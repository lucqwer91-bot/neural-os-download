import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { importFiles, listFiles, listLinks } from '../../src/main/library/library'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { aliasesOf, organize } from '../../src/main/library/organize'
import { findMention, linkMention, renameNote, replaceLinks, unlinkedMentions } from '../../src/main/library/links'
import { listVersions, setFolderEditable } from '../../src/main/library/write'

let dir: string, lib: string, db: Db
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-links-'))
  lib = join(dir, 'lib'); await mkdir(lib)
  db = openDb(join(dir, 'nos.db'))
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

async function imp(files: Record<string, string>) {
  const src = join(dir, 'src'); await mkdir(src, { recursive: true })
  const paths = []
  for (const [n, t] of Object.entries(files)) { const p = join(src, n); await writeFile(p, t); paths.push(p) }
  const r = await importFiles(db, lib, paths)
  await organize(db, lib, r.imported.map((x) => x.id))
  const byName = new Map(listFiles(db).map((x) => [x.name, x]))
  return (n: string) => byName.get(n)!
}
const text = (r: { lib_path: string }) => readFile(join(lib, r.lib_path), 'utf8')

describe('aliases', () => {
  it('reads aliases from frontmatter in all three forms', () => {
    expect(aliasesOf('---\naliases: [Haus, "Mein Heim"]\n---\n')).toEqual(['haus', 'mein heim'])
    expect(aliasesOf('---\nalias: Zuhause\n---\n')).toEqual(['zuhause'])
    expect(aliasesOf('---\ntags: x\naliases:\n  - Eins\n  - Zwei\n---\nText')).toEqual(['eins', 'zwei'])
    expect(aliasesOf('aliases: [no]\n')).toEqual([])
  })
  it('[[alias]] links to the note, in both import orders', async () => {
    const f = await imp({ 'Wohnung.md': '---\naliases: [Haus]\n---\n# Wohnung', 'Plan.md': 'siehe [[Haus]]' })
    expect(listLinks(db).some((l) => l.from_id === f('Plan.md').id && l.to_id === f('Wohnung.md').id && l.reason === 'wikilink')).toBe(true)
    expect(f('Wohnung.md').aliases).toBe('haus')
  })
})

describe('unlinked mentions', () => {
  it('finds plain mentions, not in links, code or frontmatter', () => {
    expect(findMention('Das Projekt Atlas startet', ['atlas'])?.match).toBe('Atlas')
    expect(findMention('[[Atlas]] und `atlas`', ['atlas'])).toBeNull()
    expect(findMention('---\ntitle: Atlas\n---\nnichts', ['atlas'])).toBeNull()
    expect(findMention('Atlasia', ['atlas'])).toBeNull()
  })
  it('lists notes that mention a note without linking it, and links them on request with a version', async () => {
    const f = await imp({ 'Atlas.md': '# Atlas', 'Log.md': 'Heute an atlas gearbeitet.', 'Linked.md': 'Mit [[Atlas]] verbunden, atlas.', 'Other.md': 'nichts' })
    const m = await unlinkedMentions(db, lib, f('Atlas.md').id)
    expect(m.mentions.map((x) => x.name)).toEqual(['Log.md'])
    expect(m.mentions[0].snippet).toContain('atlas')
    expect(m.mentions[0].editable).toBe(true)
    expect((await linkMention(db, lib, f('Log.md').id, f('Atlas.md').id)).ok).toBe(true)
    expect(await text(f('Log.md'))).toBe('Heute an [[Atlas|atlas]] gearbeitet.')
    expect(listVersions(db, f('Log.md').id)).toHaveLength(1)
  })
})

describe('rename', () => {
  it('rewrites [[Old]], [[Old|x]], [[Old#h]] and embeds in editable notes; other links stay', () => {
    const r = replaceLinks('[[Alt]] [[alt|A]] [[Alt#Kopf]] ![[Alt]] [[Altbau]] [[dir/Alt]]', 'alt', 'Neu')
    expect(r.text).toBe('[[Neu]] [[Neu|A]] [[Neu#Kopf]] ![[Neu]] [[Altbau]] [[dir/Neu]]')
    expect(r.count).toBe(5)
  })
  it('renames a library copy and updates links; the original import stays untouched', async () => {
    const f = await imp({ 'Alt.md': '# Alt', 'B.md': 'zu [[Alt]] und [[Alt|dem]]' })
    const r = await renameNote(db, lib, f('Alt.md').id, 'Neu')
    expect(r).toMatchObject({ ok: true, name: 'Neu.md', updated: 1, readonly: 0 })
    const rows = new Map(listFiles(db).map((x) => [x.id, x]))
    const renamed = rows.get(f('Alt.md').id)!
    expect(renamed.name).toBe('Neu.md')
    expect(await text(renamed)).toBe('# Alt')
    expect(await text(rows.get(f('B.md').id)!)).toBe('zu [[Neu]] und [[Neu|dem]]')
    expect(await readFile(join(dir, 'src', 'B.md'), 'utf8')).toBe('zu [[Alt]] und [[Alt|dem]]')
  })
  it('refuses a name that exists, and read-only vault notes are only counted', async () => {
    const vault = join(dir, 'Vault'); await mkdir(vault)
    await writeFile(join(vault, 'Ziel.md'), '# Ziel'); await writeFile(join(vault, 'Quelle.md'), '[[Ziel]]')
    const fo = addFolder(db, vault); const s = await scanFolder(db, fo.id)
    await organize(db, lib, s.added, { wikilinksOnly: true })
    const id = (n: string) => listFiles(db).find((x) => x.name === n)!.id
    expect(await renameNote(db, lib, id('Ziel.md'), 'X')).toMatchObject({ ok: false, reason: 'readonly' })
    setFolderEditable(db, fo.id, true)
    expect(await renameNote(db, lib, id('Ziel.md'), 'Quelle')).toMatchObject({ ok: false, reason: 'exists' })
    const r = await renameNote(db, lib, id('Ziel.md'), 'Ziel neu')
    expect(r).toMatchObject({ ok: true, updated: 1 })
    expect(await readFile(join(vault, 'Quelle.md'), 'utf8')).toBe('[[Ziel neu]]')
    expect(await readFile(join(vault, 'Ziel neu.md'), 'utf8')).toBe('# Ziel')
    // the next scan sees the same file, not a new one
    const again = await scanFolder(db, fo.id)
    expect(again.added).toHaveLength(0); expect(again.removed).toBe(0)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { importFiles } from '../../src/main/library/library'
import { fullSearch, tagIndex } from '../../src/main/library/notes'

let dir: string, lib: string, db: Db
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-notes-'))
  lib = join(dir, 'lib'); await mkdir(lib)
  const src = join(dir, 'src'); await mkdir(src)
  const files: Record<string, string> = {
    'Shop.md': '---\ntags: [roblox, Shop]\n---\n# Shop\nDer Server prüft die Coins. #todo',
    'Kampf.md': '# Kampf\nSchwert und Schild. Der Server berechnet Schaden. #roblox',
    'Code.md': '```\n#nichtTag\n```\nNur Code',
    'notiz.txt': 'Einkaufen: Milch'
  }
  const paths = []
  for (const [n, t] of Object.entries(files)) { const p = join(src, n); await writeFile(p, t); paths.push(p) }
  await importFiles(db = openDb(join(dir, 'nos.db')), lib, paths)
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe('tags', () => {
  it('collects frontmatter and inline tags, not tags in code', async () => {
    const t = await tagIndex(db, lib)
    expect(t.tags).toEqual([{ tag: 'roblox', count: 2 }, { tag: 'shop', count: 1 }, { tag: 'todo', count: 1 }])
    expect(t.files.roblox).toHaveLength(2)
  })
})

describe('full-text search', () => {
  it('needs every word, ranks name hits first, shows snippets', async () => {
    const r = await fullSearch(db, lib, 'server')
    expect(r.hits.map((h) => h.name).sort()).toEqual(['Kampf.md', 'Shop.md'])
    expect(r.hits[0].snippets[0].toLowerCase()).toContain('server')
    expect((await fullSearch(db, lib, 'server schwert')).hits.map((h) => h.name)).toEqual(['Kampf.md'])
    expect((await fullSearch(db, lib, 'shop')).hits[0].name).toBe('Shop.md')
    expect((await fullSearch(db, lib, 'milch')).hits.map((h) => h.name)).toEqual(['notiz.txt'])
  })
  it('supports "phrases" and #tag filters', async () => {
    expect((await fullSearch(db, lib, '"prüft die coins"')).hits.map((h) => h.name)).toEqual(['Shop.md'])
    expect((await fullSearch(db, lib, '"die coins prüft"')).hits).toHaveLength(0)
    expect((await fullSearch(db, lib, 'server #todo')).hits.map((h) => h.name)).toEqual(['Shop.md'])
    expect((await fullSearch(db, lib, '#roblox')).total).toBe(2)
  })
})

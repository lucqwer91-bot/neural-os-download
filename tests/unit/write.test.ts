import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { importFiles, listFiles } from '../../src/main/library/library'
import { addFolder, scanFolder, applyPaths } from '../../src/main/library/linked'
import { createNote, editState, listVersions, getVersion, restoreVersion, saveNote, setFolderEditable, textHash, KEEP_VERSIONS } from '../../src/main/library/write'

let dir: string, lib: string, vault: string, db: Db
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-write-'))
  lib = join(dir, 'lib'); vault = join(dir, 'Vault')
  await mkdir(lib); await mkdir(join(vault, 'Game'), { recursive: true })
  await writeFile(join(vault, 'Game', 'Plan.md'), '# Plan\n')
  await writeFile(join(vault, 'Game', 'Map.png'), Buffer.alloc(10))
  db = openDb(join(dir, 'nos.db'))
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe('note editor: safe writes (spec 5.6, 5.1)', () => {
  it('saves a library copy, keeps the old text as a version, never touches the original', async () => {
    const src = join(dir, 'Idee.md'); await writeFile(src, '# Idee\n')
    const { imported: [f] } = await importFiles(db, lib, [src])
    const r = await saveNote(db, lib, f.id, '# Idee\nNeu', textHash('# Idee\n'))
    expect(r.ok).toBe(true)
    expect(await readFile(src, 'utf8')).toBe('# Idee\n')
    const row = listFiles(db).find((x) => x.id === f.id)!
    expect(await readFile(join(lib, row.lib_path), 'utf8')).toBe('# Idee\nNeu')
    const v = listVersions(db, f.id)
    expect(v).toHaveLength(1)
    expect(getVersion(db, v[0].id)!.text).toBe('# Idee\n')
    // restore puts the old text back and keeps the newer one as a version
    expect((await restoreVersion(db, lib, v[0].id)).ok).toBe(true)
    expect(await readFile(join(lib, row.lib_path), 'utf8')).toBe('# Idee\n')
    expect(listVersions(db, f.id)).toHaveLength(2)
  })
  it('does not write when the file changed since it was opened (conflict), unless the user keeps theirs', async () => {
    const src = join(dir, 'A.md'); await writeFile(src, 'one')
    const { imported: [f] } = await importFiles(db, lib, [src])
    const path = join(lib, listFiles(db)[0].lib_path)
    await writeFile(path, 'changed by Claude')
    const r = await saveNote(db, lib, f.id, 'mine', textHash('one'))
    expect(r).toMatchObject({ ok: false, conflict: true, theirs: 'changed by Claude' })
    expect(await readFile(path, 'utf8')).toBe('changed by Claude')
    const k = await saveNote(db, lib, f.id, 'mine', null, { force: true, reason: 'conflict' })
    expect(k.ok).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('mine')
    expect(getVersion(db, listVersions(db, f.id)[0].id)!.text).toBe('changed by Claude')
  })
  it('keeps linked folders read-only until editing is turned on, and never writes other file types', async () => {
    const fo = addFolder(db, vault); await scanFolder(db, fo.id)
    const plan = listFiles(db).find((x) => x.name === 'Plan.md')!, png = listFiles(db).find((x) => x.name === 'Map.png')!
    expect(editState(db, lib, plan.id)).toEqual({ ok: false, reason: 'readonly' })
    expect(await saveNote(db, lib, plan.id, 'x', textHash('# Plan\n'))).toMatchObject({ ok: false, reason: 'readonly' })
    expect(await readFile(join(vault, 'Game', 'Plan.md'), 'utf8')).toBe('# Plan\n')
    setFolderEditable(db, fo.id, true)
    expect(editState(db, lib, png.id)).toEqual({ ok: false, reason: 'type' })
    const r = await saveNote(db, lib, plan.id, '# Plan\nmehr', textHash('# Plan\n'))
    expect(r.ok).toBe(true)
    expect(await readFile(join(vault, 'Game', 'Plan.md'), 'utf8')).toBe('# Plan\nmehr')
    // no temporary file left, and the watcher sees nothing new to index
    expect((await readdir(join(vault, 'Game'))).sort()).toEqual(['Map.png', 'Plan.md'])
    expect((await applyPaths(db, fo.id, ['Game/Plan.md', 'Game/.abc.nos-tmp'])).changed).toEqual([])
  })
  it('keeps at most a fixed number of versions and creates new notes', async () => {
    const n = await createNote(db, lib, { name: 'Tagebuch/heute?', project: 'Ideen' })
    expect(n.name).toBe('Tagebuch-heute-.md')
    let base = textHash('# Tagebuch-heute-\n\n')
    for (let i = 0; i < KEEP_VERSIONS + 3; i++) { const t = 'v' + i; const r = await saveNote(db, lib, n.id, t, base); expect(r.ok).toBe(true); base = textHash(t) }
    expect(listVersions(db, n.id)).toHaveLength(KEEP_VERSIONS)
    expect(listFiles(db).find((x) => x.id === n.id)!.project).toBe('Ideen')
  })
})

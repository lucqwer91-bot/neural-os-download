import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, schemaVersion, MIGRATIONS, type Db } from '../../src/main/library/db'
import { isInside } from '../../src/main/library/files'
import { planImport, importFiles, stats, listFiles, removeFile, readContent } from '../../src/main/library/library'

let dir: string, src: string, lib: string, db: Db

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-lib-'))
  src = join(dir, 'src'); lib = join(dir, 'lib')
  await mkdir(join(src, 'notes', '.obsidian'), { recursive: true })
  await mkdir(lib)
  await writeFile(join(src, 'notes', 'GameLoop.md'), '# GameLoop\n[[Lobby]]')
  await writeFile(join(src, 'notes', 'Copy of GameLoop.md'), '# GameLoop\n[[Lobby]]')   // same content
  await writeFile(join(src, 'notes', 'Lobby.rbxl'), Buffer.alloc(64, 1))
  await writeFile(join(src, 'notes', '.obsidian', 'app.json'), '{}')
  await writeFile(join(src, 'notes', '.DS_Store'), 'x')
  db = openDb(join(dir, 'nos.db'))
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe('database', () => {
  it('runs all migrations once', () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    db.close(); db = openDb(join(dir, 'nos.db'))
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
  })
})

describe('library import', () => {
  it('plans an import without copying, skipping tool folders', async () => {
    const p = await planImport([join(src, 'notes')])
    expect(p.count).toBe(3)
    // the folder has .obsidian inside: an Obsidian vault is linked, not copied
    expect(p.vault).toBe(true)
    expect(p.suggest).toBe('link')
    expect(listFiles(db)).toEqual([])
    const plain = await planImport([join(src, 'notes', 'GameLoop.md')])
    expect(plain).toMatchObject({ vault: false, suggest: 'copy' })
  })

  it('copies files, detects duplicates by content and leaves originals untouched', async () => {
    const before = await stat(join(src, 'notes', 'GameLoop.md'))
    const r = await importFiles(db, lib, [join(src, 'notes')], { now: () => new Date('2026-11-16T20:00:00Z') })
    expect(r.imported.map((x) => x.name).sort()).toEqual(['Copy of GameLoop.md', 'Lobby.rbxl'])
    expect(r.duplicates).toHaveLength(1)
    expect(r.failed).toEqual([])
    const rows = listFiles(db)
    const md = rows.find((x) => x.ext === 'md')!
    expect(md.status).toBe('indexed')
    expect(rows.find((x) => x.ext === 'rbxl')!.status).toBe('unsupported')
    expect(md.original_path).toContain('GameLoop.md')
    expect(await readFile(join(lib, md.lib_path), 'utf8')).toBe('# GameLoop\n[[Lobby]]')
    const after = await stat(join(src, 'notes', 'GameLoop.md'))
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(stats(db)).toEqual({ count: 2, bytes: 20 + 64, byType: { md: 1, rbxl: 1 } })

    const again = await importFiles(db, lib, [join(src, 'notes')])
    expect(again.imported).toEqual([])
    expect(again.duplicates).toHaveLength(3)
  })

  it('never imports the library into itself', async () => {
    await importFiles(db, lib, [join(src, 'notes', 'GameLoop.md')])
    const r = await importFiles(db, lib, [dir], { exclude: [join(dir, 'nos.db')] })
    expect(r.failed).toEqual([])
    expect(listFiles(db).every((x) => !x.original_path.startsWith(lib))).toBe(true)
    expect((await planImport([dir], [lib])).count).toBeLessThan((await planImport([dir])).count)
  })

  it('compares paths case-insensitively on Windows and macOS', () => {
    expect(isInside('/a/Lib/x.md', '/a/lib', 'darwin')).toBe(true)
    // Windows path maths is case-insensitive on its own, so the Linux case only holds on a Linux host
    if (process.platform === 'linux') expect(isInside('/a/Lib/x.md', '/a/lib', 'linux')).toBe(false)
    expect(isInside('/a/library2', '/a/lib', 'win32')).toBe(false)
    expect(isInside('/a/lib', '/a/lib')).toBe(true)
  })

  it('reports unreadable paths instead of failing', async () => {
    const r = await importFiles(db, lib, [join(src, 'missing.md')])
    expect(r.failed).toEqual([{ path: join(src, 'missing.md'), error: 'ENOENT' }])
  })

  it('removes only the library copy', async () => {
    const r = await importFiles(db, lib, [join(src, 'notes', 'GameLoop.md')])
    const row = listFiles(db)[0]
    expect(await removeFile(db, lib, r.imported[0].id)).toBe(true)
    expect(listFiles(db)).toEqual([])
    await expect(stat(join(lib, row.lib_path))).rejects.toThrow()
    expect(await readFile(join(src, 'notes', 'GameLoop.md'), 'utf8')).toContain('GameLoop')
  })

  it('reads file content for the preview, read-only', async () => {
    const r = await importFiles(db, lib, [join(src, 'notes', 'GameLoop.md')])
    const c = await readContent(db, lib, r.imported[0].id)
    expect(c.kind).toBe('text')
    if (c.kind === 'text') expect(c.text).toContain('GameLoop')
    expect(await readContent(db, lib, 'nope')).toEqual({ kind: 'none', reason: 'missing' })
  })
})

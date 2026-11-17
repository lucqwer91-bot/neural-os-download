import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { listFiles } from '../../src/main/library/library'
import { addFolder, scanFolder, applyPaths } from '../../src/main/library/linked'
import { setFolderEditable } from '../../src/main/library/write'
import { dirTree, movePath, moveFile, newFolder, newNote, restoreTrash, trashPath } from '../../src/main/library/fileops'

let dir: string, vault: string, db: Db, fid: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-fs-'))
  vault = join(dir, 'Vault')
  await mkdir(join(vault, 'Game', 'Ideas'), { recursive: true })
  await mkdir(join(vault, 'Empty'), { recursive: true })
  await mkdir(join(vault, '.obsidian'), { recursive: true })
  await writeFile(join(vault, 'Game', 'Ideas', 'Shop.md'), '# Shop')
  await writeFile(join(vault, 'Inbox.md'), '[[Shop]]')
  db = openDb(join(dir, 'nos.db'))
  fid = addFolder(db, vault).id
  await scanFolder(db, fid)
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

const row = (name: string) => listFiles(db).find((f) => f.name === name)!

describe('file explorer', () => {
  it('only works in folders with editing on', async () => {
    expect(await newNote(db, fid, '', 'X')).toEqual({ ok: false, reason: 'readonly' })
    expect(await trashPath(db, fid, 'Inbox.md')).toEqual({ ok: false, reason: 'readonly' })
    expect(existsSync(join(vault, 'Inbox.md'))).toBe(true)
  })

  it('lists folders, also empty ones, without hidden ones', async () => {
    const t = await dirTree(db)
    expect(t[0].dirs).toEqual(['Empty', 'Game', 'Game/Ideas'])
  })

  it('creates notes and folders with free names, indexed right away', async () => {
    setFolderEditable(db, fid, true)
    const a = await newNote(db, fid, 'Game', 'Plan'), b = await newNote(db, fid, 'Game', 'Plan')
    expect([a.ok && a.rel, b.ok && b.rel]).toEqual(['Game/Plan.md', 'Game/Plan 1.md'])
    expect(row('Plan 1.md').project).toBe('Game')
    expect(await newFolder(db, fid, 'Game', 'Ideas')).toEqual({ ok: true, rel: 'Game/Ideas 1' })
    expect((await newNote(db, fid, '../x', 'Bad')).ok).toBe(false)
  })

  it('moves and renames files and folders, keeping file ids and fixing projects', async () => {
    setFolderEditable(db, fid, true)
    const shop = row('Shop.md').id
    expect(await moveFile(db, shop, 'Empty')).toMatchObject({ ok: true, rel: 'Empty/Shop.md', id: shop })
    expect(row('Shop.md')).toMatchObject({ id: shop, rel_path: 'Empty/Shop.md', project: 'Empty' })
    expect(await movePath(db, fid, 'Empty', '', 'Shops')).toMatchObject({ ok: true, rel: 'Shops' })
    expect(row('Shop.md')).toMatchObject({ id: shop, rel_path: 'Shops/Shop.md', project: 'Shops' })
    expect(await movePath(db, fid, 'Shops', 'Shops')).toEqual({ ok: false, reason: 'inside' })
    expect(await movePath(db, fid, 'Inbox.md', 'Shops', 'Shop')).toEqual({ ok: false, reason: 'exists' })
    // the watcher seeing the same paths afterwards changes nothing
    await applyPaths(db, fid, ['Empty/Shop.md', 'Shops/Shop.md', 'Empty', 'Shops'])
    expect(listFiles(db).filter((f) => f.name === 'Shop.md').map((f) => f.id)).toEqual([shop])
  })

  it('trash moves into .trash and can be undone', async () => {
    setFolderEditable(db, fid, true)
    const t = await trashPath(db, fid, 'Game')
    expect(t).toMatchObject({ ok: true, trash: '.trash/Game' })
    expect(listFiles(db).some((f) => f.name === 'Shop.md')).toBe(false)
    expect(await readdir(join(vault, '.trash', 'Game', 'Ideas'))).toEqual(['Shop.md'])
    expect(await restoreTrash(db, fid, '.trash/Game', 'Game')).toEqual({ ok: true, rel: 'Game' })
    await applyPaths(db, fid, ['Game'])
    expect(row('Shop.md').rel_path).toBe('Game/Ideas/Shop.md')
  })
})

describe('attachments', () => {
  it('puts a pasted image where Obsidian would and indexes it; read-only notes refuse', async () => {
    const { saveAttachment, attachDir } = await import('../../src/main/library/attach')
    const inbox = row('Inbox.md').id, png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    expect(await saveAttachment(db, dir, inbox, 'Pasted image.png', png)).toEqual({ ok: false, reason: 'readonly' })
    setFolderEditable(db, fid, true)
    const a = await saveAttachment(db, dir, inbox, 'Pasted image.png', png)
    expect(a).toMatchObject({ ok: true, name: 'Pasted image.png' })
    expect(row('Pasted image.png').rel_path).toBe('Pasted image.png')
    expect(await saveAttachment(db, dir, inbox, 'x.exe', png)).toEqual({ ok: false, reason: 'type' })
    await mkdir(join(vault, '.obsidian'), { recursive: true })
    await writeFile(join(vault, '.obsidian', 'app.json'), JSON.stringify({ attachmentFolderPath: './assets' }))
    expect(await attachDir(vault, 'Game/Ideas/Shop.md')).toBe('Game/Ideas/assets')
    const b = await saveAttachment(db, dir, row('Shop.md').id, 'Pasted image.png', png)
    expect(b).toMatchObject({ ok: true, name: 'Pasted image.png' })
    expect(existsSync(join(vault, 'Game', 'Ideas', 'assets', 'Pasted image.png'))).toBe(true)
    await writeFile(join(vault, '.obsidian', 'app.json'), JSON.stringify({ attachmentFolderPath: '../out' }))
    expect(await attachDir(vault, 'Inbox.md')).toBe('')
  })
})

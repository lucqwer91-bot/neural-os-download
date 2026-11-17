import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, utimes, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { listFiles, listLinks, removeFile, stats } from '../../src/main/library/library'
import { addFolder, scanFolder, applyPaths, removeFolder, listFolders } from '../../src/main/library/linked'
import { organize } from '../../src/main/library/organize'

let dir: string, vault: string, db: Db
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-link-'))
  vault = join(dir, 'Obsidian Vault')
  await mkdir(join(vault, 'Roblox Game', 'Scripts'), { recursive: true })
  await mkdir(join(vault, '.obsidian'), { recursive: true })
  await mkdir(join(vault, 'Roblox Game', 'build'), { recursive: true })
  await writeFile(join(vault, 'Roblox Game', 'GameLoop.md'), '# GameLoop\n[[Lobby]]')
  await writeFile(join(vault, 'Roblox Game', 'Lobby.md'), '# Lobby')
  await writeFile(join(vault, 'Roblox Game', 'Scripts', 'Shop.luau'), 'return {}')
  await writeFile(join(vault, 'Roblox Game', 'Place.rbxl'), Buffer.alloc(100))
  await writeFile(join(vault, 'Roblox Game', 'build', 'out.rbxl'), Buffer.alloc(100))
  await writeFile(join(vault, '.obsidian', 'app.json'), '{}')
  await writeFile(join(vault, 'Inbox.md'), 'see [[GameLoop]]')
  db = openDb(join(dir, 'nos.db'))
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

const names = () => listFiles(db).map((f) => f.name).sort()
const snapshot = async () => {
  const out: Record<string, string> = {}
  for (const p of ['Roblox Game/GameLoop.md', 'Roblox Game/Lobby.md', 'Inbox.md']) out[p] = await readFile(join(vault, p), 'utf8')
  return out
}

describe('linked folders', () => {
  it('indexes in place, read-only, skipping tool and build folders', async () => {
    const before = await snapshot(), m = (await stat(join(vault, 'Inbox.md'))).mtimeMs
    const f = addFolder(db, vault)
    const r = await scanFolder(db, f.id)
    expect(r.added).toHaveLength(5)
    expect(names()).toEqual(['GameLoop.md', 'Inbox.md', 'Lobby.md', 'Place.rbxl', 'Shop.luau'])
    const rows = Object.fromEntries(listFiles(db).map((x) => [x.name, x]))
    expect(rows['Shop.luau'].project).toBe('Roblox Game')          // top-level subfolder = project
    expect(rows['Inbox.md'].project).toBe('Obsidian Vault')        // file at the top: the vault itself
    expect(rows['Place.rbxl'].status).toBe('nameonly')
    expect(rows['Shop.luau'].status).toBe('indexed')
    expect(rows['Shop.luau'].source).toBe('linked')
    expect(await snapshot()).toEqual(before)
    expect((await stat(join(vault, 'Inbox.md'))).mtimeMs).toBe(m)
    expect(listFolders(db)[0].files).toBe(5)
  })

  it('takes over the wikilinks of the vault as links written by the user', async () => {
    const f = addFolder(db, vault)
    const r = await scanFolder(db, f.id)
    await organize(db, dir, r.added)
    const byId = Object.fromEntries(listFiles(db).map((x) => [x.id, x.name]))
    const L = listLinks(db).filter((l) => l.reason === 'wikilink').map((l) => byId[l.from_id] + '>' + byId[l.to_id]).sort()
    expect(L).toEqual(['GameLoop.md>Lobby.md', 'Inbox.md>GameLoop.md'])
  })

  it('updates only what changed and notices deleted files', async () => {
    const f = addFolder(db, vault)
    await scanFolder(db, f.id)
    await writeFile(join(vault, 'Roblox Game', 'Lobby.md'), '# Lobby\nmore')
    const t = new Date(Date.now() + 5000); await utimes(join(vault, 'Roblox Game', 'Lobby.md'), t, t)
    await rm(join(vault, 'Inbox.md'))
    await writeFile(join(vault, 'New.md'), 'x')
    const r = await scanFolder(db, f.id)
    expect(r.added).toHaveLength(1)
    expect(r.changed).toHaveLength(1)
    expect(r.removed).toBe(1)
    expect(names()).toContain('New.md')
    expect(names()).not.toContain('Inbox.md')
  })

  it('applies single changed paths from the watcher', async () => {
    const f = addFolder(db, vault)
    await scanFolder(db, f.id)
    await writeFile(join(vault, 'Roblox Game', 'Spawn.md'), 'x')
    await rm(join(vault, 'Roblox Game', 'Lobby.md'))
    const r = await applyPaths(db, f.id, ['Roblox Game/Spawn.md', 'Roblox Game/Lobby.md', '.obsidian/app.json'])
    expect(r.added).toHaveLength(1)
    expect(r.removed).toBe(1)
    expect(names()).toContain('Spawn.md')
  })

  it('unlinking removes only the index; linked files cannot be removed one by one', async () => {
    const f = addFolder(db, vault)
    await scanFolder(db, f.id)
    expect(await removeFile(db, dir, listFiles(db)[0].id)).toBe(false)
    expect(removeFolder(db, f.id)).toBe(true)
    expect(stats(db).count).toBe(0)
    expect(await readFile(join(vault, 'Inbox.md'), 'utf8')).toContain('GameLoop')
  })
  it('a copied folder (events for the folder and its files) is added once, not rolled back', async () => {
    const f = addFolder(db, vault)
    await scanFolder(db, f.id)
    const before = stats(db).count
    await mkdir(join(vault, 'Extras', 'Pack'), { recursive: true })
    await writeFile(join(vault, 'Extras', 'Pack', 'a.png'), 'x')
    await writeFile(join(vault, 'Extras', 'Pack', 'b.md'), 'b')
    const r = await applyPaths(db, f.id, ['Extras', 'Extras/Pack', 'Extras/Pack/a.png', 'Extras/Pack/b.md', 'Extras/Pack/a.png'])
    expect(r.added).toHaveLength(2)
    expect(stats(db).count).toBe(before + 2)
  })
})

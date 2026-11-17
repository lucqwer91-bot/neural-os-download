import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { importFiles, listFiles, listLinks } from '../../src/main/library/library'
import { organize, nameTokens, wikilinks, mentions, projectFromPath } from '../../src/main/library/organize'

describe('rules', () => {
  it('finds distinctive name words', () => {
    expect(nameTokens('Lobby-Portale final (Kopie).md')).toEqual(['lobby', 'portale'])
    expect(nameTokens('2026-11-16.md')).toEqual([])
  })
  it('reads wikilinks', () => {
    expect(wikilinks('see [[GameLoop]] and [[Maps/Lobby.rbxl|lobby]] and [[GameLoop#x]]')).toEqual(['gameloop', 'lobby'])
  })
  it('finds whole-word mentions only', () => {
    expect(mentions('Der GameLoop startet', 'GameLoop.md')).toBe(true)
    expect(mentions('GameLoops everywhere', 'GameLoop.md')).toBe(false)
    expect(mentions('map', 'Map.md')).toBe(false)   // too short to count
  })
  it('takes the project from the folder, but not from generic folders', () => {
    expect(projectFromPath('/x/Roblox Game/GameLoop.md')).toBe('Roblox Game')
    expect(projectFromPath('/home/u/Downloads/a.md')).toBe(null)
  })
})

let dir: string, lib: string, db: Db
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-org-'))
  lib = join(dir, 'lib'); await mkdir(lib)
  await mkdir(join(dir, 'Roblox Game'), { recursive: true })
  await mkdir(join(dir, 'Downloads'), { recursive: true })
  await writeFile(join(dir, 'Roblox Game', 'GameLoop.md'), '# GameLoop\nRunden starten in der Lobby.')
  await writeFile(join(dir, 'Roblox Game', 'Lobby.rbxl'), Buffer.alloc(10, 2))
  await writeFile(join(dir, 'Downloads', 'Map-Ideen.md'), '# Ideen\nSiehe [[GameLoop]].')
  await writeFile(join(dir, 'Downloads', 'Lobby Moodboard.png'), Buffer.alloc(10, 3))
  await writeFile(join(dir, 'Downloads', 'Rezept.txt'), 'Pfannkuchen')
  db = openDb(join(dir, 'nos.db'))
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

const ids = (r: { imported: { id: string }[] }) => r.imported.map((x) => x.id)
const byName = () => Object.fromEntries(listFiles(db).map((f) => [f.name, f]))

describe('organize after import', () => {
  it('sorts dropped files into the matching project and links them, with reasons', async () => {
    const first = await importFiles(db, lib, [join(dir, 'Roblox Game')])
    const o1 = await organize(db, lib, ids(first))
    expect(o1.projects).toEqual({ 'Roblox Game': 2 })

    // later: loose files from Downloads are dropped in
    const second = await importFiles(db, lib, [join(dir, 'Downloads')])
    const o2 = await organize(db, lib, ids(second))
    const f = byName()
    expect(f['Map-Ideen.md'].project).toBe('Roblox Game')          // links to GameLoop
    expect(f['Lobby Moodboard.png'].project).toBe('Roblox Game')   // shares "lobby" with Lobby.rbxl
    expect(f['Rezept.txt'].project).toBe(null)                     // nothing matches, generic folder
    expect(o2.projects).toEqual({ 'Roblox Game': 2 })

    const L = listLinks(db)
    const has = (a: string, b: string, reason: string) =>
      L.some((l) => l.reason === reason && [l.from_id, l.to_id].sort().join() === [f[a].id, f[b].id].sort().join())
    expect(has('Map-Ideen.md', 'GameLoop.md', 'wikilink')).toBe(true)
    expect(L.find((l) => l.reason === 'wikilink')!.origin).toBe('user')
    expect(has('GameLoop.md', 'Lobby.rbxl', 'folder')).toBe(true)
    expect(has('Lobby Moodboard.png', 'Lobby.rbxl', 'name')).toBe(true)
    expect(L.filter((l) => l.reason !== 'wikilink').every((l) => l.origin === 'auto')).toBe(true)
    expect(L.some((l) => [l.from_id, l.to_id].includes(f['Rezept.txt'].id))).toBe(false)
  })

  it('ignores name words that many files share', async () => {
    for (let i = 0; i < 8; i++) await writeFile(join(dir, 'Downloads', `Note ${i}.md`), 'x')
    const r = await importFiles(db, lib, [join(dir, 'Downloads')])
    await organize(db, lib, ids(r))
    expect(listLinks(db).filter((l) => l.reason === 'name')).toHaveLength(0)   // "note" is in 8 names: not distinctive
  })

  it('keeps auto links as suggestions when auto-linking is off', async () => {
    const r = await importFiles(db, lib, [join(dir, 'Roblox Game')])
    const o = await organize(db, lib, ids(r), { autoLink: false })
    expect(o.links).toBe(0)
    expect(o.suggested).toBeGreaterThan(0)
    expect(listLinks(db).every((l) => l.status === 'suggested')).toBe(true)
  })

  it('never overwrites a project the file already has', async () => {
    const r = await importFiles(db, lib, [join(dir, 'Roblox Game', 'GameLoop.md')])
    db.prepare("INSERT INTO project (id, name, created_at) VALUES ('p1', 'Mein Projekt', 'x')").run()
    db.prepare("UPDATE file_asset SET project_id = 'p1', project_origin = 'user'").run()
    await organize(db, lib, ids(r))
    expect(byName()['GameLoop.md'].project).toBe('Mein Projekt')
  })
})

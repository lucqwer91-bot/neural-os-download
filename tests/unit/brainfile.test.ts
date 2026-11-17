import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { importFiles } from '../../src/main/library/library'
import { organize } from '../../src/main/library/organize'
import { exportBrain, exportPlan, importBrain, listBrains, brainData, readBrainFile, bridges, removeBrain, setVisible, peekBrain, brainFilePath } from '../../src/main/brains/brainfile'

let dir: string, db: Db, lib: string, brains: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-br-')); lib = join(dir, 'lib'); brains = join(dir, 'brains'); await mkdir(lib)
  db = openDb(join(dir, 'nos.db'))
  const src = join(dir, 'src', 'Roblox'); await mkdir(src, { recursive: true })
  await writeFile(join(src, 'Lobby.md'), '# Lobby\nSiehe [[Spawn]] und [[Shop]].')
  await writeFile(join(src, 'Spawn.md'), '# Spawn\n3 Sekunden Schutz.')
  await writeFile(join(src, 'Shop.md'), '# Shop\nPets.')
  await writeFile(join(src, 'Bild.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  const r = await importFiles(db, lib, [join(dir, 'src', 'Roblox')])
  await organize(db, lib, r.imported.map((x) => x.id), {})
})
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe('.brain files (S4)', () => {
  it('exports, imports and reads a brain; the original library is untouched', async () => {
    const plan = exportPlan(db, { name: 'x' })
    expect(plan.files).toBe(4)
    const out = join(dir, 'Mein Gehirn.brain')
    const e = await exportBrain(db, lib, out, { name: 'Mein Gehirn', author: 'Alex' })
    expect(e).toMatchObject({ files: 4, missing: 0 })
    const j = await peekBrain(out)
    expect(j.name).toBe('Mein Gehirn')
    expect(j.files.map((f) => f.name).sort()).toEqual(['Bild.png', 'Lobby.md', 'Shop.md', 'Spawn.md'])
    expect(j.links.length).toBeGreaterThan(0)
    const info = await importBrain(brains, out)
    expect(info).toMatchObject({ name: 'Mein Gehirn', author: 'Alex', files: 4, visible: true })
    expect((await listBrains(brains)).map((b) => b.id)).toEqual([info.id])
    const lobby = j.files.find((f) => f.name === 'Lobby.md')!
    expect(await readBrainFile(brains, info.id, lobby.id)).toMatchObject({ kind: 'text', ext: 'md', text: '# Lobby\nSiehe [[Spawn]] und [[Shop]].' })
    const img = j.files.find((f) => f.name === 'Bild.png')!
    expect(await readFile(brainFilePath(brains, info.id, img)!)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
    expect(await setVisible(brains, info.id, false)).toBe(true)
    expect((await listBrains(brains))[0].visible).toBe(false)
    expect(await removeBrain(brains, info.id)).toBe(true)
    expect(await listBrains(brains)).toEqual([])
    expect(await removeBrain(brains, '../../etc')).toBe(false)
  })
  it('exports only chosen projects and leaves session notes out unless asked', async () => {
    db.prepare("INSERT INTO project (id, name, created_at) VALUES ('ps', 'Claude Sessions', 'x')").run()
    await mkdir(join(lib, 'Sessions'), { recursive: true }); await writeFile(join(lib, 'Sessions', 's.md'), 'session')
    db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, status, source) VALUES ('s1', 's.md', 'md', 7, 'session:s1', 'Sessions/s.md', '', 'x', 'ps', 'indexed', 'session')`).run()
    expect((await exportBrain(db, lib, join(dir, 'a.brain'), { name: 'a' })).files).toBe(4)
    expect((await exportBrain(db, lib, join(dir, 'b.brain'), { name: 'b', sessions: true })).files).toBe(5)
    expect((await exportBrain(db, lib, join(dir, 'c.brain'), { name: 'c', projects: ['Nichts'] })).files).toBe(0)
  })
  it('finds bridges by name and shared links', async () => {
    const out = join(dir, 'x.brain')
    await exportBrain(db, lib, out, { name: 'x' })
    const j = (await brainData(brains, (await importBrain(brains, out)).id))!
    const b = bridges(db, j)
    expect(b.files.filter((x) => x.why === 'name')).toHaveLength(4)
    expect(b.files.some((x) => x.why === 'links')).toBe(true)
    expect(b.projects).toEqual([{ mine: 'Roblox', theirs: 'Roblox' }])
  })
  it('never writes outside the brain folder and refuses other files', async () => {
    // a hand-made tar with brain.json and a "../" entry
    const ent = (name: string, body: Buffer) => {
      const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write(body.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h[156] = 0x30; h.write('ustar\0', 257); h.write('00', 263)
      let s = 0; for (const b of h) s += b; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148)
      return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)])
    }
    const json = Buffer.from(JSON.stringify({ format: 'neural-os-brain', version: 1, name: 'bad', author: null, created: 'x', projects: [], files: [], links: [] }))
    const evil = join(dir, 'evil.brain')
    await writeFile(evil, Buffer.concat([ent('brain.json', json), ent('../../pwned.txt', Buffer.from('x')), ent('files/1/../../p.txt', Buffer.from('y')), Buffer.alloc(1024)]))
    const info = await importBrain(brains, evil)
    expect(await readdir(dir)).not.toContain('pwned.txt')
    expect(await readdir(join(brains, info.id))).toEqual(expect.arrayContaining(['brain.json', 'meta.json']))
    await writeFile(join(dir, 'no.brain'), 'hello')
    await expect(importBrain(brains, join(dir, 'no.brain'))).rejects.toThrow('notBrain')
  })
})

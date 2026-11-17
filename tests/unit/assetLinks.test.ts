import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { assetLinks, baseName, GROUP } from '../../src/main/library/assetLinks'

describe('asset links', () => {
  it('base names drop format and texture-map suffixes', () => {
    expect(baseName('Rhino.fbx')).toBe('rhino')
    expect(baseName('Rhino_Albedo.png')).toBe('rhino')
    expect(baseName('rock-normal_4k.jpg')).toBe('rock')
    expect(baseName('Readme.md')).toBe('readme')
  })
  it('scans long notes without slow backtracking', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nos-al2-')), v = join(dir, 'V')
    await mkdir(v, { recursive: true })
    await writeFile(join(v, 'Long.md'), ('a-b_c-d_e-f_g-h_i-j_k-l_m-n_o-p_q-r_s-t ').repeat(3000) + ' see boss.glb')
    await writeFile(join(v, 'boss.glb'), 'x')
    const db = openDb(join(dir, 'db.sqlite')); const f = addFolder(db, v); await scanFolder(db, f.id)
    const t = Date.now(); const r = await assetLinks(db)
    expect(Date.now() - t).toBeLessThan(2000)
    expect(r.byReason.mention).toBe(1)
    db.close(); await rm(dir, { recursive: true, force: true })
  })
  it('gives every file of a linked folder a link, from facts only, and recomputes in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nos-al-')), v = join(dir, 'V')
    await mkdir(join(v, 'Pack', 'Rhino'), { recursive: true })
    await mkdir(join(v, 'Pack', 'Textures'), { recursive: true })
    await mkdir(join(v, 'Notes'), { recursive: true })
    await writeFile(join(v, 'Pack', 'README.md'), 'The pack. See Dragon.glb for the boss.')
    await writeFile(join(v, 'Pack', 'Dragon.glb'), 'x')
    for (const n of ['Rhino.fbx', 'Rhino.glb', 'Rhino_albedo.png', 'Rhino_normal.png', 'preview.png']) await writeFile(join(v, 'Pack', 'Rhino', n), 'x')
    for (let i = 0; i < GROUP + 5; i++) await writeFile(join(v, 'Pack', 'Textures', `tex${i}.png`), 'x')
    await writeFile(join(v, 'Notes', 'Rhino.md'), 'about rhinos')
    const db = openDb(join(dir, 'db.sqlite'))
    const f = addFolder(db, v)
    await scanFolder(db, f.id)
    const r = await assetLinks(db)
    const id = (rel: string) => (db.prepare('SELECT id FROM file_asset WHERE rel_path = ?').get(rel) as { id: string }).id
    const edges = db.prepare('SELECT from_id, to_id, reason FROM knowledge_edge').all() as { from_id: string; to_id: string; reason: string }[]
    const has = (a: string, b: string, reason: string) => edges.some((e) => e.from_id === id(a) && e.to_id === id(b) && e.reason === reason)
    expect(has('Pack/Rhino/Rhino.fbx', 'Pack/Rhino/Rhino.glb', 'samename')).toBe(true)
    expect(has('Pack/Rhino/Rhino.fbx', 'Pack/Rhino/Rhino_albedo.png', 'samename')).toBe(true)
    expect(has('Pack/README.md', 'Pack/Dragon.glb', 'mention')).toBe(true)
    expect(has('Notes/Rhino.md', 'Pack/Rhino/Rhino.fbx', 'name')).toBe(true)
    // every file has at least one link
    const all = (db.prepare('SELECT id FROM file_asset').all() as { id: string }[]).map((x) => x.id)
    const touched = new Set(edges.flatMap((e) => [e.from_id, e.to_id]))
    expect(all.filter((x) => !touched.has(x))).toEqual([])
    // big folder: no file gets more than GROUP folder lines
    const deg = new Map<string, number>()
    for (const e of edges) if (e.reason === 'folder') deg.set(e.from_id, (deg.get(e.from_id) || 0) + 1)
    expect(Math.max(...deg.values())).toBeLessThanOrEqual(GROUP)
    // all auto, and a second run gives the same set
    expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_edge WHERE origin != 'auto'").get()).toEqual({ n: 0 })
    const again = await assetLinks(db)
    expect(again.links).toBe(r.links)
    expect((db.prepare('SELECT COUNT(*) AS n FROM knowledge_edge').get() as { n: number }).n).toBe(r.links)
    db.close(); await rm(dir, { recursive: true, force: true })
  })
})

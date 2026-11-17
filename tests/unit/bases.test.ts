import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { listFiles, listLinks } from '../../src/main/library/library'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { canvasTargets, organize } from '../../src/main/library/organize'
import { evalBase, parseYaml } from '../../src/main/library/bases'

let dir: string, db: Db
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nos-bases-')); db = openDb(join(dir, 'nos.db')) })
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

const BASE = `filters:
  and:
    - file.hasTag("quest")
    - 'status != "fertig"'
properties:
  note.status:
    displayName: Zustand
views:
  - type: table
    name: Offene Quests
    order:
      - file.name
      - status
      - xp
    sort:
      - property: xp
        direction: DESC
  - type: table
    name: Im Ordner Welt
    filters: file.inFolder("Welt") && xp > 9
    order: [file.basename, formula.score]
  - type: cards
    name: Karten
`

describe('bases', () => {
  it('reads the YAML subset .base files use', () => {
    const y = parseYaml(BASE) as { filters: { and: string[] }; views: { name: string; order: string[]; sort: { property: string }[] }[] }
    expect(y.filters.and).toEqual(['file.hasTag("quest")', 'status != "fertig"'])
    expect(y.views[0].name).toBe('Offene Quests'); expect(y.views[0].order).toEqual(['file.name', 'status', 'xp'])
    expect(y.views[0].sort[0].property).toBe('xp'); expect(y.views[1].order).toEqual(['file.basename', 'formula.score'])
  })
  it('shows views as tables over the notes, honest about what it cannot read', async () => {
    const v = join(dir, 'V'); await mkdir(join(v, 'Welt'), { recursive: true })
    await writeFile(join(v, 'Drache.md'), '---\nstatus: offen\nxp: 50\ntags: [quest]\n---\n')
    await writeFile(join(v, 'Welt', 'Höhle.md'), '---\nstatus: offen\nxp: 20\n---\n#quest')
    await writeFile(join(v, 'Brot.md'), '---\nstatus: fertig\nxp: 5\ntags: [quest]\n---\n')
    await writeFile(join(v, 'Notiz.md'), 'nichts')
    await writeFile(join(v, 'Quests.base'), BASE)
    const f = addFolder(db, v); await scanFolder(db, f.id)
    const id = listFiles(db).find((r) => r.name === 'Quests.base')!.id
    const r = await evalBase(db, join(dir, 'lib'), id)
    if (!r.ok) throw new Error(r.reason)
    expect(r.views[0].columns.map((c) => c.label)).toEqual(['name', 'Zustand', 'xp'])
    expect(r.views[0].rows.map((x) => x.cells)).toEqual([['Drache.md', 'offen', '50'], ['Höhle.md', 'offen', '20']])
    expect(r.views[0].skipped).toEqual([])
    expect(r.views[1].rows.map((x) => x.cells[0])).toEqual(['Höhle'])
    expect(r.views[1].skipped).toEqual(['formula.score'])
    expect(r.views[2].unsupportedType).toBe(true)
  })
})

describe('canvas', () => {
  it('file cards and [[links]] in text cards link the canvas to notes', async () => {
    expect(canvasTargets(JSON.stringify({ nodes: [{ type: 'file', file: 'Welt/Drache.md' }, { type: 'text', text: 'siehe [[Höhle]]' }, { type: 'link', url: 'https://x' }] }))).toEqual(['drache', 'höhle'])
    const v = join(dir, 'C'); await mkdir(v)
    await writeFile(join(v, 'Drache.md'), '# Drache'); await writeFile(join(v, 'Plan.canvas'), JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Drache.md', x: 0, y: 0, width: 200, height: 100 }], edges: [] }))
    const f = addFolder(db, v); const s = await scanFolder(db, f.id)
    await organize(db, join(dir, 'lib'), s.added, { wikilinksOnly: true })
    const byName = new Map(listFiles(db).map((x) => [x.name, x.id]))
    expect(listLinks(db).some((l) => l.from_id === byName.get('Plan.canvas') && l.to_id === byName.get('Drache.md'))).toBe(true)
  })
})

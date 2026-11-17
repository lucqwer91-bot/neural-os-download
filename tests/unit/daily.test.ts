import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { listFiles } from '../../src/main/library/library'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { setFolderEditable } from '../../src/main/library/write'
import { dailyNote, fillTemplate, formatDate, templates, templateText } from '../../src/main/library/daily'

let dir: string, lib: string, db: Db
const day = new Date(2026, 10, 17, 9, 5)
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nos-daily-')); lib = join(dir, 'lib'); await mkdir(lib); db = openDb(join(dir, 'nos.db')) })
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe('daily note', () => {
  it('formats dates and fills templates like Obsidian', () => {
    expect(formatDate(day, 'YYYY-MM-DD')).toBe('2026-11-17')
    expect(formatDate(day, 'D. MMMM YYYY [Notiz]')).toBe('17. November 2026 Notiz')
    expect(fillTemplate('# {{title}}\n{{date}} {{time}} {{date:DD.MM.YYYY}}', 'Heute', day)).toBe('# Heute\n2026-11-17 09:05 17.11.2026')
  })
  it('creates today\'s note in the library once, then opens the same note', async () => {
    const a = await dailyNote(db, lib, { now: day })
    expect(a).toMatchObject({ created: true, where: 'library' })
    const b = await dailyNote(db, lib, { now: day })
    expect(b).toMatchObject({ id: a.id, created: false })
    const row = listFiles(db).find((r) => r.id === a.id)!
    expect(row.name).toBe('2026-11-17.md'); expect(row.project).toBe('Tagesnotizen')
  })
  it('uses an editable vault and its daily-note settings; read-only vaults are left alone', async () => {
    const v = join(dir, 'Vault'); await mkdir(join(v, '.obsidian'), { recursive: true }); await mkdir(join(v, 'Vorlagen'))
    await writeFile(join(v, '.obsidian', 'daily-notes.json'), JSON.stringify({ folder: 'Journal', format: 'YYYY/MM/DD', template: 'Vorlagen/Tag' }))
    await writeFile(join(v, 'Vorlagen', 'Tag.md'), '# {{title}}\n## Aufgaben\n')
    const f = addFolder(db, v); await scanFolder(db, f.id)
    expect((await dailyNote(db, lib, { now: day })).where).toBe('library')   // read-only: library
    await rm(join(lib, 'files'), { recursive: true, force: true }); db.prepare("DELETE FROM file_asset WHERE source = 'copy'").run()
    setFolderEditable(db, f.id, true)
    const r = await dailyNote(db, lib, { now: day })
    expect(r).toMatchObject({ id: null, rel: 'Journal/2026/11/17.md', where: 'vault' })
    expect(await readFile(join(v, 'Journal', '2026', '11', '17.md'), 'utf8')).toBe('# 17\n## Aufgaben\n')
  })
  it('finds template notes and fills them', async () => {
    const v = join(dir, 'V'); await mkdir(join(v, 'Templates'), { recursive: true })
    await writeFile(join(v, 'Templates', 'Meeting.md'), 'Meeting {{title}} am {{date:DD.MM.}}'); await writeFile(join(v, 'Other.md'), 'x')
    const f = addFolder(db, v); await scanFolder(db, f.id)
    const t = await templates(db)
    expect(t.map((x) => x.name)).toEqual(['Meeting.md'])
    expect(await templateText(db, lib, t[0].id, 'Plan', { now: day })).toBe('Meeting Plan am 17.11.')
  })
  it('opens the note in the daily folder, not any other file named like today', async () => {
    const v = join(dir, 'Vault'); await mkdir(join(v, '.obsidian'), { recursive: true }); await mkdir(join(v, 'Daily')); await mkdir(join(v, 'Radar'))
    await writeFile(join(v, '.obsidian', 'daily-notes.json'), JSON.stringify({ folder: 'Daily' }))
    await writeFile(join(v, 'Radar', '2026-11-17.md'), 'report')
    const f = addFolder(db, v); await scanFolder(db, f.id)
    // read-only vault without today's daily note: a library note, never the report
    const a = await dailyNote(db, lib, { now: day })
    expect(a).toMatchObject({ created: true, where: 'library' })
    await writeFile(join(v, 'Daily', '2026-11-17.md'), '# heute'); await scanFolder(db, f.id)
    const b = await dailyNote(db, lib, { now: day })
    expect(b).toMatchObject({ created: false, where: 'vault', id: listFiles(db).find((r) => r.rel_path === 'Daily/2026-11-17.md')!.id })
  })
  it('uses an existing Daily folder when the vault has no daily-note settings', async () => {
    const v = join(dir, 'V2'); await mkdir(join(v, 'Daily'), { recursive: true }); await writeFile(join(v, 'Daily', '2026-11-16.md'), 'gestern')
    const f = addFolder(db, v); await scanFolder(db, f.id); setFolderEditable(db, f.id, true)
    expect(await dailyNote(db, lib, { now: day })).toMatchObject({ created: true, rel: 'Daily/2026-11-17.md' })
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { normalize } from '../../src/main/monitor/normalize'
import { record } from '../../src/main/monitor/store'
import { addLesson, deleteLesson, lessonProjects, lessonsText, listLessons, observed, projectOfCwd, updateLesson } from '../../src/main/monitor/lessons'
import { callTool, configure, closeDb } from '../../src/mcp/server'

let dir: string, db: Db
const base = { session_id: 's1', cwd: '/u/Roblox-Shop' }
const now = '2026-11-17T09:00:00.000Z'
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nos-les-')); db = openDb(join(dir, 'nos.db')) })
afterEach(async () => { closeDb(); db.close(); await rm(dir, { recursive: true, force: true }) })

describe('lesson book', () => {
  it('keeps Claude\'s LESSON line as a new lesson for the project folder, once', () => {
    const rec = (o: object) => record(db, dir, normalize({ ...base, ...o })!, now)
    rec({ hook_event_name: 'Stop', lesson_line: 'LESSON: Erst npm run build, dann testen.' })
    rec({ hook_event_name: 'Stop', lesson_line: 'LESSON: erst npm run build, dann testen' })   // same lesson again
    rec({ hook_event_name: 'SubagentStop', lesson_line: 'LESSON: nicht vom Subagenten' })
    const L = listLessons(db, { project: 'roblox-shop' })
    expect(L.map((l) => [l.text, l.source, l.status])).toEqual([['Erst npm run build, dann testen.', 'claude', 'new']])
    expect(projectOfCwd('C:\\Users\\x\\Roblox-Shop\\')).toBe('roblox-shop')
    expect((db.prepare("SELECT COUNT(*) AS n FROM claude_event WHERE type = 'lesson_noted'").get() as { n: number }).n).toBe(1)
  })
  it('lets the user keep, drop, rewrite, add and remove lessons', () => {
    const a = addLesson(db, { project: 'Shop', text: 'Preise nie im Client prüfen.', source: 'claude' }, now)!
    const b = addLesson(db, { project: 'Shop', text: 'Alte Idee.', source: 'claude' }, now)!
    const u = addLesson(db, { project: 'Shop', text: 'Immer deutsch kommentieren.', source: 'user' }, now)!
    expect(u.status).toBe('kept')
    updateLesson(db, a.id, { status: 'kept' }, now)
    updateLesson(db, b.id, { status: 'dropped' }, now)
    const t = lessonsText(db, 'shop').text
    expect(t).toContain('Preise nie im Client prüfen.')
    expect(t).toContain('Immer deutsch kommentieren.')
    expect(t).not.toContain('Alte Idee')
    const c = addLesson(db, { project: 'Shop', text: 'Roh', source: 'claude' }, now)!
    expect(updateLesson(db, c.id, { text: 'Umgeschrieben' }, now)!.status).toBe('kept')
    expect(deleteLesson(db, c.id)).toBe(true)
    expect(lessonProjects(db)[0]).toMatchObject({ project: 'shop', lessons: 3 })
  })
  it('reports tools that failed repeatedly, from recorded events only', () => {
    const rec = (o: object) => record(db, dir, normalize({ ...base, ...o })!, now)
    for (let i = 0; i < 3; i++) rec({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command_word: 'npm' } })
    rec({ hook_event_name: 'PostToolUseFailure', tool_name: 'Read', tool_input: { file_path: '/u/Roblox-Shop/x' } })
    expect(observed(db, 'Roblox-Shop')).toEqual([{ tool: 'Bash', what: 'npm', count: 3, last: now }])
    expect(lessonsText(db, 'roblox-shop').text).toContain('Bash (npm) failed 3 times')
  })
  it('answers Claude through the MCP tool "lessons"', () => {
    addLesson(db, { project: 'Shop', text: 'Lua-Module klein halten.', source: 'user' }, now)
    configure(join(dir, 'nos.db'), dir, join(dir, 'none.json'))
    const r = callTool('lessons', { project: 'Shop' }).result as { content: { text: string }[] }
    expect(r.content[0].text).toContain('Lua-Module klein halten.')
    expect(r.content[0].text).toContain('Source: NEURAL OS lesson book')
    const e = callTool('lessons', { project: 'Leer' }).result as { content: { text: string }[] }
    expect(e.content[0].text).toBe('No lessons yet for "Leer".')
  })
})

describe('hook layout', () => {
  it('runs Stop synchronously so claude -p delivers its lines, and spots an old async setup', async () => {
    const { withOurs, layoutOutdated } = await import('../../src/main/monitor/installer')
    const now = withOurs({}, '/d/neural-os-forward.cjs', '/d/ep.json') as { hooks: Record<string, { hooks: { async?: boolean; timeout?: number }[] }[]> }
    expect(now.hooks.Stop[0].hooks[0]).toMatchObject({ timeout: 5 })
    expect(now.hooks.Stop[0].hooks[0].async).toBeUndefined()
    expect(now.hooks.PostToolUse[0].hooks[0].async).toBe(true)
    expect(layoutOutdated(now, '/d/neural-os-forward.cjs', '/d/ep.json')).toBe(false)
    const old = JSON.parse(JSON.stringify(now)); old.hooks.Stop[0].hooks[0] = { ...old.hooks.Stop[0].hooks[0], async: true }; delete old.hooks.Stop[0].hooks[0].timeout
    expect(layoutOutdated(old, '/d/neural-os-forward.cjs', '/d/ep.json')).toBe(true)
    expect(layoutOutdated({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }, '/d/x.cjs', '/d/ep.json')).toBe(false)
  })
})

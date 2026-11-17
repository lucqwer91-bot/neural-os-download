import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { organize } from '../../src/main/library/organize'
import { search, recentSessions, contextPack, projects, LIMITS } from '../../src/main/context/query'
import { normalize } from '../../src/main/monitor/normalize'
import { record } from '../../src/main/monitor/store'
import { writeSessionNote } from '../../src/main/monitor/sessionNote'
import { configure, callTool, closeDb } from '../../src/mcp/server'
import { addArgs, removeArgs, shellLine, serverSpec, registered } from '../../src/main/monitor/mcpInstall'

let dir: string, db: Db, lib: string, vault: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-ctx-'))
  lib = join(dir, 'lib'); vault = join(dir, 'vault'); await mkdir(lib)
  await mkdir(join(vault, 'Roblox'), { recursive: true })
  await writeFile(join(vault, 'Roblox', 'Lobby.md'), '# Lobby\nDrei Portale. Siehe [[Spawn]].')
  await writeFile(join(vault, 'Roblox', 'Spawn.md'), '# Spawn\nSpawn-Schutz 3 Sekunden.')
  await writeFile(join(vault, 'Roblox', 'Shop.md'), '# Shop\nPreise für Pets.')
  db = openDb(join(dir, 'nos.db'))
  const f = addFolder(db, vault)
  const r = await scanFolder(db, f.id)
  await organize(db, lib, r.added, { wikilinksOnly: true })
})
afterEach(async () => { closeDb(); db.close(); await rm(dir, { recursive: true, force: true }) })

describe('context answers (S3)', () => {
  it('searches names and text, ranks name hits higher', () => {
    const h = search(db, lib, 'spawn portale')
    expect(h[0].name).toBe('Spawn.md')
    expect(h.map((x) => x.name)).toContain('Lobby.md')
    expect(h[0].path).toBe(join(vault, 'Roblox', 'Spawn.md'))
    expect(search(db, lib, 'x')).toEqual([])
    expect(projects(db)[0]).toMatchObject({ name: 'Roblox', files: 3 })
  })
  it('builds a pack with linked notes and sources, within the limit', () => {
    const p = contextPack(db, lib, { topic: 'Lobby' })
    expect(p.sources.map((s) => s.name)).toEqual(['Lobby.md', 'Spawn.md'])
    expect(p.sources[1].why).toBe('linked')
    expect(p.text).toContain('Drei Portale')
    expect(p.text.length).toBeLessThanOrEqual(LIMITS.chars)
  })
  it('answers "what happened last time" from session notes', () => {
    const now = '2026-11-17T08:00:00.000Z'
    const ev = (o: object) => record(db, lib, normalize({ session_id: 's1', cwd: '/u/Roblox', hook_event_name: 'PostToolUse', ...o })!, now)
    ev({ hook_event_name: 'SessionStart' })
    ev({ tool_name: 'Edit', tool_input: { file_path: join(vault, 'Roblox', 'Shop.md') } })
    writeSessionNote(db, lib, 's1', 'en', new Date(now))
    const s = recentSessions(db, lib, { project: 'Roblox' })
    expect(s).toHaveLength(1)
    expect(s[0].note).toContain('[[Shop]]')
    expect(recentSessions(db, lib, { project: 'Other' })).toEqual([])
    // a newer session without any tool use (e.g. the one asking right now) is skipped
    record(db, lib, normalize({ session_id: 's2', cwd: '/u/Roblox', hook_event_name: 'SessionStart' })!, '2026-11-17T09:00:00.000Z')
    record(db, lib, normalize({ session_id: 's2', cwd: '/u/Roblox', hook_event_name: 'PostToolUse', tool_name: 'ToolSearch' })!, '2026-11-17T09:00:01.000Z')
    record(db, lib, normalize({ session_id: 's2', cwd: '/u/Roblox', hook_event_name: 'PreToolUse', tool_name: 'mcp__neural-os__recent_sessions' })!, '2026-11-17T09:00:02.000Z')
    expect(recentSessions(db, lib, { project: 'Roblox' }).map((x) => x.id)).toEqual(['s1'])
  })
  it('MCP tools answer with sources and report the ids for the flash', () => {
    configure(join(dir, 'nos.db'), lib, join(dir, 'none.json'))
    const r = callTool('context_pack', { topic: 'Lobby' })
    const txt = (r.result.content as { text: string }[])[0].text
    expect(txt).toContain('Sources:')
    expect(r.ids).toHaveLength(2)
    expect(callTool('search_notes', {}).result.isError).toBe(true)
    expect((callTool('list_projects', {}).result.content as { text: string }[])[0].text).toContain('- Roblox (3)')
  })
})

describe('MCP registration', () => {
  it('uses the official command and reads the entry without writing', async () => {
    const spec = serverSpec('/usr/bin/node', '/d/mcp.cjs', '/d/nos.db', '/d/Library', '/d/ep.json')
    expect(addArgs(spec).slice(0, 3)).toEqual(['mcp', 'add-json', 'neural-os'])
    expect(addArgs(spec).slice(-2)).toEqual(['--scope', 'user'])
    expect(removeArgs()).toEqual(['mcp', 'remove', 'neural-os', '--scope', 'user'])
    expect(shellLine('/usr/bin/claude', ['mcp', 'add-json', 'x', '{"a":"b c"}'], false)).toBe(`/usr/bin/claude mcp add-json x '{"a":"b c"}'`)
    expect(registered(dir)).toBeNull()
    await writeFile(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { 'neural-os': spec } }))
    expect(registered(dir)).toEqual(spec)
  })
})

import { GUIDE } from '../../src/mcp/server'
describe('guide for Claude', () => {
  it('names every tool it recommends', () => {
    for (const t of ['recent_sessions', 'lessons', 'search_notes', 'context_pack', 'list_projects', 'game_context', 'who_uses']) expect(GUIDE).toContain(t)
  })
})

import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { overlaps } from '../../src/main/monitor/overlaps'
import { mcpServers } from '../../src/main/monitor/mcpServers'
import { fresh } from '../../src/main/library/fresh'

describe('overlaps, MCP servers, fresh/stale', () => {
  it('flags a file two sessions changed close together, not far apart', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nos-ov-')); const db = openDb(join(d, 'n.db'))
    try {
      const S = db.prepare("INSERT INTO claude_session (id, cwd, started_at, last_at) VALUES (?, ?, 'a', 'b')"); S.run('s1', '/p/A'); S.run('s2', '/p/B')
      const C = db.prepare("INSERT INTO claude_change (id, session_id, at, tool, file_path, how) VALUES (?, ?, ?, 'Edit', ?, 'snapshot')")
      C.run('1', 's1', '2026-11-17T10:00:00Z', '/p/x.lua'); C.run('2', 's2', '2026-11-17T10:10:00Z', '/p/x.lua')
      C.run('3', 's1', '2026-11-17T08:00:00Z', '/p/y.lua'); C.run('4', 's2', '2026-11-17T10:00:00Z', '/p/y.lua')
      const o = overlaps(db, '2026-11-17T00:00:00Z')
      expect(o.map((x) => x.file_path)).toEqual(['/p/x.lua'])
      expect(o[0].sessions.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
  it('lists MCP servers by scope without secrets, with last use', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nos-mcp-')), home = join(d, 'h'), proj = join(d, 'game'); await mkdir(home); await mkdir(proj)
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'neural-os': { type: 'stdio', command: '/usr/bin/node', args: ['secret'], env: { KEY: 'x' } } }, projects: { [proj]: { mcpServers: { Roblox_Studio: { command: 'C:/rbx/rbx-studio-mcp.exe' } } } } }))
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { blender: { type: 'http', url: 'http://localhost:9876/mcp' } } }))
    const db = openDb(join(d, 'n.db'))
    try {
      db.prepare("INSERT INTO claude_session (id, cwd, started_at, last_at) VALUES ('s', ?, 'a', 'b')").run(proj)
      db.prepare("INSERT INTO claude_event (id, session_id, received_at, hook, type, region, tool) VALUES ('e', 's', '2026-11-17T09:00:00Z', 'PostToolUse', 'tool_finished', 'connectors', 'mcp__Roblox_Studio__run_code')").run()
      const r = mcpServers(db, home)
      expect(r.servers).toEqual([
        { name: 'neural-os', scope: 'user', project: null, type: 'stdio', target: 'node', lastUsed: null, uses: 0 },
        { name: 'Roblox_Studio', scope: 'local', project: 'game', type: 'stdio', target: 'rbx-studio-mcp.exe', lastUsed: '2026-11-17T09:00:00Z', uses: 1 },
        { name: 'blender', scope: 'project', project: 'game', type: 'http', target: 'localhost:9876', lastUsed: null, uses: 0 }])
      expect(JSON.stringify(r)).not.toContain('secret')
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
  it('finds inbox notes and notes Claude reads that link to newer files', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nos-fr-')); const db = openDb(join(d, 'n.db'))
    try {
      const F = db.prepare("INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, mtime) VALUES (?, ?, ?, 1, ?, '', ?, 'x', ?)")
      F.run('n', 'Shop.md', 'md', 'h1', '/v/Docs/Shop.md', Date.parse('2026-01-01')); F.run('s', 'Shop.luau', 'luau', 'h2', '/v/src/Shop.luau', Date.parse('2026-11-01'))
      F.run('i', 'Video.md', 'md', 'h3', '/v/Atlas/Inbox/Video.md', Date.parse('2026-11-10'))
      db.prepare("INSERT INTO knowledge_edge (from_id, to_id, origin, reason, created_at) VALUES ('n', 's', 'user', 'wikilink', 'x')").run()
      const E = db.prepare("INSERT INTO claude_event (id, session_id, received_at, hook, type, region, tool, file_id) VALUES (?, 's', ?, 'PostToolUse', 'tool_finished', 'memory', 'Read', 'n')")
      E.run('1', '2026-11-10T10:00:00Z'); E.run('2', '2026-11-12T10:00:00Z')
      const r = fresh(db)
      expect(r.inbox.map((x) => x.name)).toEqual(['Video.md'])
      expect(r.recent[0].name).toBe('Video.md')
      expect(r.stale).toEqual([expect.objectContaining({ id: 'n', reads: 2, newer: [expect.objectContaining({ id: 's' })] })])
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
})

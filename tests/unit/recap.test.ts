import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { recap } from '../../src/main/monitor/recap'

describe('while you were away', () => {
  it('lists only sessions with work since the given time, with Claude summaries and changed files', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nos-rc-')); const db = openDb(join(d, 'n.db'))
    try {
      const S = db.prepare('INSERT INTO claude_session (id, cwd, started_at, last_at) VALUES (?, ?, ?, ?)')
      S.run('a', '/x/Roblox Game', '2026-11-17T08:00:00Z', '2026-11-17T09:00:00Z')
      S.run('b', '/x/Idle', '2026-11-17T08:00:00Z', '2026-11-17T09:00:00Z')
      S.run('old', '/x/Old', '2026-11-16T08:00:00Z', '2026-11-16T09:00:00Z')
      const E = db.prepare("INSERT INTO claude_event (id, session_id, received_at, hook, type, region, summary, status) VALUES (?, ?, ?, 'x', ?, 'memory', ?, NULL)")
      E.run('1', 'a', '2026-11-17T08:10:00Z', 'tool_finished', null); E.run('2', 'a', '2026-11-17T08:11:00Z', 'tool_failed', null)
      E.run('3', 'a', '2026-11-17T08:50:00Z', 'session_summary', 'Built the shop.'); E.run('4', 'a', '2026-11-17T08:51:00Z', 'lesson_noted', 'Test first.')
      E.run('5', 'b', '2026-11-17T08:10:00Z', 'session_started', null)
      db.prepare("INSERT INTO claude_change (id, session_id, at, tool, file_path, how) VALUES ('c1', 'a', '2026-11-17T08:20:00Z', 'Edit', '/x/Roblox Game/Shop.luau', 'snapshot')").run()
      const r = recap(db, '2026-11-17T07:00:00Z')
      expect(r.sessions.map((s) => s.project)).toEqual(['Roblox Game'])
      expect(r.sessions[0]).toMatchObject({ tools: 2, failed: 1, changes: 1, summaries: ['Built the shop.'], lessons: ['Test first.'] })
      expect(r.files).toEqual([{ path: '/x/Roblox Game/Shop.luau', file_id: null, changes: 1 }])
      expect(recap(db, '2026-11-17T10:00:00Z').sessions).toEqual([])
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
})

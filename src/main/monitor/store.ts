import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Db } from '../library/db'
import { EDIT_TOOLS, type NormEvent } from './normalize'
import { addLesson, projectOfCwd } from './lessons'

// Event history, sessions and the AI change log (S1) in the library database.

export interface StoredEvent {
  id: string; session_id: string; received_at: string; hook: string; type: string; tool: string | null
  file_path: string | null; file_id: string | null; cwd: string | null; region: string; status: string | null
  duration_ms: number | null; summary: string | null; agent_id: string | null; tool_use_id: string | null
}
export interface Session {
  id: string; cwd: string | null; started_at: string; last_at: string; ended_at: string | null
  end_reason: string | null; model: string | null; events: number; muted: number
}
export interface Change {
  id: string; session_id: string; tool_use_id: string | null; at: string; tool: string; file_path: string
  file_id: string | null; before_text: string | null; after_text: string | null; how: string
}

const MAX_TEXT = 1_000_000

/** Library file for an absolute path: linked files by their real path, copies inside the library folder. */
export function fileIdFor(db: Db, libDir: string, absPath: string, platform = process.platform): string | null {
  const ci = platform !== 'linux'
  const p = resolve(absPath).normalize('NFC')
  const q = ci ? 'SELECT id FROM file_asset WHERE lower(original_path) = lower(?) AND source = \'linked\'' : 'SELECT id FROM file_asset WHERE original_path = ? AND source = \'linked\''
  const r = db.prepare(q).get(p) as { id: string } | undefined
  if (r) return r.id
  const rel = relative(resolve(libDir), p)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    const lp = rel.split(sep).join('/')
    const c = db.prepare(ci ? 'SELECT id FROM file_asset WHERE lower(lib_path) = lower(?)' : 'SELECT id FROM file_asset WHERE lib_path = ?').get(lp) as { id: string } | undefined
    if (c) return c.id
  }
  return null
}

function readText(path: string): string | null {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > MAX_TEXT) return null
    const b = readFileSync(path)
    if (b.includes(0)) return null // binary
    return b.toString('utf8')
  } catch { return null }
}

export interface RecordResult { event: StoredEvent; session: Session; change: Change | null; readiness: StoredEvent | null }

/** Stores one normalized event. Excluded sessions (spec 6.7) are not stored at all. */
export function record(db: Db, libDir: string, ev: NormEvent, now: string, excluded: Set<string> = new Set()): RecordResult | null {
  if (excluded.has(ev.session_id)) return null
  const abs = ev.file_path ? (isAbsolute(ev.file_path) ? ev.file_path : join(ev.working_directory || '.', ev.file_path)) : null
  const fileId = abs ? fileIdFor(db, libDir, abs) : null
  const id = randomUUID(), rid = randomUUID()
  let change: Change | null = null
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO claude_session (id, cwd, started_at, last_at, events) VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(id) DO NOTHING`).run(ev.session_id, ev.working_directory, now, now)
    db.prepare(`UPDATE claude_session SET last_at = ?, events = events + 1, cwd = COALESCE(?, cwd),
      model = COALESCE(?, model) WHERE id = ?`).run(now, ev.working_directory, ev.model, ev.session_id)
    if (ev.event_type === 'session_ended') db.prepare('UPDATE claude_session SET ended_at = ?, end_reason = ? WHERE id = ?').run(now, ev.summary, ev.session_id)
    else if (ev.event_type === 'session_started') db.prepare('UPDATE claude_session SET ended_at = NULL, end_reason = NULL WHERE id = ?').run(ev.session_id)
    db.prepare(`INSERT INTO claude_event (id, session_id, received_at, hook, type, tool, file_path, file_id, cwd, region, status, duration_ms, summary, agent_id, tool_use_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ev.session_id, now, ev.hook, ev.event_type, ev.tool_name, abs, fileId,
      ev.working_directory, ev.region, ev.status, ev.duration_ms, ev.summary, ev.agent_id, ev.tool_use_id)

    // S1: before (snapshot from the forwarder) on PreToolUse, after (file now) on PostToolUse
    if (abs && ev.tool_name && EDIT_TOOLS.has(ev.tool_name)) {
      if (ev.event_type === 'tool_started') {
        const how = ev.before_text !== null ? 'snapshot' : ev.before_missing ? 'new_file' : 'unavailable'
        const cid = randomUUID()
        db.prepare(`INSERT INTO claude_change (id, session_id, tool_use_id, at, tool, file_path, file_id, before_text, after_text, how)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).run(cid, ev.session_id, ev.tool_use_id, now, ev.tool_name, abs, fileId, ev.before_text, how)
      } else if (ev.event_type === 'tool_finished') {
        const after = readText(abs)
        const open = ev.tool_use_id
          ? db.prepare('SELECT id FROM claude_change WHERE tool_use_id = ? AND session_id = ?').get(ev.tool_use_id, ev.session_id) as { id: string } | undefined
          : undefined
        if (open) db.prepare('UPDATE claude_change SET after_text = ?, at = ? WHERE id = ?').run(after, now, open.id)
        else db.prepare(`INSERT INTO claude_change (id, session_id, tool_use_id, at, tool, file_path, file_id, before_text, after_text, how)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'unavailable')`).run(randomUUID(), ev.session_id, ev.tool_use_id, now, ev.tool_name, abs, fileId, after)
        const cid = open?.id
        change = (cid ? db.prepare('SELECT * FROM claude_change WHERE id = ?').get(cid) : db.prepare('SELECT * FROM claude_change WHERE session_id = ? ORDER BY rowid DESC LIMIT 1').get(ev.session_id)) as unknown as Change
      } else if (ev.event_type === 'tool_failed' && ev.tool_use_id) {
        // the change did not happen
        db.prepare('DELETE FROM claude_change WHERE tool_use_id = ? AND session_id = ? AND after_text IS NULL').run(ev.tool_use_id, ev.session_id)
      }
    }
    // readiness report marker line (spec 10.6): its own event in the Connectors region
    if (ev.readiness_line) {
      db.prepare(`INSERT INTO claude_event (id, session_id, received_at, hook, type, tool, file_path, file_id, cwd, region, status, duration_ms, summary, agent_id, tool_use_id)
        VALUES (?, ?, ?, ?, 'readiness_report', NULL, NULL, NULL, ?, 'connectors', NULL, NULL, ?, ?, NULL)`).run(rid, ev.session_id, now, ev.hook, ev.working_directory, ev.readiness_line, ev.agent_id)
      db.prepare('UPDATE claude_session SET events = events + 1 WHERE id = ?').run(ev.session_id)
    }
    // Claude's session note line (rule v2): kept as its own event, shown labeled as Claude's words
    if (ev.note_line) {
      db.prepare(`INSERT INTO claude_event (id, session_id, received_at, hook, type, tool, file_path, file_id, cwd, region, status, duration_ms, summary, agent_id, tool_use_id)
        VALUES (?, ?, ?, ?, 'session_summary', NULL, NULL, NULL, ?, 'memory', NULL, NULL, ?, NULL, NULL)`).run(randomUUID(), ev.session_id, now, ev.hook, ev.working_directory, ev.note_line)
      db.prepare('UPDATE claude_session SET events = events + 1 WHERE id = ?').run(ev.session_id)
    }
    // Claude's lesson line (rule v3): a new, unconfirmed lesson for this project folder
    if (ev.lesson_line) {
      const added = addLesson(db, { project: projectOfCwd(ev.working_directory), cwd: ev.working_directory, text: ev.lesson_line, source: 'claude', session_id: ev.session_id }, now)
      if (added) db.prepare(`INSERT INTO claude_event (id, session_id, received_at, hook, type, tool, file_path, file_id, cwd, region, status, duration_ms, summary, agent_id, tool_use_id)
        VALUES (?, ?, ?, ?, 'lesson_noted', NULL, NULL, NULL, ?, 'memory', NULL, NULL, ?, NULL, NULL)`).run(randomUUID(), ev.session_id, now, ev.hook, ev.working_directory, ev.lesson_line)
      if (added) db.prepare('UPDATE claude_session SET events = events + 1 WHERE id = ?').run(ev.session_id)
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  const event = db.prepare('SELECT * FROM claude_event WHERE id = ?').get(id) as unknown as StoredEvent
  const session = db.prepare('SELECT * FROM claude_session WHERE id = ?').get(ev.session_id) as unknown as Session
  const readiness = ev.readiness_line ? (db.prepare('SELECT * FROM claude_event WHERE id = ?').get(rid) as unknown as StoredEvent) : null
  return { event, session, change, readiness }
}

export function listSessions(db: Db, limit = 50): Session[] {
  // sessions from the user's other devices (device sync) carry that device's name
  return db.prepare('SELECT s.*, p.name AS device_name FROM claude_session s LEFT JOIN sync_peer p ON p.id = s.device ORDER BY s.last_at DESC LIMIT ?').all(limit) as unknown as Session[]
}

export function listEvents(db: Db, opts: { session?: string; limit?: number } = {}): StoredEvent[] {
  const lim = Math.min(opts.limit ?? 200, 2000)
  const rows = opts.session
    ? db.prepare('SELECT * FROM claude_event WHERE session_id = ? ORDER BY received_at DESC, rowid DESC LIMIT ?').all(opts.session, lim)
    : db.prepare('SELECT * FROM claude_event ORDER BY received_at DESC, rowid DESC LIMIT ?').all(lim)
  return rows as unknown as StoredEvent[]
}

/** Change log without the texts (for lists); texts come with getChange. */
export function listChanges(db: Db, opts: { session?: string; fileId?: string; limit?: number } = {}): Omit<Change, 'before_text' | 'after_text'>[] {
  const lim = Math.min(opts.limit ?? 200, 2000)
  const cols = 'id, session_id, tool_use_id, at, tool, file_path, file_id, how'
  const where = opts.session ? 'WHERE session_id = ?' : opts.fileId ? 'WHERE file_id = ?' : ''
  const args: (string | number)[] = opts.session ? [opts.session] : opts.fileId ? [opts.fileId] : []
  return db.prepare(`SELECT ${cols} FROM claude_change ${where} ORDER BY at DESC, rowid DESC LIMIT ?`).all(...args, lim) as unknown as Omit<Change, 'before_text' | 'after_text'>[]
}

export function getChange(db: Db, id: string): Change | null {
  return (db.prepare('SELECT * FROM claude_change WHERE id = ?').get(id) as unknown as Change) ?? null
}

/** Keeps the history small (spec 6.3: retention is configurable). */
export function prune(db: Db, keepDays: number, now: Date): number {
  const cut = new Date(now.getTime() - keepDays * 864e5).toISOString()
  const a = db.prepare('DELETE FROM claude_event WHERE received_at < ?').run(cut).changes
  db.prepare('DELETE FROM claude_change WHERE at < ?').run(cut)
  db.prepare('DELETE FROM claude_session WHERE last_at < ?').run(cut)
  return Number(a)
}

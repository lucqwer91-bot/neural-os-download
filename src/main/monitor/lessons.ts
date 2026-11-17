import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { Db } from '../library/db'

// Claude's lesson book (user wish 2026-11-17: Claude should learn what works and what does not).
// No AI here: lessons are Claude's own LESSON lines (rule v3) or written by the user, kept per
// project folder. The user decides what counts: new → kept or dropped, and can rewrite any lesson.
// Observed facts (tools that failed repeatedly) come from recorded events, never guessed.

export interface Lesson { id: string; project: string; cwd: string | null; text: string; source: 'claude' | 'user'; status: 'new' | 'kept' | 'dropped'; session_id: string | null; created_at: string; updated_at: string }
export interface Observed { tool: string; what: string | null; count: number; last: string }

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase()
/** Project key of a working folder: its folder name, lower-case ('' when unknown). */
export const projectOfCwd = (cwd: string | null | undefined) => (cwd ? norm(basename(cwd.replace(/[\\/]+$/, '').replace(/\\/g, '/'))) : '')
const same = (a: string, b: string) => norm(a).replace(/[\s.!,;:]+/g, ' ').trim() === norm(b).replace(/[\s.!,;:]+/g, ' ').trim()

/** Adds a lesson unless the same text is already there for the project. Returns it, or null for a repeat. */
export function addLesson(db: Db, l: { project: string; cwd?: string | null; text: string; source: 'claude' | 'user'; session_id?: string | null; status?: Lesson['status'] }, now: string): Lesson | null {
  const text = l.text.trim().slice(0, 400)
  if (!text) return null
  const project = norm(l.project)
  const old = db.prepare('SELECT id, text FROM lesson WHERE project = ?').all(project) as { id: string; text: string }[]
  if (old.some((o) => same(o.text, text))) return null
  const id = randomUUID()
  db.prepare('INSERT INTO lesson (id, project, cwd, text, source, status, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, project, l.cwd ?? null, text, l.source, l.status ?? (l.source === 'user' ? 'kept' : 'new'), l.session_id ?? null, now, now)
  return db.prepare('SELECT * FROM lesson WHERE id = ?').get(id) as unknown as Lesson
}

export function listLessons(db: Db, opts: { project?: string } = {}): Lesson[] {
  const order = "ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'kept' THEN 1 ELSE 2 END, updated_at DESC"
  return (opts.project !== undefined
    ? db.prepare(`SELECT * FROM lesson WHERE project = ? ${order}`).all(norm(opts.project))
    : db.prepare(`SELECT * FROM lesson ${order}`).all()) as unknown as Lesson[]
}

/** The projects that have lessons or recorded sessions, with counts. */
export function lessonProjects(db: Db): { project: string; lessons: number; fresh: number }[] {
  const m = new Map<string, { project: string; lessons: number; fresh: number }>()
  for (const r of db.prepare("SELECT project, COUNT(*) AS n, SUM(status = 'new') AS f FROM lesson GROUP BY project").all() as { project: string; n: number; f: number }[]) m.set(r.project, { project: r.project, lessons: r.n, fresh: r.f || 0 })
  for (const r of db.prepare('SELECT DISTINCT cwd FROM claude_session WHERE cwd IS NOT NULL').all() as { cwd: string }[]) { const p = projectOfCwd(r.cwd); if (p && !m.has(p)) m.set(p, { project: p, lessons: 0, fresh: 0 }) }
  return [...m.values()].sort((a, b) => b.fresh - a.fresh || b.lessons - a.lessons || a.project.localeCompare(b.project))
}

export function updateLesson(db: Db, id: string, ch: { status?: Lesson['status']; text?: string }, now: string): Lesson | null {
  const cur = db.prepare('SELECT * FROM lesson WHERE id = ?').get(id) as unknown as Lesson | undefined
  if (!cur) return null
  const status = ch.status && ['new', 'kept', 'dropped'].includes(ch.status) ? ch.status : cur.status
  const text = typeof ch.text === 'string' && ch.text.trim() ? ch.text.trim().slice(0, 400) : cur.text
  // a lesson the user rewrote is theirs to keep
  db.prepare('UPDATE lesson SET status = ?, text = ?, updated_at = ?, device = NULL WHERE id = ?').run(text !== cur.text && status === 'new' ? 'kept' : status, text, now, id)
  return db.prepare('SELECT * FROM lesson WHERE id = ?').get(id) as unknown as Lesson
}

export function deleteLesson(db: Db, id: string, now = new Date().toISOString()): boolean {
  const gone = Number(db.prepare('DELETE FROM lesson WHERE id = ?').run(id).changes) > 0
  // remembered so the delete reaches the user's other devices (device sync)
  if (gone) db.prepare('INSERT INTO sync_tomb (id, kind, at) VALUES (?, \'lesson\', ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at').run(id, now)
  return gone
}

/** Tools that failed at least twice in this project folder's sessions (recorded events only). */
export function observed(db: Db, project: string, min = 2): Observed[] {
  const want = norm(project)
  const rows = db.prepare("SELECT cwd, tool, summary, COUNT(*) AS n, MAX(received_at) AS last FROM claude_event WHERE type = 'tool_failed' AND tool IS NOT NULL GROUP BY cwd, tool, summary").all() as { cwd: string | null; tool: string; summary: string | null; n: number; last: string }[]
  const m = new Map<string, Observed>()
  for (const r of rows) {
    if (projectOfCwd(r.cwd) !== want) continue
    const k = r.tool + '\u0000' + (r.summary ?? ''), o = m.get(k)
    if (o) { o.count += r.n; if (r.last > o.last) o.last = r.last } else m.set(k, { tool: r.tool, what: r.summary, count: r.n, last: r.last })
  }
  return [...m.values()].filter((o) => o.count >= min).sort((a, b) => b.count - a.count).slice(0, 12)
}

/** What Claude gets from the lessons tool: kept lessons, then unconfirmed ones, then observed failures. */
export function lessonsText(db: Db, project: string): { text: string; count: number } {
  const p = norm(project)
  const all = [...listLessons(db, { project: p }), ...(p ? listLessons(db, { project: '' }) : [])].filter((l) => l.status !== 'dropped')
  const kept = all.filter((l) => l.status === 'kept'), fresh = all.filter((l) => l.status === 'new').slice(0, 10)
  const obs = observed(db, p)
  const parts: string[] = []
  if (kept.length) parts.push('Lessons the user kept (follow these):\n' + kept.map((l) => `- ${l.text}`).join('\n'))
  if (fresh.length) parts.push('New lessons, not yet confirmed by the user (hints only):\n' + fresh.map((l) => `- ${l.text}`).join('\n'))
  if (obs.length) parts.push('Observed in earlier sessions here (recorded tool failures):\n' + obs.map((o) => `- ${o.tool}${o.what ? ` (${o.what})` : ''} failed ${o.count} times, last ${o.last.slice(0, 10)}`).join('\n'))
  return { text: parts.join('\n\n'), count: kept.length + fresh.length + obs.length }
}

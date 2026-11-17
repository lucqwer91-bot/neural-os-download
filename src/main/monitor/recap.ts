import type { Db } from '../library/db'

// "While you were away" (idea from the user's saved videos: "Claude, what did you do while I was asleep?").
// Only observed facts since the given time: sessions, changed files, failures, and Claude's own
// SESSION-NOTE / LESSON lines (the only Claude text NEURAL OS keeps). Nothing is guessed.

export interface RecapSession { id: string; project: string; started_at: string; last_at: string; tools: number; failed: number; changes: number; summaries: string[]; lessons: string[] }
export interface Recap { since: string; sessions: RecapSession[]; files: { path: string; file_id: string | null; changes: number }[]; tools: number; failed: number }

const base = (p: string | null) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '')

export function recap(db: Db, since: string): Recap {
  const ss = db.prepare('SELECT id, cwd, started_at, last_at FROM claude_session WHERE last_at > ? AND muted = 0 ORDER BY last_at DESC LIMIT 30').all(since) as { id: string; cwd: string | null; started_at: string; last_at: string }[]
  const ev = db.prepare(`SELECT type, summary FROM claude_event WHERE session_id = ? AND received_at > ? AND type IN ('tool_finished', 'tool_failed', 'session_summary', 'lesson_noted') ORDER BY received_at`)
  const ch = db.prepare('SELECT COUNT(*) AS n FROM claude_change WHERE session_id = ? AND at > ?')
  const sessions: RecapSession[] = []
  let tools = 0, failed = 0
  for (const s of ss) {
    const E = ev.all(s.id, since) as { type: string; summary: string | null }[]
    const r: RecapSession = { id: s.id, project: base(s.cwd), started_at: s.started_at, last_at: s.last_at, tools: 0, failed: 0, changes: (ch.get(s.id, since) as { n: number }).n, summaries: [], lessons: [] }
    for (const e of E) {
      if (e.type === 'tool_finished') r.tools++
      else if (e.type === 'tool_failed') { r.tools++; r.failed++ }
      else if (e.type === 'session_summary' && e.summary) r.summaries.push(e.summary)
      else if (e.type === 'lesson_noted' && e.summary) r.lessons.push(e.summary)
    }
    if (!r.tools && !r.summaries.length && !r.changes) continue   // only sessions that did something
    tools += r.tools; failed += r.failed
    sessions.push(r)
  }
  const ids = sessions.map((s) => s.id)
  const files = ids.length ? db.prepare(`SELECT file_path AS path, MAX(file_id) AS file_id, COUNT(*) AS changes FROM claude_change WHERE at > ? AND session_id IN (${ids.map(() => '?').join(',')}) GROUP BY file_path ORDER BY changes DESC LIMIT 30`).all(since, ...ids) as Recap['files'] : []
  return { since, sessions, files, tools, failed }
}

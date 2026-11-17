import type { Db } from '../library/db'

// Two Claude sessions changing the same file close together (idea from the user's vault: "Studio Lock",
// "Multiple Agents in One Studio" ownership table). Only from recorded changes; NEURAL OS warns, never blocks.

export interface Overlap { file_path: string; file_id: string | null; sessions: { id: string; cwd: string | null; at: string; changes: number }[]; last: string }

export function overlaps(db: Db, since: string, windowMin = 30): Overlap[] {
  const rows = db.prepare(`SELECT c.file_path, c.file_id, c.session_id, c.at, s.cwd FROM claude_change c LEFT JOIN claude_session s ON s.id = c.session_id
    WHERE c.at > ? AND s.muted IS NOT 1 ORDER BY c.file_path, c.at`).all(since) as { file_path: string; file_id: string | null; session_id: string; at: string; cwd: string | null }[]
  const byFile = new Map<string, typeof rows>()
  for (const r of rows) { const l = byFile.get(r.file_path); if (l) l.push(r); else byFile.set(r.file_path, [r]) }
  const out: Overlap[] = [], win = windowMin * 60e3
  for (const [path, l] of byFile) {
    if (new Set(l.map((r) => r.session_id)).size < 2) continue
    // a change by one session within the window of a change by another session
    let clash = false
    for (let i = 1; i < l.length && !clash; i++) for (let j = i - 1; j >= 0; j--) {
      if (Date.parse(l[i].at) - Date.parse(l[j].at) > win) break
      if (l[j].session_id !== l[i].session_id) { clash = true; break }
    }
    if (!clash) continue
    const per = new Map<string, { id: string; cwd: string | null; at: string; changes: number }>()
    for (const r of l) { const p = per.get(r.session_id); if (p) { p.changes++; p.at = r.at } else per.set(r.session_id, { id: r.session_id, cwd: r.cwd, at: r.at, changes: 1 }) }
    out.push({ file_path: path, file_id: l.find((r) => r.file_id)?.file_id ?? null, sessions: [...per.values()], last: l[l.length - 1].at })
  }
  return out.sort((a, b) => b.last.localeCompare(a.last)).slice(0, 50)
}

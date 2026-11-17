import type { Db } from './db'

// "Neu & veraltet" (Memory): what came in lately, and notes that may be out of date.
// - inbox: notes in folders named Inbox/Eingang/AI Radar/Radar/Drafts (the user's vault keeps saved videos and research there)
// - recent: the most recently changed notes anywhere
// - stale (spec 5.10 feature 13): notes Claude read at least twice while files they link to changed clearly later.
//   Based only on read events, links and modification dates; a hint, the note is never changed.

export interface FreshRow { id: string; name: string; project: string | null; mtime: number | null; folder: string }
// a date at the start of the name ("2026-10-22 1601 …") counts as the note's date: copied or synced files lose their mtime
const nameDate = (n: string): number | null => { const m = /^(\d{4}-\d{2}-\d{2})(?:[ _T](\d{2}):?(\d{2}))?/.exec(n); if (!m) return null; const t = Date.parse(`${m[1]}T${m[2] || '00'}:${m[3] || '00'}:00`); return Number.isNaN(t) ? null : t }
export interface StaleNote { id: string; name: string; reads: number; lastRead: string; mtime: number; newer: { id: string; name: string; mtime: number }[] }

const INBOX = /^(inbox|eingang|ai radar|radar|drafts|entwürfe|clippings|saved)$/i
const DAY = 86400e3

export function fresh(db: Db, o: { minReads?: number; lagDays?: number } = {}): { inbox: FreshRow[]; inboxTotal: number; recent: FreshRow[]; stale: StaleNote[] } {
  const rows = db.prepare(`SELECT f.id, f.name, f.mtime, f.rel_path, f.original_path, p.name AS project FROM file_asset f LEFT JOIN project p ON p.id = f.project_id
    WHERE f.ext IN ('md', 'txt') AND f.source != 'session'`).all() as { id: string; name: string; mtime: number | null; rel_path: string | null; original_path: string; project: string | null }[]
  const dir = (r: { rel_path: string | null; original_path: string }) => (r.rel_path || r.original_path).replace(/\\/g, '/').split('/').slice(0, -1)
  const toRow = (r: (typeof rows)[number]): FreshRow => { const d = dir(r); return { id: r.id, name: r.name, project: r.project, mtime: nameDate(r.name) ?? r.mtime, folder: d[d.length - 1] || '' } }
  const byTime = (a: { mtime: number | null }, b: { mtime: number | null }) => (b.mtime || 0) - (a.mtime || 0)
  const inboxAll = rows.filter((r) => dir(r).slice(-3).some((d) => INBOX.test(d))).map((r) => ({ ...r, mtime: nameDate(r.name) ?? r.mtime })).sort(byTime)
  const recent = [...rows].sort(byTime).slice(0, 30).map(toRow)

  const minReads = o.minReads ?? 2, lag = (o.lagDays ?? 1) * DAY
  const reads = db.prepare(`SELECT file_id, COUNT(*) AS n, MAX(received_at) AS last FROM claude_event
    WHERE file_id IS NOT NULL AND tool = 'Read' AND type = 'tool_finished' GROUP BY file_id HAVING n >= ?`).all(minReads) as { file_id: string; n: number; last: string }[]
  const info = db.prepare('SELECT id, name, mtime FROM file_asset WHERE id = ?')
  const outLinks = db.prepare(`SELECT f.id, f.name, f.mtime FROM knowledge_edge e JOIN file_asset f ON f.id = e.to_id WHERE e.from_id = ? AND e.origin = 'user' AND e.status = 'linked'`)
  const stale: StaleNote[] = []
  for (const r of reads) {
    const n = info.get(r.file_id) as { id: string; name: string; mtime: number | null } | undefined
    if (!n || n.mtime == null) continue
    const newer = (outLinks.all(n.id) as { id: string; name: string; mtime: number | null }[]).filter((x) => x.mtime != null && x.mtime - n.mtime! > lag) as { id: string; name: string; mtime: number }[]
    if (newer.length) stale.push({ id: n.id, name: n.name, reads: r.n, lastRead: r.last, mtime: n.mtime, newer: newer.sort((a, b) => b.mtime - a.mtime).slice(0, 8) })
  }
  stale.sort((a, b) => b.reads - a.reads)
  return { inbox: inboxAll.slice(0, 40).map(toRow), inboxTotal: inboxAll.length, recent, stale: stale.slice(0, 50) }
}

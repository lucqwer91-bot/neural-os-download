import { readFileSync, statSync } from 'node:fs'
import { isSecretName, maskSecrets } from '../library/secrets'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

// Context answers for Claude (spec 3.5, S3). No AI: names, full text, links, projects,
// recency and Claude traces. Every answer lists its sources. Runs inside the MCP server
// process (plain node) and in tests; it only reads.

type Db = DatabaseSync

export const LIMITS = { chars: 12_000, perNote: 3_000, results: 20, scanBytes: 400_000, scanFiles: 5_000 }
const TEXT = new Set(['md', 'txt', 'lua', 'luau', 'json', 'canvas', 'csv', 'yml', 'yaml'])

export interface FileHit { id: string; name: string; project: string | null; path: string; score: number; snippet: string; mtime: number | null }

interface Row { id: string; name: string; ext: string; size: number; lib_path: string; original_path: string; source: string; rel_path: string | null; folder_path: string | null; project: string | null; mtime: number | null }

function rows(db: Db): Row[] {
  dbForText = db
  return db.prepare(`SELECT f.id, f.name, f.ext, f.size, f.lib_path, f.original_path, f.source, f.rel_path, f.mtime, lf.path AS folder_path, p.name AS project
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id LEFT JOIN project p ON p.id = f.project_id`).all() as unknown as Row[]
}

const pathOf = (libDir: string, r: Row) => (r.source === 'linked' && r.folder_path && r.rel_path ? join(r.folder_path, ...r.rel_path.split('/')) : join(libDir, r.lib_path))
/** What Claude sees as the location: the real path for linked files, the library path for copies. */
const shownPath = (libDir: string, r: Row) => pathOf(libDir, r)

let dbForText: Db | null = null
function readText(libDir: string, r: Row, max = LIMITS.scanBytes): string | null {
  // PDF/Word: the text NEURAL OS read out of the file (table file_text)
  if ((r.ext === 'pdf' || r.ext === 'docx') && dbForText) {
    try { const x = dbForText.prepare('SELECT text FROM file_text WHERE file_id = ?').get(r.id) as { text: string } | undefined; return x && x.text.trim() ? maskSecrets(x.text.slice(0, max)) : null } catch { return null }
  }
  if (!TEXT.has(r.ext)) return null
  try {
    const p = pathOf(libDir, r)
    if (statSync(p).size > max || isSecretName(r.name)) return null
    return maskSecrets(readFileSync(p, 'utf8'))
  } catch { return null }
}

const stripFront = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n?/, '')
const norm = (s: string) => s.normalize('NFC').toLowerCase()
const words = (q: string) => [...new Set(norm(q).split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length >= 2))].slice(0, 8)

function snippetOf(text: string, ws: string[], len = 220): string {
  const t = stripFront(text), l = norm(t)
  let at = -1
  for (const w of ws) { const i = l.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i }
  const s = Math.max(0, at < 0 ? 0 : at - 60)
  return (s > 0 ? '…' : '') + t.slice(s, s + len).replace(/\s+/g, ' ').trim() + (s + len < t.length ? '…' : '')
}

/** Search names and text. Name hits weigh more; more matching words rank higher. */
export function search(db: Db, libDir: string, query: string, opts: { project?: string; limit?: number } = {}): FileHit[] {
  const ws = words(query)
  if (!ws.length) return []
  const hits: FileHit[] = []
  let scanned = 0
  for (const r of rows(db)) {
    if (opts.project && norm(r.project || '') !== norm(opts.project)) continue
    const n = norm(r.name)
    let score = 0
    for (const w of ws) if (n.includes(w)) score += 3
    let text: string | null = null
    if (scanned < LIMITS.scanFiles) { text = readText(libDir, r); if (text !== null) scanned++ }
    if (text) { const l = norm(text); for (const w of ws) if (l.includes(w)) score += 1 }
    if (score > 0) hits.push({ id: r.id, name: r.name, project: r.project, path: shownPath(libDir, r), score, snippet: text ? snippetOf(text, ws) : '', mtime: r.mtime })
  }
  return hits.sort((a, b) => b.score - a.score || (b.mtime || 0) - (a.mtime || 0)).slice(0, Math.min(opts.limit || 10, LIMITS.results))
}

/** Projects per linked folder (a folder = one game or vault; its top-level subfolders are its projects); copies under "Library". */
export function projects(db: Db): { name: string; files: number; folder: string | null }[] {
  return db.prepare(`SELECT p.name, COUNT(f.id) AS files, lf.path AS folder FROM file_asset f LEFT JOIN project p ON p.id = f.project_id LEFT JOIN linked_folder lf ON lf.id = f.folder_id
    GROUP BY lf.id, p.id ORDER BY lf.path, files DESC`).all() as unknown as { name: string; files: number; folder: string | null }[]
}

export interface SessionInfo { id: string; folder: string | null; started_at: string; ended_at: string | null; model: string | null; events: number; note_id: string | null; note: string | null; device?: string | null }

/** Recent Claude sessions, optionally for one project folder (matched by the folder name). */
export function recentSessions(db: Db, libDir: string, opts: { project?: string; limit?: number } = {}): SessionInfo[] {
  const all = db.prepare('SELECT * FROM claude_session ORDER BY last_at DESC LIMIT 200').all() as unknown as { id: string; cwd: string | null; started_at: string; ended_at: string | null; model: string | null; events: number }[]
  const base = (p: string | null) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  const want = opts.project ? norm(opts.project) : null
  const out: SessionInfo[] = []
  for (const s of all) {
    if (want && norm(base(s.cwd)) !== want && !norm(s.cwd || '').includes(want)) continue
    // a session in which Claude used no tool yet tells nothing; asking NEURAL OS itself does not count,
    // so the session that is asking right now is not its own answer
    if (!db.prepare("SELECT 1 FROM claude_event WHERE session_id = ? AND type LIKE 'tool_%' AND COALESCE(tool, '') NOT LIKE 'mcp__neural-os__%' AND COALESCE(tool, '') <> 'ToolSearch' LIMIT 1").get(s.id)) continue
    const n = db.prepare("SELECT * FROM file_asset WHERE hash = ?").get(`session:${s.id}`) as unknown as Row | undefined
    let note: string | null = null
    if (n) { const r = rows(db).find((x) => x.id === n.id); const t = r ? readText(libDir, r) : null; note = t ? stripFront(t).slice(0, LIMITS.perNote) : null }
    // device sync: a session from the user's other computer names it (older databases have no sync tables)
    let device: string | null = null
    try { device = (db.prepare('SELECT p.name FROM claude_session s JOIN sync_peer p ON p.id = s.device WHERE s.id = ?').get(s.id) as { name: string } | undefined)?.name ?? null } catch { /* no sync tables */ }
    out.push({ id: s.id, folder: s.cwd, started_at: s.started_at, ended_at: s.ended_at, model: s.model, events: s.events, note_id: n ? n.id : null, note, ...(device ? { device } : {}) })
    if (out.length >= Math.min(opts.limit || 3, 10)) break
  }
  return out
}

export interface Pack { text: string; sources: { id: string; name: string; path: string; why: string }[] }

/**
 * A context pack: the best matches for a topic, their linked notes and the last session
 * notes of the project, cut to a size limit. Plain text with a source list.
 */
export function contextPack(db: Db, libDir: string, opts: { topic?: string; project?: string; maxChars?: number }): Pack {
  const max = Math.min(opts.maxChars || LIMITS.chars, LIMITS.chars)
  const all = rows(db), byId = new Map(all.map((r) => [r.id, r]))
  const picked: { r: Row; why: string }[] = []
  const add = (r: Row | undefined, why: string) => { if (r && !picked.some((p) => p.r.id === r.id)) picked.push({ r, why }) }
  if (opts.topic) for (const h of search(db, libDir, opts.topic, { project: opts.project, limit: 6 })) add(byId.get(h.id), 'match')
  // one step along the links of the best matches
  for (const p of picked.slice(0, 3)) {
    const ns = db.prepare(`SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS id FROM knowledge_edge WHERE status = 'linked' AND (from_id = ? OR to_id = ?) LIMIT 6`).all(p.r.id, p.r.id, p.r.id) as { id: string }[]
    for (const n of ns) add(byId.get(n.id), 'linked')
  }
  if (!opts.topic && opts.project) {
    // no topic: the most recently changed notes of the project
    for (const r of all.filter((x) => norm(x.project || '') === norm(opts.project!) && TEXT.has(x.ext)).sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 6)) add(r, 'recent')
  }
  for (const s of recentSessions(db, libDir, { project: opts.project, limit: 2 })) if (s.note_id) add(byId.get(s.note_id), 'session')
  let text = '', used = 0
  const sources: Pack['sources'] = []
  for (const { r, why } of picked) {
    const t = readText(libDir, r)
    if (t === null) continue
    const body = stripFront(t).slice(0, LIMITS.perNote)
    const block = `\n## ${r.name} (${why})\n${body}\n`
    if (used + block.length > max) break
    text += block; used += block.length
    sources.push({ id: r.id, name: r.name, path: shownPath(libDir, r), why })
  }
  return { text: text.trim(), sources }
}

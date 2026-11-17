import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import { TEXT } from './files'

// Automatic sorting after an import (no AI, fixed rules, every result carries its reason):
// links    1. [[wikilinks]] written in a note        -> origin 'user' (the user wrote them)
//          2. a note mentions another file's name   -> 'auto', reason 'mention'
//          3. both came from the same folder         -> 'auto', reason 'folder' (not for Downloads, Desktop, …)
//          4. the names share a distinctive word     -> 'auto', reason 'name'
// project  the project most of its links point to; otherwise the name of the folder it came from;
//          generic folders (Downloads, Desktop, …) give no project.
// Auto links are stored as 'linked' or, if the user turned that off, as 'suggested' (spec 5.10 feature 8).

const MAX_TEXT = 2_000_000
const STOP = new Set(['copy', 'kopie', 'final', 'neu', 'new', 'draft', 'entwurf', 'notes', 'notizen', 'untitled', 'unbenannt', 'file', 'datei', 'image', 'bild', 'screenshot', 'scan', 'test'])
const GENERIC_DIRS = new Set(['downloads', 'download', 'desktop', 'schreibtisch', 'documents', 'dokumente', 'pictures', 'bilder', 'tmp', 'temp', 'files', 'dateien', 'users', 'home'])
const W = { wikilink: 3, mention: 2, folder: 2, name: 1 } as const
type Reason = keyof typeof W

export const stem = (name: string): string => name.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase()

// distinctive words of a file name: 4+ letters/digits, not a stop word, not only digits
export function nameTokens(name: string): string[] {
  return [...new Set(stem(name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))]
}

export function wikilinks(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\[\[([^\]|#\n]+)/g)) out.add(stem(basename(m[1].trim())))
  return [...out]
}

// links of an Obsidian canvas: file cards and [[links]] inside text cards
export function canvasTargets(text: string): string[] {
  try {
    const j = JSON.parse(text) as { nodes?: { type?: string; file?: string; text?: string }[] }
    const out = new Set<string>()
    for (const n of j.nodes || []) {
      if (n.type === 'file' && typeof n.file === 'string') out.add(stem(basename(n.file)))
      else if (n.type === 'text' && typeof n.text === 'string') for (const w of wikilinks(n.text)) out.add(w)
    }
    return [...out]
  } catch { return [] }
}

// other names of a note from its frontmatter: aliases: [a, b] | aliases: a | aliases:\n  - a (also "alias")
export function aliasesOf(text: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text)
  if (!m) return []
  const lines = m[1].split(/\r?\n/), out = new Set<string>()
  const clean = (v: string) => v.trim().replace(/^["']|["']$/g, '').trim()
  for (let i = 0; i < lines.length; i++) {
    const k = /^(aliases|alias)\s*:\s*(.*)$/i.exec(lines[i]); if (!k) continue
    const v = k[2].trim()
    if (v.startsWith('[')) v.replace(/^\[|\]$/g, '').split(',').forEach((x) => out.add(clean(x)))
    else if (v) out.add(clean(v))
    else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) out.add(clean(lines[j].replace(/^\s*-\s+/, '')))
  }
  return [...out].filter(Boolean).map((a) => a.normalize('NFC').toLowerCase())
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function mentions(text: string, name: string): boolean {
  const s = stem(name)
  if (s.length < 4) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(s)}($|[^\\p{L}\\p{N}])`, 'iu').test(text.normalize('NFC'))
}

export function projectFromPath(originalPath: string): string | null {
  const dir = basename(dirname(originalPath)).normalize('NFC')
  if (!dir || GENERIC_DIRS.has(dir.toLowerCase()) || /^[a-z]:?$/i.test(dir)) return null
  return dir
}

interface Row { id: string; name: string; ext: string; lib_path: string; original_path: string; project_id: string | null; source: string; rel_path: string | null; folder_path: string | null }

export interface OrganizeResult {
  links: number
  suggested: number
  projects: Record<string, number>   // project name -> files sorted into it
}

// absolute path of a file's content: the library copy, or the file inside its linked folder
export const contentPath = (libDir: string, r: { source: string; lib_path: string; rel_path: string | null; folder_path: string | null }): string =>
  r.source === 'linked' && r.folder_path && r.rel_path ? join(r.folder_path, ...r.rel_path.split('/')) : join(libDir, r.lib_path)

async function readText(path: string): Promise<string | null> {
  try { const b = await readFile(path); return b.length <= MAX_TEXT ? b.toString('utf8') : null } catch { return null }
}

// Above this size only the cheap rules run (wikilinks, project by folder): the pairwise rules
// (mention, folder, name) compare every new file with every file and are meant for normal imports.
export const PAIRWISE_LIMIT = 3000
// a name word shared by more files than this is not distinctive
export const NAME_DF_MAX = 5
// "same folder" only means "belongs together" in small folders; in a big folder it would connect everything with everything
export const FOLDER_MAX = 8
// "mentions the other file's name" scans texts pair by pair; above this many files it is skipped
export const MENTION_LIMIT = 800
// give the main process a breath every so many files, so the window stays responsive during long runs
const YIELD_EVERY = 100
const breathe = () => new Promise<void>((r) => setImmediate(r))

// opts.wikilinksOnly: for linked folders (a vault) the user's own wikilinks and folders are the structure; no guessing.
export async function organize(db: Db, libDir: string, ids: string[], opts: { autoLink?: boolean; wikilinksOnly?: boolean; now?: () => Date } = {}): Promise<OrganizeResult> {
  const autoStatus = opts.autoLink === false ? 'suggested' : 'linked'
  const now = (opts.now || (() => new Date()))().toISOString()
  const all = db.prepare(`SELECT f.id, f.name, f.ext, f.lib_path, f.original_path, f.project_id, f.source, f.rel_path, lf.path AS folder_path
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id`).all() as unknown as Row[]
  const byId = new Map(all.map((r) => [r.id, r]))
  const byStem = new Map<string, Row[]>()
  const addStem = (k: string, r: Row) => { const l = byStem.get(k); if (!l) byStem.set(k, [r]); else if (!l.includes(r)) l.push(r) }
  for (const r of all) addStem(stem(r.name), r)
  const pairwise = !opts.wikilinksOnly && all.length <= PAIRWISE_LIMIT && ids.length <= PAIRWISE_LIMIT
  // a word in many file names (Note 1, Note 2, …) says nothing about belonging together
  const df = new Map<string, number>()
  if (pairwise) for (const r of all) for (const w of nameTokens(r.name)) df.set(w, (df.get(w) || 0) + 1)
  const distinctive = (w: string) => (df.get(w) || 0) <= NAME_DF_MAX

  // texts: new files always (their wikilinks are stored); all others only for the pairwise rules
  const texts = new Map<string, string>()
  const isNew = new Set(ids)
  for (const r of all) {
    const canvas = r.ext === 'canvas' && isNew.has(r.id)
    if ((!TEXT.has(r.ext) && !canvas) || (!pairwise && !isNew.has(r.id))) continue
    const t = await readText(contentPath(libDir, r)); if (t !== null) texts.set(r.id, t)
  }

  const res: OrganizeResult = { links: 0, suggested: 0, projects: {} }
  const insert = db.prepare(`INSERT OR IGNORE INTO knowledge_edge (from_id, to_id, origin, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
  const touched = new Map<string, Map<string, number>>()   // file id -> neighbour id -> weight
  const add = (a: string, b: string, reason: Reason) => {
    if (a === b) return
    const origin = reason === 'wikilink' ? 'user' : 'auto'
    const status = origin === 'user' ? 'linked' : autoStatus
    // undirected rules are stored once, from the new file
    const r = insert.run(a, b, origin, reason, status, now)
    if (r.changes) { if (status === 'linked') res.links++; else res.suggested++ }
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!touched.has(x)) touched.set(x, new Map())
      const m = touched.get(x)!; m.set(y, (m.get(y) || 0) + W[reason])
    }
  }

  // 1. wikilinks: store each new note's targets, then resolve outgoing and incoming links
  const delT = db.prepare('DELETE FROM wikilink_target WHERE file_id = ?')
  const insT = db.prepare('INSERT OR IGNORE INTO wikilink_target (file_id, stem) VALUES (?, ?)')
  const delA = db.prepare('DELETE FROM note_alias WHERE file_id = ?')
  const insA = db.prepare('INSERT OR IGNORE INTO note_alias (file_id, stem) VALUES (?, ?)')
  const targetsOf = new Map<string, string[]>()
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      delT.run(id); delA.run(id)
      const t = texts.get(id); if (!t) continue
      const w = byId.get(id)?.ext === 'canvas' ? canvasTargets(t) : wikilinks(t); targetsOf.set(id, w)
      for (const x of w) insT.run(id, x)
      if (byId.get(id)?.ext === 'md') for (const a of aliasesOf(t)) insA.run(id, a)
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  // [[alias]] resolves like the note's own name
  const aliasesOfId = new Map<string, string[]>()
  for (const a of db.prepare('SELECT file_id, stem FROM note_alias').all() as { file_id: string; stem: string }[]) {
    const r = byId.get(a.file_id); if (!r) continue
    addStem(a.stem, r)
    const l = aliasesOfId.get(a.file_id); if (l) l.push(a.stem); else aliasesOfId.set(a.file_id, [a.stem])
  }
  const incoming = db.prepare('SELECT file_id FROM wikilink_target WHERE stem = ?')
  // all edge and project writes in one transaction: per-row commits made linking a vault take seconds per thousand notes
  db.exec('BEGIN')
  try {
  for (const id of ids) {
    const f = byId.get(id); if (!f) continue
    for (const target of targetsOf.get(id) || []) for (const t of byStem.get(target) || []) add(id, t.id, 'wikilink')
    for (const k of [stem(f.name), ...(aliasesOfId.get(id) || [])]) for (const r of incoming.all(k) as { file_id: string }[]) add(r.file_id, id, 'wikilink')
  }

  // 2. pairwise rules (normal imports)
  if (pairwise) {
    const linksOfText = new Map<string, string[]>()
    for (const [id, t] of texts) linksOfText.set(id, targetsOf.get(id) || wikilinks(t))
    const dirOf = new Map(all.map((r) => [r.id, dirname(r.original_path).normalize('NFC').toLowerCase()]))
    const perDir = new Map<string, number>(); for (const d of dirOf.values()) perDir.set(d, (perDir.get(d) || 0) + 1)
    const tokensOf = new Map(all.map((r) => [r.id, nameTokens(r.name)]))
    const mentionOn = all.length <= MENTION_LIMIT
    let n = 0
    for (const id of ids) {
      if (++n % YIELD_EVERY === 0) await breathe()
      const f = byId.get(id); if (!f) continue
      const text = texts.get(id)
      const toks = (tokensOf.get(id) || []).filter(distinctive), dir = dirOf.get(id)!
      // Downloads & co. say nothing about belonging together, and neither does a big folder
      const sameFolder = projectFromPath(f.original_path) !== null && (perDir.get(dir) || 0) <= FOLDER_MAX
      const mine = targetsOf.get(id) || []
      for (const o of all) {
        if (o.id === id || (isNew.has(o.id) && o.id < id)) continue   // pairs of new files only once
        const ot = texts.get(o.id)
        // a mention only counts where no wikilink already connects the two
        if (mentionOn) {
          const linked = mine.includes(stem(o.name)) || (ot ? (linksOfText.get(o.id) || []).includes(stem(f.name)) : false)
          if (!linked && ot && mentions(ot, f.name)) add(o.id, id, 'mention')
          else if (!linked && text && mentions(text, o.name)) add(id, o.id, 'mention')
        }
        if (sameFolder && dirOf.get(o.id) === dir) add(id, o.id, 'folder')
        else if (toks.length && (tokensOf.get(o.id) || []).some((w) => toks.includes(w))) add(id, o.id, 'name')
      }
    }
  }

  // projects: only files that have none yet; the user's own choice is never overwritten
  const projName = new Map((db.prepare('SELECT id, name FROM project').all() as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const projByName = new Map([...projName].map(([id, n]) => [n.toLowerCase(), id]))
  const setProj = db.prepare("UPDATE file_asset SET project_id = ?, project_origin = 'auto' WHERE id = ? AND project_id IS NULL")
  const ensure = (name: string): string => {
    const k = name.toLowerCase(); let pid = projByName.get(k)
    if (!pid) { pid = randomUUID(); db.prepare('INSERT INTO project (id, name, created_at) VALUES (?, ?, ?)').run(pid, name, now); projByName.set(k, pid); projName.set(pid, name) }
    return pid
  }
  // first files whose neighbours already have a project, then the rest by folder name
  const pending = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r && !r.project_id)
  for (let pass = 0; pass < 2; pass++) {
    for (const f of pending) {
      if (f.project_id) continue
      const score = new Map<string, number>()
      for (const [nb, w] of touched.get(f.id) || []) { const p = byId.get(nb)?.project_id; if (p) score.set(p, (score.get(p) || 0) + w) }
      let pid: string | null = [...score].sort((a, b) => b[1] - a[1])[0]?.[0] || null
      if (!pid && pass === 1) { const n = projectFromPath(f.original_path); if (n) pid = ensure(n) }
      if (pid) { setProj.run(pid, f.id); f.project_id = pid; const n = projName.get(pid)!; res.projects[n] = (res.projects[n] || 0) + 1 }
    }
  }
  db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return res
}

// ensure a project by name (used for linked folders: top-level subfolder = project)
export function ensureProject(db: Db, name: string, now: string): string {
  const r = db.prepare('SELECT id FROM project WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined
  if (r) return r.id
  const id = randomUUID(); db.prepare('INSERT INTO project (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now); return id
}

import { watch, type FSWatcher } from 'node:fs'
import { isSecretName } from './secrets'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import { extOf, IMAGE, SUPPORTED } from './files'
import { ensureProject } from './organize'

// Linked folders (spec 5.1): the folder stays where it is and is only READ. NEURAL OS stores its path,
// an index and metadata. Updates are incremental (size + modification time), changes are picked up live.

// text formats indexed fully; everything else (game files, meshes, audio, video) by name, type, size, dates only
export const LINK_TEXT = new Set(['md', 'txt', 'lua', 'luau', 'json'])
// never indexed inside a linked folder
export const LINK_SKIP_DIR = new Set(['.git', 'node_modules', '.obsidian', '.trash', '__MACOSX', '.cache', 'cache', 'build', 'dist', 'out', 'temp', 'tmp'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
// NEURAL OS's own temporary files while saving a note (write.ts) are never indexed
// keys and passwords are never indexed (secrets.ts)
const SKIP_FILE = { has: (n: string) => SKIP_FILES.has(n) || n.endsWith('.nos-tmp') || isSecretName(n) }

export interface LinkedFolder { id: string; path: string; name: string; editable: number; added_at: string; last_scan: string | null; exclude?: string }

/**
 * Exclude patterns of a linked folder (one per line or comma separated, case-insensitive).
 * Without "/" a pattern matches any file or folder name anywhere ("Imports", "*.png").
 * With "/" it is a path from the folder's top ("Studio/Imports/", "Daily/2024-*"); a matching folder hides everything in it.
 * "*" = any characters except "/", "**" = anything, "?" = one character.
 */
export function excludeMatcher(patterns: string): (rel: string) => boolean {
  const list = patterns.split(/[\n,]/).map((p) => p.trim().replace(/\\/g, '/')).filter((p) => p && !p.startsWith('#'))
  if (!list.length) return () => false
  const rx = (p: string) => p.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')
  const names: RegExp[] = [], paths: RegExp[] = []
  for (const p0 of list) {
    const p = p0.replace(/\/+$/, '').replace(/^\.?\/+/, '')
    if (!p) continue
    if (p.includes('/')) paths.push(new RegExp(`^${rx(p)}(/.*)?$`, 'i'))
    else names.push(new RegExp(`^${rx(p)}$`, 'i'))
  }
  return (rel: string) => {
    if (paths.some((r) => r.test(rel))) return true
    return names.length > 0 && rel.split('/').some((seg) => names.some((r) => r.test(seg)))
  }
}
export interface ScanResult { folderId: string; added: string[]; changed: string[]; removed: number; total: number }

const toRel = (parts: string[]) => parts.join('/').normalize('NFC')
const statusOf = (ext: string) => (LINK_TEXT.has(ext) || IMAGE.has(ext) ? 'indexed' : SUPPORTED.has(ext) ? 'nameonly' : 'nameonly')

export function listFolders(db: Db): (LinkedFolder & { files: number; bytes: number })[] {
  return db.prepare(`SELECT lf.*, COUNT(f.id) AS files, COALESCE(SUM(f.size), 0) AS bytes FROM linked_folder lf
    LEFT JOIN file_asset f ON f.folder_id = lf.id GROUP BY lf.id ORDER BY lf.name COLLATE NOCASE`).all() as unknown as (LinkedFolder & { files: number; bytes: number })[]
}

export function addFolder(db: Db, path: string, now = new Date()): LinkedFolder {
  const existing = db.prepare('SELECT * FROM linked_folder WHERE path = ?').get(path) as LinkedFolder | undefined
  if (existing) return existing
  const f: LinkedFolder = { id: randomUUID(), path, name: basename(path).normalize('NFC') || path, editable: 0, added_at: now.toISOString(), last_scan: null }
  db.prepare('INSERT INTO linked_folder (id, path, name, editable, added_at) VALUES (?, ?, ?, 0, ?)').run(f.id, f.path, f.name, f.added_at)
  return f
}

// Removes the link and NEURAL OS's index for it. The folder and its files are not touched.
export function removeFolder(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM linked_folder WHERE id = ?').run(id).changes > 0   // files and links cascade
}

/** Saves the exclude patterns; the caller rescans so excluded files leave the index (the files themselves stay). */
export function setFolderExclude(db: Db, id: string, patterns: string): boolean {
  const clean = patterns.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200).join('\n').slice(0, 8000)
  return db.prepare('UPDATE linked_folder SET exclude = ? WHERE id = ?').run(clean, id).changes > 0
}

// Project of a linked file: its top-level subfolder, or the folder's own name for files at the top.
const projectName = (folder: LinkedFolder, rel: string) => (rel.includes('/') ? rel.split('/')[0] : folder.name)

interface Entry { size: number; mtime: number }

async function walk(root: string, onFile: (rel: string, e: Entry) => void, isCancelled: () => boolean, skip: (rel: string) => boolean = () => false, prefix: string[] = []): Promise<void> {
  const stack: string[][] = [[]]
  while (stack.length) {
    if (isCancelled()) return
    const parts = stack.pop()!
    let names: string[]
    try { names = await readdir(join(root, ...parts)) } catch { continue }   // unreadable folder: skipped
    for (const n of names) {
      const p = join(root, ...parts, n)
      let s
      try { s = await stat(p) } catch { continue }
      if (skip(toRel([...prefix, ...parts, n]))) continue
      if (s.isDirectory()) { if (!LINK_SKIP_DIR.has(n.toLowerCase())) stack.push([...parts, n]) }
      else if (s.isFile() && !SKIP_FILE.has(n)) onFile(toRel([...parts, n]), { size: s.size, mtime: s.mtimeMs })
    }
  }
}

// Full incremental scan: new files are added, changed ones updated, vanished ones removed.
export async function scanFolder(db: Db, folderId: string, opts: { now?: () => Date; onProgress?: (seen: number) => void; isCancelled?: () => boolean } = {}): Promise<ScanResult> {
  const folder = db.prepare('SELECT * FROM linked_folder WHERE id = ?').get(folderId) as LinkedFolder | undefined
  if (!folder) throw new Error('unknown folder')
  const now = (opts.now || (() => new Date()))().toISOString()
  const known = new Map((db.prepare('SELECT id, rel_path, size, mtime FROM file_asset WHERE folder_id = ?').all(folderId) as { id: string; rel_path: string; size: number; mtime: number }[]).map((r) => [r.rel_path, r]))
  const seen = new Set<string>()
  const found: [string, Entry][] = []
  await walk(folder.path, (rel, e) => { found.push([rel, e]); if (found.length % 250 === 0) opts.onProgress?.(found.length) }, opts.isCancelled || (() => false), excludeMatcher(folder.exclude || ''))
  opts.onProgress?.(found.length)
  const res: ScanResult = { folderId, added: [], changed: [], removed: 0, total: found.length }
  apply(db, folder, found, known, seen, res, now)
  // anything known but not seen any more is gone
  const del = db.prepare('DELETE FROM file_asset WHERE id = ?')
  db.exec('BEGIN')
  for (const [rel, r] of known) if (!seen.has(rel)) { del.run(r.id); res.removed++ }
  db.prepare('UPDATE linked_folder SET last_scan = ? WHERE id = ?').run(now, folderId)
  db.exec('COMMIT')
  return res
}

function apply(db: Db, folder: LinkedFolder, found: [string, Entry][], known: Map<string, { id: string; size: number; mtime: number }>, seen: Set<string>, res: ScanResult, now: string): void {
  const ins = db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, project_origin, status, source, folder_id, rel_path, mtime)
    VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'auto', ?, 'linked', ?, ?, ?)`)
  const upd = db.prepare('UPDATE file_asset SET size = ?, mtime = ? WHERE id = ?')
  const projects = new Map<string, string>()
  db.exec('BEGIN')
  try {
    for (const [rel, e] of found) {
      seen.add(rel)
      const k = known.get(rel)
      if (k) { if (k.size !== e.size || Math.abs(k.mtime - e.mtime) > 1) { upd.run(e.size, e.mtime, k.id); res.changed.push(k.id) } continue }
      const name = rel.split('/').pop()!, ext = extOf(name), id = randomUUID()
      const pn = projectName(folder, rel)
      let pid = projects.get(pn); if (!pid) { pid = ensureProject(db, pn, now); projects.set(pn, pid) }
      ins.run(id, name, ext, e.size, `link:${folder.id}:${rel}`, join(folder.path, ...rel.split('/')), now, pid, statusOf(ext), folder.id, rel, e.mtime)
      res.added.push(id)
    }
    db.exec('COMMIT')
  } catch (err) { db.exec('ROLLBACK'); throw err }
}

// Apply a set of changed paths (from the watcher) without walking the whole folder.
export async function applyPaths(db: Db, folderId: string, rels: string[], now = new Date()): Promise<ScanResult> {
  const folder = db.prepare('SELECT * FROM linked_folder WHERE id = ?').get(folderId) as LinkedFolder | undefined
  const res: ScanResult = { folderId, added: [], changed: [], removed: 0, total: 0 }
  if (!folder) return res
  const get = db.prepare('SELECT id, rel_path, size, mtime FROM file_asset WHERE folder_id = ? AND rel_path = ?')
  const found: [string, Entry][] = [], known = new Map<string, { id: string; size: number; mtime: number }>(), gone: string[] = []
  const skip = excludeMatcher(folder.exclude || '')
  for (const rel0 of new Set(rels)) {
    const rel = rel0.normalize('NFC')
    const parts = rel.split('/')
    if (parts.some((p) => LINK_SKIP_DIR.has(p.toLowerCase())) || SKIP_FILE.has(parts[parts.length - 1]) || skip(rel)) continue
    const k = get.get(folderId, rel) as { id: string; rel_path: string; size: number; mtime: number } | undefined
    if (k) known.set(rel, k)
    try {
      const s = await stat(join(folder.path, ...parts))
      if (s.isFile()) found.push([rel, { size: s.size, mtime: s.mtimeMs }])
      else if (s.isDirectory()) { const sub = await scanSub(folder, parts); found.push(...sub); for (const [r] of sub) { const kk = get.get(folderId, r) as { id: string; size: number; mtime: number } | undefined; if (kk) known.set(r, kk) } }
    } catch { if (k) gone.push(k.id) }
  }
  // a new folder arrives as events for the folder and for each file in it: every path once, or the
  // insert hits the unique hash and the whole batch was rolled back (new files never showed up)
  const uniq = [...new Map(found.map((x) => [x[0], x])).values()]
  apply(db, folder, uniq, known, new Set(), res, now.toISOString())
  res.total = uniq.length
  const del = db.prepare('DELETE FROM file_asset WHERE id = ?')
  for (const id of gone) { del.run(id); res.removed++ }
  return res
}

async function scanSub(folder: LinkedFolder, parts: string[]): Promise<[string, Entry][]> {
  const out: [string, Entry][] = []
  await walk(join(folder.path, ...parts), (rel, e) => out.push([toRel([...parts, rel]), e]), () => false, excludeMatcher(folder.exclude || ''), parts)
  return out
}

// Watch a linked folder; changed paths are collected and handed over after a short quiet time.
export function watchFolder(folder: LinkedFolder, onPaths: (rels: string[]) => void, onStop: () => void = () => undefined, quietMs = 800): FSWatcher | null {
  let pending = new Set<string>(), timer: NodeJS.Timeout | null = null
  try {
    const w = watch(folder.path, { recursive: true, persistent: false }, (_ev, file) => {
      if (!file) return
      pending.add(String(file).split(sep).join('/'))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { const p = [...pending]; pending = new Set(); timer = null; onPaths(p) }, quietMs)
    })
    w.on('error', () => { try { w.close() } catch { /* already closed */ } onStop() })   // folder gone or not watchable: the next scan catches up
    return w
  } catch { return null }
}

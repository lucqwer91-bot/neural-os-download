import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'
import { ensureProject } from './organize'
import { excludeMatcher, LINK_SKIP_DIR, type LinkedFolder } from './linked'
import { isSecretName } from './secrets'

// File explorer (Obsidian replacement, Paket 1): folders, new notes and folders, move, rename, trash —
// only inside linked folders the user made editable (spec 5.1). Deleting never deletes: the file goes
// to <folder>/.trash/ like in Obsidian (never indexed) and can be put back.
// The index is updated right away, so links, versions and history keep their file ids.

export type OpResult = { ok: true; id?: string; rel?: string; trash?: string } | { ok: false; reason: 'missing' | 'readonly' | 'name' | 'exists' | 'failed' | 'inside' }

const BAD = /[\\/:*?"<>|\u0000-\u001f]/g
export const cleanName = (s: string) => s.replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 180)
const joinRel = (...p: string[]) => p.filter(Boolean).join('/')
const parent = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const baseOf = (rel: string) => rel.split('/').pop() || ''
const projectName = (folder: LinkedFolder, rel: string) => (rel.includes('/') ? rel.split('/')[0] : folder.name)
const abs = (f: LinkedFolder, rel: string) => join(f.path, ...rel.split('/').filter(Boolean))
const BAD_PART = /[\\:*?"<>|\u0000-\u001f]/
const safeRel = (rel: string) => rel === '' || !rel.split('/').some((p) => !p || p === '..' || p === '.' || BAD_PART.test(p))

function folderOf(db: Db, folderId: string): LinkedFolder | null {
  return (db.prepare('SELECT * FROM linked_folder WHERE id = ?').get(folderId) as LinkedFolder | undefined) ?? null
}
function editable(db: Db, folderId: string): LinkedFolder | 'missing' | 'readonly' {
  const f = folderOf(db, folderId)
  if (!f) return 'missing'
  return f.editable ? f : 'readonly'
}
/** A free name in a folder: "Name", "Name 1", "Name 2" … */
export async function freeName(dirAbs: string, base: string, ext: string): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const n = (i ? `${base} ${i}` : base) + ext
    if (!existsSync(join(dirAbs, n))) return n
  }
  return `${base} ${Date.now()}${ext}`
}

export interface DirTree { folderId: string; name: string; editable: boolean; dirs: string[] }

/** All folders of every linked folder (also empty ones), without skipped, excluded and hidden ones. */
export async function dirTree(db: Db, max = 20000): Promise<DirTree[]> {
  const out: DirTree[] = []
  for (const f of db.prepare('SELECT * FROM linked_folder ORDER BY name').all() as unknown as LinkedFolder[]) {
    const skip = excludeMatcher(f.exclude || '')
    const dirs: string[] = []
    const stack = ['']
    while (stack.length && dirs.length < max) {
      const rel = stack.pop()!
      let names: import('node:fs').Dirent[] = []
      try { names = await readdir(abs(f, rel), { withFileTypes: true }) } catch { continue }
      for (const d of names) {
        if (!d.isDirectory() || d.name.startsWith('.') || LINK_SKIP_DIR.has(d.name.toLowerCase())) continue
        const r = joinRel(rel, d.name)
        if (skip(r)) continue
        dirs.push(r); stack.push(r)
      }
    }
    out.push({ folderId: f.id, name: f.name, editable: !!f.editable, dirs: dirs.sort((a, b) => a.localeCompare(b)) })
  }
  return out
}

/** New note in a folder of an editable linked folder; indexed right away. */
export async function newNote(db: Db, folderId: string, relDir: string, name: string, now = new Date()): Promise<OpResult> {
  const f = editable(db, folderId); if (typeof f === 'string') return { ok: false, reason: f }
  if (!safeRel(relDir)) return { ok: false, reason: 'name' }
  const base = cleanName(name.replace(/\.md$/i, '')) || 'Untitled'
  if (isSecretName(base + '.md')) return { ok: false, reason: 'name' }
  const dir = abs(f, relDir)
  try { await mkdir(dir, { recursive: true }) } catch { return { ok: false, reason: 'failed' } }
  const fname = await freeName(dir, base, '.md')
  const rel = joinRel(relDir, fname), text = ''
  try { await writeFile(join(dir, fname), text, { flag: 'wx' }) } catch { return { ok: false, reason: 'exists' } }
  const s = await stat(join(dir, fname))
  const id = (await import('node:crypto')).randomUUID(), at = now.toISOString()
  const pid = ensureProject(db, projectName(f, rel), at)
  db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, project_origin, status, source, folder_id, rel_path, mtime)
    VALUES (?, ?, 'md', ?, ?, '', ?, ?, ?, 'auto', 'indexed', 'linked', ?, ?, ?)`).run(id, fname, s.size, `link:${f.id}:${rel}`, join(dir, fname), at, pid, f.id, rel, s.mtimeMs)
  return { ok: true, id, rel }
}

export async function newFolder(db: Db, folderId: string, relDir: string, name: string): Promise<OpResult> {
  const f = editable(db, folderId); if (typeof f === 'string') return { ok: false, reason: f }
  if (!safeRel(relDir)) return { ok: false, reason: 'name' }
  const base = cleanName(name) || 'New folder'
  const fname = await freeName(abs(f, relDir), base, '')
  try { await mkdir(join(abs(f, relDir), fname), { recursive: true }) } catch { return { ok: false, reason: 'failed' } }
  return { ok: true, rel: joinRel(relDir, fname) }
}

/** Moves the index rows of a path (a file, or a folder with everything in it) to a new path. */
function moveRows(db: Db, f: LinkedFolder, from: string, to: string, now: string): void {
  const rows = db.prepare('SELECT id, rel_path FROM file_asset WHERE folder_id = ? AND (rel_path = ? OR rel_path LIKE ? ESCAPE \'\\\')')
    .all(f.id, from, from.replace(/[\\%_]/g, (c) => '\\' + c) + '/%') as { id: string; rel_path: string }[]
  const up = db.prepare('UPDATE file_asset SET rel_path = ?, name = ?, original_path = ?, hash = ?, project_id = ? WHERE id = ?')
  const projects = new Map<string, string>()
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      const rel = to + r.rel_path.slice(from.length)
      const pn = projectName(f, rel)
      let pid = projects.get(pn); if (!pid) { pid = ensureProject(db, pn, now); projects.set(pn, pid) }
      up.run(rel, baseOf(rel), abs(f, rel), `link:${f.id}:${rel}`, pid, r.id)
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
}

function fileRow(db: Db, id: string): { id: string; folder_id: string | null; rel_path: string | null; source: string } | null {
  return (db.prepare('SELECT id, folder_id, rel_path, source FROM file_asset WHERE id = ?').get(id) as { id: string; folder_id: string | null; rel_path: string | null; source: string } | undefined) ?? null
}

/**
 * Move a file or folder to another folder in the same linked folder, optionally with a new name
 * (a file keeps its extension). Moving does not break [[links]]: they go by name.
 */
export async function movePath(db: Db, folderId: string, rel: string, toDir: string, newName?: string, now = new Date()): Promise<OpResult> {
  const f = editable(db, folderId); if (typeof f === 'string') return { ok: false, reason: f }
  if (!rel || !safeRel(rel) || !safeRel(toDir)) return { ok: false, reason: 'name' }
  if (toDir === rel || toDir.startsWith(rel + '/')) return { ok: false, reason: 'inside' }
  const from = abs(f, rel)
  let st
  try { st = await stat(from) } catch { return { ok: false, reason: 'missing' } }
  let name = baseOf(rel)
  if (newName !== undefined) {
    const ext = st.isFile() && name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
    const b = cleanName(newName.endsWith(ext) && ext ? newName.slice(0, -ext.length) : newName)
    if (!b) return { ok: false, reason: 'name' }
    name = b + ext
  }
  const to = joinRel(toDir, name)
  if (to === rel) return { ok: true, rel }
  if (existsSync(abs(f, to)) && to.toLowerCase() !== rel.toLowerCase()) return { ok: false, reason: 'exists' }
  if (st.isFile() && isSecretName(name)) return { ok: false, reason: 'name' }
  try { await mkdir(abs(f, toDir), { recursive: true }); await rename(from, abs(f, to)) } catch { return { ok: false, reason: 'failed' } }
  moveRows(db, f, rel, to, now.toISOString())
  return { ok: true, rel: to }
}

export async function moveFile(db: Db, id: string, toDir: string, newName?: string, now = new Date()): Promise<OpResult> {
  const r = fileRow(db, id)
  if (!r || r.source !== 'linked' || !r.folder_id || !r.rel_path) return { ok: false, reason: r ? 'readonly' : 'missing' }
  const res = await movePath(db, r.folder_id, r.rel_path, toDir, newName, now)
  return res.ok ? { ...res, id } : res
}

/** To <folder>/.trash/ (Obsidian's place), out of the index. The answer names where, for "undo". */
export async function trashPath(db: Db, folderId: string, rel: string): Promise<OpResult> {
  const f = editable(db, folderId); if (typeof f === 'string') return { ok: false, reason: f }
  if (!rel || !safeRel(rel)) return { ok: false, reason: 'name' }
  const from = abs(f, rel)
  if (!existsSync(from)) return { ok: false, reason: 'missing' }
  const tdir = join(f.path, '.trash')
  const name = baseOf(rel), dot = name.lastIndexOf('.')
  const isFile = (await stat(from)).isFile()
  const t = await freeName(tdir, isFile && dot > 0 ? name.slice(0, dot) : name, isFile && dot > 0 ? name.slice(dot) : '')
  try { await mkdir(tdir, { recursive: true }); await rename(from, join(tdir, t)) } catch { return { ok: false, reason: 'failed' } }
  db.prepare("DELETE FROM file_asset WHERE folder_id = ? AND (rel_path = ? OR rel_path LIKE ? ESCAPE '\\')").run(f.id, rel, rel.replace(/[\\%_]/g, (c) => '\\' + c) + '/%')
  return { ok: true, rel, trash: '.trash/' + t }
}

/** Undo a trash: back to where it was (if that place is free); the caller indexes it again. */
export async function restoreTrash(db: Db, folderId: string, trash: string, rel: string): Promise<OpResult> {
  const f = editable(db, folderId); if (typeof f === 'string') return { ok: false, reason: f }
  if (!trash.startsWith('.trash/') || !safeRel(trash) || !safeRel(rel)) return { ok: false, reason: 'name' }
  if (existsSync(abs(f, rel))) return { ok: false, reason: 'exists' }
  try { await mkdir(abs(f, parent(rel)), { recursive: true }); await rename(abs(f, trash), abs(f, rel)) } catch { return { ok: false, reason: 'failed' } }
  return { ok: true, rel }
}

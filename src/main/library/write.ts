import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Db } from './db'
import { contentPath, ensureProject } from './organize'

// Note editor, safe writes (spec 5.6 and 5.1):
// - only Markdown and plain text, never binary or other files
// - library copies are editable; files in a linked folder only when the user enabled editing for that folder
// - before saving, the file on disk must still be what the editor opened (hash); otherwise: conflict, nothing written
// - the previous text is kept as a version before every save, so every edit can be undone
// - written atomically (temporary file next to it, then rename)

export const EDITABLE = new Set(['md', 'txt'])
export const MAX_NOTE = 2_000_000
export const KEEP_VERSIONS = 50

export const textHash = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

interface FileInfo { id: string; name: string; ext: string; source: string; lib_path: string; rel_path: string | null; folder_path: string | null; editable: number | null }

function info(db: Db, id: string): FileInfo | undefined {
  return db.prepare(`SELECT f.id, f.name, f.ext, f.source, f.lib_path, f.rel_path, lf.path AS folder_path, lf.editable
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id WHERE f.id = ?`).get(id) as unknown as FileInfo | undefined
}

export type EditState = { ok: true; path: string; linked: boolean } | { ok: false; reason: 'missing' | 'type' | 'readonly' | 'session' }

/** Whether a file may be edited in NEURAL OS, and where it is. */
export function editState(db: Db, libDir: string, id: string): EditState {
  const r = info(db, id)
  if (!r) return { ok: false, reason: 'missing' }
  if (!EDITABLE.has((r.ext || '').toLowerCase())) return { ok: false, reason: 'type' }
  // session notes are rewritten by NEURAL OS after every Claude session: edits there would be lost
  if (r.source === 'session') return { ok: false, reason: 'session' }
  const linked = r.source === 'linked'
  if (linked && !r.editable) return { ok: false, reason: 'readonly' }
  return { ok: true, path: contentPath(libDir, r), linked }
}

export type SaveResult =
  | { ok: true; hash: string; unchanged?: boolean; version: string | null }
  | { ok: false; conflict: true; theirs: string | null; theirsHash: string | null }
  | { ok: false; conflict?: false; reason: 'missing' | 'type' | 'readonly' | 'session' | 'size' | 'failed'; error?: string }

/**
 * Saves a note. baseHash = hash of the text the editor opened. If the file changed since (Claude, Obsidian,
 * another tool), nothing is written and the current text comes back as a conflict; force skips that check
 * (the user chose "keep mine" after seeing the conflict). The text before the save is kept as a version.
 */
export async function saveNote(db: Db, libDir: string, id: string, text: string, baseHash: string | null, opts: { force?: boolean; reason?: 'save' | 'restore' | 'conflict'; now?: Date } = {}): Promise<SaveResult> {
  const st = editState(db, libDir, id)
  if (!st.ok) return { ok: false, reason: st.reason }
  if (Buffer.byteLength(text, 'utf8') > MAX_NOTE) return { ok: false, reason: 'size' }
  let cur: string | null = null
  try { cur = (await readFile(st.path)).toString('utf8') } catch { cur = null }
  const curHash = cur === null ? null : textHash(cur)
  if (!opts.force && curHash !== baseHash) return { ok: false, conflict: true, theirs: cur, theirsHash: curHash }
  if (cur === text) return { ok: true, hash: curHash!, unchanged: true, version: null }
  const now = (opts.now || new Date()).toISOString()
  let version: string | null = null
  if (cur !== null) {
    version = randomUUID()
    db.prepare('INSERT INTO note_version (id, file_id, saved_at, text, reason) VALUES (?, ?, ?, ?, ?)').run(version, id, now, cur, opts.reason || 'save')
    const old = db.prepare('SELECT id FROM note_version WHERE file_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT -1 OFFSET ?').all(id, KEEP_VERSIONS) as { id: string }[]
    for (const o of old) db.prepare('DELETE FROM note_version WHERE id = ?').run(o.id)
  }
  const tmp = join(dirname(st.path), `.${randomUUID().slice(0, 8)}.nos-tmp`)
  try {
    await mkdir(dirname(st.path), { recursive: true })
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, st.path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined)
    if (version) db.prepare('DELETE FROM note_version WHERE id = ?').run(version)
    return { ok: false, reason: 'failed', error: (e as NodeJS.ErrnoException).code || String(e) }
  }
  const s = await stat(st.path)
  const hash = textHash(text)
  if (st.linked) db.prepare('UPDATE file_asset SET size = ?, mtime = ? WHERE id = ?').run(s.size, s.mtimeMs, id)
  else {
    // copies keep their content hash for the duplicate check; equal content elsewhere gets a unique suffix
    const taken = db.prepare('SELECT 1 FROM file_asset WHERE hash = ? AND id <> ?').get(hash, id)
    db.prepare('UPDATE file_asset SET size = ?, mtime = ?, hash = ? WHERE id = ?').run(s.size, s.mtimeMs, taken ? `${hash}:${id}` : hash, id)
  }
  return { ok: true, hash, version }
}

export interface VersionRow { id: string; saved_at: string; reason: string; size: number }
export function listVersions(db: Db, id: string): VersionRow[] {
  return db.prepare('SELECT id, saved_at, reason, length(text) AS size FROM note_version WHERE file_id = ? ORDER BY saved_at DESC, rowid DESC').all(id) as unknown as VersionRow[]
}
export function getVersion(db: Db, vid: string): { id: string; file_id: string; saved_at: string; text: string } | null {
  return (db.prepare('SELECT id, file_id, saved_at, text FROM note_version WHERE id = ?').get(vid) as unknown as { id: string; file_id: string; saved_at: string; text: string }) ?? null
}

/** Puts an earlier version back; the current text becomes a version itself, so restoring can be undone too. */
export async function restoreVersion(db: Db, libDir: string, vid: string, now?: Date): Promise<SaveResult> {
  const v = getVersion(db, vid)
  if (!v) return { ok: false, reason: 'missing' }
  return saveNote(db, libDir, v.file_id, v.text, null, { force: true, reason: 'restore', now })
}

const safeName = (n: string) => n.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 120)

/** A new note in the library (a copy-type file that starts in NEURAL OS). */
export async function createNote(db: Db, libDir: string, o: { name: string; project?: string | null; text?: string; now?: Date }): Promise<{ id: string; name: string }> {
  const base = safeName(o.name.replace(/\.md$/i, '')) || 'Neue Notiz'
  const now = (o.now || new Date()).toISOString()
  const id = randomUUID(), name = base + '.md'
  const rel = ['files', id.slice(0, 2), id, name].join('/')
  const text = o.text ?? `# ${base}\n\n`
  await mkdir(join(libDir, 'files', id.slice(0, 2), id), { recursive: true })
  await writeFile(join(libDir, rel), text, { encoding: 'utf8', flag: 'wx' })
  const s = await stat(join(libDir, rel))
  const hash = textHash(text), taken = db.prepare('SELECT 1 FROM file_asset WHERE hash = ?').get(hash)
  const pid = o.project ? ensureProject(db, o.project, now) : null
  db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, status, mtime)
    VALUES (?, ?, 'md', ?, ?, ?, ?, ?, ?, 'indexed', ?)`).run(id, name, s.size, taken ? `${hash}:${id}` : hash, rel, join(libDir, rel), now, pid, s.mtimeMs)
  return { id, name }
}

/** Turn editing on or off for a linked folder (spec 5.1: off by default). */
export function setFolderEditable(db: Db, folderId: string, on: boolean): boolean {
  return Number(db.prepare('UPDATE linked_folder SET editable = ? WHERE id = ?').run(on ? 1 : 0, folderId).changes) > 0
}

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'
import { editState } from './write'
import { cleanName, freeName } from './fileops'
import { applyPaths } from './linked'
import { isSecretName } from './secrets'

// Images pasted or dropped into a note (Obsidian replacement, Paket 1). The file goes where Obsidian would
// put it (vault: .obsidian/app.json attachmentFolderPath; library note: its own library folder) and the
// note gets ![[name]]. Only for notes NEURAL OS may edit; never anything that looks like a key file.

export const ATTACH_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf'])
export const ATTACH_MAX = 25 * 1024 * 1024

export type AttachResult = { ok: true; id: string; name: string } | { ok: false; reason: 'missing' | 'readonly' | 'type' | 'size' | 'name' | 'failed' }

const parent = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

/** Obsidian's attachment folder for a note in a vault, as a path inside the vault. */
export async function attachDir(vault: string, noteRel: string): Promise<string> {
  let p = '/'
  try { const j = JSON.parse(await readFile(join(vault, '.obsidian', 'app.json'), 'utf8')); if (typeof j.attachmentFolderPath === 'string') p = j.attachmentFolderPath } catch { /* no config: vault root, Obsidian's default */ }
  p = p.trim().replace(/\\/g, '/')
  const here = parent(noteRel)
  let rel = p === '' || p === '/' ? '' : p === '.' || p === './' ? here : p.startsWith('./') ? [here, p.slice(2)].filter(Boolean).join('/') : p
  rel = rel.replace(/^\/+|\/+$/g, '')
  if (rel.split('/').some((x) => x === '..' || x.startsWith('.'))) rel = here   // never outside the vault or into hidden folders
  return rel
}

export async function saveAttachment(db: Db, libDir: string, noteId: string, fileName: string, bytes: Uint8Array, now = new Date()): Promise<AttachResult> {
  const es = editState(db, libDir, noteId)
  if (!es.ok) return { ok: false, reason: es.reason === 'missing' ? 'missing' : 'readonly' }
  const dot = fileName.lastIndexOf('.'), ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  if (!ATTACH_EXT.has(ext)) return { ok: false, reason: 'type' }
  if (!bytes.byteLength || bytes.byteLength > ATTACH_MAX) return { ok: false, reason: 'size' }
  const base = cleanName(fileName.slice(0, dot)) || 'Pasted image'
  if (isSecretName(base + '.' + ext)) return { ok: false, reason: 'name' }
  const note = db.prepare('SELECT folder_id, rel_path, project_id FROM file_asset WHERE id = ?').get(noteId) as { folder_id: string | null; rel_path: string | null; project_id: string | null }
  try {
    if (es.linked && note.folder_id && note.rel_path !== null) {
      const f = db.prepare('SELECT path FROM linked_folder WHERE id = ?').get(note.folder_id) as { path: string }
      const dirRel = await attachDir(f.path, note.rel_path)
      const dir = join(f.path, ...dirRel.split('/').filter(Boolean))
      await mkdir(dir, { recursive: true })
      const name = await freeName(dir, base, '.' + ext)
      await writeFile(join(dir, name), bytes, { flag: 'wx' })
      const rel = [dirRel, name].filter(Boolean).join('/')
      await applyPaths(db, note.folder_id, [rel], now)
      const row = db.prepare('SELECT id FROM file_asset WHERE folder_id = ? AND rel_path = ?').get(note.folder_id, rel) as { id: string } | undefined
      return row ? { ok: true, id: row.id, name } : { ok: false, reason: 'failed' }
    }
    // library note: own library folder; a name another library file already has gets a number (links go by name)
    const taken = new Set((db.prepare('SELECT lower(name) AS n FROM file_asset').all() as { n: string }[]).map((r) => r.n))
    let name = `${base}.${ext}`
    for (let i = 1; taken.has(name.toLowerCase()) && i < 1000; i++) name = `${base} ${i}.${ext}`
    const id = randomUUID(), rel = ['files', id.slice(0, 2), id, name].join('/')
    await mkdir(join(libDir, 'files', id.slice(0, 2), id), { recursive: true })
    await writeFile(join(libDir, rel), bytes, { flag: 'wx' })
    const s = await stat(join(libDir, rel))
    let hash = createHash('sha256').update(bytes).digest('hex')
    if (db.prepare('SELECT 1 FROM file_asset WHERE hash = ?').get(hash)) hash = `${hash}:${id}`
    db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, status, mtime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, ext, s.size, hash, rel, join(libDir, rel), now.toISOString(), note.project_id, ext === 'pdf' ? 'nameonly' : 'indexed', s.mtimeMs)
    return { ok: true, id, name }
  } catch { return { ok: false, reason: 'failed' } }
}

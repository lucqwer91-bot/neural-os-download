import { randomUUID } from 'node:crypto'
import { maskSecrets } from './secrets'
import { constants, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'
import { collect, displayName, extOf, IMAGE, sha256, SUPPORTED, TEXT } from './files'
import { contentPath } from './organize'
import { EXTRACT, storedText } from './extract'

// The library: imported files are COPIED into the library folder (spec 5.1).
// Originals are only read, never moved, changed or deleted.

// Above these limits the import dialog suggests linking the folder instead of copying.
export const LINK_SUGGEST_FILES = 5000
export const LINK_SUGGEST_BYTES = 1e9

export interface ImportPlan {
  count: number
  bytes: number
  suggest: 'copy' | 'link'
  vault: boolean
  errors: { path: string; error: string }[]
}

export async function planImport(paths: string[], exclude: string[] = []): Promise<ImportPlan> {
  const { files, errors } = await collect(paths, exclude)
  const bytes = files.reduce((s, f) => s + f.size, 0)
  // an Obsidian vault (a folder with .obsidian inside) is linked in place, never copied: the user keeps working in it
  const vault = paths.some((p) => { try { return statSync(join(p, '.obsidian')).isDirectory() } catch { return false } })
  const suggest = vault || files.length > LINK_SUGGEST_FILES || bytes > LINK_SUGGEST_BYTES ? 'link' : 'copy'
  return { count: files.length, bytes, suggest, vault, errors }
}

export interface ImportResult {
  imported: { id: string; name: string }[]
  duplicates: { path: string; existing: string }[]
  failed: { path: string; error: string }[]
}

export interface FileRow {
  id: string; name: string; ext: string; size: number; hash: string; lib_path: string
  original_path: string; imported_at: string; project_id: string | null; project_origin: string | null; status: string
  source: string; folder_id: string | null; rel_path: string | null; mtime: number | null
}

export async function importFiles(
  db: Db, libDir: string, paths: string[],
  opts: { projectId?: string | null; exclude?: string[]; now?: () => Date; onProgress?: (done: number, total: number) => void } = {}
): Promise<ImportResult> {
  const now = opts.now || (() => new Date())
  // never import the library into itself
  const { files, errors } = await collect(paths, [libDir, ...(opts.exclude || [])])
  const res: ImportResult = { imported: [], duplicates: [], failed: errors.slice() }
  const byHash = db.prepare('SELECT name FROM file_asset WHERE hash = ?')
  const insert = db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, status, mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  let done = 0
  for (const f of files) {
    try {
      const hash = await sha256(f.path)
      const dup = byHash.get(hash) as { name: string } | undefined
      if (dup) { res.duplicates.push({ path: f.path, existing: dup.name }); continue }
      const id = randomUUID(), name = displayName(f.path), ext = extOf(f.path)
      // each copy gets its own folder, so equal names never collide and the name stays readable
      const rel = join('files', id.slice(0, 2), id, name)
      const dest = join(libDir, rel)
      await mkdir(join(libDir, 'files', id.slice(0, 2), id), { recursive: true })
      await copyFile(f.path, dest, constants.COPYFILE_EXCL)
      // text and images are complete after the copy; PDF/DOCX text extraction comes later, until then name only
      const status = !SUPPORTED.has(ext) ? 'unsupported' : TEXT.has(ext) || IMAGE.has(ext) ? 'indexed' : 'nameonly'
      try {
        insert.run(id, name, ext, f.size, hash, rel.split('\\').join('/'), f.path, now().toISOString(), opts.projectId ?? null, status, f.mtime ?? null)
      } catch (e) {
        await rm(join(libDir, 'files', id.slice(0, 2), id), { recursive: true, force: true })
        throw e
      }
      res.imported.push({ id, name })
    } catch (e) {
      res.failed.push({ path: f.path, error: (e as NodeJS.ErrnoException).code || String((e as Error).message || e) })
    } finally {
      opts.onProgress?.(++done, files.length)
    }
  }
  return res
}

export interface LibraryStats { count: number; bytes: number; byType: Record<string, number> }

export function stats(db: Db): LibraryStats {
  const t = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS b FROM file_asset').get() as { c: number; b: number }
  const byType: Record<string, number> = {}
  for (const r of db.prepare('SELECT ext, COUNT(*) AS c FROM file_asset GROUP BY ext ORDER BY c DESC').all() as { ext: string; c: number }[])
    byType[r.ext || '—'] = r.c
  return { count: t.c, bytes: t.b, byType }
}

export function listFiles(db: Db): (FileRow & { project: string | null; links: number; folder_name: string | null; aliases: string | null })[] {
  return db.prepare(`SELECT f.*, p.name AS project, lf.name AS folder_name,
      (SELECT group_concat(a.stem, '|') FROM note_alias a WHERE a.file_id = f.id) AS aliases,
      (SELECT COUNT(DISTINCT CASE WHEN e.from_id = f.id THEN e.to_id ELSE e.from_id END) FROM knowledge_edge e WHERE e.status = 'linked' AND (e.from_id = f.id OR e.to_id = f.id)) AS links
    FROM file_asset f LEFT JOIN project p ON p.id = f.project_id LEFT JOIN linked_folder lf ON lf.id = f.folder_id ORDER BY f.name COLLATE NOCASE`).all() as unknown as (FileRow & { project: string | null; links: number; folder_name: string | null; aliases: string | null })[]
}

export interface LinkRow { from_id: string; to_id: string; origin: string; reason: string; status: string }
export function listLinks(db: Db): LinkRow[] {
  return db.prepare("SELECT from_id, to_id, origin, reason, status FROM knowledge_edge WHERE status != 'rejected'").all() as unknown as LinkRow[]
}

// Removes only the library copy and its record (after the user confirmed). The original is never touched.
export async function removeFile(db: Db, libDir: string, id: string): Promise<boolean> {
  const row = db.prepare("SELECT id FROM file_asset WHERE id = ? AND source = 'copy'").get(id) as { id: string } | undefined
  if (!row) return false   // linked files are removed by unlinking their folder, never one by one
  await rm(join(libDir, 'files', id.slice(0, 2), id), { recursive: true, force: true })
  db.prepare('DELETE FROM file_asset WHERE id = ?').run(id)
  return true
}

// Content of one library file for reading inside NEURAL OS (never written). Text up to 2 MB, images up to 8 MB as data URL.
const READ_TEXT = new Set(['md', 'txt', 'lua', 'luau', 'json', 'canvas', 'base', 'css', 'js', 'ts', 'csv', 'yml', 'yaml'])
const READ_IMAGE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
export type Content = { kind: 'text'; ext: string; text: string; from?: string; pages?: number | null } | { kind: 'image'; url: string } | { kind: 'none'; reason: 'type' | 'size' | 'missing' | 'notext' | 'pending' }
export async function readContent(db: Db, libDir: string, id: string): Promise<Content> {
  const r = db.prepare(`SELECT f.ext, f.size, f.source, f.lib_path, f.rel_path, lf.path AS folder_path FROM file_asset f
    LEFT JOIN linked_folder lf ON lf.id = f.folder_id WHERE f.id = ?`).get(id) as { ext: string; size: number; source: string; lib_path: string; rel_path: string | null; folder_path: string | null } | undefined
  if (!r) return { kind: 'none', reason: 'missing' }
  const path = contentPath(libDir, r), ext = (r.ext || '').toLowerCase()
  // PDF/Word: the text read out of the file (extract.ts), never the file itself
  if (EXTRACT.has(ext)) {
    const tx = storedText(db, id)
    if (tx) return { kind: 'text', ext: 'extracted', text: maskSecrets(tx.text), from: ext, pages: tx.pages }
    const seen = db.prepare('SELECT 1 FROM file_text WHERE file_id = ?').get(id)
    return { kind: 'none', reason: seen ? 'notext' : 'pending' }
  }
  try {
    if (READ_TEXT.has(ext)) {
      if (r.size > 2_000_000) return { kind: 'none', reason: 'size' }
      return { kind: 'text', ext, text: maskSecrets((await readFile(path)).toString('utf8')) }
    }
    if (ext in READ_IMAGE) {
      if (r.size > 8_000_000) return { kind: 'none', reason: 'size' }
      return { kind: 'image', url: `data:${READ_IMAGE[ext]};base64,` + (await readFile(path)).toString('base64') }
    }
  } catch { return { kind: 'none', reason: 'missing' } }
  return { kind: 'none', reason: 'type' }
}

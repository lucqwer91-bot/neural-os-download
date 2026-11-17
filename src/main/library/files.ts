import { createHash } from 'node:crypto'
import { isSecretName } from './secrets'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'

// File helpers for the library: hashing, type detection, walking folders. Read-only on originals.

export async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

// NFC so the same name from macOS (NFD) and Windows compares equal
export const displayName = (p: string): string => basename(p).normalize('NFC')
export const extOf = (p: string): string => extname(p).slice(1).toLowerCase()

// First supported formats (spec 5.1). Others are stored, but marked unsupported.
export const SUPPORTED = new Set(['md', 'txt', 'pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'])
export const TEXT = new Set(['md', 'txt'])
export const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp'])

// Folders that are never imported (system and tool clutter)
const SKIP_DIR = new Set(['.git', 'node_modules', '.obsidian', '.trash', '__MACOSX'])
const SKIP_FILE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

// Is `child` the folder `parent` or inside it? Case-insensitive on Windows and macOS.
export function isInside(child: string, parent: string, platform: string = process.platform): boolean {
  const norm = (p: string) => { const r = resolve(p).normalize('NFC'); return platform === 'linux' ? r : r.toLowerCase() }
  const rel = relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export interface FoundFile { path: string; size: number; mtime?: number }

// Walk files and folders the user picked. Symlinks are not followed.
// Paths inside `exclude` (the library itself, the app data folder) are skipped.
export async function collect(paths: string[], exclude: string[] = []): Promise<{ files: FoundFile[]; errors: { path: string; error: string }[] }> {
  const files: FoundFile[] = []
  const errors: { path: string; error: string }[] = []
  async function visit(p: string): Promise<void> {
    if (exclude.some((x) => isInside(p, x))) return
    let s
    try { s = await stat(p) } catch (e) { errors.push({ path: p, error: (e as NodeJS.ErrnoException).code || 'unreadable' }); return }
    if (s.isDirectory()) {
      if (SKIP_DIR.has(basename(p))) return
      let names: string[]
      try { names = await readdir(p) } catch (e) { errors.push({ path: p, error: (e as NodeJS.ErrnoException).code || 'unreadable' }); return }
      for (const n of names.sort()) await visit(join(p, n))
    } else if (s.isFile()) {
      // keys and passwords are never copied in (secrets.ts)
      if (!SKIP_FILE.has(basename(p)) && !isSecretName(basename(p))) files.push({ path: p, size: s.size, mtime: s.mtimeMs })
    }
  }
  for (const p of paths) await visit(p)
  return { files, errors }
}

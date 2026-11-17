import { readFile, stat } from 'node:fs/promises'
import { maskSecrets } from './secrets'
import type { Db } from './db'
import { contentPath } from './organize'
// the same tag rules the note view uses, so the list and the note always agree
import { noteTags } from '../../renderer/src/ui/markdown.js'

// Tags and full-text search over the user's notes (spec 5.9). Read only; nothing is written.
// Texts are read from disk and cached by modification time, so a second search is quick.

export const SCAN_MAX = 5000
const MAX_TEXT = 2_000_000
const NOTE = new Set(['md', 'txt'])
const SEARCHABLE = new Set(['md', 'txt', 'lua', 'luau', 'json', 'canvas', 'csv', 'yml', 'yaml', 'base'])

interface Row { id: string; name: string; ext: string; source: string; lib_path: string; rel_path: string | null; folder_path: string | null; project: string | null; mtime: number | null }
const cache = new Map<string, { mtime: number; text: string; tags: string[] | null }>()

function rows(db: Db): Row[] {
  return db.prepare(`SELECT f.id, f.name, f.ext, f.source, f.lib_path, f.rel_path, f.mtime, lf.path AS folder_path, p.name AS project
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id LEFT JOIN project p ON p.id = f.project_id ORDER BY f.name COLLATE NOCASE`).all() as unknown as Row[]
}

async function textOf(db: Db, libDir: string, r: Row): Promise<string | null> {
  if (r.ext === 'pdf' || r.ext === 'docx') {
    const x = db.prepare('SELECT text FROM file_text WHERE file_id = ?').get(r.id) as { text: string } | undefined
    return x && x.text.trim() ? maskSecrets(x.text) : null
  }
  if (!SEARCHABLE.has(r.ext)) return null
  const p = contentPath(libDir, r)
  try {
    const s = await stat(p)
    if (s.size > MAX_TEXT) return null
    const c = cache.get(r.id)
    if (c && c.mtime === s.mtimeMs) return c.text
    const text = maskSecrets((await readFile(p)).toString('utf8'))
    cache.set(r.id, { mtime: s.mtimeMs, text, tags: null })
    return text
  } catch { return null }
}

/** Text of one file (cached by modification time), or null. */
export const noteText = (db: Db, libDir: string, r: Pick<Row, 'id' | 'ext' | 'source' | 'lib_path' | 'rel_path' | 'folder_path'>): Promise<string | null> =>
  textOf(db, libDir, r as Row)

function tagsOf(id: string, text: string): string[] {
  const c = cache.get(id)
  if (c && c.text === text && c.tags) return c.tags
  const t = noteTags(text) as string[]
  if (c && c.text === text) c.tags = t
  return t
}

export interface TagIndex { tags: { tag: string; count: number }[]; files: Record<string, string[]>; scanned: number; capped: boolean }

/** All tags of all notes (frontmatter tags and #tags in the text), with the notes that carry them. */
export async function tagIndex(db: Db, libDir: string, max = SCAN_MAX): Promise<TagIndex> {
  const notes = rows(db).filter((r) => NOTE.has(r.ext))
  const files: Record<string, string[]> = {}
  let scanned = 0
  for (const r of notes.slice(0, max)) {
    const t = await textOf(db, libDir, r); scanned++
    if (!t || !t.includes('#') && !/^---/.test(t)) continue
    for (const g of tagsOf(r.id, t)) (files[g] ||= []).push(r.id)
  }
  const tags = Object.entries(files).map(([tag, ids]) => ({ tag, count: ids.length })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  return { tags, files, scanned, capped: notes.length > max }
}

export interface Hit { id: string; name: string; project: string | null; score: number; snippets: string[]; inName: boolean }
const norm = (s: string) => s.normalize('NFC').toLowerCase()

function snippets(text: string, words: string[], phrase: string | null, max = 3): string[] {
  const l = norm(text), out: string[] = [], used: number[] = []
  const needles = phrase ? [phrase, ...words] : words
  for (const w of needles) {
    let from = 0
    while (out.length < max) {
      const i = l.indexOf(w, from); if (i < 0) break
      from = i + w.length
      if (used.some((u) => Math.abs(u - i) < 120)) continue
      used.push(i)
      const a = Math.max(0, i - 60), b = Math.min(text.length, i + w.length + 80)
      out.push((a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : ''))
    }
  }
  return out
}

/**
 * Full-text search: every word must occur (in the name or the text); "quoted phrases" must occur as written;
 * #tag narrows to notes with that tag. Name hits rank first, then how often the words occur.
 */
export async function fullSearch(db: Db, libDir: string, query: string, opts: { limit?: number; max?: number } = {}): Promise<{ hits: Hit[]; scanned: number; capped: boolean; total: number }> {
  const q = norm(query)
  const phrases = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean)
  const rest = q.replace(/"[^"]*"/g, ' ')
  const tags = [...rest.matchAll(/(^|\s)#([^\s#]+)/g)].map((m) => m[2])
  const words = [...new Set(rest.replace(/(^|\s)#[^\s#]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2))].slice(0, 10)
  if (!words.length && !phrases.length && !tags.length) return { hits: [], scanned: 0, capped: false, total: 0 }
  const all = rows(db), max = opts.max ?? SCAN_MAX
  const hits: Hit[] = []
  let scanned = 0
  for (const r of all) {
    if (scanned >= max) break
    const name = norm(r.name)
    const raw = await textOf(db, libDir, r)
    if (raw !== null) scanned++
    if (tags.length && (raw === null || !NOTE.has(r.ext) || !tags.every((g) => tagsOf(r.id, raw).includes(g)))) continue
    const text = raw === null ? '' : norm(raw)
    if (!words.every((w) => name.includes(w) || text.includes(w)) || !phrases.every((p) => text.includes(p) || name.includes(p))) continue
    let score = 0
    const inName = words.length > 0 && words.every((w) => name.includes(w))
    if (inName) score += 100
    for (const w of [...words, ...phrases]) { let i = -1, n = 0; while ((i = text.indexOf(w, i + 1)) >= 0 && n < 50) n++; score += n }
    hits.push({ id: r.id, name: r.name, project: r.project, score, snippets: raw ? snippets(raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), words, phrases[0] || null) : [], inName })
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return { hits: hits.slice(0, opts.limit ?? 100), scanned, capped: all.length > max && scanned >= max, total: hits.length }
}

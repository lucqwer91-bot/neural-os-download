import { readFile, stat } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import type { Db } from './db'
import { contentPath } from './organize'

// Text out of PDF and Word (.docx) files (spec 5.1: "PDF/DOCX text extraction"), so they can
// be previewed, searched and handed to Claude as context. Only reads the file; the text
// lives in table file_text. No AI, no network. PDF via pdfjs-dist (pure JavaScript).

export const EXTRACT = new Set(['pdf', 'docx'])
export const LIMITS = { fileBytes: 60_000_000, textChars: 1_000_000, pdfPages: 400 }

/** One file out of a .zip (a .docx is a zip). Reads the central directory; stored or deflated entries. */
export function unzipEntry(buf: Buffer, name: string): Buffer | null {
  // end of central directory: signature 0x06054b50 within the last 64 KB
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const entry = buf.toString('utf8', p + 46, p + 46 + nlen)
    if (entry === name) {
      if (buf.readUInt32LE(local) !== 0x04034b50) return null
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + csize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      return null
    }
    p += 46 + nlen + xlen + clen
  }
  return null
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m)

/** Plain text of a .docx: paragraphs as lines, tabs and line breaks kept. */
export function docxText(buf: Buffer): string | null {
  const xml = unzipEntry(buf, 'word/document.xml')
  if (!xml) return null
  const s = xml.toString('utf8')
  const out: string[] = []
  for (const para of s.split(/<\/w:p>/)) {
    let line = ''
    for (const m of para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
      if (m[1] !== undefined) line += decode(m[1])
      else line += m[0] === '<w:tab/>' ? '\t' : '\n'
    }
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Plain text of a PDF, page by page (blank line between pages). Scanned pages have no text. */
export async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  const doc = await task.promise
  try {
    let text = ''
    const n = Math.min(doc.numPages, LIMITS.pdfPages)
    for (let i = 1; i <= n && text.length < LIMITS.textChars; i++) {
      const page = await doc.getPage(i)
      const c = await page.getTextContent()
      text += c.items.map((x) => ('str' in x ? x.str + (x.hasEOL ? '\n' : '') : '')).join('') + '\n\n'
      page.cleanup()
    }
    return { text: text.replace(/[ \t]+\n/g, '\n').trim(), pages: doc.numPages }
  } finally { await task.destroy() }
}

interface Pending { id: string; ext: string; size: number; mtime: number | null; source: string; lib_path: string; rel_path: string | null; folder_path: string | null }

/**
 * Reads the text of every PDF/DOCX that has none yet (or changed since). Status becomes
 * 'indexed' with text, 'nameonly' without (e.g. a scanned PDF), 'failed' if unreadable.
 * Returns the ids that got text.
 */
export async function extractPending(db: Db, libDir: string, opts: { limit?: number; now?: Date } = {}): Promise<string[]> {
  db.exec('DELETE FROM file_text WHERE file_id NOT IN (SELECT id FROM file_asset)')
  const rows = db.prepare(`SELECT f.id, f.ext, f.size, f.mtime, f.source, f.lib_path, f.rel_path, lf.path AS folder_path
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id LEFT JOIN file_text t ON t.file_id = f.id
    WHERE f.ext IN ('pdf', 'docx') AND f.status != 'failed' AND (t.file_id IS NULL OR COALESCE(t.mtime, -1) != COALESCE(f.mtime, -1))
    LIMIT ?`).all(opts.limit ?? 500) as unknown as Pending[]
  const done: string[] = []
  const now = (opts.now ?? new Date()).toISOString()
  const save = db.prepare(`INSERT INTO file_text (file_id, text, pages, mtime, extracted_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET text = excluded.text, pages = excluded.pages, mtime = excluded.mtime, extracted_at = excluded.extracted_at`)
  const setStatus = db.prepare('UPDATE file_asset SET status = ? WHERE id = ?')
  for (const r of rows) {
    try {
      const path = contentPath(libDir, r)
      if ((await stat(path)).size > LIMITS.fileBytes) { setStatus.run('nameonly', r.id); continue }
      const buf = await readFile(path)
      let text = '', pages: number | null = null
      if (r.ext === 'docx') text = docxText(buf) ?? ''
      else { const p = await pdfText(buf); text = p.text; pages = p.pages }
      text = text.slice(0, LIMITS.textChars)
      save.run(r.id, text, pages, r.mtime, now)
      setStatus.run(text.trim() ? 'indexed' : 'nameonly', r.id)
      if (text.trim()) done.push(r.id)
    } catch {
      setStatus.run('failed', r.id)
    }
  }
  return done
}

/** The stored text of a file, or null. */
export function storedText(db: Db, id: string): { text: string; pages: number | null } | null {
  const r = db.prepare('SELECT text, pages FROM file_text WHERE file_id = ?').get(id) as { text: string; pages: number | null } | undefined
  return r && r.text.trim() ? r : null
}

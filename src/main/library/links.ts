import { readFile, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Db } from './db'
import { TEXT } from './files'
import { contentPath, stem } from './organize'
import { editState, saveNote, textHash } from './write'

// Links like in Obsidian, without guessing:
// - unlinked mentions: notes that write a note's name (or an alias) as plain text, not as [[link]]
// - "link it": turns the first such mention into [[Name]] (a normal safe save with a version)
// - rename: renames the file and rewrites [[Old]] links in notes NEURAL OS may edit; read-only notes are only counted

const MAX_TEXT = 2_000_000
export const MENTION_SCAN_MAX = 3000

interface Row { id: string; name: string; ext: string; source: string; lib_path: string; rel_path: string | null; folder_path: string | null }
const rows = (db: Db, where = '', ...args: string[]) => db.prepare(`SELECT f.id, f.name, f.ext, f.source, f.lib_path, f.rel_path, lf.path AS folder_path
  FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id ${where}`).all(...args) as unknown as Row[]

async function readText(libDir: string, r: Row): Promise<string | null> {
  try { const b = await readFile(contentPath(libDir, r)); return b.length <= MAX_TEXT ? b.toString('utf8') : null } catch { return null }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// the name as a whole word, case-insensitive
const wordRe = (word: string, flags = 'iu') => new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(word)})(?=$|[^\\p{L}\\p{N}])`, flags)

// parts of a note where a plain mention does not count: frontmatter, code, existing links, URLs
function maskedRanges(text: string): [number, number][] {
  const out: [number, number][] = []
  const fm = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(text); if (fm) out.push([0, fm[0].length])
  for (const re of [/```[\s\S]*?(```|$)/g, /`[^`\n]*`/g, /!?\[\[[^\]\n]*\]\]/g, /\[[^\]\n]*\]\([^)\n]*\)/g, /https?:\/\/\S+/g]) {
    for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

/** First plain mention of one of the words in the text (not in code, links, frontmatter), or null. */
export function findMention(text: string, words: string[]): { index: number; match: string } | null {
  const t = text.normalize('NFC'), masked = maskedRanges(t)
  let best: { index: number; match: string } | null = null
  for (const w of words) {
    if (w.length < 3) continue
    const re = wordRe(w, 'giu')
    for (const m of t.matchAll(re)) {
      const at = m.index! + m[1].length
      if (masked.some(([a, b]) => at >= a && at < b)) continue
      if (!best || at < best.index) best = { index: at, match: m[2] }
      break
    }
  }
  return best
}

function snippet(text: string, at: number, len: number): string {
  const a = Math.max(0, at - 50), b = Math.min(text.length, at + len + 50)
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '')
}

function namesOf(db: Db, r: Row): string[] {
  const own = stem(r.name)
  const al = (db.prepare('SELECT stem FROM note_alias WHERE file_id = ?').all(r.id) as { stem: string }[]).map((a) => a.stem)
  return [...new Set([own, ...al])]
}

export interface Mention { id: string; name: string; snippet: string; editable: boolean }

/** Notes that mention this note's name or an alias as plain text and do not link it yet. */
export async function unlinkedMentions(db: Db, libDir: string, id: string, max = MENTION_SCAN_MAX): Promise<{ mentions: Mention[]; scanned: number; capped: boolean }> {
  const me = rows(db, 'WHERE f.id = ?', id)[0]
  if (!me) return { mentions: [], scanned: 0, capped: false }
  const words = namesOf(db, me)
  const linking = new Set((db.prepare(`SELECT DISTINCT file_id FROM wikilink_target WHERE stem IN (${words.map(() => '?').join(',')})`).all(...words) as { file_id: string }[]).map((x) => x.file_id))
  const cand = rows(db, "WHERE f.ext IN ('md', 'txt') AND f.id <> ? ORDER BY f.name COLLATE NOCASE", id).filter((r) => !linking.has(r.id))
  const out: Mention[] = []
  let scanned = 0
  for (const r of cand.slice(0, max)) {
    scanned++
    const t = await readText(libDir, r); if (!t) continue
    const m = findMention(t, words); if (!m) continue
    out.push({ id: r.id, name: r.name, snippet: snippet(t.normalize('NFC'), m.index, m.match.length), editable: editState(db, libDir, r.id).ok })
  }
  return { mentions: out, scanned, capped: cand.length > max }
}

/** Turns the first plain mention of the target in a note into a wikilink (safe save, version kept). */
export async function linkMention(db: Db, libDir: string, fromId: string, targetId: string): Promise<{ ok: boolean; reason?: string }> {
  const from = rows(db, 'WHERE f.id = ?', fromId)[0], target = rows(db, 'WHERE f.id = ?', targetId)[0]
  if (!from || !target) return { ok: false, reason: 'missing' }
  const st = editState(db, libDir, fromId); if (!st.ok) return { ok: false, reason: st.reason }
  const raw = await readText(libDir, from); if (raw === null) return { ok: false, reason: 'missing' }
  const text = raw.normalize('NFC')
  const m = findMention(text, namesOf(db, target)); if (!m) return { ok: false, reason: 'gone' }
  const name = target.name.replace(/\.md$/i, '').normalize('NFC')
  const link = m.match === name ? `[[${name}]]` : `[[${name}|${m.match}]]`
  const next = text.slice(0, m.index) + link + text.slice(m.index + m.match.length)
  const r = await saveNote(db, libDir, fromId, next, textHash(raw))
  return r.ok ? { ok: true } : { ok: false, reason: 'conflict' in r && r.conflict ? 'conflict' : r.reason }
}

/** [[Old]], [[Old|x]], [[Old#h]], [[dir/Old]] and embeds become the new name; other links stay as they are. */
export function replaceLinks(text: string, oldStem: string, newName: string): { text: string; count: number } {
  let count = 0
  const out = text.replace(/(!?\[\[)([^\]|#\n]+)([^\]\n]*\]\])/g, (all, open: string, target: string, rest: string) => {
    const tg = target.trim(), slash = tg.lastIndexOf('/'), base = slash >= 0 ? tg.slice(slash + 1) : tg
    if (stem(base) !== oldStem) return all
    count++
    const ext = /\.[a-z0-9]+$/i.exec(base)?.[0] || ''
    const nb = ext && ext.toLowerCase() !== '.md' ? newName + ext : newName
    return open + (slash >= 0 ? tg.slice(0, slash + 1) : '') + nb + rest
  })
  return { text: out, count }
}

const safeName = (n: string) => n.normalize('NFC').replace(/[\\/:*?"<>|[\]#^\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 120)

export type RenameResult =
  | { ok: true; id: string; name: string; updated: number; readonly: number; failed: number; ambiguous: boolean; changed: string[] }
  | { ok: false; reason: 'missing' | 'type' | 'readonly' | 'session' | 'name' | 'exists' | 'failed' }

/**
 * Renames a note NEURAL OS may edit and updates the [[links]] to it in every note it may edit (each with a version).
 * Notes it may not edit (read-only vault folders) are only counted. If another file has the same old name,
 * links are left alone, because they could mean that file.
 */
export async function renameNote(db: Db, libDir: string, id: string, newBase: string, now = new Date()): Promise<RenameResult> {
  const r = rows(db, 'WHERE f.id = ?', id)[0]
  if (!r) return { ok: false, reason: 'missing' }
  const st = editState(db, libDir, id); if (!st.ok) return { ok: false, reason: st.reason }
  const base = safeName(newBase.replace(/\.(md|txt)$/i, ''))
  if (!base) return { ok: false, reason: 'name' }
  const newName = `${base}.${r.ext}`
  if (newName === r.name) return { ok: true, id, name: newName, updated: 0, readonly: 0, failed: 0, ambiguous: false, changed: [] }
  const oldStem = stem(r.name)
  const to = join(dirname(st.path), newName)
  // a different file with that name already there (a case-only rename of the same file is fine)
  try { await stat(to); if (newName.toLowerCase() !== r.name.toLowerCase()) return { ok: false, reason: 'exists' } } catch { /* free */ }
  try { await rename(st.path, to) } catch { return { ok: false, reason: 'failed' } }
  if (r.source === 'linked' && r.rel_path) {
    const parts = r.rel_path.split('/'); parts[parts.length - 1] = newName
    const rel = parts.join('/')
    db.prepare('UPDATE file_asset SET name = ?, rel_path = ?, original_path = ?, hash = ? WHERE id = ?').run(newName, rel, to, `link:${(db.prepare('SELECT folder_id FROM file_asset WHERE id = ?').get(id) as { folder_id: string }).folder_id}:${rel}`, id)
  } else {
    const parts = r.lib_path.split('/'); parts[parts.length - 1] = newName
    db.prepare('UPDATE file_asset SET name = ?, lib_path = ? WHERE id = ?').run(newName, parts.join('/'), id)
  }
  // links to the old name
  const ambiguous = rows(db, 'WHERE f.id <> ?', id).some((x) => stem(x.name) === oldStem)
  let updated = 0, readonly = 0, failed = 0
  const changed: string[] = []
  if (!ambiguous) {
    const linking = (db.prepare('SELECT DISTINCT file_id FROM wikilink_target WHERE stem = ?').all(oldStem) as { file_id: string }[]).map((x) => x.file_id)
    for (const fid of linking) {
      const f = rows(db, 'WHERE f.id = ?', fid)[0]; if (!f || !TEXT.has(f.ext)) continue
      if (!editState(db, libDir, fid).ok) { readonly++; continue }
      const raw = await readText(libDir, f); if (raw === null) { failed++; continue }
      const rep = replaceLinks(raw, oldStem, base); if (!rep.count) continue
      const s = await saveNote(db, libDir, fid, rep.text, textHash(raw), { now })
      if (s.ok) { updated++; changed.push(fid) } else failed++
    }
  }
  return { ok: true, id, name: newName, updated, readonly, failed, ambiguous, changed }
}

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'
import { stem } from './organize'
import { readContent } from './library'
import { createNote } from './write'

// Daily note (spec 5.9) like in Obsidian: one note per day, opened if it exists, created otherwise.
// - a note named like the day (YYYY-MM-DD, or the vault's own format) anywhere in the library: open it
// - a vault folder with editing turned on: created there, using the vault's daily-note settings
//   (.obsidian/daily-notes.json: folder, format, template) when it has them
// - otherwise: a new note in the library (project "Tagesnotizen" / "Daily notes")
// Templates fill {{date}}, {{time}} and {{title}} like Obsidian's core templates.

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The moment.js tokens Obsidian users really use in daily-note formats. */
export function formatDate(d: Date, fmt: string, lang = 'de'): string {
  const months = lang === 'de' ? MONTHS_DE : MONTHS_EN
  return fmt.replace(/\[([^\]]*)\]|YYYY|MMMM|MMM|MM|M|DD|D|HH|mm/g, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit
    switch (tok) {
      case 'YYYY': return String(d.getFullYear())
      case 'MMMM': return months[d.getMonth()]
      case 'MMM': return months[d.getMonth()].slice(0, 3)
      case 'MM': return pad(d.getMonth() + 1)
      case 'M': return String(d.getMonth() + 1)
      case 'DD': return pad(d.getDate())
      case 'D': return String(d.getDate())
      case 'HH': return pad(d.getHours())
      case 'mm': return pad(d.getMinutes())
    }
    return tok
  })
}

export function fillTemplate(text: string, title: string, d: Date, lang = 'de'): string {
  return text.replace(/\{\{\s*(date|time|title)(?::([^}]*))?\s*\}\}/g, (_m, k: string, f: string | undefined) =>
    k === 'title' ? title : formatDate(d, f ? f.trim() : k === 'date' ? 'YYYY-MM-DD' : 'HH:mm', lang))
}

interface DailyCfg { folder: string; format: string; template: string }
// without a configured folder: a top-level folder that is obviously for daily notes (many vaults have one)
const DAILY_DIRS = ['daily', 'dailies', 'daily notes', 'tagesnotizen', 'journal', 'tagebuch']
async function vaultCfg(root: string): Promise<DailyCfg> {
  let j: Partial<DailyCfg> = {}
  try { j = JSON.parse(await readFile(join(root, '.obsidian', 'daily-notes.json'), 'utf8')) as Partial<DailyCfg> } catch { /* no settings */ }
  let folder = String(j.folder || '').replace(/^\/+|\/+$/g, '')
  if (!folder) {
    try { folder = (await readdir(root, { withFileTypes: true })).find((d) => d.isDirectory() && DAILY_DIRS.includes(d.name.toLowerCase()))?.name || '' } catch { /* unreadable */ }
  }
  return { folder, format: String(j.format || 'YYYY-MM-DD'), template: String(j.template || '') }
}

export type DailyResult = { id: string; created: boolean; where: 'library' | 'vault' } | { id: null; rel: string; folderId: string; created: true; where: 'vault' }

/**
 * Opens or creates today's note. For a vault the new file is written into the folder and returned
 * as folderId + rel; the caller indexes it (applyPaths) and gets its id.
 */
export async function dailyNote(db: Db, libDir: string, o: { now?: Date; lang?: string } = {}): Promise<DailyResult> {
  const now = o.now || new Date(), lang = o.lang || 'de'
  const linked = db.prepare('SELECT id, path, editable FROM linked_folder ORDER BY editable DESC, added_at').all() as { id: string; path: string; editable: number }[]
  const relFor = (cfg: DailyCfg, title: string) => [...(cfg.folder ? cfg.folder.split('/') : []), ...title.split('/')].filter(Boolean).join('/') + '.md'
  // today's note where each vault keeps its daily notes (not any file that happens to carry today's date)
  const byRel = db.prepare('SELECT id FROM file_asset WHERE folder_id = ? AND lower(rel_path) = lower(?)')
  for (const f of linked) {
    const c = await vaultCfg(f.path)
    const hit = byRel.get(f.id, relFor(c, formatDate(now, c.format, lang))) as { id: string } | undefined
    if (hit) return { id: hit.id, created: false, where: 'vault' }
  }
  const folders = linked.filter((f) => f.editable)
  const cfg = folders.length ? await vaultCfg(folders[0].path) : { folder: '', format: 'YYYY-MM-DD', template: '' }
  const title = formatDate(now, cfg.format, lang)
  const base = title.split('/').pop()!
  // a daily note NEURAL OS made in the library earlier
  const proj = lang === 'de' ? 'Tagesnotizen' : 'Daily notes'
  const own = db.prepare(`SELECT f.id, f.name FROM file_asset f JOIN project p ON p.id = f.project_id
    WHERE f.source = 'copy' AND f.ext = 'md' AND p.name IN ('Tagesnotizen', 'Daily notes')`).all() as { id: string; name: string }[]
  const mine = own.find((r) => stem(r.name) === stem(base + '.md'))
  if (mine && !folders.length) return { id: mine.id, created: false, where: 'library' }

  let text = `# ${base}\n\n`
  if (cfg.template && folders.length) {
    try { text = fillTemplate(await readFile(join(folders[0].path, ...(cfg.template.replace(/\.md$/i, '') + '.md').split('/')), 'utf8'), base, now, lang) } catch { /* template missing: plain note */ }
  }
  if (folders.length) {
    const f = folders[0]
    const rel = relFor(cfg, title)
    const abs = join(f.path, ...rel.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
    return { id: null, rel, folderId: f.id, created: true, where: 'vault' }
  }
  const r = await createNote(db, libDir, { name: base, project: proj, text })
  return { id: r.id, created: true, where: 'library' }
}

/** Template notes: Markdown files in the vault's template folder (.obsidian/templates.json) or any folder named Templates/Vorlagen. */
export async function templates(db: Db): Promise<{ id: string; name: string }[]> {
  const folders = db.prepare('SELECT id, path FROM linked_folder').all() as { id: string; path: string }[]
  const tplDirs = new Map<string, string>()
  for (const f of folders) {
    try { const j = JSON.parse(await readFile(join(f.path, '.obsidian', 'templates.json'), 'utf8')) as { folder?: string }; if (j.folder) tplDirs.set(f.id, j.folder.replace(/^\/+|\/+$/g, '').toLowerCase()) } catch { /* none */ }
  }
  const rows = db.prepare("SELECT f.id, f.name, f.folder_id, f.rel_path, f.original_path, f.source, f.lib_path, lf.path AS folder_path FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id WHERE f.ext = 'md'").all() as { id: string; name: string; folder_id: string | null; rel_path: string | null; original_path: string; source: string; lib_path: string; folder_path: string | null }[]
  const out = rows.filter((r) => {
    const dir = (r.rel_path || r.original_path).replace(/\\/g, '/').toLowerCase().split('/').slice(0, -1)
    const own = r.folder_id ? tplDirs.get(r.folder_id) : undefined
    if (own && (r.rel_path || '').toLowerCase().startsWith(own + '/')) return true
    return dir.some((d) => d === 'templates' || d === 'vorlagen' || d === 'template' || d === 'vorlage')
  })
  return out.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** A template's text with {{date}}, {{time}}, {{title}} filled in. */
export async function templateText(db: Db, libDir: string, id: string, title: string, o: { now?: Date; lang?: string } = {}): Promise<string | null> {
  const c = await readContent(db, libDir, id)
  return c.kind === 'text' ? fillTemplate(c.text, title, o.now || new Date(), o.lang || 'de') : null
}

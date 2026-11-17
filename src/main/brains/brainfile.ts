import { open, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { isSecretName } from '../library/secrets'
import { randomUUID } from 'node:crypto'
import { join, extname } from 'node:path'
import type { Db } from '../library/db'
import { contentPath } from '../library/organize'

// Shareable brains (spec 5.12, S4): a .brain file is a plain tar archive. The first entry is
// brain.json (names, projects, links, read-out PDF/Word text), then every file as
// files/<n>/<name>. No size limit: files are copied in 1 MB pieces, never held in memory.
// The user shares the file wherever they like (e.g. MEGA); NEURAL OS uploads nothing.
// An imported brain lives in <app data>/brains/<id>/ and is read-only.

export const FORMAT = 'neural-os-brain'
export const FORMAT_VERSION = 1
export const SESSION_PROJECT = 'Claude Sessions'
const CHUNK = 1 << 20

export interface BrainFile { n: number; id: string; name: string; ext: string; size: number; project: string | null; mtime: number | null; path: string; text?: string; links: string[] }
export interface BrainJson {
  format: string; version: number; name: string; author: string | null; created: string
  projects: string[]; files: BrainFile[]
  links: { from: string; to: string; origin: string; reason: string }[]
}
export interface ExportOpts { name: string; author?: string | null; projects?: (string | null)[] | null; sessions?: boolean }

// ---------- tar (ustar; sizes above 8 GB in base-256) ----------

function header(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512)
  const put = (s: string, off: number, len: number) => h.write(s.slice(0, len), off, len, 'utf8')
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0'
  let pre = ''
  let nm = name
  if (Buffer.byteLength(nm) > 100) { const i = nm.lastIndexOf('/', 154); pre = nm.slice(0, i); nm = nm.slice(i + 1) }
  put(nm, 0, 100); put(oct(0o644, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8)
  if (size < 0o77777777777) put(oct(size, 12), 124, 12)
  else { h[124] = 0x80; let v = BigInt(size); for (let i = 135; i > 124; i--) { h[i] = Number(v & 0xffn); v >>= 8n } }
  put(oct(Math.max(0, Math.floor(mtime)), 12), 136, 12)
  h.write('        ', 148, 8, 'ascii'); h[156] = 0x30
  put('ustar\0', 257, 6); put('00', 263, 2); put(pre, 345, 155)
  let sum = 0; for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return h
}

function parseHeader(h: Buffer): { name: string; size: number } | null {
  if (h.every((b) => b === 0)) return null
  const str = (off: number, len: number) => h.toString('utf8', off, off + len).replace(/\0.*$/s, '')
  let size: number
  if (h[124] & 0x80) { let v = 0n; for (let i = 125; i < 136; i++) v = (v << 8n) | BigInt(h[i]); size = Number(v) }
  else size = parseInt(str(124, 12).trim() || '0', 8)
  const pre = str(345, 155), name = str(0, 100)
  return { name: pre ? pre + '/' + name : name, size }
}

/** Writes a .brain file. entries: brain.json first, then each file read from disk. */
async function writeTar(out: string, json: Buffer, files: { name: string; src: string; size: number; mtime: number }[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const fh = await open(out, 'w')
  try {
    let pos = 0
    const w = async (b: Buffer) => { await fh.write(b, 0, b.length, pos); pos += b.length }
    const pad = async (n: number) => { const r = n % 512; if (r) await w(Buffer.alloc(512 - r)) }
    await w(header('brain.json', json.length, Date.now() / 1000)); await w(json); await pad(json.length)
    const buf = Buffer.alloc(CHUNK)
    let k = 0
    for (const f of files) {
      await w(header(f.name, f.size, f.mtime))
      const src = await open(f.src, 'r')
      try {
        let left = f.size, at = 0
        while (left > 0) {
          const { bytesRead } = await src.read(buf, 0, Math.min(CHUNK, left), at)
          if (!bytesRead) throw new Error('file shrank while exporting: ' + f.src)
          await w(buf.subarray(0, bytesRead)); left -= bytesRead; at += bytesRead
        }
      } finally { await src.close() }
      await pad(f.size)
      onProgress?.(++k, files.length)
    }
    await w(Buffer.alloc(1024))
  } finally { await fh.close() }
}

/** Reads brain.json from the start of a .brain file (without reading the rest). */
export async function peekBrain(file: string): Promise<BrainJson> {
  const fh = await open(file, 'r')
  try {
    const h = Buffer.alloc(512)
    await fh.read(h, 0, 512, 0)
    const e = parseHeader(h)
    if (!e || e.name !== 'brain.json' || e.size > 200_000_000) throw new Error('notBrain')
    const b = Buffer.alloc(e.size)
    await fh.read(b, 0, e.size, 512)
    const j = JSON.parse(b.toString('utf8')) as BrainJson
    if (j.format !== FORMAT || typeof j.version !== 'number' || !Array.isArray(j.files)) throw new Error('notBrain')
    if (j.version > FORMAT_VERSION) throw new Error('newer')
    return j
  } finally { await fh.close() }
}

// only these entry names are ever written to disk: no "..", no absolute paths
const SAFE = /^files\/(\d{1,7})\/([^/\\\0]{1,255})$/
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\0]/g, '-').replace(/^\.+/, '_').slice(0, 200) || 'file'
/** A file name that fits the 100-byte tar name field (keeps the extension). */
function tarName(s: string): string {
  let n = safeName(s)
  if (Buffer.byteLength(n) <= 95) return n
  const ext = extname(n).slice(0, 12)
  let base = n.slice(0, n.length - ext.length)
  while (Buffer.byteLength(base + ext) > 95) base = base.slice(0, -1)
  return base + ext
}

async function extractTar(file: string, dir: string, onProgress?: (done: number, total: number) => void, total = 0): Promise<number> {
  const fh = await open(file, 'r')
  let n = 0
  try {
    const size = (await fh.stat()).size
    let pos = 0
    const h = Buffer.alloc(512), buf = Buffer.alloc(CHUNK)
    while (pos + 512 <= size) {
      await fh.read(h, 0, 512, pos)
      const e = parseHeader(h)
      if (!e) break
      pos += 512
      const m = SAFE.exec(e.name)
      if (e.name === 'brain.json' || m) {
        const target = e.name === 'brain.json' ? join(dir, 'brain.json') : join(dir, 'files', m![1], safeName(m![2]))
        await mkdir(join(target, '..'), { recursive: true })
        const out = await open(target, 'w')
        try {
          let left = e.size, at = pos, wp = 0
          while (left > 0) {
            const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, left), at)
            if (!bytesRead) throw new Error('truncated')
            await out.write(buf, 0, bytesRead, wp); wp += bytesRead; at += bytesRead; left -= bytesRead
          }
        } finally { await out.close() }
        if (m) onProgress?.(++n, total)
      }
      pos += Math.ceil(e.size / 512) * 512
    }
  } finally { await fh.close() }
  return n
}

// ---------- export ----------

interface Row { id: string; name: string; ext: string; size: number; mtime: number | null; project: string | null; source: string; lib_path: string; rel_path: string | null; folder_path: string | null }

function selectRows(db: Db, o: ExportOpts): Row[] {
  const all = db.prepare(`SELECT f.id, f.name, f.ext, f.size, f.mtime, f.source, f.lib_path, f.rel_path, lf.path AS folder_path, p.name AS project
    FROM file_asset f LEFT JOIN project p ON p.id = f.project_id LEFT JOIN linked_folder lf ON lf.id = f.folder_id ORDER BY f.name`).all() as unknown as Row[]
  return all.filter((r) => {
    if (isSecretName(r.name)) return false // keys never leave this computer
    const isSession = r.source === 'session' || r.project === SESSION_PROJECT
    if (isSession) return !!o.sessions
    return !o.projects || o.projects.includes(r.project)
  })
}

/** What an export would contain (for the dialog): files, bytes, projects. */
export function exportPlan(db: Db, o: ExportOpts): { files: number; bytes: number; projects: { name: string | null; files: number; bytes: number }[] } {
  const rows = selectRows(db, { ...o, projects: null, sessions: true })
  const by = new Map<string | null, { files: number; bytes: number }>()
  for (const r of rows) { const k = r.project; const x = by.get(k) || { files: 0, bytes: 0 }; x.files++; x.bytes += r.size || 0; by.set(k, x) }
  const sel = selectRows(db, o)
  return { files: sel.length, bytes: sel.reduce((a, r) => a + (r.size || 0), 0), projects: [...by.entries()].map(([name, x]) => ({ name, ...x })).sort((a, b) => b.files - a.files) }
}

export async function exportBrain(db: Db, libDir: string, out: string, o: ExportOpts, onProgress?: (done: number, total: number) => void, now = new Date()): Promise<{ files: number; bytes: number; missing: number }> {
  const rows = selectRows(db, o)
  const ids = new Set(rows.map((r) => r.id))
  const files: BrainFile[] = [], entries: { name: string; src: string; size: number; mtime: number }[] = []
  let missing = 0
  const text = db.prepare('SELECT text FROM file_text WHERE file_id = ?')
  const stems = db.prepare('SELECT stem FROM wikilink_target WHERE file_id = ?')
  const names = new Map(rows.map((r) => [r.id, r.name]))
  const linksOut = new Map<string, Set<string>>()
  const links = (db.prepare("SELECT from_id, to_id, origin, reason FROM knowledge_edge WHERE status = 'linked'").all() as { from_id: string; to_id: string; origin: string; reason: string }[])
    .filter((l) => ids.has(l.from_id) && ids.has(l.to_id))
  const stemOf = (n: string) => n.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase()
  for (const l of links) { const s = linksOut.get(l.from_id) || new Set(); s.add(stemOf(names.get(l.to_id)!)); linksOut.set(l.from_id, s) }
  for (const r of rows) {
    const src = contentPath(libDir, r)
    let st
    try { st = await stat(src) } catch { missing++; continue }
    if (!st.isFile()) { missing++; continue }
    const n = files.length
    const path = `files/${n}/${tarName(r.name)}`
    const t = (r.ext === 'pdf' || r.ext === 'docx') ? (text.get(r.id) as { text: string } | undefined)?.text : undefined
    const ls = new Set([...(linksOut.get(r.id) || []), ...(stems.all(r.id) as { stem: string }[]).map((x) => x.stem)])
    files.push({ n, id: r.id, name: r.name, ext: r.ext, size: st.size, project: r.project, mtime: r.mtime, path, ...(t ? { text: t } : {}), links: [...ls].slice(0, 200) })
    entries.push({ name: path, src, size: st.size, mtime: st.mtimeMs / 1000 })
  }
  const kept = new Set(files.map((f) => f.id))
  const j: BrainJson = {
    format: FORMAT, version: FORMAT_VERSION, name: o.name.slice(0, 80) || 'Brain', author: o.author ? o.author.slice(0, 80) : null, created: now.toISOString(),
    projects: [...new Set(files.map((f) => f.project).filter((p): p is string => !!p))],
    files, links: links.filter((l) => kept.has(l.from_id) && kept.has(l.to_id)).map((l) => ({ from: l.from_id, to: l.to_id, origin: l.origin, reason: l.reason }))
  }
  await writeTar(out, Buffer.from(JSON.stringify(j)), entries, onProgress)
  return { files: files.length, bytes: entries.reduce((a, e) => a + e.size, 0), missing }
}

// ---------- imported brains ----------

export interface BrainInfo { id: string; name: string; author: string | null; created: string; imported_at: string; files: number; bytes: number; visible: boolean; source: string }

export async function importBrain(brainsDir: string, file: string, onProgress?: (done: number, total: number) => void, now = new Date()): Promise<BrainInfo> {
  const j = await peekBrain(file)
  const id = randomUUID(), dir = join(brainsDir, id)
  await mkdir(dir, { recursive: true })
  try {
    await extractTar(file, dir, onProgress, j.files.length)
  } catch (e) { await rm(dir, { recursive: true, force: true }); throw e }
  const info: BrainInfo = { id, name: j.name, author: j.author, created: j.created, imported_at: now.toISOString(), files: j.files.length, bytes: j.files.reduce((a, f) => a + (f.size || 0), 0), visible: true, source: file.split(/[\\/]/).pop() || file }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(info))
  return info
}

export async function listBrains(brainsDir: string): Promise<BrainInfo[]> {
  let ds: string[] = []
  try { ds = await readdir(brainsDir) } catch { return [] }
  const out: BrainInfo[] = []
  for (const d of ds) { try { out.push(JSON.parse(await readFile(join(brainsDir, d, 'meta.json'), 'utf8'))) } catch { /* half-imported */ } }
  return out.sort((a, b) => a.imported_at.localeCompare(b.imported_at))
}

const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id)

export async function brainData(brainsDir: string, id: string): Promise<BrainJson | null> {
  if (!validId(id)) return null
  try { return JSON.parse(await readFile(join(brainsDir, id, 'brain.json'), 'utf8')) as BrainJson } catch { return null }
}

export async function setVisible(brainsDir: string, id: string, visible: boolean): Promise<boolean> {
  if (!validId(id)) return false
  const p = join(brainsDir, id, 'meta.json')
  try { const m = JSON.parse(await readFile(p, 'utf8')) as BrainInfo; m.visible = visible; await writeFile(p, JSON.stringify(m)); return true } catch { return false }
}

export async function removeBrain(brainsDir: string, id: string): Promise<boolean> {
  if (!validId(id)) return false
  await rm(join(brainsDir, id), { recursive: true, force: true }); return true
}

/** Path of one file of an imported brain (read-only use: preview, copy into my library). */
export function brainFilePath(brainsDir: string, id: string, f: BrainFile): string | null {
  const m = SAFE.exec(f.path)
  if (!validId(id) || !m) return null
  return join(brainsDir, id, 'files', m[1], safeName(m[2]))
}

const READ_TEXT = new Set(['md', 'txt', 'lua', 'luau', 'json', 'canvas', 'csv', 'yml', 'yaml'])
const READ_IMAGE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

export async function readBrainFile(brainsDir: string, id: string, fileId: string): Promise<{ kind: string; [k: string]: unknown }> {
  const j = await brainData(brainsDir, id)
  const f = j?.files.find((x) => x.id === fileId)
  if (!j || !f) return { kind: 'none', reason: 'missing' }
  if (f.text) return { kind: 'text', ext: 'extracted', text: f.text, from: f.ext }
  const p = brainFilePath(brainsDir, id, f)
  if (!p) return { kind: 'none', reason: 'missing' }
  const ext = (f.ext || extname(f.name).slice(1)).toLowerCase()
  try {
    if (READ_TEXT.has(ext)) { if (f.size > 2_000_000) return { kind: 'none', reason: 'size' }; return { kind: 'text', ext, text: await readFile(p, 'utf8') } }
    if (ext in READ_IMAGE) { if (f.size > 8_000_000) return { kind: 'none', reason: 'size' }; return { kind: 'image', url: `data:${READ_IMAGE[ext]};base64,` + (await readFile(p)).toString('base64') } }
  } catch { return { kind: 'none', reason: 'missing' } }
  return { kind: 'none', reason: 'type' }
}

// ---------- bridges between my brain and an imported one ----------

export interface Bridge { mine: string; theirs: string; why: 'name' | 'links' }

/**
 * Matches between my files and a foreign brain: the same note name, or at least two shared
 * link targets. Plain rules, no AI; every bridge carries its reason. Capped for big brains.
 */
export function bridges(db: Db, j: BrainJson, cap = 2000): { files: Bridge[]; projects: { mine: string; theirs: string }[] } {
  const stemOf = (n: string) => n.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase()
  const mine = db.prepare('SELECT f.id, f.name, p.name AS project FROM file_asset f LEFT JOIN project p ON p.id = f.project_id').all() as { id: string; name: string; project: string | null }[]
  const byStem = new Map<string, string[]>()
  for (const r of mine) { const k = stemOf(r.name); const a = byStem.get(k); if (a) a.push(r.id); else byStem.set(k, [r.id]) }
  const out: Bridge[] = [], seen = new Set<string>()
  const add = (m: string, t: string, why: Bridge['why']) => { const k = m + '|' + t; if (seen.has(k) || out.length >= cap) return; seen.add(k); out.push({ mine: m, theirs: t, why }) }
  for (const f of j.files) for (const m of byStem.get(stemOf(f.name)) || []) add(m, f.id, 'name')
  // shared link targets: my outgoing link stems per file
  const names = new Map(mine.map((r) => [r.id, r.name]))
  const myLinks = new Map<string, Set<string>>()
  for (const l of db.prepare("SELECT from_id, to_id FROM knowledge_edge WHERE status = 'linked'").all() as { from_id: string; to_id: string }[]) {
    const n = names.get(l.to_id); if (!n) continue
    const s = myLinks.get(l.from_id) || new Set(); s.add(stemOf(n)); myLinks.set(l.from_id, s)
  }
  for (const r of db.prepare('SELECT file_id, stem FROM wikilink_target').all() as { file_id: string; stem: string }[]) { const s = myLinks.get(r.file_id) || new Set(); s.add(r.stem); myLinks.set(r.file_id, s) }
  const byTarget = new Map<string, string[]>()
  for (const [id, s] of myLinks) for (const st of s) { const a = byTarget.get(st); if (a) a.push(id); else byTarget.set(st, [id]) }
  for (const f of j.files) {
    if (out.length >= cap) break
    const cnt = new Map<string, number>()
    for (const st of f.links || []) for (const m of (byTarget.get(st) || []).slice(0, 200)) cnt.set(m, (cnt.get(m) || 0) + 1)
    for (const [m, c] of cnt) if (c >= 2) add(m, f.id, 'links')
  }
  const myProjects = new Map<string, string>()
  for (const r of mine) if (r.project) myProjects.set(r.project.normalize('NFC').toLowerCase(), r.project)
  const projects = j.projects.filter((p) => myProjects.has(p.normalize('NFC').toLowerCase())).map((p) => ({ mine: myProjects.get(p.normalize('NFC').toLowerCase())!, theirs: p }))
  return { files: out, projects }
}

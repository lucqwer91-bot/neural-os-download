import { randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Db } from '../library/db'

// Device sync (user decision 2026-11-17: "Über deinen Cloud-Ordner"). NEURAL OS uploads nothing itself:
// it writes plain files into a folder the user picked inside their own cloud folder (Google Drive,
// OneDrive, iCloud, MEGA, Dropbox …) and the cloud program carries them to the other devices.
//
//   <sync folder>/NEURAL OS Sync/devices/<device id>/device.json          name, platform, time
//   <sync folder>/NEURAL OS Sync/devices/<device id>/journal-YYYY-MM.jsonl one row per line, append only
//
// Every device appends only to its own journal, so two devices never write the same file and the
// cloud program never has to merge. Each device reads the other journals from where it stopped.
// What travels: Claude sessions, events, the change log (S1) and the lesson book. Notes and other
// files travel by themselves when the linked folder lies in the cloud folder.

export const SYNC_DIR = 'NEURAL OS Sync'
const KINDS = ['s', 'e', 'c', 'l', 'ld'] as const
type Kind = typeof KINDS[number]
export interface Line { k: Kind; r: Record<string, unknown> }
export interface Peer { id: string; name: string; platform: string | null; seen_at: string; updated_at: string | null }
export interface SyncStatus { on: boolean; folder: string | null; device: { id: string; name: string }; peers: (Peer & { sessions: number; events: number; lessons: number })[]; lastOut: string | null; lastIn: string | null; error: string | null }

const SESSION_COLS = ['id', 'cwd', 'started_at', 'last_at', 'ended_at', 'end_reason', 'model', 'events'] as const
const EVENT_COLS = ['id', 'session_id', 'received_at', 'hook', 'type', 'tool', 'file_path', 'cwd', 'region', 'status', 'duration_ms', 'summary', 'agent_id', 'tool_use_id'] as const
const CHANGE_COLS = ['id', 'session_id', 'tool_use_id', 'at', 'tool', 'file_path', 'before_text', 'after_text', 'how'] as const
const LESSON_COLS = ['id', 'project', 'cwd', 'text', 'source', 'status', 'session_id', 'created_at', 'updated_at'] as const

const get = (db: Db, k: string) => (db.prepare('SELECT value FROM app_setting WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
const put = (db: Db, k: string, v: string) => db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
const del = (db: Db, k: string) => db.prepare('DELETE FROM app_setting WHERE key = ?').run(k)

/** This device's stable random id (never the computer name, which can repeat). */
export function deviceId(db: Db): string {
  let id = get(db, 'syncDevice')
  if (!id || !/^[a-z0-9-]{8,64}$/.test(id)) { id = randomUUID(); put(db, 'syncDevice', id) }
  return id
}
export const deviceName = (db: Db, host: string) => get(db, 'syncDeviceName') || host
export const syncFolder = (db: Db) => get(db, 'syncFolder')
export const devicesDir = (folder: string) => join(folder, SYNC_DIR, 'devices')
const journalName = (d: Date) => `journal-${d.toISOString().slice(0, 7)}.jsonl`

function pick<T extends readonly string[]>(row: Record<string, unknown>, cols: T): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const c of cols) o[c] = row[c] ?? null
  return o
}

/** Rows of this device changed since the last export (by their own time stamps), oldest first. */
export function collectOut(db: Db, since: string, until: string): Line[] {
  const out: Line[] = []
  const q = (sql: string) => db.prepare(sql).all(since, until) as Record<string, unknown>[]
  for (const r of q('SELECT * FROM claude_session WHERE device IS NULL AND last_at > ? AND last_at <= ? ORDER BY last_at')) out.push({ k: 's', r: pick(r, SESSION_COLS) })
  for (const r of q('SELECT * FROM claude_event WHERE device IS NULL AND received_at > ? AND received_at <= ? ORDER BY received_at, rowid')) out.push({ k: 'e', r: pick(r, EVENT_COLS) })
  for (const r of q('SELECT * FROM claude_change WHERE device IS NULL AND at > ? AND at <= ? ORDER BY at')) out.push({ k: 'c', r: pick(r, CHANGE_COLS) })
  for (const r of q('SELECT * FROM lesson WHERE device IS NULL AND updated_at > ? AND updated_at <= ? ORDER BY updated_at')) out.push({ k: 'l', r: pick(r, LESSON_COLS) })
  for (const r of q("SELECT id, at FROM sync_tomb WHERE kind = 'lesson' AND at > ? AND at <= ? ORDER BY at")) out.push({ k: 'ld', r: { id: r.id, at: r.at } })
  return out
}

/** Appends this device's new rows to its own journal. Returns how many lines were written. */
export function exportOnce(db: Db, folder: string, host: string, platform: string, now = new Date()): number {
  const me = deviceId(db)
  const dir = join(devicesDir(folder), me)
  mkdirSync(dir, { recursive: true })
  const until = now.toISOString()
  // first export of this device: everything still kept (the history is pruned to the kept days anyway)
  const since = get(db, 'syncOut:' + folder) || '0000'
  const lines = collectOut(db, since, until)
  if (lines.length) appendFileSync(join(dir, journalName(now)), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  put(db, 'syncOut:' + folder, until)
  // device.json: written whole through a temp file so a reader never sees half of it
  const info = JSON.stringify({ id: me, name: deviceName(db, host), platform, updated_at: until }, null, 2)
  const f = join(dir, 'device.json')
  let same = false
  try { const j = JSON.parse(readFileSync(f, 'utf8')) as { name?: string; platform?: string }; same = j.name === deviceName(db, host) && j.platform === platform && !lines.length } catch { /* write */ }
  if (!same) { writeFileSync(f + '.tmp', info); renameSync(f + '.tmp', f) }
  return lines.length
}

/** A file name from another device: same name in the library = the same note (paths differ per device). */
function fileIdByName(db: Db, path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null
  const name = basename(path.replace(/\\/g, '/')).normalize('NFC')
  const rows = db.prepare('SELECT id FROM file_asset WHERE lower(name) = lower(?) LIMIT 2').all(name) as { id: string }[]
  return rows.length === 1 ? rows[0].id : null
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200

/** Applies one line from another device. Idempotent: reading a line twice changes nothing. */
export function applyLine(db: Db, dev: string, l: Line, keepFrom: string): string | null {
  const r = l.r || {}
  if (!isId(r.id)) return null
  if (l.k === 's') {
    if ((str(r.last_at) || '') < keepFrom) return null
    db.prepare(`INSERT INTO claude_session (id, cwd, started_at, last_at, ended_at, end_reason, model, events, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET cwd = COALESCE(excluded.cwd, cwd), started_at = MIN(started_at, excluded.started_at),
      last_at = MAX(last_at, excluded.last_at), ended_at = excluded.ended_at, end_reason = excluded.end_reason,
      model = COALESCE(excluded.model, model), events = MAX(events, excluded.events) WHERE claude_session.device IS NOT NULL`)
      .run(r.id, str(r.cwd), str(r.started_at) || str(r.last_at) || '', str(r.last_at) || '', str(r.ended_at), str(r.end_reason), str(r.model), num(r.events) ?? 0, dev)
    return r.id
  }
  if (l.k === 'e') {
    if ((str(r.received_at) || '') < keepFrom || !isId(r.session_id)) return null
    db.prepare(`INSERT INTO claude_event (id, session_id, received_at, hook, type, tool, file_path, file_id, cwd, region, status, duration_ms, summary, agent_id, tool_use_id, device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(r.id, r.session_id, str(r.received_at) || '', str(r.hook) || '', str(r.type) || '', str(r.tool), str(r.file_path), fileIdByName(db, r.file_path),
        str(r.cwd), str(r.region) || 'core', str(r.status), num(r.duration_ms), str(r.summary), str(r.agent_id), str(r.tool_use_id), dev)
    // a session line may come later in the same batch; until then the session exists with what we know
    db.prepare(`INSERT INTO claude_session (id, cwd, started_at, last_at, events, device) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING`)
      .run(r.session_id, str(r.cwd), str(r.received_at) || '', str(r.received_at) || '', dev)
    return r.session_id
  }
  if (l.k === 'c') {
    if ((str(r.at) || '') < keepFrom || !isId(r.session_id)) return null
    db.prepare(`INSERT INTO claude_change (id, session_id, tool_use_id, at, tool, file_path, file_id, before_text, after_text, how, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET at = excluded.at, after_text = excluded.after_text, before_text = COALESCE(before_text, excluded.before_text) WHERE claude_change.device IS NOT NULL`)
      .run(r.id, r.session_id, str(r.tool_use_id), str(r.at) || '', str(r.tool) || '', str(r.file_path) || '', fileIdByName(db, r.file_path), str(r.before_text), str(r.after_text), str(r.how) || 'unavailable', dev)
    return r.session_id
  }
  if (l.k === 'l') {
    const up = str(r.updated_at) || ''
    const tomb = db.prepare("SELECT at FROM sync_tomb WHERE id = ? AND kind = 'lesson'").get(r.id) as { at: string } | undefined
    if (tomb && tomb.at >= up) return null // deleted here after that edit
    const status = ['new', 'kept', 'dropped'].includes(String(r.status)) ? String(r.status) : 'new'
    const source = r.source === 'user' ? 'user' : 'claude'
    // last edit wins, on any device
    db.prepare(`INSERT INTO lesson (id, project, cwd, text, source, status, session_id, created_at, updated_at, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text = excluded.text, status = excluded.status, updated_at = excluded.updated_at, device = excluded.device
      WHERE excluded.updated_at > lesson.updated_at`)
      .run(r.id, str(r.project) || '', str(r.cwd), (str(r.text) || '').slice(0, 400), source, status, str(r.session_id), str(r.created_at) || up, up, dev)
    return null
  }
  if (l.k === 'ld') {
    const at = str(r.at) || ''
    db.prepare('DELETE FROM lesson WHERE id = ? AND updated_at <= ?').run(r.id, at)
    return null
  }
  return null
}

export interface ImportResult { lines: number; sessions: string[]; peers: number }

/** Reads what the other devices added since last time. Only whole lines; a half-synced last line waits. */
export function importOnce(db: Db, folder: string, keepFrom: string, now = new Date()): ImportResult {
  const me = deviceId(db)
  const base = devicesDir(folder)
  const res: ImportResult = { lines: 0, sessions: [], peers: 0 }
  const touched = new Set<string>()
  let devs: string[] = []
  try { devs = readdirSync(base).filter((d) => d !== me && /^[A-Za-z0-9-]{8,64}$/.test(d)) } catch { return res }
  for (const dev of devs) {
    const dir = join(base, dev)
    let info: { name?: unknown; platform?: unknown; updated_at?: unknown } = {}
    try { info = JSON.parse(readFileSync(join(dir, 'device.json'), 'utf8')) } catch { /* not there yet */ }
    let files: string[] = []
    try { files = readdirSync(dir).filter((f) => /^journal-\d{4}-\d{2}\.jsonl$/.test(f)).sort() } catch { continue }
    let got = 0
    for (const f of files) {
      const key = `syncIn:${dev}/${f}`
      const p = join(dir, f)
      let size = 0
      try { size = statSync(p).size } catch { continue }
      let off = Number(get(db, key) || 0)
      if (size < off) off = 0 // the file was replaced (e.g. a cloud conflict copy won): read again, lines are idempotent
      if (size === off) continue
      const fd = openSync(p, 'r')
      let text: string
      try {
        const buf = Buffer.alloc(size - off)
        readSync(fd, buf, 0, buf.length, off)
        text = buf.toString('utf8')
      } finally { closeSync(fd) }
      const end = text.lastIndexOf('\n')
      if (end < 0) continue
      const lines = text.slice(0, end).split('\n')
      db.exec('BEGIN')
      try {
        for (const s of lines) {
          if (!s.trim()) continue
          let l: Line
          try { l = JSON.parse(s) as Line } catch { continue }
          if (!l || !KINDS.includes(l.k) || typeof l.r !== 'object') continue
          const sid = applyLine(db, dev, l, keepFrom)
          if (sid) touched.add(sid)
          got++
        }
        put(db, key, String(off + Buffer.byteLength(text.slice(0, end + 1), 'utf8')))
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    }
    if (got || info.name) {
      const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim().slice(0, 80) : dev.slice(0, 8)
      const old = db.prepare('SELECT seen_at FROM sync_peer WHERE id = ?').get(dev) as { seen_at: string } | undefined
      db.prepare(`INSERT INTO sync_peer (id, name, platform, seen_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, platform = excluded.platform, seen_at = excluded.seen_at, updated_at = excluded.updated_at`)
        .run(dev, name, typeof info.platform === 'string' ? info.platform.slice(0, 20) : null, got || !old ? now.toISOString() : old.seen_at, typeof info.updated_at === 'string' ? info.updated_at : null)
      res.peers++
    }
    res.lines += got
  }
  res.sessions = [...touched]
  return res
}

export function peers(db: Db): SyncStatus['peers'] {
  const rows = db.prepare('SELECT * FROM sync_peer ORDER BY seen_at DESC').all() as unknown as Peer[]
  const n = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n
  return rows.map((p) => ({ ...p, sessions: n('SELECT COUNT(*) AS n FROM claude_session WHERE device = ?', p.id), events: n('SELECT COUNT(*) AS n FROM claude_event WHERE device = ?', p.id), lessons: n('SELECT COUNT(*) AS n FROM lesson WHERE device = ?', p.id) }))
}

/** Turn sync on for a folder (the user's choice) or off (null). Off keeps everything already synced. */
export function setFolder(db: Db, folder: string | null): void {
  if (folder) put(db, 'syncFolder', folder)
  else del(db, 'syncFolder')
}

/** Known cloud folders on this computer (existence checks of the usual places only). */
export function cloudFolders(platform: string, home: string, env: Record<string, string | undefined>, exists: (p: string) => boolean = existsSync, list: (p: string) => string[] = (p) => { try { return readdirSync(p) } catch { return [] } }): { kind: string; path: string }[] {
  const out: { kind: string; path: string }[] = []
  const add = (kind: string, p: string | null | undefined) => { if (p && exists(p) && !out.some((o) => o.path === p)) out.push({ kind, path: p }) }
  if (platform === 'darwin') {
    const cs = join(home, 'Library', 'CloudStorage')
    for (const d of list(cs)) {
      if (/^GoogleDrive-/i.test(d)) { const g = join(cs, d); const inner = list(g).find((x) => /^(My Drive|Meine Ablage)$/i.test(x)); add('gdrive', inner ? join(g, inner) : g) }
      else if (/^OneDrive/i.test(d)) add('onedrive', join(cs, d))
      else if (/^Dropbox/i.test(d)) add('dropbox', join(cs, d))
    }
    add('icloud', join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'))
  } else if (platform === 'win32') {
    add('onedrive', env['OneDrive'] || env['ONEDRIVE'] || join(home, 'OneDrive'))
    for (const n of ['My Drive', 'Meine Ablage']) add('gdrive', join('G:\\', n))
    add('gdrive', join(home, 'Google Drive'))
    add('icloud', join(home, 'iCloudDrive'))
  }
  add('dropbox', join(home, 'Dropbox'))
  add('mega', join(home, 'MEGA'))
  add('mega', join(home, 'Documents', 'MEGA'))
  return out
}

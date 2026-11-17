import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../../src/main/library/db'
import { normalize } from '../../src/main/monitor/normalize'
import { record, listSessions } from '../../src/main/monitor/store'
import { addLesson, deleteLesson, listLessons, updateLesson } from '../../src/main/monitor/lessons'
import { cloudFolders, deviceId, devicesDir, exportOnce, importOnce, peers, setFolder, syncFolder } from '../../src/main/sync/sync'
import { recentSessions } from '../../src/main/context/query'

let dir: string, cloud: string, A: Db, B: Db
const keep = '2000-01-01'
const t = (m: number) => new Date(Date.UTC(2026, 10, 17, 9, m)).toISOString()
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nos-sync-'))
  cloud = join(dir, 'cloud')
  A = openDb(join(dir, 'a.db')); B = openDb(join(dir, 'b.db'))
})
afterEach(async () => { A.close(); B.close(); await rm(dir, { recursive: true, force: true }) })

const rec = (db: Db, o: object, at: string) => record(db, dir, normalize({ session_id: 's1', cwd: '/u/Shop', ...o })!, at)
const n = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n

describe('device sync through a cloud folder', () => {
  it('carries sessions, events, changes and lessons to the other device, once', () => {
    rec(A, { hook_event_name: 'SessionStart', model: 'opus' }, t(1))
    rec(A, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/u/Shop/notes/Idee.md' } }, t(2))
    rec(A, { hook_event_name: 'Stop', note_line: 'SESSION-NOTE: Shop gebaut.', lesson_line: 'LESSON: Preise im Server prüfen.' }, t(3))
    expect(exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(4)))).toBeGreaterThan(3)
    const r = importOnce(B, cloud, keep, new Date(t(5)))
    expect(r.sessions).toEqual(['s1'])
    const s = listSessions(B)[0] as unknown as { id: string; model: string; device: string; device_name: string; events: number }
    expect([s.id, s.model, s.device, s.device_name]).toEqual(['s1', 'opus', deviceId(A), 'Mac'])
    expect(n(B, 'SELECT COUNT(*) AS n FROM claude_event')).toBe(n(A, 'SELECT COUNT(*) AS n FROM claude_event'))
    expect(listLessons(B).map((l) => l.text)).toEqual(['Preise im Server prüfen.'])
    // reading again changes nothing; B never sends A's rows back
    expect(importOnce(B, cloud, keep, new Date(t(6))).lines).toBe(0)
    exportOnce(B, cloud, 'PC', 'win32', new Date(t(6)))
    expect(importOnce(A, cloud, keep, new Date(t(7))).lines).toBe(0)
    expect(peers(A).map((p) => p.name)).toEqual(['PC'])
    expect(peers(B)[0]).toMatchObject({ name: 'Mac', platform: 'darwin', sessions: 1, lessons: 1 })
  })

  it('only new rows go out, and a change gets its "after" later', () => {
    rec(A, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 'u1', tool_input: { file_path: join(dir, 'x.md') }, before_missing: true }, t(1))
    exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(2)))
    importOnce(B, cloud, keep)
    expect((B.prepare('SELECT after_text FROM claude_change').get() as { after_text: string | null }).after_text).toBe(null)
    writeFileSync(join(dir, 'x.md'), 'neu')
    rec(A, { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'u1', tool_input: { file_path: join(dir, 'x.md') } }, t(3))
    const lines = exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(4)))
    expect(lines).toBe(3) // session, event, change: nothing old again
    importOnce(B, cloud, keep)
    expect((B.prepare('SELECT after_text FROM claude_change').get() as { after_text: string }).after_text).toBe('neu')
    expect(n(B, 'SELECT COUNT(*) AS n FROM claude_change')).toBe(1)
  })

  it('lesson edits: the last edit wins on any device, deletes travel too', () => {
    const l = addLesson(A, { project: 'shop', text: 'Eins.', source: 'claude' }, t(1))!
    exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(2))); importOnce(B, cloud, keep)
    updateLesson(B, l.id, { status: 'kept' }, t(3))
    exportOnce(B, cloud, 'PC', 'win32', new Date(t(4))); importOnce(A, cloud, keep)
    expect(listLessons(A)[0].status).toBe('kept')
    // an older edit from the other side does not win
    updateLesson(A, l.id, { text: 'Zwei.' }, t(5))
    exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(6))); importOnce(B, cloud, keep)
    expect(listLessons(B)[0].text).toBe('Zwei.')
    deleteLesson(B, l.id, t(7))
    exportOnce(B, cloud, 'PC', 'win32', new Date(t(8))); importOnce(A, cloud, keep)
    expect(listLessons(A)).toEqual([])
  })

  it('waits for a half-synced last line and reads a replaced file again', () => {
    rec(A, { hook_event_name: 'SessionStart' }, t(1))
    exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(2)))
    const jdir = join(devicesDir(cloud), deviceId(A)), f = join(jdir, readdirSync(jdir).find((x) => x.endsWith('.jsonl'))!)
    appendFileSync(f, '{"k":"e","r":{"id":"half"')
    importOnce(B, cloud, keep)
    expect(n(B, "SELECT COUNT(*) AS n FROM claude_event WHERE id = 'half'")).toBe(0)
    appendFileSync(f, ',"session_id":"s1","received_at":"' + t(3) + '","hook":"Stop","type":"turn_finished","region":"core"}}\n')
    importOnce(B, cloud, keep)
    expect(n(B, "SELECT COUNT(*) AS n FROM claude_event WHERE id = 'half'")).toBe(1)
    // the cloud replaced the file with a shorter one: read from the start, nothing doubles
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').slice(0, 2).join('\n') + '\n')
    importOnce(B, cloud, keep)
    expect(n(B, 'SELECT COUNT(*) AS n FROM claude_event')).toBe(2)
    // old rows beyond the kept days are skipped
    const C = openDb(join(dir, 'c.db'))
    importOnce(C, cloud, '2030-01-01')
    expect(n(C, 'SELECT COUNT(*) AS n FROM claude_session')).toBe(0)
    C.close()
  })

  it('names the other computer in recent_sessions for Claude', () => {
    rec(A, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/u/Shop/a.md' } }, t(1))
    exportOnce(A, cloud, 'Mac', 'darwin', new Date(t(2))); importOnce(B, cloud, keep)
    expect(recentSessions(B, dir)[0].device).toBe('Mac')
    expect(recentSessions(A, dir)[0].device).toBeUndefined()
  })

  it('remembers the folder and finds cloud folders', () => {
    setFolder(A, cloud); expect(syncFolder(A)).toBe(cloud); setFolder(A, null); expect(syncFolder(A)).toBe(null)
    const have = new Set(['/h/Library/CloudStorage/GoogleDrive-x@y/My Drive', '/h/Library/Mobile Documents/com~apple~CloudDocs', '/h/MEGA'])
    const ls = (p: string) => (p === '/h/Library/CloudStorage' ? ['GoogleDrive-x@y'] : p === '/h/Library/CloudStorage/GoogleDrive-x@y' ? ['My Drive', 'Other'] : [])
    expect(cloudFolders('darwin', '/h', {}, (p) => have.has(p), ls).map((c) => c.kind)).toEqual(['gdrive', 'icloud', 'mega'])
    const w = cloudFolders('win32', 'C:\\Users\\v', { OneDrive: 'C:\\Users\\v\\OneDrive' }, (p) => p === 'C:\\Users\\v\\OneDrive')
    expect(w).toEqual([{ kind: 'onedrive', path: 'C:\\Users\\v\\OneDrive' }])
  })
})

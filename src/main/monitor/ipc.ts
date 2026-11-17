import { addLesson, deleteLesson, lessonProjects, listLessons, observed, updateLesson } from './lessons'
import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { guardrails } from './guardrails'
import { recap } from './recap'
import { overlaps } from './overlaps'
import { mcpServers } from './mcpServers'
import { scanApps } from './appScan'
import { join } from 'node:path'
import { libraryState } from '../library/ipc'
import { normalize } from './normalize'
import { startReceiver, type Receiver } from './receiver'
import { getChange, listChanges, listEvents, listSessions, prune, record } from './store'
import { apply, layoutOutdated, plan, SCRIPT_NAME, status } from './installer'
import { writeSessionNote, type Lang } from './sessionNote'
import { ruleApply, rulePlan, ruleStatus, parseReadiness } from './readiness'
import { FORWARDER_SOURCE } from './forwarder'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { addArgs, addArgsPlain, findClaude, registered, removeArgs, runClaude, serverSpec, shellLine } from './mcpInstall'
import { organize } from '../library/organize'

// IPC for Claude Code monitoring (spec 6). Channel names: "mon:*".

let receiver: Receiver | null = null
let receiverError: string | null = null

/** Absolute path of node. GUI apps on macOS do not see the shell PATH, so ask a login shell too. */
export function findNode(): string | null {
  // keep the stable link (e.g. /opt/homebrew/bin/node), not the versioned target: a brew upgrade
  // would otherwise break every hook silently
  const tries: [string, string[]][] = process.platform === 'win32'
    ? [['where', ['node']], ['node', ['-p', 'process.execPath']]]
    : [['/bin/sh', ['-c', 'command -v node']], ['/bin/zsh', ['-lc', 'command -v node']], ['node', ['-p', 'process.execPath']]]
  for (const [cmd, args] of tries) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 4000, windowsHide: true })
      const line = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^([A-Za-z]:\\|\/)/.test(l))[0]
      if (r.status === 0 && line && existsSync(line)) return line
    } catch { /* try next */ }
  }
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) if (process.platform === 'darwin' && existsSync(p)) return p
  return null
}

export function initMonitor(getWin: () => BrowserWindow | null): { scheduleNote: (sid: string, ms?: number) => void } {
  const { db, libDir, notify, job } = libraryState()
  const data = app.getPath('userData')
  const endpoint = join(data, 'monitor', 'endpoint.json')
  const script = join(data, 'hooks', SCRIPT_NAME)
  const backups = join(data, 'backups')
  const home = process.env['NEURAL_OS_CLAUDE_HOME'] || homedir() // tests use a throw-away home

  const getSet = (k: string) => (db.prepare('SELECT value FROM app_setting WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
  const putSet = (k: string, v: string) => db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  const excluded = new Set<string>(JSON.parse(getSet('monExcluded') || '[]') as string[])
  try { prune(db, Number(getSet('monKeepDays') || 30), new Date()) } catch { /* ignore */ }

  const onPayload = (p: Record<string, unknown>) => {
    const ev = normalize(p)
    if (!ev) return
    const r = record(db, libDir, ev, new Date().toISOString(), excluded)
    if (!r) return
    // plain objects: sqlite rows have no prototype and do not survive IPC cloning
    let c: Record<string, unknown> | null = null
    if (r.change) { const { before_text: _b, after_text: _a, ...rest } = r.change; c = { ...rest } }
    scheduleNote(ev.session_id, ev.event_type === 'turn_finished' || ev.event_type === 'session_ended' ? 4000 : 60000)
    if (r.readiness) { try { getWin()?.webContents.send('mon:event', { event: { ...r.readiness }, session: { ...r.session, excluded: false }, change: null }) } catch { /* ignore */ } }
    try { getWin()?.webContents.send('mon:event', { event: { ...r.event }, session: { ...r.session, excluded: false }, change: c }) } catch (e) { console.error('mon:event', e) }
  }
  // S2: write the session note after each finished answer and at the end (debounced per session)
  const noteTimers = new Map<string, NodeJS.Timeout>()
  const notesOn = () => getSet('monNotes') !== '0'
  const lang = (): Lang => (getSet('lang') === 'en' ? 'en' : 'de')
  // Stop and SessionEnd may never arrive (e.g. `claude -p` exits before async hooks finish),
  // so any event also schedules a later write
  const scheduleNote = (sid: string, ms = 4000) => {
    if (!notesOn()) return
    clearTimeout(noteTimers.get(sid))
    noteTimers.set(sid, setTimeout(() => {
      noteTimers.delete(sid)
      void job(async () => {
        const id = writeSessionNote(db, libDir, sid, lang(), new Date())
        if (id) { await organize(db, libDir, [id], { wikilinksOnly: true }); notify() }
      }).catch((e) => console.error('session note', e))
    }, ms))
  }
  // context server (S3): our script in app data, registered through the official claude command
  const mcpScript = join(data, 'mcp', 'neural-os-mcp.cjs')
  const mcpSource = () => readFileSync(join(__dirname, 'mcp.js'), 'utf8')
  const writeMcp = () => { mkdirSync(join(data, 'mcp'), { recursive: true }); const src = mcpSource(); if (!existsSync(mcpScript) || readFileSync(mcpScript, 'utf8') !== src) writeFileSync(mcpScript, src) }
  const spec = () => serverSpec(nodePath() ?? 'node', mcpScript, join(data, 'neural-os.db'), libDir, endpoint)
  try { if (registered(home)) writeMcp() } catch { /* ignore */ }
  let claudeCmd: string | null | undefined
  const claudePath = () => (claudeCmd === undefined ? (claudeCmd = findClaude()) : claudeCmd)
  ipcMain.handle('ctx:status', () => {
    const r = registered(home), want = spec()
    return { installed: !!r, outdated: !!r && JSON.stringify(r.args) !== JSON.stringify(want.args), claude: claudePath(), node: nodePath() }
  })
  ipcMain.handle('ctx:plan', (_e, remove: unknown) => {
    const found = claudePath(), c = found ?? 'claude'
    // the server file must exist for the hand-typed command too
    if (remove !== true) { try { writeMcp() } catch { /* shown as failure on apply */ } }
    const args = remove === true ? removeArgs() : found ? addArgs(spec()) : addArgsPlain(spec())
    return { command: shellLine(c, args), found: !!found, claude: found, spec: remove === true ? null : spec(), error: !nodePath() && remove !== true ? 'noNode' : null }
  })
  ipcMain.handle('ctx:apply', (_e, remove: unknown) => {
    const c = claudePath()
    if (!c) return { ok: false, backup: null, error: 'noClaude' }
    if (remove !== true) writeMcp()
    // re-adding replaces: remove first (ignore "not found")
    if (remove !== true && registered(home)) runClaude(c, removeArgs(), home, backups, new Date())
    return runClaude(c, remove === true ? removeArgs() : addArgs(spec()), home, backups, new Date())
  })

  // keep the installed forwarder (our own file in app data) in step with this app version
  try {
    const st0 = status(home)
    if (st0.installed && st0.script === script && existsSync(script) && readFileSync(script, 'utf8') !== FORWARDER_SOURCE) writeFileSync(script, FORWARDER_SOURCE)
  } catch { /* ignore */ }
  // memory flash: the context server tells which notes it handed to Claude
  const onContext = (p: Record<string, unknown>) => {
    const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === 'string').slice(0, 40) : []
    if (ids.length) getWin()?.webContents.send('mon:flash', { ids, tool: typeof p.tool === 'string' ? p.tool.slice(0, 40) : '' })
  }
  const started = startReceiver(endpoint, onPayload, onContext).then((r) => { receiver = r }, (e: Error) => { receiverError = e.message })
  app.on('will-quit', () => { void receiver?.close() })

  let node: string | null | undefined
  const nodePath = () => (node === undefined ? (node = findNode()) : node)

  ipcMain.handle('mon:status', async () => {
    await started // the window can ask before the receiver is listening
    const st = status(home)
    const n = nodePath()
    // installed with another node path (e.g. a versioned one) or another app data folder: offer to reconnect
    const outdated = st.installed && ((!!n && st.command !== n) || st.script !== script || (!!st.json && layoutOutdated(st.json, script, endpoint)))
    return { receiving: !!receiver, receiverError, installed: st.installed, outdated, settingsPath: st.path, settingsError: st.error ?? null, node: n }
  })
  ipcMain.handle('mon:plan', (_e, remove: unknown) => {
    const n = nodePath()
    if (!n && !remove) return { error: 'noNode' }
    return plan(home, script, endpoint, remove === true, n ?? 'node')
  })
  ipcMain.handle('mon:apply', (_e, remove: unknown) => {
    const n = nodePath()
    if (!n && !remove) return { ok: false, error: 'noNode' }
    const r = apply(home, script, endpoint, backups, remove === true, new Date(), n ?? 'node')
    if (r.ok) putSet('monHooksChanged', new Date().toISOString())
    return r
  })
  ipcMain.handle('mon:getNotes', () => notesOn())
  ipcMain.handle('mon:setNotes', (_e, on: unknown) => { putSet('monNotes', on ? '1' : '0'); return true })
  ipcMain.handle('mon:setLang', (_e, l: unknown) => { if (l === 'de' || l === 'en') putSet('lang', l); return true })
  // readiness rule (spec 10.5): shown first, backed up, removable
  ipcMain.handle('rule:status', () => ruleStatus(home))
  ipcMain.handle('mon:guardrails', () => guardrails(db, home))
  ipcMain.handle('mon:mcp', () => mcpServers(db, home))
  ipcMain.handle('mon:apps', () => ({ platform: process.platform, apps: scanApps({ platform: process.platform, home, env: process.env, servers: mcpServers(db, home).servers }) }))
  ipcMain.handle('mon:overlaps', (_e, hours: unknown) => overlaps(db, new Date(Date.now() - (typeof hours === 'number' && hours > 0 ? Math.min(hours, 720) : 24) * 3600e3).toISOString()))
  ipcMain.handle('mon:recap', (_e, since: unknown) => (typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? recap(db, new Date(since).toISOString()) : null))
  ipcMain.handle('rule:plan', (_e, remove: unknown) => rulePlan(home, remove === true))
  ipcMain.handle('rule:apply', (_e, remove: unknown) => ruleApply(home, backups, remove === true, new Date()))
  ipcMain.handle('rule:reports', () => (db.prepare("SELECT e.id, e.session_id, e.received_at, e.summary, s.cwd FROM claude_event e LEFT JOIN claude_session s ON s.id = e.session_id WHERE e.type = 'readiness_report' ORDER BY e.received_at DESC LIMIT 50").all() as { summary: string }[])
    .map((r) => ({ ...r, parsed: parseReadiness(r.summary || '') })))
  // lesson book: the user keeps, drops, rewrites or adds lessons
  ipcMain.handle('les:projects', () => lessonProjects(db))
  ipcMain.handle('les:list', (_e, p: unknown) => (typeof p === 'string' ? { lessons: listLessons(db, { project: p }), observed: observed(db, p) } : { lessons: listLessons(db), observed: [] }))
  ipcMain.handle('les:update', (_e, id: unknown, ch: unknown) => {
    if (typeof id !== 'string' || !ch || typeof ch !== 'object') return null
    const c = ch as { status?: unknown; text?: unknown }
    return updateLesson(db, id, { status: c.status === 'new' || c.status === 'kept' || c.status === 'dropped' ? c.status : undefined, text: typeof c.text === 'string' ? c.text : undefined }, new Date().toISOString())
  })
  ipcMain.handle('les:add', (_e, p: unknown, text: unknown) => (typeof p === 'string' && typeof text === 'string' ? addLesson(db, { project: p, text, source: 'user' }, new Date().toISOString()) : null))
  ipcMain.handle('les:remove', (_e, id: unknown) => (typeof id === 'string' ? deleteLesson(db, id) : false))
  ipcMain.handle('mon:openBackups', () => shell.openPath(backups))
  ipcMain.handle('mon:sessions', () => listSessions(db).map((s) => ({ ...s, excluded: excluded.has(s.id) })))
  ipcMain.handle('mon:events', (_e, o: unknown) => {
    const q = (o && typeof o === 'object' ? o : {}) as { session?: unknown; limit?: unknown }
    return listEvents(db, { session: typeof q.session === 'string' ? q.session : undefined, limit: typeof q.limit === 'number' ? q.limit : undefined })
  })
  ipcMain.handle('mon:changes', (_e, o: unknown) => {
    const q = (o && typeof o === 'object' ? o : {}) as { session?: unknown; fileId?: unknown }
    return listChanges(db, { session: typeof q.session === 'string' ? q.session : undefined, fileId: typeof q.fileId === 'string' ? q.fileId : undefined })
  })
  ipcMain.handle('mon:change', (_e, id: unknown) => (typeof id === 'string' ? getChange(db, id) : null))
  ipcMain.handle('mon:mute', (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string') return false
    db.prepare('UPDATE claude_session SET muted = ? WHERE id = ?').run(on ? 1 : 0, id)
    return true
  })
  ipcMain.handle('mon:exclude', (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string') return false
    if (on) excluded.add(id); else excluded.delete(id)
    putSet('monExcluded', JSON.stringify([...excluded]))
    return true
  })
  return { scheduleNote }
}

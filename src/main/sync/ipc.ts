import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { libraryState } from '../library/ipc'
import { cloudFolders, deviceId, deviceName, devicesDir, exportOnce, importOnce, peers, setFolder, syncFolder, SYNC_DIR } from './sync'

// IPC for device sync ("sync:*"), see sync.ts. Runs every 10 s and when the other devices' journals change.

export function initSync(getWin: () => BrowserWindow | null, scheduleNote: (sid: string, ms?: number) => void): void {
  const { db } = libraryState()
  const host = hostname().replace(/\.local$/i, '').slice(0, 60) || 'NEURAL OS'
  const getSet = (k: string) => (db.prepare('SELECT value FROM app_setting WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
  const putSet = (k: string, v: string) => db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v)
  let lastOut: string | null = null, lastIn: string | null = null, error: string | null = null
  let watcher: FSWatcher | null = null, soon: NodeJS.Timeout | null = null, busy = false

  const keepFrom = () => new Date(Date.now() - Number(getSet('monKeepDays') || 30) * 864e5).toISOString()
  const run = () => {
    const folder = syncFolder(db)
    if (!folder || busy) return
    busy = true
    try {
      if (!existsSync(folder)) { error = 'missing'; return }
      exportOnce(db, folder, host, process.platform)
      lastOut = new Date().toISOString()
      const r = importOnce(db, folder, keepFrom())
      lastIn = new Date().toISOString()
      error = null
      if (r.lines) {
        // the other device's sessions get their notes here too, so both brains hold the same notes
        for (const sid of r.sessions) scheduleNote(sid, 4000)
        try { getWin()?.webContents.send('mon:synced', { lines: r.lines }) } catch { /* window closed */ }
      }
    } catch (e) { error = (e as Error).message.slice(0, 200); console.error('sync', e) } finally { busy = false }
  }
  const watchFolder = () => {
    watcher?.close(); watcher = null
    const folder = syncFolder(db)
    if (!folder) return
    try {
      const d = devicesDir(folder)
      mkdirSync(d, { recursive: true })
      // cloud programs do not always raise events: the 10 s timer is the safety net
      watcher = watch(d, { recursive: process.platform !== 'linux' }, () => { if (soon) clearTimeout(soon); soon = setTimeout(run, 1500) })
      watcher.on('error', () => { watcher?.close(); watcher = null })
    } catch { /* timer only */ }
  }
  const timer = setInterval(run, 10_000)
  watchFolder()
  setTimeout(run, 3000)
  app.on('will-quit', () => { clearInterval(timer); watcher?.close(); try { run() } catch { /* ignore */ } })

  const status = () => ({
    on: !!syncFolder(db), folder: syncFolder(db), device: { id: deviceId(db), name: deviceName(db, host) },
    peers: peers(db), lastOut, lastIn, error, sub: SYNC_DIR,
    clouds: cloudFolders(process.platform, homedir(), process.env)
  })
  ipcMain.handle('sync:status', () => status())
  ipcMain.handle('sync:pick', async () => {
    const win = getWin()
    const o = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const r = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('sync:set', (_e, folder: unknown) => {
    if (folder !== null && (typeof folder !== 'string' || !existsSync(folder))) return { ok: false, error: 'missing' }
    setFolder(db, folder as string | null)
    watchFolder()
    if (folder) run()
    return { ok: true, status: status() }
  })
  ipcMain.handle('sync:name', (_e, name: unknown) => {
    if (typeof name === 'string' && name.trim()) putSet('syncDeviceName', name.trim().slice(0, 60))
    run()
    return status()
  })
  ipcMain.handle('sync:now', () => { run(); return status() })
  ipcMain.handle('sync:open', () => { const f = syncFolder(db); return f ? shell.openPath(join(f, SYNC_DIR)) : '' })
}

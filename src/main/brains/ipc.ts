import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { libraryState } from '../library/ipc'
import { importFiles } from '../library/library'
import { organize } from '../library/organize'
import { brainData, brainFilePath, bridges, exportBrain, exportPlan, importBrain, listBrains, readBrainFile, removeBrain, setVisible, type ExportOpts } from './brainfile'

// IPC for shareable brains: "brain:*". Export asks where to save, import asks which file.
// Imported brains live in <app data>/brains and are only read.

export function initBrains(getWin: () => BrowserWindow | null): void {
  const dir = join(app.getPath('userData'), 'brains')
  const opts = (o: unknown): ExportOpts => {
    const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
    const projects = Array.isArray(x.projects) ? x.projects.filter((p) => p === null || typeof p === 'string') as (string | null)[] : null
    return { name: typeof x.name === 'string' ? x.name : 'Brain', author: typeof x.author === 'string' && x.author.trim() ? x.author.trim() : null, projects, sessions: x.sessions === true }
  }
  const progress = (done: number, total: number) => getWin()?.webContents.send('brain:progress', { done, total })

  ipcMain.handle('brain:plan', (_e, o: unknown) => exportPlan(libraryState().db, opts(o)))
  ipcMain.handle('brain:export', async (_e, o: unknown) => {
    const O = opts(o), win = getWin()
    const def = join(app.getPath('documents'), (O.name.replace(/[\\/:*?"<>|]/g, '-') || 'Brain') + '.brain')
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: def, filters: [{ name: 'NEURAL OS Brain', extensions: ['brain'] }] }) : await dialog.showSaveDialog({ defaultPath: def })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    const { db, libDir, job } = libraryState()
    try { return { ok: true, path: r.filePath, ...(await job(() => exportBrain(db, libDir, r.filePath!, O, progress))) } } catch (err) { return { ok: false, error: (err as Error).message } }
  })
  ipcMain.handle('brain:reveal', (_e, p: unknown) => { if (typeof p === 'string' && p.endsWith('.brain')) shell.showItemInFolder(p) })
  ipcMain.handle('brain:import', async () => {
    const win = getWin(), f = { filters: [{ name: 'NEURAL OS Brain', extensions: ['brain'] }], properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, f) : await dialog.showOpenDialog(f)
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    try { return { ok: true, brain: await importBrain(dir, r.filePaths[0], progress) } } catch (err) { return { ok: false, error: (err as Error).message } }
  })
  ipcMain.handle('brain:list', () => listBrains(dir))
  // what the renderer draws: files (without their long text), links, and bridges to my brain
  ipcMain.handle('brain:data', async (_e, id: unknown) => {
    if (typeof id !== 'string') return null
    const j = await brainData(dir, id)
    if (!j) return null
    return { name: j.name, author: j.author, files: j.files.map(({ text: _t, ...f }) => ({ ...f, hasText: !!_t })), links: j.links, bridges: bridges(libraryState().db, j) }
  })
  ipcMain.handle('brain:read', (_e, id: unknown, fileId: unknown) => (typeof id === 'string' && typeof fileId === 'string' ? readBrainFile(dir, id, fileId) : { kind: 'none', reason: 'missing' }))
  ipcMain.handle('brain:visible', (_e, id: unknown, on: unknown) => (typeof id === 'string' ? setVisible(dir, id, on === true) : false))
  ipcMain.handle('brain:remove', (_e, id: unknown) => (typeof id === 'string' ? removeBrain(dir, id) : false))
  // copy notes of an imported brain into my library (a normal copy import, the source stays as it is)
  ipcMain.handle('brain:copy', async (_e, id: unknown, ids: unknown) => {
    if (typeof id !== 'string' || !Array.isArray(ids)) return { imported: 0 }
    const j = await brainData(dir, id)
    if (!j) return { imported: 0 }
    const want = new Set(ids.filter((x) => typeof x === 'string'))
    const paths = j.files.filter((f) => want.has(f.id)).map((f) => brainFilePath(dir, id, f)).filter((p): p is string => !!p)
    const { db, libDir, job, notify } = libraryState()
    return job(async () => {
      const r = await importFiles(db, libDir, paths)
      await organize(db, libDir, r.imported.map((x) => x.id), {})
      notify()
      return { imported: r.imported.length, duplicates: r.duplicates?.length ?? 0, ids: r.imported.map((x) => x.id) }
    })
  })
}

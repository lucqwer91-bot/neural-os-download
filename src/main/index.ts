import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { initLibrary } from './library/ipc'
import { initMonitor } from './monitor/ipc'
import { initBrains } from './brains/ipc'
import { initSync } from './sync/ipc'

// Main process: window, library (Phase 2) and the Claude Code monitor (Phase 3:
// local event receiver on 127.0.0.1, hook installer), see docs/NEURAL_OS_Development_Handoff.md.

// tests run against a throw-away data folder
if (process.env['NEURAL_OS_USER_DATA']) app.setPath('userData', process.env['NEURAL_OS_USER_DATA'])

let mainWin: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#08090a',
    show: false,
    title: 'NEURAL OS',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWin = win
  win.on('closed', () => { if (mainWin === win) mainWin = null })
  win.once('ready-to-show', () => win.show())

  // Never navigate away inside the app window; open external links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // `npm start` runs the plain Electron binary: show our icon in the macOS Dock too (installers use build/icon.png)
  if (process.platform === 'darwin') try { app.dock?.setIcon(icon) } catch { /* keep the default */ }
  initLibrary(() => mainWin)
  const mon = initMonitor(() => mainWin)
  initSync(() => mainWin, mon.scheduleNote)
  initBrains(() => mainWin)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

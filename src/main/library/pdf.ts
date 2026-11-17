import { BrowserWindow, dialog } from 'electron'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// PDF export of a note (Obsidian replacement, Paket 1). The renderer sends the rendered note as HTML
// (images are data: URLs); a hidden window without scripts, network or preload prints it, the user picks
// where to save. Nothing leaves the computer.

const PRINT_CSS = `@page{margin:18mm 16mm}body{font:11pt/1.55 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#111;background:#fff;margin:0}
h1,h2,h3,h4{line-height:1.25;margin:1.2em 0 .5em}h1{font-size:20pt}h2{font-size:15pt}h3{font-size:12.5pt}
img{max-width:100%;height:auto}pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:9.5pt}pre{background:#f4f4f5;padding:8px 10px;border-radius:6px;white-space:pre-wrap}
code{background:#f4f4f5;padding:0 3px;border-radius:3px}blockquote,.callout{border-left:3px solid #999;margin:.8em 0;padding:.2em 0 .2em 12px;color:#333}
table{border-collapse:collapse;margin:.6em 0}td,th{border:1px solid #ccc;padding:4px 8px}a,.wl{color:#2a5bd7;text-decoration:none}
.props-print{font-size:9.5pt;color:#555;border-bottom:1px solid #ddd;margin-bottom:12px;padding-bottom:6px}hr{border:0;border-top:1px solid #ddd}
.task input{margin-right:6px}mark{background:#fff3a3}`

export async function exportPdf(parent: BrowserWindow | null, name: string, html: string): Promise<{ ok: true; path: string } | { ok: false; reason: 'cancel' | 'failed' }> {
  const base = (name.replace(/\.(md|txt)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Note').slice(0, 120)
  const pick = parent ? await dialog.showSaveDialog(parent, { defaultPath: base + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : await dialog.showSaveDialog({ defaultPath: base + '.pdf' })
  if (pick.canceled || !pick.filePath) return { ok: false, reason: 'cancel' }
  const tmp = join(tmpdir(), `nos-pdf-${randomUUID()}.html`)
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><title>${esc(base)}</title><style>${PRINT_CSS}</style></head><body>${html}</body></html>`
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await writeFile(tmp, doc, 'utf8')
    await win.loadFile(tmp)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(pick.filePath, pdf)
    return { ok: true, path: pick.filePath }
  } catch { return { ok: false, reason: 'failed' } } finally {
    win.destroy(); await rm(tmp, { force: true }).catch(() => undefined)
  }
}

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Link requests while the app runs (user wish 2026-11-17: "nicht die ganze Zeit neustarten um was zu adden").
// Claude (or the user) drops a JSON file into <app data>/link-requests/:
//   { "path": "/Users/me/Folder", "exclude": "node_modules\n*.mp4" }  or a list of such objects
// The app links each folder read-only (an already linked folder is only rescanned and gets the new exclude),
// then writes the outcome to link-requests/done/<file> and removes the request. Only local processes of this
// user can write into the app data folder; a request can only add read-only folders, never change files.

export interface LinkRequest { path: string; exclude?: string }
export const REQ_DIR = 'link-requests'
const MAX = 64 * 1024

export function requestDir(appData: string): string { const d = join(appData, REQ_DIR); mkdirSync(join(d, 'done'), { recursive: true }); return d }

// reads and removes every pending *.json request; broken files go to done/ with an error, never block the queue
export function takeRequests(dir: string): { file: string; items: LinkRequest[]; error?: string }[] {
  const out: { file: string; items: LinkRequest[]; error?: string }[] = []
  let names: string[] = []
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort() } catch { return out }
  for (const file of names) {
    const p = join(dir, file)
    let items: LinkRequest[] = [], error: string | undefined
    try {
      const raw = readFileSync(p)
      if (raw.length > MAX) throw new Error('too large')
      const v = JSON.parse(raw.toString('utf8')) as unknown
      const list = Array.isArray(v) ? v : [v]
      items = list.filter((x): x is { path: string; exclude?: unknown } => !!x && typeof x === 'object' && typeof (x as { path?: unknown }).path === 'string')
        .map((x) => (typeof x.exclude === 'string' ? { path: x.path, exclude: x.exclude } : { path: x.path }))
      if (!items.length) error = 'no path'
    } catch (e) { error = (e as Error).message || 'unreadable' }
    // a half-written file (writer still busy) fails to parse: leave it for the next look unless it is old
    if (error && error !== 'no path' && error !== 'too large' && !tooOld(p)) continue
    try { rmSync(p, { force: true }) } catch { /* ignore */ }
    out.push({ file, items, error })
  }
  return out
}
function tooOld(p: string): boolean { try { return Date.now() - statSync(p).mtimeMs > 10_000 } catch { return true } }

export function writeResult(dir: string, file: string, result: unknown): void {
  const tmp = join(dir, 'done', file + '.tmp')
  try { writeFileSync(tmp, JSON.stringify(result, null, 2)); renameSync(tmp, join(dir, 'done', file)) } catch { /* the link itself still happened */ }
}

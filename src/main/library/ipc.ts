import { homedir } from 'node:os'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { mkdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { openDb, type Db } from './db'
import { isInside } from './files'

const isInsideAny = (p: string, roots: string[]) => roots.some((r) => isInside(p, r) || isInside(r, p))
import { importFiles, listFiles, listLinks, planImport, readContent, removeFile, stats } from './library'
import { organize } from './organize'
import { assetLinks } from './assetLinks'
import { luauGraph } from './luau'
import { extractPending } from './extract'
import { createNote, editState, getVersion, listVersions, restoreVersion, saveNote, setFolderEditable, textHash } from './write'
import { fullSearch, tagIndex } from './notes'
import { findVaults } from './vaults'
import { evalBase } from './bases'
import { dailyNote, templateText, templates } from './daily'
import { linkMention, renameNote, unlinkedMentions } from './links'
import { addFolder, applyPaths, listFolders, removeFolder, scanFolder, setFolderExclude, watchFolder, type ScanResult } from './linked'
import { libraryHealth } from './health'
import { agentBoard } from './agents'
import { fresh } from './fresh'
import { exportPdf } from './pdf'
import { exampleVault } from './example'
import { saveAttachment, ATTACH_MAX } from './attach'
import { dirTree, movePath, moveFile, newFolder, newNote, restoreTrash, trashPath } from './fileops'
import { requestDir, takeRequests, writeResult } from './requests'

// IPC for the library (renderer <-> main). Channel names: "lib:*".
// The database lives in the app data folder. The library folder defaults to
// <app data>/Library until the first-launch choice (spec 12.2) is built.

let db: Db | null = null
let libDir = ''
const watchers = new Map<string, FSWatcher>()
// library jobs (imports, scans, watcher updates) run one after another
let queue: Promise<unknown> = Promise.resolve()
function job<T>(fn: () => Promise<T>): Promise<T> { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p }

/** Database and library folder for other main-process modules (monitor). */
export const libraryState = () => ({ db: db!, libDir, notify: () => notifyChanged(), job })
let notifyChanged = () => undefined as unknown
const ASSET_LINKS_V = '5'   // 2: Luau code links, 3: backups skipped, 4: guards + house rules, 5: wrapper module, helpers, tool scripts

function setting(key: string): string | null {
  const r = db!.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as { value: string } | undefined
  return r ? r.value : null
}

export function initLibrary(getWin: () => BrowserWindow | null): void {
  const data = app.getPath('userData')
  mkdirSync(data, { recursive: true })
  db = openDb(join(data, 'neural-os.db'))
  libDir = setting('libraryDir') || join(data, 'Library')
  mkdirSync(libDir, { recursive: true })

  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

  const autoLink = () => setting('autoLink') !== '0'
  const changed = () => getWin()?.webContents.send('lib:changed')
  notifyChanged = changed
  // after a scan: refresh links of changed notes, link and sort new ones
  const afterScan = async (r: ScanResult) => {
    const del = db!.prepare("DELETE FROM knowledge_edge WHERE from_id = ? AND reason = 'wikilink'")
    for (const id of r.changed) del.run(id)
    const ids = [...r.added, ...r.changed]
    const o = ids.length ? await organize(db!, libDir, ids, { autoLink: autoLink(), wikilinksOnly: true }) : { links: 0, suggested: 0, projects: {} }
    if (ids.length || r.removed) changed()
    if (ids.length) extract()
    // code links follow edits too: a changed script can require or fire something new
    const code = () => r.changed.some((id) => (db!.prepare('SELECT ext FROM file_asset WHERE id = ?').get(id) as { ext?: string } | undefined)?.ext?.startsWith('lua'))
    if (r.added.length || r.removed || code()) relinkAssets()
    return o
  }
  // links for images, models and other files of linked folders (assetLinks.ts), recomputed after files come or go;
  // queued once behind the running scans, so linking many folders computes them one time
  let assetsQueued = false
  const relinkAssets = () => {
    if (assetsQueued) return
    assetsQueued = true
    void job(async () => {
      assetsQueued = false
      const a = await assetLinks(db!, { autoLink: autoLink() })
      db!.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('assetLinksV', ASSET_LINKS_V)
      console.log('[neural-os] asset links:', JSON.stringify(a))
      const c = await luauGraph(db!, { autoLink: autoLink() })
      console.log('[neural-os] code links:', JSON.stringify(c))
      if (a.links || c.links) changed()
    }).catch(() => { assetsQueued = false })
  }
  // PDF/Word text in the background, after imports and scans (never blocks the window)
  const extract = () => void job(async () => { const ids = await extractPending(db!, libDir); if (ids.length) changed() }).catch(() => undefined)
  const startWatch = (f: { id: string; path: string; name: string; editable: number; added_at: string; last_scan: string | null }) => {
    if (watchers.has(f.id)) return
    const w = watchFolder(f, (rels) => {
      console.log('[neural-os] watch:', JSON.stringify({ folder: f.name, paths: rels.length }))
      void job(async () => afterScan(await applyPaths(db!, f.id, rels))).catch((err) => console.warn('[neural-os] watch apply failed:', String(err)))
    }, () => { console.warn('[neural-os] watcher stopped:', f.name); watchers.delete(f.id) })
    if (w) watchers.set(f.id, w); else console.warn('[neural-os] watcher not available:', f.name)
  }
  // safety net: the live watcher can miss changes (very big folders, sleep, network drives); a quiet
  // incremental scan every 10 minutes catches up and restarts a stopped watcher
  setInterval(() => {
    for (const f of listFolders(db!)) void job(async () => afterScan(await scanFolder(db!, f.id))).catch(() => undefined).finally(() => startWatch(f))
  }, 10 * 60 * 1000).unref()
  // on start: catch up with changes made while NEURAL OS was closed, then watch
  for (const f of listFolders(db)) {
    void job(async () => afterScan(await scanFolder(db!, f.id))).catch(() => undefined).finally(() => startWatch(f))
  }

  if (setting('assetLinksV') !== ASSET_LINKS_V && listFolders(db).length) relinkAssets()   // first start with these rules
  extract()   // files imported before text extraction existed, or changed while closed
  ipcMain.handle('lib:folders', () => listFolders(db!))
  ipcMain.handle('lib:vaults', () => findVaults({ platform: process.platform, home: homedir(), env: process.env, linked: listFolders(db!).map((f) => f.path) }))
  // link folders (read-only index); exclude patterns per path are set before the first scan
  const linkFolders = (paths: string[], onProgress?: (seen: number) => void, exclude: Record<string, string> = {}) => job(async () => {
    const out = { folders: 0, files: 0, links: 0, projects: {} as Record<string, number>, failed: [] as { path: string; error: string }[] }
    for (const p of paths) {
      try { if (!statSync(p).isDirectory()) { out.failed.push({ path: p, error: 'ENOTDIR' }); continue } } catch (err) { out.failed.push({ path: p, error: (err as NodeJS.ErrnoException).code || 'unreadable' }); continue }
      if (isInsideAny(p, [libDir, data])) { out.failed.push({ path: p, error: 'EINSIDE' }); continue }
      const f = addFolder(db!, p)
      if (typeof exclude[p] === 'string') { setFolderExclude(db!, f.id, exclude[p]); f.exclude = exclude[p] }
      const r = await scanFolder(db!, f.id, { onProgress })
      const o = await afterScan(r)
      out.folders++; out.files += r.total; out.links += o.links
      for (const [k, v] of Object.entries(o.projects)) out.projects[k] = (out.projects[k] || 0) + v
      for (const r2 of db!.prepare("SELECT p.name, COUNT(*) AS c FROM file_asset f JOIN project p ON p.id = f.project_id WHERE f.folder_id = ? GROUP BY p.name").all(f.id) as { name: string; c: number }[]) out.projects[r2.name] = r2.c
      startWatch(f)
    }
    if (out.folders) changed()
    return out
  })
  // test mode: example vault in NEURAL OS's own data folder, editing on (example.ts)
  ipcMain.handle('lib:example', async (_e, lang: unknown) => {
    const r = await job(async () => {
      const x = await exampleVault(db!, data, lang === 'de' ? 'de' : 'en')
      if (x.created && x.scan) { await afterScan(x.scan); const f = listFolders(db!).find((y) => y.id === x.id); if (f) startWatch(f) }
      return x
    })
    changed()
    return { ok: true, created: r.created }
  })
  ipcMain.handle('lib:link', (e, paths: unknown) => linkFolders(strings(paths), (seen) => e.sender.send('lib:progress', { done: seen, total: 0 })))
  // NEURAL_OS_LINK='[{"path":"/x","exclude":"Imports/"}]': link folders at start without the folder picker
  // (used when the user asks Claude to set things up on their computer); already linked folders are only rescanned
  try {
    const want = JSON.parse(process.env['NEURAL_OS_LINK'] || '[]') as { path?: unknown; exclude?: unknown }[]
    const list = (Array.isArray(want) ? want : []).filter((x) => x && typeof x.path === 'string') as { path: string; exclude?: unknown }[]
    if (list.length) void linkFolders(list.map((x) => x.path), undefined, Object.fromEntries(list.filter((x) => typeof x.exclude === 'string').map((x) => [x.path, x.exclude as string])))
      .then((r) => console.log('[neural-os] linked from NEURAL_OS_LINK:', JSON.stringify({ folders: r.folders, files: r.files, links: r.links, failed: r.failed }))).catch(() => undefined)
  } catch { console.log('[neural-os] NEURAL_OS_LINK is not valid JSON, ignored') }
  // link requests while running: JSON files in <app data>/link-requests/ (see requests.ts), no restart needed
  const reqDir = requestDir(data)
  let reqBusy = false, reqAgain = false
  const takeLinkRequests = async (): Promise<void> => {
    if (reqBusy) { reqAgain = true; return }
    reqBusy = true
    try {
      for (const r of takeRequests(reqDir)) {
        if (r.error) { writeResult(reqDir, r.file, { ok: false, error: r.error }); console.log('[neural-os] link request', r.file, 'refused:', r.error); continue }
        const res = await linkFolders(r.items.map((x) => x.path), undefined, Object.fromEntries(r.items.filter((x) => typeof x.exclude === 'string').map((x) => [x.path, x.exclude as string])))
          .catch((e: Error) => ({ folders: 0, files: 0, links: 0, failed: [{ path: '*', error: e.message }] }))
        const out = { ok: !res.failed.length, folders: res.folders, files: res.files, links: res.links, failed: res.failed }
        writeResult(reqDir, r.file, out)
        console.log('[neural-os] link request', r.file + ':', JSON.stringify(out))
      }
    } finally { reqBusy = false; if (reqAgain) { reqAgain = false; void takeLinkRequests() } }
  }
  void takeLinkRequests()
  try {
    let t: NodeJS.Timeout | undefined
    watch(reqDir, () => { clearTimeout(t); t = setTimeout(() => void takeLinkRequests(), 500) }).on('error', () => undefined)
  } catch { /* the 20 s look below still finds requests */ }
  setInterval(() => void takeLinkRequests(), 20_000).unref()
  ipcMain.handle('lib:unlink', (_e, id: unknown) => job(async () => {
    if (typeof id !== 'string') return false
    watchers.get(id)?.close(); watchers.delete(id)
    const ok = removeFolder(db!, id); if (ok) changed(); return ok
  }))

  ipcMain.handle('lib:info', () => ({ libDir, ...stats(db!) }))
  ipcMain.handle('lib:list', () => listFiles(db!))
  ipcMain.handle('lib:plan', (_e, paths: unknown) => planImport(strings(paths), [libDir, data]))
  ipcMain.handle('lib:import', (e, paths: unknown) => job(async () => {
    const r = await importFiles(db!, libDir, strings(paths), { exclude: [data], onProgress: (done, total) => e.sender.send('lib:progress', { done, total }) })
    // sort new files into projects and link them (rules in organize.ts); 'autoLink' = '0' keeps auto links as suggestions
    const o = await organize(db!, libDir, r.imported.map((x) => x.id), { autoLink: autoLink() })
    if (r.imported.length) extract()
    return { ...r, organized: o }
  }))
  ipcMain.handle('lib:links', () => listLinks(db!))
  ipcMain.handle('lib:read', async (_e, id: unknown) => {
    if (typeof id !== 'string') return { kind: 'none', reason: 'missing' }
    const c = await readContent(db!, libDir, id)
    // the editor needs the hash of what it opened (conflict check) and whether it may write
    if (c.kind === 'text' && c.ext !== 'extracted') { const st = editState(db!, libDir, id); return { ...c, hash: textHash(c.text), editable: st.ok, why: st.ok ? null : st.reason } }
    return c
  })
  // note editor (spec 5.6, 5.1): safe saves with conflict check and versions
  const relink = (id: string) => job(async () => {
    const r = db!.prepare('SELECT source FROM file_asset WHERE id = ?').get(id) as { source: string } | undefined
    if (!r) return
    db!.prepare("DELETE FROM knowledge_edge WHERE from_id = ? AND reason = 'wikilink'").run(id)
    await organize(db!, libDir, [id], { autoLink: autoLink(), wikilinksOnly: r.source === 'linked' })
    changed()
  })
  ipcMain.handle('lib:save', async (_e, id: unknown, text: unknown, base: unknown, force: unknown) => {
    if (typeof id !== 'string' || typeof text !== 'string') return { ok: false, reason: 'missing' }
    const r = await job(() => saveNote(db!, libDir, id, text, typeof base === 'string' ? base : null, { force: force === true, reason: force === true ? 'conflict' : 'save' }))
    if (r.ok && !r.unchanged) void relink(id).catch(() => undefined)
    return r
  })
  ipcMain.handle('lib:versions', (_e, id: unknown) => (typeof id === 'string' ? listVersions(db!, id) : []))
  ipcMain.handle('lib:version', (_e, vid: unknown) => (typeof vid === 'string' ? getVersion(db!, vid) : null))
  ipcMain.handle('lib:restore', async (_e, vid: unknown) => {
    if (typeof vid !== 'string') return { ok: false, reason: 'missing' }
    const v = getVersion(db!, vid)
    const r = await job(() => restoreVersion(db!, libDir, vid))
    if (r.ok && v) void relink(v.file_id).catch(() => undefined)
    return r
  })
  ipcMain.handle('lib:create', async (_e, name: unknown, project: unknown) => {
    const r = await job(() => createNote(db!, libDir, { name: typeof name === 'string' ? name : '', project: typeof project === 'string' && project ? project : null }))
    changed()
    return r
  })
  // exclude patterns per linked folder: save, then rescan so excluded files leave the index (files stay untouched)
  ipcMain.handle('lib:setExclude', (_e, folderId: unknown, patterns: unknown) => job(async () => {
    if (typeof folderId !== 'string' || typeof patterns !== 'string' || !setFolderExclude(db!, folderId, patterns)) return { ok: false }
    const r = await scanFolder(db!, folderId)
    await afterScan(r)
    changed()
    return { ok: true, total: r.total, removed: r.removed, added: r.added.length }
  }))
  // "Neu einlesen": a full incremental scan of one linked folder (catches up when the watcher missed changes)
  ipcMain.handle('lib:rescan', (_e, folderId: unknown) => job(async () => {
    if (typeof folderId !== 'string') return { ok: false }
    try { const r = await scanFolder(db!, folderId); await afterScan(r); changed(); return { ok: true, total: r.total, added: r.added.length, changed: r.changed.length, removed: r.removed } } catch { return { ok: false } }
  }))
  ipcMain.handle('lib:health', () => libraryHealth(db!))
  ipcMain.handle('lib:agents', () => agentBoard(db!, libDir))
  ipcMain.handle('lib:fresh', () => fresh(db!))
  ipcMain.handle('lib:setEditable', (_e, folderId: unknown, on: unknown) => {
    const ok = typeof folderId === 'string' && setFolderEditable(db!, folderId, on === true)
    if (ok) changed()
    return ok
  })
  // links (Obsidian-like): unlinked mentions, "link it", rename with link update
  ipcMain.handle('lib:mentions', (_e, id: unknown) => (typeof id === 'string' ? unlinkedMentions(db!, libDir, id) : { mentions: [], scanned: 0, capped: false }))
  ipcMain.handle('lib:linkMention', async (_e, from: unknown, to: unknown) => {
    if (typeof from !== 'string' || typeof to !== 'string') return { ok: false, reason: 'missing' }
    const r = await job(() => linkMention(db!, libDir, from, to))
    if (r.ok) void relink(from).catch(() => undefined)
    return r
  })
  ipcMain.handle('lib:rename', async (_e, id: unknown, name: unknown) => {
    if (typeof id !== 'string' || typeof name !== 'string') return { ok: false, reason: 'missing' }
    const r = await job(() => renameNote(db!, libDir, id, name))
    if (r.ok) { for (const x of new Set([id, ...r.changed])) void relink(x).catch(() => undefined); changed() }
    return r
  })
  // file explorer (fileops.ts): only in linked folders with editing on; trash = <folder>/.trash, can be undone
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  ipcMain.handle('fs:tree', () => dirTree(db!))
  ipcMain.handle('fs:newNote', async (_e, folderId: unknown, dir: unknown, name: unknown) => {
    const r = await job(() => newNote(db!, str(folderId), str(dir), str(name) || 'Untitled'))
    if (r.ok) changed()
    return r
  })
  ipcMain.handle('fs:newFolder', async (_e, folderId: unknown, dir: unknown, name: unknown) => job(() => newFolder(db!, str(folderId), str(dir), str(name) || 'New folder')))
  ipcMain.handle('fs:move', async (_e, folderId: unknown, rel: unknown, toDir: unknown, newName: unknown) => {
    const r = await job(() => movePath(db!, str(folderId), str(rel), str(toDir), typeof newName === 'string' ? newName : undefined))
    if (r.ok) changed()
    return r
  })
  ipcMain.handle('fs:moveFile', async (_e, id: unknown, toDir: unknown, newName: unknown) => {
    const r = await job(() => moveFile(db!, str(id), str(toDir), typeof newName === 'string' ? newName : undefined))
    if (r.ok) changed()
    return r
  })
  ipcMain.handle('fs:trash', async (_e, folderId: unknown, rel: unknown) => {
    const r = await job(() => trashPath(db!, str(folderId), str(rel)))
    if (r.ok) changed()
    return r
  })
  // image pasted or dropped into a note: bytes from the renderer, written next to the note (attach.ts)
  ipcMain.handle('lib:attach', async (_e, id: unknown, name: unknown, data: unknown) => {
    const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null
    if (!bytes || bytes.byteLength > ATTACH_MAX) return { ok: false, reason: 'size' }
    const r = await job(() => saveAttachment(db!, libDir, str(id), str(name), bytes))
    if (r.ok) changed()
    return r
  })
  ipcMain.handle('lib:pdf', async (_e, name: unknown, html: unknown) => {
    if (typeof html !== 'string' || html.length > 60 * 1024 * 1024) return { ok: false, reason: 'failed' }
    return exportPdf(getWin(), str(name), html)
  })
  ipcMain.handle('fs:untrash', async (_e, folderId: unknown, trash: unknown, rel: unknown) => {
    const r = await job(async () => {
      const x = await restoreTrash(db!, str(folderId), str(trash), str(rel))
      if (x.ok) await afterScan(await applyPaths(db!, str(folderId), [str(rel)]))
      return x
    })
    if (r.ok) changed()
    return r
  })
  // daily note: open today's, or create it (library, or an editable vault with its own daily-note settings)
  ipcMain.handle('lib:daily', (_e, lang: unknown) => job(async () => {
    const r = await dailyNote(db!, libDir, { lang: lang === 'en' ? 'en' : 'de' })
    if (r.id === null) {
      const s = await applyPaths(db!, r.folderId, [r.rel])
      await afterScan(s)
      const row = db!.prepare('SELECT id FROM file_asset WHERE folder_id = ? AND rel_path = ?').get(r.folderId, r.rel) as { id: string } | undefined
      return { id: row?.id ?? null, created: true, where: 'vault' }
    }
    if (r.created) changed()
    return r
  }))
  ipcMain.handle('lib:templates', () => templates(db!))
  ipcMain.handle('lib:templateText', (_e, id: unknown, title: unknown, lang: unknown) =>
    (typeof id === 'string' ? templateText(db!, libDir, id, typeof title === 'string' ? title : '', { lang: lang === 'en' ? 'en' : 'de' }) : null))
  // tags and full-text search (read only)
  ipcMain.handle('lib:tags', () => tagIndex(db!, libDir))
  ipcMain.handle('lib:base', (_e, id: unknown) => (typeof id === 'string' ? evalBase(db!, libDir, id) : { ok: false, reason: 'missing' }))
  ipcMain.handle('lib:search', (_e, q: unknown) => (typeof q === 'string' ? fullSearch(db!, libDir, q.slice(0, 300)) : { hits: [], scanned: 0, capped: false, total: 0 }))
  ipcMain.handle('lib:getAutoLink', () => setting('autoLink') !== '0')
  ipcMain.handle('lib:setAutoLink', (_e, on: unknown) => {
    db!.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('autoLink', on ? '1' : '0')
    return !!on
  })
  ipcMain.handle('lib:remove', (_e, id: unknown) => (typeof id === 'string' ? removeFile(db!, libDir, id) : false))
  ipcMain.handle('lib:openFolder', () => shell.openPath(libDir))
  ipcMain.handle('lib:pick', async (_e, folders: unknown) => {
    const win = getWin()
    const props: ('openFile' | 'openDirectory' | 'multiSelections')[] = [folders ? 'openDirectory' : 'openFile', 'multiSelections']
    const r = win ? await dialog.showOpenDialog(win, { properties: props }) : await dialog.showOpenDialog({ properties: props })
    return r.canceled ? [] : r.filePaths
  })

  app.on('will-quit', () => { for (const w of watchers.values()) w.close(); watchers.clear(); db?.close(); db = null })
}

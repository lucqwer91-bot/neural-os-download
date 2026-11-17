import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'

// Roblox code graph (user wish 2026-11-17: specialise NEURAL OS for Roblox games). Reads the Luau scripts of linked
// folders by plain rules, no AI, and links what the code really says:
//   require    script → the module it requires (require(script.Parent.Combat), require(ReplicatedStorage.Shared.Util))
//   remote     script that fires a RemoteEvent/RemoteFunction → script that handles it (same remote name)
//   datastore  scripts that open the same DataStore
// Everything found is also kept in luau_ref, so the MCP tool game_context can tell Claude the remotes, modules and
// DataStores of a game before it writes code. Names come from the code; a remote name that is built at runtime is
// not guessed (only literal names and plain variable chains).

export const LUAU_REASONS = ['require', 'remote', 'datastore'] as const
const MAX_TEXT = 512 * 1024
const GROUP = 20

export type Side = 'server' | 'client' | 'shared' | 'tool'
export interface LuauRef { kind: 'require' | 'remote' | 'datastore' | 'asset' | 'guard' | 'netcall' | 'legacy'; name: string; role: string; line: number; path?: string[] }

const FIRE = /\b(FireServer|FireClient|FireAllClients|InvokeServer|InvokeClient)\b/
const HANDLE = /\b(OnServerEvent|OnClientEvent|OnServerInvoke|OnClientInvoke)\b/
// a chain like Remotes.Damage, ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Damage"), Remotes["Damage"]
const SEG = String.raw`(?:[.:]\w+\(\s*"[^"]+"[^)]*\)|\.\w+|\[\s*"[^"]+"\s*\])`
const CHAIN = String.raw`[A-Za-z_]\w*(?:${SEG})*`
const USE = new RegExp(String.raw`(${CHAIN})\s*[:.]\s*(FireServer|FireClient|FireAllClients|InvokeServer|InvokeClient|OnServerEvent|OnClientEvent|OnServerInvoke|OnClientInvoke)\b`, 'g')
const LOCAL = new RegExp(String.raw`\blocal\s+([A-Za-z_]\w*)\s*(?::\s*[\w.<>]+\s*)?=\s*(${CHAIN})`, 'g')
const REQUIRE = new RegExp(String.raw`\brequire\s*\(\s*(?:(${CHAIN})|"([^"]+)"|'([^']+)')\s*\)`, 'g')
// network wrapper modules (Net.Handle(Remotes.PetEquip, …), Net.Send("Name", …), Bridge:Fire(Remotes.X)):
// the first argument names the remote, either a string or a key of a remotes table (Remotes.X, Events.X, NetNames.X)
const WRAP_HANDLE = 'Handle|Listen|On|OnEvent|OnInvoke|Bind|Connect|SetCallback|Receive|Subscribe'
const WRAP_FIRE = 'Request|Send|Fire|FireServer|FireClient|FireAll|FireAllClients|FireList|Push|Invoke|InvokeServer|Emit|Broadcast|Call'
const WRAP = new RegExp(String.raw`\b[A-Za-z_]\w*\s*[.:]\s*(${WRAP_HANDLE}|${WRAP_FIRE})\s*\(\s*(?:"([^"]+)"|'([^']+)'|\w*(?:Remotes?|Events?|Names|Net|Network|Packets?)\.(\w+))`, 'g')
const IS_HANDLE = new RegExp(`^(${WRAP_HANDLE})$`)
// a local helper around the wrapper (request(Remotes.BuyOven), fire(Remotes.X)): only with a remotes-table key
const BARE = /(?<![\w.:])(request|send|fire|invoke|emit|listen|handle|on)\s*\(\s*\w*(?:Remotes?|Events?|Names|Packets?)\.(\w+)/gi
// the networking module itself (function Net.Handle(name, spec) …): its raw remote calls are the wrapper, not game remotes
const WRAPPER_DEF = new RegExp(String.raw`\bfunction\s+[A-Za-z_]\w*[.:](${WRAP_HANDLE}|${WRAP_FIRE})\s*\(`, 'g')
// what a handler does with the client's arguments, looked at in the next lines after it (rules, not proof):
// argument checks (typeof/type/assert/tonumber/checkArgs/args = {…}/t.* validators) and rate limits (rate = …, cooldown, debounce, os.clock())
const ARGCHECK = /\btypeof\s*\(|\btype\s*\(|\bassert\s*\(|\btonumber\s*\(|checkArgs|\bargs\s*=\s*\{|\bt\.\w+\s*\(|\bvalidate\w*\s*\(|\bIsA\s*\(|math\.clamp|\bisfinite/
const RATE = /\brate\s*=|:Allow\s*\(|limiter|cooldown|debounce|ratelimit|rate_limit|RateLimit|os\.clock\s*\(|tick\s*\(\)|lastRequest|lastFire|\bthrottle/i
export function guardsAfter(text: string, at: number, stop = Infinity, lines = 30): string {
  let end = at; for (let i = 0; i < lines && end >= 0; i++) end = text.indexOf('\n', end + 1)
  const w = text.slice(at, Math.min(end < 0 ? text.length : end, stop))
  return [ARGCHECK.test(w) ? 'args' : '', RATE.test(w) ? 'rate' : ''].filter(Boolean).join(',') || 'none'
}
const DATASTORE = /\b(?:GetDataStore|GetOrderedDataStore)\s*\(\s*["']([^"']+)["']/g
// old global scheduling functions; task.wait/task.spawn/task.delay/task.defer replace them
const LEGACY = /(?<![\w.:])(wait|spawn|delay)\s*\(/g
const ASSET = /rbxassetid:\/\/(\d{3,})/g

/** the segments of a chain: Remotes.Damage → ['Remotes', 'Damage'], x:WaitForChild("A") → ['x', 'A'] */
export function chainSegments(chain: string): string[] {
  const out: string[] = []
  const re = /^[A-Za-z_]\w*|\.(\w+)|"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(chain))) out.push(m[1] ?? m[2] ?? m[0])
  return out
}

/** Server, client or shared, from Rojo file names (x.server.luau, x.client.luau) and Roblox folders. */
export function sideOf(relPath: string): Side {
  const p = relPath.toLowerCase()
  // Studio build scripts, local tools, tests: not game code
  if (/(^|\/)(tools?|tools_local|local_tools|build_scripts|scripts_local|dev_tools|tests?|spec)(\/|$)/.test(p)) return 'tool'
  if (/\.server\.luau?$/.test(p) || /(^|\/)(serverscriptservice|serverstorage|server)(\/|$)/.test(p)) return 'server'
  if (/\.client\.luau?$/.test(p) || /(^|\/)(starterplayer|starterplayerscripts|startercharacterscripts|startergui|client)(\/|$)/.test(p)) return 'client'
  return 'shared'
}

const lineAt = (text: string, i: number) => { let n = 1; for (let k = text.indexOf('\n'); k >= 0 && k < i; k = text.indexOf('\n', k + 1)) n++; return n }
const stripComments = (t: string) => t.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))

export function parseLuau(src: string): LuauRef[] {
  const text = stripComments(src)
  const out: LuauRef[] = []
  // local variables that point at an instance chain: local Damage = Remotes:WaitForChild("Damage")
  const vars = new Map<string, string[]>()
  for (const m of text.matchAll(LOCAL)) {
    const seg = chainSegments(m[2])
    const base = vars.get(seg[0])
    vars.set(m[1], base && seg.length >= 1 ? [...base, ...seg.slice(1)] : seg)
  }
  // a handler's lines end where the next remote use starts
  const starts = [...[...text.matchAll(USE)].map((m) => m.index!), ...[...text.matchAll(WRAP)].map((m) => m.index!)].sort((a, b) => a - b)
  const next = (i: number) => starts.find((s) => s > i) ?? Infinity
  const isWrapper = [...text.matchAll(WRAPPER_DEF)].length >= 2
  const resolve = (chain: string) => { const seg = chainSegments(chain); const base = vars.get(seg[0]); return base ? [...base, ...seg.slice(1)] : seg }
  for (const m of isWrapper ? [] : text.matchAll(USE)) {
    const seg = resolve(m[1])
    const name = seg[seg.length - 1]
    // a lone variable that was never assigned from a chain (a parameter, a table field) has no known name
    if (!name || (seg.length === 1 && !vars.has(m[1]))) continue
    const handle = HANDLE.test(m[2])
    out.push({ kind: 'remote', name, role: handle ? 'handle' : FIRE.test(m[2]) ? 'fire' : '', line: lineAt(text, m.index!) })
    if (handle && /Server/.test(m[2])) out.push({ kind: 'guard', name, role: guardsAfter(text, m.index!, next(m.index!)), line: lineAt(text, m.index!) })
  }
  for (const m of text.matchAll(BARE)) {
    // skip the helper's own definition (local function request(...)) and method calls handled by WRAP
    if (/function\s*$/.test(text.slice(Math.max(0, m.index! - 20), m.index!))) continue
    const handle = /^(listen|handle|on)$/i.test(m[1])
    out.push({ kind: 'netcall', name: `${m[1]}()`, role: '', line: lineAt(text, m.index!) })
    out.push({ kind: 'remote', name: m[2], role: handle ? 'handle' : 'fire', line: lineAt(text, m.index!) })
  }
  for (const m of isWrapper ? [] : text.matchAll(WRAP)) {
    const name = m[2] ?? m[3] ?? m[4]
    if (!name) continue
    const obj = /^\s*([A-Za-z_]\w*)/.exec(m[0])![1]
    out.push({ kind: 'netcall', name: `${obj}.${m[1]}`, role: '', line: lineAt(text, m.index!) })
    const handle = IS_HANDLE.test(m[1])
    out.push({ kind: 'remote', name, role: handle ? 'handle' : 'fire', line: lineAt(text, m.index!) })
    // a wrapper handler on the server side (Net.Handle/Listen); client-side On(...) has nothing to guard
    if (handle && m[1] !== 'On') out.push({ kind: 'guard', name, role: guardsAfter(text, m.index!, next(m.index!)), line: lineAt(text, m.index!) })
  }
  for (const m of text.matchAll(REQUIRE)) {
    if (m[1]) {
      const seg = resolve(m[1])
      const name = seg[seg.length - 1]
      if (name && name !== 'script' && name !== 'Parent') out.push({ kind: 'require', name, role: '', line: lineAt(text, m.index!), path: seg })
    } else {
      const s = (m[2] ?? m[3]).replace(/\\/g, '/')
      const name = s.split('/').filter(Boolean).pop()?.replace(/\.luau?$/, '')
      if (name && name !== '.' && name !== '..') out.push({ kind: 'require', name: name.replace(/^@/, ''), role: '', line: lineAt(text, m.index!), path: s.split('/') })
    }
  }
  for (const m of text.matchAll(DATASTORE)) out.push({ kind: 'datastore', name: m[1], role: '', line: lineAt(text, m.index!) })
  for (const m of text.matchAll(LEGACY)) out.push({ kind: 'legacy', name: m[1], role: '', line: lineAt(text, m.index!) })
  for (const m of text.matchAll(/\btask\.(wait|spawn|delay|defer)\s*\(/g)) out.push({ kind: 'legacy', name: 'task.' + m[1], role: 'modern', line: lineAt(text, m.index!) })
  const seen = new Set<string>()
  for (const m of text.matchAll(ASSET)) { if (seen.has(m[1])) continue; seen.add(m[1]); out.push({ kind: 'asset', name: m[1], role: '', line: lineAt(text, m.index!) }) }
  return out
}

interface F { id: string; name: string; rel_path: string; folder_id: string; folder_path: string }
export interface LuauResult { scripts: number; refs: number; links: number; byReason: Record<string, number>; ms: number }

// old copies of code (_backups/audit3_pre/UI.luau, ShopController_pre_audit1.luau, old/, archive/) stay in the brain
// but are not read as code: they would point modules at stale copies and inflate every count
const BACKUP_DIR = /^(_*backups?|_*backup[ _-].*|.*[ _-]pre|.*[ _-]pre[ _-].*|_*old|_*archive[sd]?|_*deprecated|_*trash|_to_delete)$/i
export function isBackupPath(rel: string): boolean {
  const seg = rel.split('/'), name = seg.pop() || ''
  return seg.some((s) => BACKUP_DIR.test(s)) || /[ _-](pre|backup|bak|old|copy)([ _-][^.]*)?\.luau?$/i.test(name) || /\.bak\.luau?$|\.luau?\.bak$/i.test(name)
}

const stemOf = (name: string) => name.replace(/\.(server|client)?\.?luau?$/i, '').replace(/\.(server|client)$/i, '').toLowerCase()
const dirOf = (rel: string) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i) }
const common = (a: string, b: string) => { const x = a.split('/'), y = b.split('/'); let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i }

export async function luauGraph(db: Db, opts: { autoLink?: boolean; now?: () => Date; readText?: (f: F) => Promise<string | null> } = {}): Promise<LuauResult> {
  const t0 = Date.now()
  const status = opts.autoLink === false ? 'suggested' : 'linked'
  const now = (opts.now || (() => new Date()))().toISOString()
  const files = (db.prepare(`SELECT f.id, f.name, f.rel_path, f.folder_id, lf.path AS folder_path FROM file_asset f JOIN linked_folder lf ON lf.id = f.folder_id
    WHERE f.source = 'linked' AND f.rel_path IS NOT NULL AND f.ext IN ('luau', 'lua') ORDER BY f.folder_id, f.rel_path`).all() as unknown as F[])
    .filter((f) => !isBackupPath(f.rel_path))
  // modules by name per linked folder; Rojo: a folder with init.luau is the module named like the folder
  const mods = new Map<string, F[]>()
  for (const f of files) {
    let s = stemOf(f.name)
    if (s === 'init') { const d = dirOf(f.rel_path); s = d.slice(d.lastIndexOf('/') + 1).toLowerCase() }
    const k = f.folder_id + ':' + s; const l = mods.get(k); if (l) l.push(f); else mods.set(k, [f])
  }
  const read = opts.readText || (async (f: F) => { try { const b = await readFile(join(f.folder_path, ...f.rel_path.split('/'))); return b.length <= MAX_TEXT ? b.toString('utf8') : null } catch { return null } })
  const refs: [string, LuauRef, Side][] = []
  let n = 0
  for (const f of files) {
    if (++n % 100 === 0) await new Promise<void>((r) => setImmediate(r))
    const t = await read(f); if (!t) continue
    const side = sideOf(f.rel_path)
    for (const r of parseLuau(t)) {
      if (r.kind === 'require') {
        const c = mods.get(f.folder_id + ':' + r.name.toLowerCase())?.filter((x) => x.id !== f.id) || []
        // several modules with that name: the one nearest in the folder tree
        const best = c.sort((a, b) => common(dirOf(b.rel_path), dirOf(f.rel_path)) - common(dirOf(a.rel_path), dirOf(f.rel_path)))[0]
        r.role = best ? best.id : ''
      }
      refs.push([f.id, r, side])
    }
  }
  const edges: [string, string, string][] = []
  const add = (a: string, b: string, why: string) => { if (a && b && a !== b) edges.push([a, b, why]) }
  for (const [id, r] of refs) if (r.kind === 'require' && r.role) add(id, r.role, 'require')
  // remotes and DataStores are matched within one linked folder (one game)
  const folderOf = new Map(files.map((f) => [f.id, f.folder_id]))
  const by = (kind: string) => {
    const m = new Map<string, { fire: Set<string>; handle: Set<string>; all: Set<string> }>()
    for (const [id, r] of refs) if (r.kind === kind) {
      const k = folderOf.get(id) + ':' + r.name
      const e = m.get(k) || { fire: new Set<string>(), handle: new Set<string>(), all: new Set<string>() }
      if (r.role === 'fire') e.fire.add(id); if (r.role === 'handle') e.handle.add(id); e.all.add(id); m.set(k, e)
    }
    return m
  }
  for (const e of by('remote').values()) {
    const F = [...e.fire].slice(0, GROUP), H = [...e.handle].slice(0, GROUP)
    for (const a of F) for (const b of H) add(a, b, 'remote')
  }
  for (const e of by('datastore').values()) { const l = [...e.all].slice(0, GROUP); for (const b of l.slice(1)) add(l[0], b, 'datastore') }

  const res: LuauResult = { scripts: files.length, refs: refs.length, links: 0, byReason: {}, ms: 0 }
  const ins = db.prepare('INSERT OR IGNORE INTO knowledge_edge (from_id, to_id, origin, reason, status, created_at) VALUES (?, ?, \'auto\', ?, ?, ?)')
  const ref = db.prepare('INSERT INTO luau_ref (file_id, kind, name, role, side, line) VALUES (?, ?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  try {
    db.exec("DELETE FROM luau_ref WHERE file_id IN (SELECT id FROM file_asset WHERE source = 'linked')")
    db.prepare(`DELETE FROM knowledge_edge WHERE origin = 'auto' AND reason IN (${LUAU_REASONS.map(() => '?').join(',')}) AND from_id IN (SELECT id FROM file_asset WHERE source = 'linked')`).run(...LUAU_REASONS)
    for (const [id, r, side] of refs) ref.run(id, r.kind, r.name.slice(0, 200), r.role, side, r.line)
    for (const [a, b, r] of edges) if (ins.run(a, b, r, status, now).changes) { res.links++; res.byReason[r] = (res.byReason[r] || 0) + 1 }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.ms = Date.now() - t0
  return res
}

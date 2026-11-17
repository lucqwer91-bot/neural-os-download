import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

// MCP tool game_context: what the Luau code of a Roblox game uses, from the code graph (library/luau.ts).
// Facts read from the scripts by rules, no AI; every line names its files. Read-only.

type Db = DatabaseSync
interface Ref { file_id: string; kind: string; name: string; role: string; side: string; line: number; rel_path: string; folder: string; fname: string }
export interface GameContext { text: string; ids: string[]; games: string[] }

const MAX = 12_000

/** Games = linked folders with Luau scripts. `game` matches the folder name or a project name (case-insensitive part). */
export function gameContext(db: Db, opts: { game?: string; query?: string } = {}): GameContext {
  const all = db.prepare(`SELECT r.file_id, r.kind, r.name, r.role, r.side, r.line, f.rel_path, lf.path AS folder, f.name AS fname
    FROM luau_ref r JOIN file_asset f ON f.id = r.file_id JOIN linked_folder lf ON lf.id = f.folder_id LEFT JOIN project p ON p.id = f.project_id
    WHERE (? IS NULL OR lower(lf.path) LIKE ? OR lower(coalesce(p.name, '')) LIKE ?)`).all(
    opts.game ? 1 : null, `%${(opts.game || '').toLowerCase()}%`, `%${(opts.game || '').toLowerCase()}%`) as unknown as Ref[]
  const games = [...new Set(all.map((r) => r.folder))]
  if (!all.length) return { text: '', ids: [], games }
  const q = (opts.query || '').toLowerCase()
  const refs = q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.rel_path.toLowerCase().includes(q)) : all
  const ids = new Set<string>()
  const where = (r: Ref) => { ids.add(r.file_id); return `${r.rel_path}:${r.line}` }
  const out: string[] = []
  const head = (s: string) => out.push('', `## ${s}`)
  out.push(`# Game code of ${games.map((g) => g.split(/[\\/]/).pop()).join(', ')}`, `Scripts with references: ${new Set(all.map((r) => r.file_id)).size}. Read from the Luau code by NEURAL OS rules (no AI).`)

  out.push(...houseRules(db, all))
  const remotes = new Map<string, { fire: Ref[]; handle: Ref[] }>()
  for (const r of refs) if (r.kind === 'remote') { const e = remotes.get(r.name) || { fire: [], handle: [] }; (r.role === 'handle' ? e.handle : e.fire).push(r); remotes.set(r.name, e) }
  if (remotes.size) {
    head(`Remotes (${remotes.size})`)
    for (const [name, e] of [...remotes].sort((a, b) => a[0].localeCompare(b[0]))) {
      const note = !e.handle.length ? ' (no handler found in the code)' : !e.fire.length ? ' (never fired in the code)' : ''
      const sides = (l: Ref[]) => [...new Set(l.map((r) => r.side))].join('/')
      out.push(`- ${name}${note}: fired ${e.fire.length ? `[${sides(e.fire)}] in ${e.fire.slice(0, 4).map(where).join(', ')}` : '—'}; handled ${e.handle.length ? `[${sides(e.handle)}] in ${e.handle.slice(0, 4).map(where).join(', ')}` : '—'}`)
    }
  }
  // server handlers: what the next lines do with the client's arguments (rules; "not seen" is not proof of a bug)
  const guards = refs.filter((r) => r.kind === 'guard' && r.side !== 'client')
  const weak = guards.filter((r) => r.role !== 'args,rate')
  if (guards.length) {
    head(`Server handlers: argument check and rate limit (${guards.length - weak.length} of ${guards.length} show both)`)
    if (!weak.length) out.push('- every server handler shows an argument check and a rate limit')
    for (const r of weak.slice(0, 40)) out.push(`- ${r.name} at ${where(r)}: ${r.role === 'none' ? 'no argument check and no rate limit seen' : r.role === 'args' ? 'no rate limit seen' : 'no argument check seen'}`)
    if (weak.length > 40) out.push(`- … +${weak.length - 40}`)
  }
  const mods = new Map<string, { n: number; target: string; users: Ref[] }>()
  for (const r of refs) if (r.kind === 'require') { const e = mods.get(r.name) || { n: 0, target: r.role, users: [] }; e.n++; e.users.push(r); mods.set(r.name, e) }
  if (mods.size) {
    head(`Modules, most required first (${mods.size})`)
    const path = (id: string) => (db.prepare('SELECT rel_path FROM file_asset WHERE id = ?').get(id) as { rel_path?: string } | undefined)?.rel_path
    for (const [name, e] of [...mods].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
      const p = e.target ? path(e.target) : undefined
      if (e.target) ids.add(e.target)
      out.push(`- ${name}: required ${e.n}× ${p ? `→ ${p}` : '(module file not found in the folder: a package or built at runtime)'}; e.g. ${e.users.slice(0, 2).map(where).join(', ')}`)
    }
  }
  const ds = new Map<string, Ref[]>()
  for (const r of refs) if (r.kind === 'datastore') { const l = ds.get(r.name) || []; l.push(r); ds.set(r.name, l) }
  if (ds.size) { head(`DataStores (${ds.size})`); for (const [name, l] of ds) out.push(`- "${name}": ${l.slice(0, 5).map(where).join(', ')}`) }
  const assets = refs.filter((r) => r.kind === 'asset')
  if (assets.length) {
    const byId = new Map<string, Ref[]>(); for (const r of assets) { const l = byId.get(r.name) || []; l.push(r); byId.set(r.name, l) }
    head(`Asset ids in code (${byId.size})`)
    for (const [id, l] of [...byId].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) out.push(`- rbxassetid://${id}: ${l.slice(0, 3).map(where).join(', ')}${l.length > 3 ? ` +${l.length - 3}` : ''}`)
  }
  let text = out.join('\n')
  if (text.length > MAX) text = text.slice(0, MAX) + '\n… (cut; ask with a query to narrow it)'
  return { text, ids: [...ids].slice(0, 60), games: games.map((g) => join(g)) }
}

/** MCP tool who_uses: every script that requires a module, fires or handles a remote, or opens a DataStore of that name. */
export function whoUses(db: Db, name: string, opts: { game?: string } = {}): GameContext {
  const g = `%${(opts.game || '').toLowerCase()}%`
  const target = db.prepare(`SELECT f.id, f.rel_path FROM file_asset f JOIN linked_folder lf ON lf.id = f.folder_id
    WHERE f.ext IN ('lua', 'luau') AND lower(f.name) IN (?, ?, ?, ?) AND (? IS NULL OR lower(lf.path) LIKE ?)`).all(
    `${name.toLowerCase()}.luau`, `${name.toLowerCase()}.lua`, `${name.toLowerCase()}.server.luau`, `${name.toLowerCase()}.client.luau`, opts.game ? 1 : null, g) as { id: string; rel_path: string }[]
  const refs = db.prepare(`SELECT r.file_id, r.kind, r.name, r.role, r.side, r.line, f.rel_path, lf.path AS folder, f.name AS fname
    FROM luau_ref r JOIN file_asset f ON f.id = r.file_id JOIN linked_folder lf ON lf.id = f.folder_id
    WHERE r.kind IN ('require', 'remote', 'datastore') AND (lower(r.name) = lower(?) OR r.role IN (${target.map(() => '?').join(',') || "'-none-'"})) AND (? IS NULL OR lower(lf.path) LIKE ?)
    ORDER BY r.kind, f.rel_path, r.line`).all(name, ...target.map((t) => t.id), opts.game ? 1 : null, g) as unknown as Ref[]
  const games = [...new Set(refs.map((r) => r.folder))]
  if (!refs.length && !target.length) return { text: '', ids: [], games }
  const ids = new Set<string>(target.map((t) => t.id))
  const out = [`# Who uses "${name}"`]
  if (target.length) out.push(`Module file: ${target.map((t) => t.rel_path).join(', ')}`)
  const groups: [string, (r: Ref) => boolean][] = [
    ['Required by', (r) => r.kind === 'require'], ['Fires the remote', (r) => r.kind === 'remote' && r.role === 'fire'],
    ['Handles the remote', (r) => r.kind === 'remote' && r.role === 'handle'], ['Opens the DataStore', (r) => r.kind === 'datastore']]
  for (const [title, ok] of groups) {
    const l = refs.filter(ok); if (!l.length) continue
    out.push('', `## ${title} (${l.length})`)
    for (const r of l.slice(0, 60)) { ids.add(r.file_id); out.push(`- ${r.rel_path}:${r.line} [${r.side}]`) }
    if (l.length > 60) out.push(`- … +${l.length - 60}`)
  }
  if (games.length > 1) out.push('', `In ${games.length} linked folders: ${games.map((x) => x.split(/[\\/]/).pop()).join(', ')}`)
  return { text: out.join('\n').slice(0, MAX), ids: [...ids].slice(0, 60), games }
}

/** "House rules": how this game's code is built, counted from the code, so new code can follow the same patterns. */
function houseRules(db: Db, refs: Ref[]): string[] {
  const out = ['', '## House rules (counted from the code; follow them in new code)']
  const calls = new Map<string, number>()
  for (const r of refs) if (r.kind === 'netcall') calls.set(r.name, (calls.get(r.name) || 0) + 1)
  const raw = refs.filter((r) => r.kind === 'remote').length - [...calls.values()].reduce((a, b) => a + b, 0)
  if (calls.size) {
    const top = [...calls].sort((a, b) => b[1] - a[1])
    const mod = top[0][0].split('.')[0]
    out.push(`- Networking goes through the ${mod} module: ${top.slice(0, 8).map(([n, c]) => `${n} ${c}×`).join(', ')}.${raw > 0 ? ` Direct RemoteEvent calls: ${raw}.` : ' No direct RemoteEvent calls.'} Add new remotes the same way.`)
    const rem = refs.find((r) => r.kind === 'require' && /^(remotes|remotenames|events|netnames)$/i.test(r.name))
    if (rem) out.push(`- Remote names come from the ${rem.name} module; add new names there.`)
  }
  // where scripts of each kind live (most common folders)
  const files = db.prepare(`SELECT DISTINCT f.id, f.rel_path FROM file_asset f WHERE f.id IN (${[...new Set(refs.map((r) => r.file_id))].map(() => '?').join(',') || "'-'"})`).all(...new Set(refs.map((r) => r.file_id))) as { id: string; rel_path: string }[]
  const side = new Map(refs.map((r) => [r.file_id, r.side]))
  for (const s of ['server', 'client', 'shared']) {
    const dirs = new Map<string, number>()
    for (const f of files) if (side.get(f.id) === s) { const d = f.rel_path.includes('/') ? f.rel_path.slice(0, f.rel_path.lastIndexOf('/')) : '.'; dirs.set(d, (dirs.get(d) || 0) + 1) }
    const top = [...dirs].sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (top.length) out.push(`- ${s} scripts mostly in: ${top.map(([d, c]) => `${d} (${c})`).join(', ')}`)
  }
  const suffix = new Map<string, number>()
  for (const f of files) { const m = /(Service|Controller|Config|Util|Utils|Handler|Manager|Module|Client|Server)\.(?:server\.|client\.)?luau?$/.exec(f.rel_path); if (m) suffix.set(m[1], (suffix.get(m[1]) || 0) + 1) }
  const suf = [...suffix].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1])
  if (suf.length) out.push(`- Naming: ${suf.map(([n, c]) => `*${n} ${c}×`).join(', ')}`)
  const legacy = refs.filter((r) => r.kind === 'legacy' && r.role !== 'modern'), modern = refs.filter((r) => r.kind === 'legacy' && r.role === 'modern')
  if (legacy.length || modern.length) {
    const c = (n: string) => legacy.filter((r) => r.name === n).length
    out.push(`- Scheduling: task.* ${modern.length}×, old wait() ${c('wait')}×, spawn() ${c('spawn')}×, delay() ${c('delay')}×. Use task.wait/task.spawn/task.delay in new code${legacy.length ? '; the old calls are deprecated' : ''}.`)
  }
  return out.length > 2 ? out : []
}

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { FORWARDER_SOURCE } from './forwarder'

// Hook installer (spec 3.4, 6.7): user-level ~/.claude/settings.json, verified in
// docs/hooks-verified.md. NEURAL OS only adds and removes its own hook entries, which
// it recognises by the forwarder file name; everything else in the file stays as it is.
// Every change is shown first, backed up, and can be removed in one click.

export const SCRIPT_NAME = 'neural-os-forward.cjs'
export const EDIT_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit'
// events NEURAL OS listens to (names from the official hooks reference, 2026-11-17)
export const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'PostModelSwitch'] as const

type Json = Record<string, unknown>
interface Handler { type?: unknown; command?: unknown; args?: unknown; [k: string]: unknown }
interface Group { matcher?: unknown; hooks?: unknown; [k: string]: unknown }

export const settingsPath = (home: string) => join(home, '.claude', 'settings.json')

const isOurs = (h: Handler) => Array.isArray(h.args) && typeof h.args[0] === 'string' && basename(h.args[0] as string) === SCRIPT_NAME

/** Removes NEURAL OS hook entries; leaves the user's own hooks untouched. */
export function withoutOurs(settings: Json): Json {
  const out: Json = { ...settings }
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return out
  const nh: Json = {}
  for (const [ev, groups] of Object.entries(hooks as Json)) {
    if (!Array.isArray(groups)) { nh[ev] = groups; continue }
    const ng = (groups as Group[]).map((g) => {
      if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) return g
      const keep = (g.hooks as Handler[]).filter((h) => !(h && typeof h === 'object' && isOurs(h)))
      return keep.length === (g.hooks as Handler[]).length ? g : keep.length ? { ...g, hooks: keep } : null
    }).filter((g) => g !== null)
    if (ng.length) nh[ev] = ng
  }
  if (Object.keys(nh).length) out.hooks = nh
  else delete out.hooks
  return out
}

/** Adds NEURAL OS hook entries (after removing old ones). */
export function withOurs(settings: Json, script: string, endpoint: string, node = 'node'): Json {
  const base = withoutOurs(settings)
  const hooks: Json = base.hooks && typeof base.hooks === 'object' ? { ...(base.hooks as Json) } : {}
  const handler = (extra: Json = {}, mode?: string): Handler => ({
    type: 'command', command: node, args: mode ? [script, endpoint, mode] : [script, endpoint], ...extra
  })
  for (const ev of HOOK_EVENTS) {
    const list = Array.isArray(hooks[ev]) ? [...(hooks[ev] as Group[])] : []
    // Stop runs synchronously (short timeout): with `claude -p` the process can exit before an async
    // Stop hook finishes, and Stop carries the SESSION-NOTE and LESSON lines (Mac test 2026-11-17)
    list.push({ hooks: [handler(ev === 'Stop' ? { timeout: 5 } : { async: true })] })
    // reads the file before an edit; Claude waits for this one, so it gets a short timeout
    if (ev === 'PreToolUse') list.push({ matcher: EDIT_MATCHER, hooks: [handler({ timeout: 5 }, 'snap')] })
    hooks[ev] = list
  }
  return { ...base, hooks }
}

export function isInstalled(settings: Json): boolean {
  return JSON.stringify(withoutOurs(settings)) !== JSON.stringify(settings)
}

export interface Plan { path: string; exists: boolean; before: string; after: string; error?: string }

function readSettings(path: string): { json: Json; text: string; exists: boolean; error?: string } {
  if (!existsSync(path)) return { json: {}, text: '', exists: false }
  const text = readFileSync(path, 'utf8')
  try {
    const j = text.trim() ? JSON.parse(text) : {}
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { json: {}, text, exists: true, error: 'notObject' }
    return { json: j as Json, text, exists: true }
  } catch { return { json: {}, text, exists: true, error: 'invalidJson' } }
}

const show = (j: Json) => JSON.stringify(j, null, 2) + '\n'

/** What installing or removing would change. Nothing is written. */
export function plan(home: string, script: string, endpoint: string, remove: boolean, node = 'node'): Plan {
  const path = settingsPath(home)
  const r = readSettings(path)
  if (r.error) return { path, exists: r.exists, before: r.text, after: r.text, error: r.error }
  const after = remove ? withoutOurs(r.json) : withOurs(r.json, script, endpoint, node)
  return { path, exists: r.exists, before: r.exists ? show(r.json) : '', after: show(after) }
}

export interface ApplyResult { ok: boolean; path: string; backup: string | null; error?: string }

/** Applies the change: backup first, then write. Never writes a file it cannot parse. */
export function apply(home: string, script: string, endpoint: string, backupDir: string, remove: boolean, now: Date, node = 'node'): ApplyResult {
  const path = settingsPath(home)
  const r = readSettings(path)
  if (r.error) return { ok: false, path, backup: null, error: r.error }
  let backup: string | null = null
  if (r.exists) {
    mkdirSync(backupDir, { recursive: true })
    backup = join(backupDir, `settings-${now.toISOString().replace(/[:.]/g, '-')}.json`)
    copyFileSync(path, backup)
  }
  if (!remove) {
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, FORWARDER_SOURCE)
  }
  const next = remove ? withoutOurs(r.json) : withOurs(r.json, script, endpoint, node)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, show(next))
  return { ok: true, path, backup }
}

/** The node command and script our installed entries use (to spot an outdated setup). */
export function installedCommand(settings: Json): { command: string; script: string } | null {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return null
  for (const groups of Object.values(hooks as Json)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups as Group[]) for (const h of (Array.isArray(g?.hooks) ? g.hooks : []) as Handler[]) {
      if (h && isOurs(h) && typeof h.command === 'string') return { command: h.command, script: (h.args as string[])[0] }
    }
  }
  return null
}

/** Our entries per event, to see whether an installed setup still matches the current layout. */
export function ourLayout(settings: Json): string {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return ''
  const out: string[] = []
  for (const [ev, groups] of Object.entries(hooks as Json)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups as Group[]) for (const h of (Array.isArray(g?.hooks) ? g.hooks : []) as Handler[]) {
      if (h && isOurs(h)) out.push(JSON.stringify([ev, g.matcher ?? null, { ...h, command: null, args: (h.args as string[]).slice(2) }]))
    }
  }
  return out.sort().join('\n')
}
/** True when our installed entries differ from what "connect" would write now (other events, sync/async, timeouts). */
export function layoutOutdated(settings: Json, script: string, endpoint: string): boolean {
  const now = ourLayout(settings)
  return !!now && now !== ourLayout(withOurs(settings, script, endpoint))
}

export function status(home: string): { installed: boolean; path: string; error?: string; command: string | null; script: string | null; json: Json | null } {
  const path = settingsPath(home)
  const r = readSettings(path)
  const c = r.error ? null : installedCommand(r.json)
  return { installed: !r.error && isInstalled(r.json), path, error: r.error, command: c?.command ?? null, script: c?.script ?? null, json: r.error ? null : r.json }
}

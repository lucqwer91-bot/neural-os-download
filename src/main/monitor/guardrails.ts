import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../library/db'

// Claude Code's guardrails, shown read-only (idea from the user's vault: "permissions deny/ask, hooks, gates").
// NEURAL OS never writes these files here. Keys and file locations as documented in
// https://code.claude.com/docs/en/settings and /permissions (checked 2026-11-17):
//   permissions.allow / ask / deny (rules, evaluated deny → ask → allow), defaultMode, additionalDirectories
//   files: managed policy > .claude/settings.local.json > .claude/settings.json > ~/.claude/settings.json

export interface GuardFile {
  scope: 'managed' | 'user' | 'project' | 'local'
  path: string
  found: boolean
  error: string | null
  defaultMode: string | null
  allow: string[]; ask: string[]; deny: string[]
  dirs: string[]
  hooks: { event: string; commands: number; ours: number }[]
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 300) : [])

export function managedPath(platform: string = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json'
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
  return '/etc/claude-code/managed-settings.json'
}

export function readGuardFile(path: string, scope: GuardFile['scope'], ourScript = 'neural-os-forward'): GuardFile {
  const g: GuardFile = { scope, path, found: false, error: null, defaultMode: null, allow: [], ask: [], deny: [], dirs: [], hooks: [] }
  let raw: string
  try { raw = readFileSync(path, 'utf8') } catch { return g }
  g.found = true
  let j: Record<string, unknown>
  try { j = JSON.parse(raw) as Record<string, unknown> } catch { g.error = 'json'; return g }
  const p = (j.permissions && typeof j.permissions === 'object' ? j.permissions : {}) as Record<string, unknown>
  g.allow = strs(p.allow); g.ask = strs(p.ask); g.deny = strs(p.deny); g.dirs = strs(p.additionalDirectories)
  g.defaultMode = typeof p.defaultMode === 'string' ? p.defaultMode : null
  const hooks = (j.hooks && typeof j.hooks === 'object' ? j.hooks : {}) as Record<string, unknown>
  for (const [event, groups] of Object.entries(hooks)) {
    let commands = 0, ours = 0
    for (const gr of Array.isArray(groups) ? groups : []) for (const h of (gr && Array.isArray((gr as { hooks?: unknown }).hooks) ? (gr as { hooks: unknown[] }).hooks : [])) {
      commands++
      const s = JSON.stringify(h)
      if (s.includes(ourScript)) ours++
    }
    g.hooks.push({ event, commands, ours })
  }
  return g
}

/** User and managed settings, plus project settings of the folders Claude worked in recently (from the monitor). */
export function guardrails(db: Db, home: string, opts: { platform?: string; maxProjects?: number } = {}): { files: GuardFile[] } {
  const files: GuardFile[] = [readGuardFile(managedPath(opts.platform), 'managed'), readGuardFile(join(home, '.claude', 'settings.json'), 'user')]
  const cwds = (db.prepare(`SELECT cwd, MAX(last_at) AS l FROM claude_session WHERE cwd IS NOT NULL AND cwd != '' GROUP BY cwd ORDER BY l DESC LIMIT ?`).all(opts.maxProjects ?? 8) as { cwd: string }[]).map((r) => r.cwd)
  for (const c of cwds) {
    if (c === home) continue
    files.push(readGuardFile(join(c, '.claude', 'settings.json'), 'project'), readGuardFile(join(c, '.claude', 'settings.local.json'), 'local'))
  }
  return { files: files.filter((f) => f.found || f.scope === 'user') }
}

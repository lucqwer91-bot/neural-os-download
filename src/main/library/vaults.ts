import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

// Setup guide → "Meine Notizen im Gehirn": the Obsidian vaults this computer knows, read from Obsidian's own
// list (obsidian.json, key "vaults" → { id: { path } }). Read-only; linking happens only when the user clicks.

/** where Obsidian keeps obsidian.json on each platform */
export function obsidianConfig(platform: string, home: string, env: Record<string, string | undefined>): string | null {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  if (platform === 'win32') return env['APPDATA'] ? join(env['APPDATA'], 'obsidian', 'obsidian.json') : null
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'obsidian', 'obsidian.json')
}

export interface FoundVault { path: string; name: string; linked: boolean }

/** vaults from obsidian.json that still exist; linked = already a linked folder (or inside one) */
export function findVaults(o: { platform: string; home: string; env: Record<string, string | undefined>; linked: string[]; read?: (p: string) => string; exists?: (p: string) => boolean }): FoundVault[] {
  const read = o.read ?? ((p: string) => readFileSync(p, 'utf8'))
  const exists = o.exists ?? existsSync
  const cfg = obsidianConfig(o.platform, o.home, o.env)
  if (!cfg) return []
  let j: { vaults?: Record<string, { path?: unknown }> }
  try { j = JSON.parse(read(cfg)) } catch { return [] }
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase()
  const linked = o.linked.map(norm)
  const seen = new Set<string>(), out: FoundVault[] = []
  for (const v of Object.values(j.vaults || {})) {
    if (!v || typeof v.path !== 'string' || !v.path) continue
    const k = norm(v.path)
    if (seen.has(k)) continue
    seen.add(k)
    try { if (!exists(v.path)) continue } catch { continue }
    out.push({ path: v.path, name: basename(v.path), linked: linked.some((l) => k === l || k.startsWith(l + '/') || k.startsWith(l + '\\')) })
  }
  return out.sort((a, b) => Number(a.linked) - Number(b.linked) || a.name.localeCompare(b.name))
}

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { McpEntry } from './mcpServers'

// Setup guide → "Connectoren für deine Programme": which known programs are installed on this computer,
// and whether Claude Code already has an MCP server for each. Only existence checks of fixed install
// places; nothing is read, started or sent. Paths are never returned, only found / not found.

export interface KnownApp {
  id: string
  /** install places per platform; `~` = home, `%NAME%` = environment variable */
  places: { darwin?: string[]; win32?: string[]; linux?: string[] }
  /** an MCP server with a matching name or program counts as connected */
  match: RegExp
  /** the official or best known MCP server page, only where we are sure of it */
  link: string | null
}

export const KNOWN_APPS: KnownApp[] = [
  { id: 'roblox', places: { darwin: ['/Applications/RobloxStudio.app', '~/Applications/RobloxStudio.app'], win32: ['%LOCALAPPDATA%/Roblox/Versions'] }, match: /roblox/i, link: 'https://github.com/Roblox/studio-rust-mcp-server' },
  { id: 'github', places: { darwin: ['/Applications/GitHub Desktop.app', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'], win32: ['%LOCALAPPDATA%/GitHubDesktop', '%ProgramFiles%/GitHub CLI'], linux: ['/usr/bin/gh', '/usr/local/bin/gh'] }, match: /github/i, link: 'https://github.com/github/github-mcp-server' },
  { id: 'blender', places: { darwin: ['/Applications/Blender.app'], win32: ['%ProgramFiles%/Blender Foundation'], linux: ['/usr/bin/blender', '/snap/bin/blender'] }, match: /blender/i, link: 'https://github.com/ahujasid/blender-mcp' },
  { id: 'obs', places: { darwin: ['/Applications/OBS.app'], win32: ['%ProgramFiles%/obs-studio'], linux: ['/usr/bin/obs'] }, match: /\bobs\b|obs[-_]/i, link: null },
  { id: 'figma', places: { darwin: ['/Applications/Figma.app'], win32: ['%LOCALAPPDATA%/Figma'] }, match: /figma/i, link: null },
  { id: 'obsidian', places: { darwin: ['/Applications/Obsidian.app'], win32: ['%LOCALAPPDATA%/Programs/obsidian', '%LOCALAPPDATA%/Obsidian'], linux: ['/usr/bin/obsidian', '/snap/bin/obsidian'] }, match: /obsidian/i, link: null }
]

export interface AppFound { id: string; found: boolean; connected: boolean; link: string | null; server: string | null }

/** expand ~ and %VAR%; a place with an unknown variable is skipped (returns null) */
export function expandPlace(p: string, home: string, env: Record<string, string | undefined>): string | null {
  let miss = false
  let s = p.replace(/%([A-Za-z_]+)%/g, (_m, k: string) => {
    const v = env[k] ?? env[k.toUpperCase()]
    if (!v) miss = true
    return v ?? ''
  })
  if (miss) return null
  if (s.startsWith('~')) s = join(home, s.slice(1))
  return s
}

export function scanApps(o: { platform: string; home: string; env: Record<string, string | undefined>; servers: Pick<McpEntry, 'name' | 'target'>[]; exists?: (p: string) => boolean }): AppFound[] {
  const exists = o.exists ?? existsSync
  return KNOWN_APPS.map((a) => {
    const places = a.places[o.platform as keyof KnownApp['places']] ?? []
    const found = places.some((p) => {
      const x = expandPlace(p, o.home, o.env)
      try { return !!x && exists(x) } catch { return false }
    })
    const srv = o.servers.find((s) => a.match.test(s.name) || a.match.test(s.target || ''))
    return { id: a.id, found, connected: !!srv, link: a.link, server: srv ? srv.name : null }
  })
}

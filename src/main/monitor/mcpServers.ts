import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Db } from '../library/db'

// Which MCP servers Claude Code knows (read-only; idea from the user's vault: Roblox Studio MCP, Blender MCP, OBS).
// Places per https://code.claude.com/docs/en/mcp: user scope in ~/.claude.json (top-level "mcpServers",
// the same key the NEURAL OS registration checks after `claude mcp add-json --scope user`), local scope in
// ~/.claude.json under "projects" → <path> → "mcpServers", project scope in <project>/.mcp.json ("mcpServers").
// Only the name, scope, type and the program name or host are shown: never args, env or headers (they can hold keys).

export interface McpEntry { name: string; scope: 'user' | 'local' | 'project'; project: string | null; type: string; target: string; lastUsed: string | null; uses: number }

type Spec = { type?: unknown; command?: unknown; url?: unknown }
const readJson = (p: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown> } catch { return null } }

function entry(name: string, s: Spec, scope: McpEntry['scope'], project: string | null): Omit<McpEntry, 'lastUsed' | 'uses'> {
  const type = typeof s.type === 'string' ? s.type : typeof s.command === 'string' ? 'stdio' : typeof s.url === 'string' ? '?' : '?'
  let target = ''
  if (typeof s.command === 'string') target = basename(s.command)
  else if (typeof s.url === 'string') { try { target = new URL(s.url).host } catch { target = '' } }
  return { name, scope, project, type, target }
}

export function mcpServers(db: Db, home: string, maxProjects = 8): { servers: McpEntry[]; configFound: boolean } {
  const out: Omit<McpEntry, 'lastUsed' | 'uses'>[] = []
  const cj = readJson(join(home, '.claude.json'))
  const servers = (o: unknown) => (o && typeof o === 'object' ? Object.entries(o as Record<string, Spec>).filter(([, v]) => v && typeof v === 'object') : [])
  for (const [n, s] of servers(cj?.mcpServers)) out.push(entry(n, s, 'user', null))
  const cwds = (db.prepare(`SELECT cwd, MAX(last_at) AS l FROM claude_session WHERE cwd IS NOT NULL AND cwd != '' GROUP BY cwd ORDER BY l DESC LIMIT ?`).all(maxProjects) as { cwd: string }[]).map((r) => r.cwd)
  const projects = (cj?.projects && typeof cj.projects === 'object' ? cj.projects : {}) as Record<string, { mcpServers?: unknown }>
  for (const c of cwds) {
    for (const [n, s] of servers(projects[c]?.mcpServers)) out.push(entry(n, s, 'local', basename(c)))
    for (const [n, s] of servers(readJson(join(c, '.mcp.json'))?.mcpServers)) out.push(entry(n, s, 'project', basename(c)))
  }
  // last use seen by the live monitor (tool names mcp__<server>__<tool>)
  const used = db.prepare("SELECT MAX(received_at) AS l, COUNT(*) AS n FROM claude_event WHERE tool LIKE ? ESCAPE '\\' AND type IN ('tool_finished', 'tool_failed')")
  const esc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m)
  return {
    configFound: cj !== null,
    servers: out.map((e) => { const u = used.get(`mcp\\_\\_${esc(e.name)}\\_\\_%`) as { l: string | null; n: number }; return { ...e, lastUsed: u.l, uses: u.n } })
  }
}

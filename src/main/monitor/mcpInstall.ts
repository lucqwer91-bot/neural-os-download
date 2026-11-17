import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Registers the NEURAL OS context server with Claude Code (spec 3.5).
// User-scope MCP servers live in ~/.claude.json, which Claude Code "writes for itself"
// (official docs, 2026-11-17). So NEURAL OS never edits that file: it runs the official
// command `claude mcp add-json <name> <json> --scope user` (and `claude mcp remove`),
// shows the exact command first and backs the file up. Without the claude command it
// shows the command for the user to run.

export const SERVER_NAME = 'neural-os'

export interface ServerSpec { type: 'stdio'; command: string; args: string[] }

export function serverSpec(node: string, script: string, dbPath: string, libDir: string, endpoint: string): ServerSpec {
  return { type: 'stdio', command: node, args: ['--no-warnings', script, dbPath, libDir, endpoint] }
}

export const addArgs = (spec: ServerSpec) => ['mcp', 'add-json', SERVER_NAME, JSON.stringify(spec), '--scope', 'user']
export const removeArgs = () => ['mcp', 'remove', SERVER_NAME, '--scope', 'user']
/** the same registration without JSON (`claude mcp add … -- <command> <args>`), for a command the user types:
 *  Windows PowerShell 5.1 breaks the double quotes inside a JSON argument */
export const addArgsPlain = (spec: ServerSpec) => ['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', spec.command, ...spec.args]

/** How the command looks in a terminal (for the preview and for running it by hand). */
export function shellLine(claude: string, args: string[], win = process.platform === 'win32'): string {
  const q = (a: string) => (/^[\w./:@=-]+$/.test(a) ? a : win ? `'${a.replace(/'/g, "''")}'` : `'${a.replace(/'/g, `'\\''`)}'`)
  // PowerShell runs a quoted program path only with the call operator &
  const prog = claude.includes(' ') ? (win ? `& "${claude}"` : `"${claude}"`) : claude
  return [prog, ...args.map(q)].join(' ')
}

/** The registered entry, read only (null = not registered). */
export function registered(home: string): ServerSpec | null {
  try {
    const j = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, ServerSpec> }
    return j.mcpServers?.[SERVER_NAME] ?? null
  } catch { return null }
}

/** semver-ish compare of folder names like 2.1.325 */
const verCmp = (a: string, b: string) => {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0), y = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}
/**
 * Claude Code inside the Claude desktop app on Windows (not on PATH):
 * %LOCALAPPDATA%\Claude-Data\claude_<id>\claude-code\<version>\<build>\claude.exe — newest version wins.
 * Version and build folders change with updates, so they are searched, never stored.
 */
export function bundledClaude(localAppData: string | undefined, fs: { readdir: (p: string) => string[]; exists: (p: string) => boolean } = { readdir: (p) => readdirSync(p), exists: existsSync }): string | null {
  if (!localAppData) return null
  const base = join(localAppData, 'Claude-Data')
  const found: { ver: string; path: string }[] = []
  const list = (p: string) => { try { return fs.readdir(p) } catch { return [] } }
  for (const inst of list(base).filter((n) => /^claude_/i.test(n))) {
    const cc = join(base, inst, 'claude-code')
    for (const ver of list(cc).filter((n) => /^\d+(\.\d+)*$/.test(n))) {
      for (const build of list(join(cc, ver))) {
        const exe = join(cc, ver, build, 'claude.exe')
        if (fs.exists(exe)) found.push({ ver, path: exe })
      }
    }
  }
  found.sort((a, b) => verCmp(b.ver, a.ver))
  return found[0]?.path ?? null
}

/** Absolute path of the claude command, like findNode: the GUI may not see the shell PATH. */
export function findClaude(): string | null {
  const tries: [string, string[]][] = process.platform === 'win32'
    ? [['where', ['claude']]]
    : [['/bin/sh', ['-c', 'command -v claude']], ['/bin/zsh', ['-lc', 'command -v claude']]]
  for (const [cmd, args] of tries) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 4000, windowsHide: true })
      const line = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^([A-Za-z]:\\|\/)/.test(l))
      // on Windows prefer the .exe/.cmd that can be started without a shell
      const pick = process.platform === 'win32' ? line.find((l) => /\.exe$/i.test(l)) ?? line[0] : line[0]
      if (r.status === 0 && pick && existsSync(pick)) return pick
    } catch { /* next */ }
  }
  if (process.platform === 'win32') return bundledClaude(process.env['LOCALAPPDATA'])
  return null
}

export interface McpResult { ok: boolean; backup: string | null; output?: string; error?: string }

export function runClaude(claude: string, args: string[], home: string, backupDir: string, now: Date): McpResult {
  let backup: string | null = null
  const file = join(home, '.claude.json')
  if (existsSync(file)) {
    mkdirSync(backupDir, { recursive: true })
    backup = join(backupDir, `claude-json-${now.toISOString().replace(/[:.]/g, '-')}.json`)
    copyFileSync(file, backup)
  }
  // .cmd shims on Windows would need a shell, and JSON does not survive cmd quoting: let the user run it
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(claude)) return { ok: false, backup, error: 'manual' }
  // tests point NEURAL OS at a throw-away home; the claude command must use the same one
  const env = process.env['NEURAL_OS_CLAUDE_HOME'] ? { ...process.env, HOME: home, USERPROFILE: home } : process.env
  const r = spawnSync(claude, args, { encoding: 'utf8', timeout: 30000, windowsHide: true, env })
  const output = ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 2000)
  if (r.error) return { ok: false, backup, output, error: r.error.message }
  return { ok: r.status === 0, backup, output, error: r.status === 0 ? undefined : 'exit ' + r.status }
}

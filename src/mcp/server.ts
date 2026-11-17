// NEURAL OS context server (spec 3.5, S3): a local MCP server over stdio that Claude Code
// starts as a tool. It only answers, read-only, without any AI. Every answer lists its
// sources. When NEURAL OS is running, the sources light up in the brain (memory flash).
//
// Run by Claude Code as: node --no-warnings <app data>/mcp/neural-os-mcp.cjs <db> <library> <endpoint.json>
// Protocol: JSON-RPC 2.0, one message per line (MCP stdio transport).

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { createInterface } from 'node:readline'
import { contextPack, projects, recentSessions, search } from '../main/context/query'
import { lessonsText } from '../main/monitor/lessons'
import { gameContext, whoUses } from '../main/context/game'
import { basename } from 'node:path'

// Shown to Claude when it connects (MCP "instructions"): how NEURAL OS works and when to use which tool.
// A guide for the AI user of the app; it ships with every install, so Claude knows the app without setup notes.
export const GUIDE = `NEURAL OS is the user's local "long-term memory" for Claude Code: a desktop app that shows their notes,
linked folders (e.g. an Obsidian vault, game projects) and past Claude Code sessions as a 3D brain. It has no AI of its own.
This server is read-only and local; every answer names its sources (file paths), so cite them.

When to use it:
- At the start of a larger task: call recent_sessions (what happened last time in this project) and lessons
  (what worked, what to avoid), then search_notes or context_pack for the topic. Tell the user which notes you used.
- Looking for something the user wrote or decided: search_notes ("exact phrase", #tag work).
- Overview of what exists: list_projects.
- Roblox / Luau projects: game_context (house rules, RemoteEvents with sides, modules, DataStores, weak server
  handlers) before writing game code, and who_uses(name) before changing or renaming a module, remote or DataStore.
  Follow the house rules it reports (networking module, naming, task.* instead of wait/spawn).
- Small questions need no lookup.

What NEURAL OS records (only if the user connected it): which files Claude Code reads and changes, with before/after
copies of edits. It never stores prompts or tool output. At the end of a finished task you may write one line
"SESSION-NOTE: <one sentence>" and, if you learned something reusable, "LESSON: <one sentence>"; NEURAL OS keeps
only those lines in the session note and lesson book.

Never claim NEURAL OS showed you something it did not return. If a tool says "not available", say so.`

let [dbPath, libDir, endpointFile] = process.argv.slice(2)
/** For tests: point the server at a database and library. */
export function configure(d: string, l: string, e: string): void { closeDb(); dbPath = d; libDir = l; endpointFile = e }
/** Release the database (tests on Windows cannot delete an open file). */
export function closeDb(): void { try { db?.close() } catch { /* already closed */ } db = null }
const VERSION = '1'

type Json = Record<string, unknown>
let db: DatabaseSync | null = null
const send = (m: Json) => process.stdout.write(JSON.stringify(m) + '\n')

function open(): DatabaseSync {
  if (!db) db = new DatabaseSync(dbPath, { readOnly: true })
  return db
}

/** Tell the running app which notes were handed to Claude (memory flash). Silent if it is closed. */
function flash(tool: string, ids: string[]): void {
  try {
    const ep = JSON.parse(readFileSync(endpointFile, 'utf8')) as { port: number; token: string }
    const body = Buffer.from(JSON.stringify({ tool, ids: ids.slice(0, 40) }))
    const req = request({ host: '127.0.0.1', port: ep.port, path: '/context', method: 'POST', timeout: 800,
      headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-neural-os': ep.token } }, (r) => r.resume())
    req.on('error', () => undefined)
    req.on('timeout', () => req.destroy())
    req.end(body)
  } catch { /* app closed */ }
}

const str = { type: 'string' }
const TOOLS = [
  {
    name: 'search_notes',
    description: 'Search the user\'s NEURAL OS library (their notes and linked Obsidian vault) by words in file names and text. Returns matching files with path, project and a short snippet. Read-only.',
    inputSchema: { type: 'object', properties: { query: { ...str, description: 'Words to look for' }, project: { ...str, description: 'Optional project name to search in' }, limit: { type: 'number', description: 'Max results (default 10, max 20)' } }, required: ['query'] }
  },
  {
    name: 'recent_sessions',
    description: 'What happened in earlier Claude Code sessions, from NEURAL OS session notes (observed events only: files read and changed, tools, time). Use it to answer "what did we do last time in this project". Read-only.',
    inputSchema: { type: 'object', properties: { project: { ...str, description: 'Project folder name, e.g. the name of the current working directory' }, limit: { type: 'number', description: 'Number of sessions (default 3, max 10)' } } }
  },
  {
    name: 'context_pack',
    description: 'A compact context pack from the user\'s notes for a topic and/or project: best matching notes, notes linked to them, and the latest session notes, cut to a size limit. Every part names its source file. Read-only.',
    inputSchema: { type: 'object', properties: { topic: { ...str, description: 'What the context is about' }, project: { ...str, description: 'Optional project name' } } }
  },
  {
    name: 'lessons',
    description: 'Lessons for a project from the user\'s NEURAL OS lesson book: what worked, what to avoid, conventions. Kept lessons were confirmed by the user; new ones are unconfirmed hints; plus tools that failed repeatedly in earlier sessions. Call it once at the start of a larger task. Read-only.',
    inputSchema: { type: 'object', properties: { project: { ...str, description: 'Project folder name (the name of the current working directory). Default: the folder Claude Code was started in.' } } }
  },
  {
    name: 'game_context',
    description: 'For Roblox games: the house rules of the game\'s code (how networking is done, where server/client/shared scripts live, naming, task.* vs old wait/spawn), the remotes (who fires, who handles, server/client), server handlers without a visible argument check or rate limit, required modules, DataStores and asset ids, each with file:line. Read by rules from the Luau code in the user\'s linked folders, no AI. Call it at the start of any Roblox coding task and follow the house rules. Read-only.',
    inputSchema: { type: 'object', properties: { game: { ...str, description: 'Game folder or project name (part of it is enough). Default: the folder Claude Code was started in.' }, query: { ...str, description: 'Optional: only names or paths containing this, e.g. a remote name' } } }
  },
  {
    name: 'who_uses',
    description: 'For Roblox games: every script that requires a module, fires or handles a remote, or opens a DataStore with this name, with file:line and server/client side. Call it before changing or renaming a shared module, remote or DataStore to see what else must change. Read by rules from the Luau code, no AI. Read-only.',
    inputSchema: { type: 'object', properties: { name: { ...str, description: 'Module, remote or DataStore name, e.g. PlayerData or PetEquip' }, game: { ...str, description: 'Optional game folder or project name (part of it is enough)' } }, required: ['name'] }
  },
  {
    name: 'list_projects',
    description: 'List the projects in the user\'s NEURAL OS library with their file counts. Read-only.',
    inputSchema: { type: 'object', properties: {} }
  }
]

/** Local time of this computer, like the session notes. */
const local = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('sv-SE').slice(0, 16) }
const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined)
const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(1, Math.floor(v)) : undefined)

export function callTool(name: string, a: Json): { result: Json; ids: string[] } {
  const d = open()
  if (name === 'search_notes') {
    const q = s(a.query)
    if (!q) return { result: text('query is required', true), ids: [] }
    const hits = search(d, libDir, q, { project: s(a.project), limit: n(a.limit) })
    const out = hits.length ? hits.map((h, i) => `${i + 1}. ${h.name}${h.project ? ` [${h.project}]` : ''}\n   ${h.path}${h.snippet ? `\n   ${h.snippet}` : ''}`).join('\n') : 'No matches.'
    return { result: text(`${out}\n\nSource: NEURAL OS library search (no AI).`), ids: hits.map((h) => h.id) }
  }
  if (name === 'recent_sessions') {
    const L = recentSessions(d, libDir, { project: s(a.project), limit: n(a.limit) })
    const out = L.length ? L.map((x) => (x.device ? `(on the user's other computer "${x.device}")\n` : '') + (x.note ? x.note : `Session ${x.id} in ${x.folder ?? 'unknown folder'}, ${local(x.started_at)}, ${x.events} events (no session note).`)).join('\n\n---\n\n') : 'No recorded sessions' + (s(a.project) ? ` for "${s(a.project)}".` : '.')
    return { result: text(`${out}\n\nSource: NEURAL OS session notes from observed Claude Code events.`), ids: L.map((x) => x.note_id).filter((x): x is string => !!x) }
  }
  if (name === 'context_pack') {
    const topic = s(a.topic), project = s(a.project)
    if (!topic && !project) return { result: text('Give a topic or a project.', true), ids: [] }
    const p = contextPack(d, libDir, { topic, project })
    const src = p.sources.map((x, i) => `${i + 1}. ${x.name} (${x.why}): ${x.path}`).join('\n')
    return { result: text(p.sources.length ? `${p.text}\n\nSources:\n${src}` : 'Nothing found for this topic/project.'), ids: p.sources.map((x) => x.id) }
  }
  if (name === 'lessons') {
    const p = s(a.project) ?? basename(process.cwd())
    const L = lessonsText(d, p)
    return { result: text(L.count ? `${L.text}\n\nSource: NEURAL OS lesson book for "${p}" (lessons written by Claude or the user, reviewed by the user; failures from recorded events; no AI).` : `No lessons yet for "${p}".`), ids: [] }
  }
  if (name === 'game_context') {
    const g = s(a.game) ?? basename(process.cwd())
    let r = gameContext(d, { game: g, query: s(a.query) })
    // started outside a game folder and no game named: all games
    if (!r.text && !s(a.game)) r = gameContext(d, { query: s(a.query) })
    return { result: text(r.text ? `${r.text}\n\nSource: NEURAL OS code graph of linked folders (rules, no AI).` : `No Luau code found${s(a.game) ? ` for "${g}"` : ''}. The game folder must be linked in NEURAL OS.`), ids: r.ids }
  }
  if (name === 'who_uses') {
    const q = s(a.name)
    if (!q) return { result: text('name is required', true), ids: [] }
    const r = whoUses(d, q, { game: s(a.game) })
    return { result: text(r.text ? `${r.text}\n\nSource: NEURAL OS code graph of linked folders (rules, no AI).` : `Nothing in the linked Luau code uses "${q}".`), ids: r.ids }
  }
  if (name === 'list_projects') {
    const P = projects(d)
    const by = new Map<string, typeof P>()
    for (const p of P) { const k = p.folder ? basename(p.folder) + ` (${p.folder})` : 'Library (copied files)'; by.set(k, [...(by.get(k) || []), p]) }
    const out = [...by].map(([k, l]) => `## ${k}: ${l.reduce((a, p) => a + p.files, 0)} files\n` + l.slice(0, 15).map((p) => `- ${p.name ?? '(top level)'} (${p.files})`).join('\n') + (l.length > 15 ? `\n- … +${l.length - 15} more` : ''))
    return { result: text(out.length ? out.join('\n\n') : 'No projects yet.'), ids: [] }
  }
  return { result: text(`Unknown tool: ${name}`, true), ids: [] }
}

export function handle(m: Json): void {
  const id = m.id as string | number | undefined
  const method = m.method as string
  const reply = (result: Json) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }) }
  const fail = (code: number, message: string) => { if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } }) }
  if (method === 'initialize') {
    const p = (m.params || {}) as Json
    return reply({ protocolVersion: typeof p.protocolVersion === 'string' ? p.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'neural-os', version: VERSION }, instructions: GUIDE })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: TOOLS })
  if (method === 'tools/call') {
    const p = (m.params || {}) as Json
    try {
      const { result, ids } = callTool(String(p.name), (p.arguments || {}) as Json)
      if (ids.length) flash(String(p.name), ids)
      return reply(result)
    } catch (e) {
      return reply(text(`NEURAL OS could not answer: ${(e as Error).message}`, true))
    }
  }
  if (method && method.startsWith('notifications/')) return
  fail(-32601, `Method not found: ${method}`)
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let m: Json
    try { m = JSON.parse(line) } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
    try { handle(m) } catch (e) { process.stderr.write(String(e) + '\n') }
  })
  rl.on('close', () => process.exit(0))
}

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../library/db'
import { ensureProject } from '../library/organize'
import type { Session, StoredEvent } from './store'

// S2 self-writing memory (spec 5.12): after a Claude session NEURAL OS writes a session
// note into its own library folder `Sessions/`. Observed facts, nothing invented; the only
// text from Claude is its own SESSION-NOTE line (readiness rule v2), shown as Claude's words. Files from the library become [[wikilinks]], so the note grows into the brain.

export const SESSION_PROJECT = 'Claude Sessions'

const L = {
  de: {
    title: 'Claude-Sitzung', folder: 'Ordner', when: 'Zeit', dur: 'Dauer', events: 'Ereignisse', model: 'Modell', na: 'nicht verfügbar',
    changed: 'Geänderte Dateien', read: 'Gelesene Dateien', tools: 'Werkzeuge', mcp: 'Konnektoren (MCP)', agents: 'Subagenten',
    failed: 'Fehlgeschlagen', prompts: 'Anfragen', none: 'keine', end: 'Ende', running: 'läuft noch', min: 'min',
    summary: 'Von Claude zusammengefasst',
    lesson: 'Lektion',
    footer: 'Geschrieben von NEURAL OS aus beobachteten Claude-Code-Ereignissen. Nur der Abschnitt „Von Claude zusammengefasst“ stammt von Claude selbst, alles andere ist beobachtet, nichts geraten. Vorher/Nachher jeder Änderung: Aktivität → Änderungen.'
  },
  en: {
    title: 'Claude session', folder: 'Folder', when: 'Time', dur: 'Duration', events: 'Events', model: 'Model', na: 'not available',
    changed: 'Changed files', read: 'Read files', tools: 'Tools', mcp: 'Connectors (MCP)', agents: 'Subagents',
    failed: 'Failed', prompts: 'Requests', none: 'none', end: 'End', running: 'still running', min: 'min',
    summary: 'Summarized by Claude',
    lesson: 'Lesson',
    footer: 'Written by NEURAL OS from observed Claude Code events. Only the section "Summarized by Claude" comes from Claude itself; everything else is observed, nothing guessed. Before/after of every change: Activity → Changes.'
  }
}

export type Lang = keyof typeof L

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
const pad = (n: number) => String(n).padStart(2, '0')
const fmtTime = (iso: string, lang: Lang) => {
  const d = new Date(iso)
  return lang === 'de'
    ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// file names must be safe on Windows and macOS
const safe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Session'
const wl = (name: string) => name.replace(/\.md$/i, '').replace(/[[\]|#^]/g, '')

function count<T>(xs: T[], key: (x: T) => string | null): [string, number][] {
  const m = new Map<string, number>()
  for (const x of xs) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** The note text for one session, built only from stored events. */
export function buildNote(db: Db, sessionId: string, lang: Lang = 'de'): { fileName: string; text: string } | null {
  const s = db.prepare('SELECT * FROM claude_session WHERE id = ?').get(sessionId) as unknown as Session | undefined
  if (!s) return null
  const ev = db.prepare('SELECT * FROM claude_event WHERE session_id = ? ORDER BY received_at, rowid').all(sessionId) as unknown as StoredEvent[]
  const T = L[lang]
  const project = s.cwd ? baseName(s.cwd) : T.na
  const names = new Map<string, string>()
  for (const r of db.prepare(`SELECT id, name FROM file_asset WHERE id IN (SELECT file_id FROM claude_event WHERE session_id = ? AND file_id IS NOT NULL)`).all(sessionId) as { id: string; name: string }[]) names.set(r.id, r.name)
  const fileRef = (e: StoredEvent) => (e.file_id && names.has(e.file_id) ? `[[${wl(names.get(e.file_id)!)}]]` : e.file_path ? '`' + e.file_path + '`' : null)
  const done = ev.filter((e) => e.type === 'tool_finished')
  const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
  const changed = count(done.filter((e) => e.tool && EDIT.has(e.tool)), fileRef)
  const read = count(done.filter((e) => e.tool === 'Read'), fileRef).filter(([k]) => !changed.some(([c]) => c === k))
  const tools = count(done.filter((e) => e.tool && !e.tool.startsWith('mcp__')), (e) => e.tool)
  const mcp = count(done.filter((e) => e.tool?.startsWith('mcp__')), (e) => /^mcp__(.+?)__/.exec(e.tool!)?.[1] ?? null)
  const agents = count(ev.filter((e) => e.type === 'subagent_started'), (e) => e.summary || 'agent')
  const failed = count(ev.filter((e) => e.type === 'tool_failed'), (e) => e.tool)
  const prompts = ev.filter((e) => e.type === 'prompt_submitted').length
  const said = ev.filter((e) => (e.type === 'session_summary' || e.type === 'lesson_noted') && e.summary).map((e) => `- ${pad(new Date(e.received_at).getHours())}:${pad(new Date(e.received_at).getMinutes())} ${e.type === 'lesson_noted' ? T.lesson + ': ' : ''}${e.summary!.replace(/\s+/g, ' ')}`)
  const start = s.started_at, end = s.ended_at || s.last_at
  const mins = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000))
  const list = (rows: [string, number][]) => rows.length ? rows.map(([k, n]) => `- ${k}${n > 1 ? ` (${n}×)` : ''}`).join('\n') : `- ${T.none}`
  const text = [
    '---',
    'type: claude-session',
    `session: ${s.id}`,
    `project: ${JSON.stringify(project)}`,
    `started: ${start}`,
    `ended: ${s.ended_at ?? 'null'}`,
    `model: ${s.model ? JSON.stringify(s.model) : 'null'}`,
    'source: NEURAL OS',
    '---',
    `# ${T.title} · ${project} · ${fmtTime(start, lang)}`,
    '',
    `- ${T.folder}: ${s.cwd ? '`' + s.cwd + '`' : T.na}`,
    `- ${T.when}: ${fmtTime(start, lang)} – ${s.ended_at ? fmtTime(s.ended_at, lang) : T.running}`,
    `- ${T.dur}: ${mins} ${T.min} · ${s.events} ${T.events} · ${T.prompts}: ${prompts}`,
    `- ${T.model}: ${s.model || T.na}`,
    '',
    ...(said.length ? [`## ${T.summary}`, ...said, ''] : []),
    `## ${T.changed}`, list(changed), '',
    `## ${T.read}`, list(read), '',
    `## ${T.tools}`, list(tools), '',
    ...(mcp.length ? [`## ${T.mcp}`, list(mcp), ''] : []),
    ...(agents.length ? [`## ${T.agents}`, list(agents), ''] : []),
    ...(failed.length ? [`## ${T.failed}`, list(failed), ''] : []),
    `> ${T.footer}`,
    ''
  ].join('\n')
  const d = new Date(start)
  const fileName = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())} ${safe(project)} ${s.id.slice(0, 6)}.md`
  return { fileName, text }
}

/**
 * Writes (or rewrites) the note of a session into <library>/Sessions and registers it
 * as a library file. Returns the file id, or null when there is nothing to write.
 */
export function writeSessionNote(db: Db, libDir: string, sessionId: string, lang: Lang, now: Date): string | null {
  const hash = `session:${sessionId}`
  const old = db.prepare('SELECT id, lib_path FROM file_asset WHERE hash = ?').get(hash) as { id: string; lib_path: string } | undefined
  // no note for a session in which Claude used no tool (it would only say "nothing happened")
  if (!old && !db.prepare("SELECT 1 FROM claude_event WHERE session_id = ? AND type LIKE 'tool_%' AND COALESCE(tool, '') NOT LIKE 'mcp__neural-os__%' AND COALESCE(tool, '') <> 'ToolSearch' LIMIT 1").get(sessionId)) return null
  const n = buildNote(db, sessionId, lang)
  if (!n) return null
  const rel = `Sessions/${n.fileName}`
  mkdirSync(join(libDir, 'Sessions'), { recursive: true })
  if (old && old.lib_path !== rel) { try { rmSync(join(libDir, old.lib_path), { force: true }) } catch { /* ignore */ } }
  writeFileSync(join(libDir, rel), n.text)
  const size = Buffer.byteLength(n.text)
  if (old) {
    db.prepare('UPDATE file_asset SET name = ?, size = ?, lib_path = ?, mtime = ? WHERE id = ?').run(n.fileName, size, rel, now.getTime() / 1000, old.id)
    db.prepare("DELETE FROM knowledge_edge WHERE from_id = ? AND reason = 'wikilink'").run(old.id)
    return old.id
  }
  const id = sessionId.length >= 8 ? `session-${sessionId}` : `session-${sessionId}-${now.getTime()}`
  const pid = ensureProject(db, SESSION_PROJECT, now.toISOString())
  db.prepare(`INSERT INTO file_asset (id, name, ext, size, hash, lib_path, original_path, imported_at, project_id, project_origin, status, source, mtime)
    VALUES (?, ?, 'md', ?, ?, ?, '', ?, ?, 'auto', 'indexed', 'session', ?)`).run(id, n.fileName, size, hash, rel, now.toISOString(), pid, now.getTime() / 1000)
  return id
}

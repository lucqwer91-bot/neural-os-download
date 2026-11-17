import { regionFor, type Region } from '../../shared/regions'

// Normalized event schema v1 (spec 6.4). Only fields that the hook payload really
// contains are filled; everything else stays null = "not available".

export const SCHEMA_VERSION = 1

export type EventType =
  | 'session_started' | 'session_ended' | 'prompt_submitted'
  | 'tool_started' | 'tool_finished' | 'tool_failed'
  | 'subagent_started' | 'subagent_finished' | 'turn_finished'
  | 'notification' | 'model_switched' | 'other'

export interface NormEvent {
  schema_version: number
  hook: string
  event_type: EventType
  session_id: string
  working_directory: string | null
  tool_name: string | null
  tool_use_id: string | null
  file_path: string | null
  model: string | null
  agent_id: string | null
  agent_type: string | null
  status: string | null
  duration_ms: number | null
  region: Region
  summary: string | null
  before_text: string | null
  before_missing: boolean
  readiness_line: string | null
  /** Claude's own one-line summary (rule v2) and lesson line (rule v3), only on Stop; the only texts of Claude's that are kept */
  note_line: string | null
  lesson_line: string | null
}

const TYPE: Record<string, EventType> = {
  SessionStart: 'session_started',
  SessionEnd: 'session_ended',
  UserPromptSubmit: 'prompt_submitted',
  PreToolUse: 'tool_started',
  PostToolUse: 'tool_finished',
  PostToolUseFailure: 'tool_failed',
  SubagentStart: 'subagent_started',
  SubagentStop: 'subagent_finished',
  Stop: 'turn_finished',
  Notification: 'notification',
  PostModelSwitch: 'model_switched'
}

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const s = (v: unknown, n = 4000): string | null => (typeof v === 'string' && v.length ? v.slice(0, n) : null)

/** Validates and normalizes a forwarded payload. Returns null for anything malformed. */
export function normalize(p: Record<string, unknown>): NormEvent | null {
  const hook = s(p.hook_event_name, 60)
  const session = s(p.session_id, 200)
  if (!hook || !session || !/^[A-Za-z]+$/.test(hook)) return null
  const ti = (p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}) as Record<string, unknown>
  const tool = s(p.tool_name, 200)
  const type = TYPE[hook] ?? 'other'
  const file = s(ti.file_path) ?? s(ti.notebook_path)
  let summary: string | null = null
  if (s(ti.command_word, 60)) summary = s(ti.command_word, 60)
  else if (s(ti.url_host, 200)) summary = s(ti.url_host, 200)
  else if (type === 'session_started') summary = s(p.source, 40)
  else if (type === 'session_ended') summary = s(p.reason, 60)
  else if (type === 'notification') summary = s(p.notification_type, 60)
  else if (type === 'subagent_started' || type === 'subagent_finished') summary = s(p.agent_type, 100)
  return {
    schema_version: SCHEMA_VERSION,
    hook,
    event_type: type,
    session_id: session,
    working_directory: s(p.cwd),
    tool_name: tool,
    tool_use_id: s(p.tool_use_id, 200),
    file_path: file,
    model: type === 'session_started' || type === 'model_switched' ? s(p.model, 200) : null,
    agent_id: s(p.agent_id, 200),
    agent_type: s(p.agent_type, 200),
    status: type === 'tool_started' ? 'started' : type === 'tool_finished' ? 'ok' : type === 'tool_failed' ? 'failed' : null,
    duration_ms: typeof p.duration_ms === 'number' && isFinite(p.duration_ms) ? Math.max(0, Math.round(p.duration_ms)) : null,
    region: regionFor({ hook_event_name: hook, tool_name: tool }),
    summary,
    before_text: typeof p.before_text === 'string' && tool && EDIT_TOOLS.has(tool) ? p.before_text : null,
    before_missing: p.before_missing === true,
    readiness_line: (type === 'turn_finished' || type === 'subagent_finished') && typeof p.readiness_line === 'string' && /^READINESS:/.test(p.readiness_line) ? p.readiness_line.slice(0, 800) : null,
    note_line: type === 'turn_finished' && typeof p.note_line === 'string' && /^SESSION-NOTE:/.test(p.note_line)
      ? p.note_line.replace(/^SESSION-NOTE:\s*/, '').trim().slice(0, 600) || null : null,
    lesson_line: type === 'turn_finished' && typeof p.lesson_line === 'string' && /^LESSON:/.test(p.lesson_line)
      ? p.lesson_line.replace(/^LESSON:\s*/, '').replace(/^<|>$/g, '').trim().slice(0, 400) || null : null
  }
}

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Plugin & connector readiness rule (spec 10.5, Appendix A). NEURAL OS only offers it;
// it lives as a marked block in the user-level Claude Code instructions
// (~/.claude/CLAUDE.md, docs/hooks-verified.md) and works without NEURAL OS.
// Text outside the block is never changed; every write is shown first and backed up.

export const RULE_VERSION = 4
const BEGIN = /<!-- NEURAL-OS:READINESS:BEGIN v(\d+) -->/
const END = '<!-- NEURAL-OS:READINESS:END -->'

export const RULE_TEXT = `<!-- NEURAL-OS:READINESS:BEGIN v${RULE_VERSION} -->
## Plugin & connector readiness check

Before starting a larger task, check whether you have the tools it needs.

A larger task is one that involves an external service, app, or account
(for example GitHub, Figma, OBS, Notion, a browser, an API), or is
expected to touch more than a few files, or that the user calls big or
asks you to check. Skip the check for short questions, single small
edits, and conversation.

Procedure:
1. List the services, data sources, and tool types the task needs.
2. Check what is actually available in this session: loaded tools,
   configured MCP servers and their connection state, enabled plugins
   and skills. Use the discovery tools you have. Do not guess.
3. Mark each need as ready, needs sign-in, failed to connect, or missing.
4. For anything missing, search the available plugin and connector
   catalogs for a fitting option.
5. Before starting, give a short readiness report: what is ready, what
   is missing and what you suggest and why, what access it needs, and
   alternatives.
6. Ask before every installation, connection, or sign-in. One approval
   covers one item. The user does all sign-ins.
7. After something is added, test it with a harmless read-only call and
   say whether it works.
8. If something stays unavailable, do only what is possible and say
   clearly what was not done and why. Never claim results from a tool
   you could not use.

End the readiness report with one line in this exact form, so that
monitoring tools can read it:
READINESS: ready=<comma list> missing=<comma list> needs_signin=<comma list> failed=<comma list>

## Session note line

When you finish a task that changed files or produced a result, end your
final message with one line in this exact form, so that NEURAL OS can add
it to its session note:
SESSION-NOTE: <one or two sentences: what was done, what is still open>
Keep it under 300 characters. No secrets, passwords, or personal data.
Skip it for short questions and conversation.

## Lesson line

When a task taught you something worth remembering for this project (a
mistake you had to fix, an approach that worked or failed, a command or
convention the project needs), add one more line at the very end:
LESSON: <one sentence: what to do or avoid next time in this project, and why>
At most one per task, only from what really happened. No secrets,
passwords, or personal data. Skip it when there is nothing new.

## Lesson book

At the start of a larger task, if the tool \`lessons\` of the neural-os
MCP server is available, call it once with the project folder name and
follow the lessons the user kept. Lessons marked "new" are unconfirmed
hints. If a lesson turns out to be wrong, say so in your LESSON line.

## Memory from NEURAL OS

At the start of a larger task, if the neural-os MCP server is available,
also look up what the user already knows and did:
- call \`recent_sessions\` once for this project, to continue where the
  last session stopped;
- call \`search_notes\` with the task's main topic words, and read the
  notes that fit (\`context_pack\` gives a short pack with sources).
Use what you find as background, name the notes you relied on, and do
not invent content that is not in them. Skip this for short questions,
small edits, and conversation, or when the user says not to.
${END}`

export const rulePath = (home: string) => join(home, '.claude', 'CLAUDE.md')

/** Where the block is, and which version. */
export function findBlock(text: string): { start: number; end: number; version: number } | null {
  const m = BEGIN.exec(text)
  if (!m) return null
  const e = text.indexOf(END, m.index)
  if (e < 0) return null
  return { start: m.index, end: e + END.length, version: Number(m[1]) }
}

/** The file text with the current rule added or replaced. */
export function withRule(text: string): string {
  const b = findBlock(text)
  if (b) return text.slice(0, b.start) + RULE_TEXT + text.slice(b.end)
  const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return text + sep + RULE_TEXT + '\n'
}

/** The file text without the block (and without the blank lines it added). */
export function withoutRule(text: string): string {
  const b = findBlock(text)
  if (!b) return text
  let before = text.slice(0, b.start), after = text.slice(b.end)
  if (after.startsWith('\n')) after = after.slice(1)
  if (!after.length) before = before.replace(/\n+$/, before.trim().length ? '\n' : '')
  return before + after
}

export interface RuleStatus { path: string; installed: boolean; version: number | null; current: number; outdated: boolean; brokenBlock: boolean }

export function ruleStatus(home: string): RuleStatus {
  const path = rulePath(home)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const b = findBlock(text)
  return { path, installed: !!b, version: b?.version ?? null, current: RULE_VERSION, outdated: !!b && b.version < RULE_VERSION, brokenBlock: !b && BEGIN.test(text) }
}

export function rulePlan(home: string, remove: boolean): { path: string; exists: boolean; before: string; after: string; error?: string } {
  const path = rulePath(home)
  const exists = existsSync(path)
  const before = exists ? readFileSync(path, 'utf8') : ''
  // a begin marker without an end marker: do not guess where the block ends
  if (!findBlock(before) && BEGIN.test(before)) return { path, exists, before, after: before, error: 'brokenBlock' }
  return { path, exists, before, after: remove ? withoutRule(before) : withRule(before) }
}

export function ruleApply(home: string, backupDir: string, remove: boolean, now: Date): { ok: boolean; path: string; backup: string | null; error?: string } {
  const p = rulePlan(home, remove)
  if (p.error) return { ok: false, path: p.path, backup: null, error: p.error }
  let backup: string | null = null
  if (p.exists) {
    mkdirSync(backupDir, { recursive: true })
    backup = join(backupDir, `CLAUDE-${now.toISOString().replace(/[:.]/g, '-')}.md`)
    copyFileSync(p.path, backup)
  }
  mkdirSync(dirname(p.path), { recursive: true })
  writeFileSync(p.path, p.after)
  return { ok: true, path: p.path, backup }
}

/** Parses "READINESS: ready=a,b missing=c needs_signin= failed=" (Appendix A). Names may contain spaces. */
export function parseReadiness(line: string): { ready: string[]; missing: string[]; needs_signin: string[]; failed: string[] } | null {
  const m = /^\s*READINESS:\s*(.*)$/m.exec(line)
  if (!m) return null
  const out = { ready: [] as string[], missing: [] as string[], needs_signin: [] as string[], failed: [] as string[] }
  const parts = m[1].split(/(?:^|\s)(ready|missing|needs_signin|failed)=/)
  let any = false
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const k = parts[i] as keyof typeof out
    any = true
    out[k] = parts[i + 1].split(',').map((s) => s.trim().replace(/^<|>$/g, '')).filter((s) => s && s !== '-' && !/^(none|keine?)$/i.test(s)).slice(0, 40)
  }
  return any ? out : null
}

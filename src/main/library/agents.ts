import type { Db } from './db'
import { noteText } from './notes'
import { stem } from './organize'
import { frontmatter } from '../../renderer/src/ui/markdown.js'

// Agent board (idea from the user's vault: an agent fleet that writes handoff notes, grades them on a
// scorecard, collects learnings and questions for the owner). NEURAL OS only reads these notes and shows
// them; it never writes them and invents nothing. Recognised by common shapes, so any vault can use it:
// - agents: notes in a folder named Agents (or Agenten)
// - handoffs: notes in a folder named Handoffs/Übergaben, or any note with "FROM: … TO: …" lines
// - scorecard: a table in a note named Scorecard with an Agent column and a grade column
// - learnings / open questions: list items in notes named Learnings/Lessons/Lektionen and Owner Questions/Offene Fragen
// Live subagents come from the Claude Code hook events (SubagentStart/SubagentStop, agent_type).

export interface AgentNote { id: string; name: string; title: string; officer: string | null; handoffs: number; grade: string | null; graded: number }
export interface Handoff { id: string; name: string; at: string | null; agent: string; task: string; from: string | null; to: string | null; status: string; next: string | null }
export interface Item { id: string; note: string; date: string | null; text: string }
export interface SubagentRun { type: string; runs: number; failed: number; last: string }
export interface Phase { id: string; name: string; title: string; status: string | null; done: number; total: number; gates: string[]; agents: string[]; handoffs: number }
export interface Proposal { id: string; date: string | null; agent: string; change: string; why: string; status: string }
export interface AgentBoard { agents: AgentNote[]; handoffs: Handoff[]; handoffTotal: number; questions: Item[]; learnings: Item[]; subagents: SubagentRun[]; phases: Phase[]; proposals: Proposal[]; scanned: number }

const MAX_NOTES = 4000, MAX_HANDOFFS = 400
interface Row { id: string; name: string; ext: string; source: string; lib_path: string; rel_path: string | null; original_path: string; folder_path: string | null }

const dirsOf = (r: Row) => (r.rel_path || r.original_path).replace(/\\/g, '/').toLowerCase().split('/').slice(0, -1)
const AGENT_DIRS = new Set(['agents', 'agenten'])
const HANDOFF_DIRS = new Set(['handoffs', 'handoff', 'übergaben', 'uebergaben'])
const isScorecard = (s: string) => /^(scorecard|bewertungen?)$/.test(s)
const isLearnings = (s: string) => /^(learnings|lessons( learned)?|lektionen|erkenntnisse)$/.test(s)
const isQuestions = (s: string) => /^(owner questions|open questions|offene fragen|fragen an mich)$/.test(s)
const isProposals = (s: string) => /^(prompt proposals|prompt-vorschläge|prompt vorschläge|prompt-vorschlaege)$/.test(s)
const PHASE_DIRS = new Set(['phases', 'phasen'])
const isPhaseName = (s: string) => /^(phase|phasen?) \d+[a-z]?(:.*)?$/.test(s)
const links = (t: string) => [...new Set([...t.matchAll(/\[\[([^\]|#\n]+)/g)].map((m) => m[1].trim().split('/').pop()!.toLowerCase()))]
const naturalCmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Progress of a plan note: ticked and all checkboxes. */
export function checkboxes(text: string): { done: number; total: number } {
  let done = 0, total = 0
  for (const m of text.matchAll(/^\s*[-*]\s+\[([ xX])\]/gm)) { total++; if (m[1] !== ' ') done++ }
  return { done, total }
}

/** "2026-10-24 1106 code-reviewer - phase 2 draft review" (time optional, "UTC" allowed). */
export function parseHandoffName(name: string): { at: string | null; agent: string; task: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T_](\d{2}):?(\d{2}))?(?:\s*UTC)?\s+(.+?)\s+[-–]\s+(.+)$/i.exec(name.replace(/\.md$/i, ''))
  if (!m) return null
  return { at: m[2] ? `${m[1]} ${m[2]}:${m[3]}` : m[1], agent: m[4].trim(), task: m[5].trim() }
}

/** FROM/TO/TASK/STATUS/NEXT lines, or a "Verdict: PASS/FAIL" line. */
export function parseHandoffText(text: string): { from: string | null; to: string | null; task: string | null; status: string | null; next: string | null } {
  const head = text.slice(0, 6000)
  const field = (k: string) => { const m = new RegExp(`(?:^|\\s|\\*\\*)${k}\\s*:\\s*\\**\\s*([^\\n]*?)(?=\\s+(?:FROM|TO|TASK|STATUS|EVIDENCE|NEXT)\\s*:|\\n|$)`, 'i').exec(head); return m ? m[1].replace(/\*+/g, '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim() || null : null }
  let status = field('STATUS')
  if (status) status = status.split(/[\s|,;(]/)[0].toLowerCase().replace(/[^a-z]+$/, '')
  if (!status) { const v = /verdict\s*:?\s*\**\s*:?\s*(PASS|FAIL|BLOCKED)/i.exec(head) || /\*\*(PASS|FAIL)\b/.exec(head); if (v) status = v[1].toLowerCase() }
  return { from: field('FROM'), to: field('TO'), task: field('TASK'), status, next: field('NEXT') }
}

const GRADE: Record<string, number> = { a: 4, b: 3, c: 2, d: 1, e: 0, f: 0 }
export function gradeValue(g: string): number | null {
  const m = /^\s*([A-Fa-f])\s*([+-]?)\s*$/.exec(g); if (!m) return null
  return GRADE[m[1].toLowerCase()] + (m[2] === '+' ? 0.3 : m[2] === '-' ? -0.3 : 0)
}
export function gradeLetter(v: number): string {
  const base = Math.round(v), l = 'FDCBA'[Math.max(0, Math.min(4, base))], d = v - base
  return l + (d >= 0.15 && l !== 'A' ? '+' : d <= -0.15 && l !== 'F' ? '-' : '')
}

/** Markdown tables in a note → rows as { header: cell } objects. */
export function tables(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  const lines = text.split(/\r?\n/)
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue
    const head = cells(lines[i]).map((h) => h.toLowerCase())
    let j = i + 2
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) { const c = cells(lines[j]); const o: Record<string, string> = {}; head.forEach((h, k) => { o[h] = c[k] ?? '' }); out.push(o) }
    i = j
  }
  return out
}

/** "- 2026-10-24 (agent): text" list items; struck-through (~~…~~) or checked ones are done and skipped. */
export function listItems(text: string): { date: string | null; text: string }[] {
  const out: { date: string | null; text: string }[] = []
  for (const l of frontmatter(text).body.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.+)$/.exec(l); if (!m) continue
    if (m[1] && m[1] !== ' ') continue
    let t = m[2].trim()
    if (/^~~.*~~/.test(t)) continue
    if (/^\[\[[^\]]+\]\]$/.test(t)) continue   // a bare link list ("Related") is not an item
    const d = /^\**(\d{4}-\d{2}-\d{2})\**[:\s]*/.exec(t)
    if (d) t = t.slice(d[0].length).trim()
    t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    if (t.length > 3) out.push({ date: d ? d[1] : null, text: t.slice(0, 600) })
  }
  return out
}

const agentKey = (s: string) => s.replace(/\(.*?\)/g, '').replace(/\[\[|\]\]/g, '').replace(/#\d+/g, '').split(/[,+]/)[0].trim().toLowerCase()

export async function agentBoard(db: Db, libDir: string): Promise<AgentBoard> {
  const rows = (db.prepare(`SELECT f.id, f.name, f.ext, f.source, f.lib_path, f.rel_path, f.original_path, lf.path AS folder_path
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id WHERE f.ext = 'md' ORDER BY f.name COLLATE NOCASE`).all() as unknown as Row[]).slice(0, MAX_NOTES * 4)
  const agents: AgentNote[] = [], handoffs: Handoff[] = [], questions: Item[] = [], learnings: Item[] = [], phases: Phase[] = [], proposals: Proposal[] = []
  const handoffLinks = new Map<string, number>()
  const score = new Map<string, number[]>()
  let scanned = 0
  for (const r of rows) {
    const dirs = dirsOf(r), s = stem(r.name)
    const inAgents = dirs.length > 0 && AGENT_DIRS.has(dirs[dirs.length - 1])
    const inHandoffs = dirs.some((d) => HANDOFF_DIRS.has(d)) && s !== 'readme'
    const inPhases = (dirs.length > 0 && PHASE_DIRS.has(dirs[dirs.length - 1])) || isPhaseName(s)
    const special = isScorecard(s) || isLearnings(s) || isQuestions(s) || isProposals(s)
    if (!inAgents && !inHandoffs && !special && !inPhases) continue
    if (++scanned > MAX_NOTES) break
    const text = await noteText(db, libDir, r); if (text == null) continue
    if (inAgents) {
      const fm = frontmatter(text).props || []
      const officer = fm.find((p: { key: string }) => p.key.toLowerCase() === 'officer')
      const h1 = /^#\s+(.+)$/m.exec(frontmatter(text).body)
      agents.push({ id: r.id, name: r.name.replace(/\.md$/i, ''), title: h1 ? h1[1].trim() : r.name.replace(/\.md$/i, ''), officer: officer && typeof officer.value === 'string' ? officer.value : null, handoffs: 0, grade: null, graded: 0 })
    }
    if (inHandoffs) {
      const n = parseHandoffName(r.name), x = parseHandoffText(text)
      for (const l of links(text)) handoffLinks.set(l, (handoffLinks.get(l) || 0) + 1)
      handoffs.push({ id: r.id, name: r.name.replace(/\.md$/i, ''), at: n?.at || null, agent: x.from || n?.agent || '', task: x.task || n?.task || r.name.replace(/\.md$/i, ''), from: x.from, to: x.to, status: x.status || '', next: x.next })
    }
    if (isScorecard(s)) for (const t of tables(text)) {
      const a = t.agent || t.agentin || t['wer'], g = Object.entries(t).find(([k]) => /grade|note|bewertung/.test(k) && !/self|selbst/.test(k))
      const v = g ? gradeValue(g[1]) : null
      if (a && v != null) { const k = agentKey(a); const l = score.get(k); if (l) l.push(v); else score.set(k, [v]) }
    }
    if (isLearnings(s)) for (const it of listItems(text)) learnings.push({ id: r.id, note: r.name.replace(/\.md$/i, ''), ...it })
    if (isQuestions(s)) for (const it of listItems(text)) questions.push({ id: r.id, note: r.name.replace(/\.md$/i, ''), ...it })
    if (inPhases && !inHandoffs) {
      const { props, body } = frontmatter(text), st = (props || []).find((p: { key: string }) => p.key.toLowerCase() === 'status')
      const h1 = /^#\s+(.+)$/m.exec(body), ag = /^\s*(?:agents?|agenten)\s*:\s*(.+)$/im.exec(body)
      phases.push({ id: r.id, name: r.name.replace(/\.md$/i, ''), title: h1 ? h1[1].replace(/[`*]/g, '').trim() : r.name.replace(/\.md$/i, ''), status: st && typeof st.value === 'string' ? st.value : null, ...checkboxes(body),
        gates: [...new Set([...body.matchAll(/\[\[(G\d+[^\]|#]*)/g)].map((m) => m[1].trim()))], agents: ag ? links(ag[1]) : [], handoffs: 0 })
    }
    if (isProposals(s)) for (const t of tables(text)) {
      const ch = Object.entries(t).find(([k]) => /change|vorschlag|änderung|proposal/.test(k))?.[1] || ''
      if (!ch) continue
      const why = Object.entries(t).find(([k]) => /why|warum|grund/.test(k))?.[1] || ''
      const un = (x: string) => x.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b || a).replace(/`/g, '')
      proposals.push({ id: r.id, date: (t.date || t.datum || '').trim() || null, agent: un(t.agent || t.agentin || t.wer || ''), change: un(ch).slice(0, 800), why: un(why).slice(0, 600), status: (t.status || '').toLowerCase().trim() })
    }
  }
  for (const p of phases) p.handoffs = handoffLinks.get(p.name.toLowerCase()) || 0
  phases.sort((a, b) => naturalCmp(a.name, b.name))
  // handoff counts and grades per agent (agents mentioned only in handoffs or the scorecard still count)
  const byKey = new Map(agents.map((a) => [agentKey(a.name), a]))
  for (const h of handoffs) { const k = agentKey(h.agent); if (!k) continue; const a = byKey.get(k); if (a) a.handoffs++ }
  for (const [k, l] of score) { const a = byKey.get(k); if (a) { a.graded = l.length; a.grade = gradeLetter(l.reduce((x, y) => x + y, 0) / l.length) } }
  agents.sort((a, b) => b.handoffs - a.handoffs || a.name.localeCompare(b.name))
  handoffs.sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.name.localeCompare(a.name))
  learnings.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  // Claude Code subagents seen by the live monitor
  const subagents = (db.prepare(`SELECT COALESCE(summary, '') AS type, COUNT(*) AS runs, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, MAX(received_at) AS last
    FROM claude_event WHERE type = 'subagent_finished' GROUP BY COALESCE(summary, '') ORDER BY last DESC LIMIT 40`).all() as unknown as SubagentRun[])
  return { agents, handoffs: handoffs.slice(0, MAX_HANDOFFS), handoffTotal: handoffs.length, questions, learnings: learnings.slice(0, 300), subagents, phases, proposals, scanned }
}

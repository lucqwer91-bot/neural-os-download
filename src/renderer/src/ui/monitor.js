// Real Claude Code monitoring in the renderer (Phase 3, spec 6 and S1).
// Talks to the main process through window.neuralOS.monitor (see src/preload/index.ts).
// Pure helpers are exported for unit tests; rendering stays in the legacy file for now.

export const monBridge = () => (typeof window !== "undefined" && window.neuralOS && window.neuralOS.monitor) || null;

// cached state; refreshMonitor() reloads it
export const mon = { ctx: null, ctxPlan: null, ctxRemove: false, rule: null, rulePlan: null, ruleRemove: false, reports: [], ready: false, status: null, sessions: [], events: [], changes: [], plan: null, planRemove: false, result: null, change: null, sel: "" };

export async function refreshMonitor(onChange) {
  const b = monBridge(); if (!b) return;
  try {
    const [status, sessions, events, changes, rule, reports] = await Promise.all([b.status(), b.sessions(), b.events({ limit: 300 }), b.changes(),
      b.ruleStatus ? b.ruleStatus() : null, b.ruleReports ? b.ruleReports() : []]);
    Object.assign(mon, { status, sessions, events, changes, rule, reports, ready: true });
    if (b.ctxStatus) b.ctxStatus().then(c => { mon.ctx = c; onChange && onChange(); }).catch(() => {});   // slower: looks for the claude command
  } catch (_) { mon.ready = false; }
  onChange && onChange();
}

/** True once real monitoring is set up or real events exist: demo activity stops then. */
export const isLive = () => !!(mon.ready && (mon.status && mon.status.installed || mon.events.length));

/** Adds a live event to the cache (newest first). */
export function addLive(p, max = 300) {
  if (!p || !p.event) return;
  mon.events.unshift(p.event);
  if (mon.events.length > max) mon.events.length = max;
  if (p.session) {
    const i = mon.sessions.findIndex(s => s.id === p.session.id);
    const prev = i >= 0 ? mon.sessions[i] : null;
    const s = { ...p.session, excluded: prev ? prev.excluded : false };
    if (i >= 0) mon.sessions.splice(i, 1);
    mon.sessions.unshift(s);
  }
  if (p.change && !mon.changes.some(c => c.id === p.change.id)) {
    const { before_text, after_text, ...c } = p.change;
    mon.changes.unshift(c);
  }
}

/** Last path segment of a folder or file path, for both separators. */
export const baseName = p => (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";

/** A session is active when it has not ended and was seen in the last 30 minutes. */
export const isActive = (s, now = Date.now()) => !s.ended_at && now - Date.parse(s.last_at) < 30 * 60e3;

// tools with their own wording (same keys as the demo events)
const TOOL_KEY = { Read: "e_Read", Edit: "e_Edit", Write: "e_Edit", MultiEdit: "e_Edit", NotebookEdit: "e_Edit", Bash: "e_Bash", PowerShell: "e_Bash",
  WebSearch: "e_WebSearch", TodoWrite: "e_TodoWrite", Skill: "e_Skill", Agent: "e_Agent", Task: "e_Agent" };

/** Timeline rows: a started tool is hidden once its result arrived (one row per tool call). */
export function timelineEvents(events) {
  const done = new Set(events.filter(e => e.type !== "tool_started" && e.tool_use_id).map(e => e.tool_use_id));
  return events.filter(e => e.type !== "tool_started" || !e.tool_use_id || !done.has(e.tool_use_id));
}

/** i18n key for an event row. Unknown hooks keep their own name (shown as received). */
export function eventKey(e) {
  switch (e.type) {
    case "session_started": return "m_start";
    case "session_ended": return "m_end";
    case "prompt_submitted": return "m_prompt";
    case "turn_finished": return "m_turn";
    case "subagent_started": return "m_subStart";
    case "subagent_finished": return "m_subStop";
    case "model_switched": return "m_model";
    case "readiness_report": return "m_ready";
    case "session_summary": return "m_summary";
    case "lesson_noted": return "m_lesson";
    case "tool_failed": return "m_failed";
    case "tool_started": case "tool_finished": return e.tool && e.tool.startsWith("mcp__") ? "e_mcp" : TOOL_KEY[e.tool] || "m_tool";
    default: return "m_other";
  }
}

/** Detail text for an event: file name, first word of a command, host, MCP server, or tool name. */
export function eventDetail(e) {
  if (e.type === "readiness_report") return "";
  if (e.file_path) return baseName(e.file_path);
  if (e.tool && TOOL_KEY[e.tool] && e.summary) return e.summary;
  if (e.tool && e.tool.startsWith("mcp__")) { const m = /^mcp__(.+?)__(.*)$/.exec(e.tool); return m ? m[1] + " · " + m[2] : e.tool; }
  if (e.summary && e.tool) return e.tool + " · " + e.summary;
  return e.tool || e.summary || "";
}

/**
 * Line diff (longest common subsequence). Returns [op, text] with op " ", "-" or "+".
 * Big inputs fall back to "all removed, all added" so the UI never freezes.
 */
export function lineDiff(a, b, maxCells = 4e6) {
  const A = a == null ? [] : String(a).split("\n"), B = b == null ? [] : String(b).split("\n");
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const head = A.slice(0, s).map(l => [" ", l]), tail = A.slice(ea).map(l => [" ", l]);
  const a2 = A.slice(s, ea), b2 = B.slice(s, eb), n = a2.length, m = b2.length;
  if (n * m > maxCells) return [...head, ...a2.map(l => ["-", l]), ...b2.map(l => ["+", l]), ...tail];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a2[i] === b2[j]) { mid.push([" ", a2[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) mid.push(["-", a2[i++]]);
    else mid.push(["+", b2[j++]]);
  }
  while (i < n) mid.push(["-", a2[i++]]);
  while (j < m) mid.push(["+", b2[j++]]);
  return [...head, ...mid, ...tail];
}

/** Keeps changed lines with `ctx` lines around them; gaps become ["…", count]. */
export function compactDiff(d, ctx = 2) {
  const keep = d.map(([op]) => op !== " ");
  const show = d.map((_, i) => { for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) if (keep[k]) return true; return false; });
  const out = []; let gap = 0;
  d.forEach((x, i) => { if (show[i]) { if (gap) { out.push(["…", gap]); gap = 0; } out.push(x); } else gap++; });
  if (gap) out.push(["…", gap]);
  return out;
}

export const diffStats = d => ({ add: d.filter(x => x[0] === "+").length, del: d.filter(x => x[0] === "-").length });

// Setup guide (Settings → "Einrichtung", command palette "Einrichtung"): the steps a new user
// takes, each with its real state on this computer. Pure: it only reads the library and
// monitor state it is given, so it can be tested without the app.

export const TRIED_KEY = "nos-ctx-tried";
export const PICK_KEY = "nos-setup-pick";

// What the user wants (chosen at the top of the guide); each step belongs to one or more goals.
// notes = my notes in the brain, watch = see Claude work live, memory = Claude remembers (rule + context),
// apps = look for connectors for the programs on this computer (no steps, its own list).
export const GOALS = ["notes", "watch", "memory", "apps"];
const STEP_GOALS = { node: ["watch", "memory"], notes: ["notes"], connect: ["watch"], session: ["watch"], rule: ["memory"], context: ["memory"], try: ["memory"] };
/** saved choice -> array of goals; nothing saved = everything */
export function readPick(raw) {
  try { const a = JSON.parse(raw); if (Array.isArray(a)) return GOALS.filter(g => a.includes(g)); } catch (_) { /* not saved yet */ }
  return GOALS.slice();
}

/**
 * Steps in order. done: true/false; na: the step cannot be checked here (no app bridge).
 * go: where the button leads (module + optional tab).
 */
export function setupSteps({ hasBridge, libCount, mon, tried, pick = GOALS }) {
  const S = (mon && mon.status) || null, R = (mon && mon.rule) || null, C = (mon && mon.ctx) || null;
  const sessions = (mon && mon.sessions) || [];
  const st = (v) => (!hasBridge ? { done: false, na: true } : { done: !!v, na: false });
  return [
    { k: "node", ...st(S && S.node), go: null },
    { k: "notes", ...st(libCount > 0), go: { m: "memory", tab: "lib" } },
    { k: "connect", ...st(S && S.installed && !S.outdated), go: { m: "activity", tab: "live", act: "mon" } },
    { k: "session", ...st(sessions.length > 0), go: { m: "activity", tab: "live" } },
    { k: "rule", ...st(R && R.installed && !R.outdated), go: { m: "connectors", act: "rule" } },
    { k: "context", ...st(C && C.installed && !C.outdated), go: { m: "connectors", act: "ctx" } },
    { k: "try", ...st(tried), go: null }
  ].filter(s => STEP_GOALS[s.k].some(g => pick.includes(g)));
}

/** How many steps are done (n of total), for the Settings row. */
export function setupProgress(steps) {
  return { n: steps.filter((s) => s.done).length, total: steps.length };
}

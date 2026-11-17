// Groups for real library files: colour by project, folder or file type, a legend with counts,
// and a month histogram ("when you wrote"). Pure functions so they can be unit tested.
import { nameColor, hsl } from "../brain/colors.js";

export const GROUP_BY = ["project", "top", "folder", "type", "time", "tag"];
const NONE = "\u0000none";   // files without a project / folder; shown with a translated label

/** folder a file lives in: linked = parent folder inside the vault (or the vault root), copy = parent folder of the original */
export function folderOf(row) {
  const p = String((row.source === "linked" ? row.rel_path : row.original_path) || "").split(/[\\/]/).filter(Boolean);
  if (p.length > 1) return p[p.length - 2];
  return row.source === "linked" && row.folder_name ? row.folder_name : NONE;
}

/** main folder: the first folder inside the linked folder (or the linked folder itself), for copies the project */
export function topOf(row) {
  if (row.source === "linked") {
    const p = String(row.rel_path || "").split(/[\\/]/).filter(Boolean);
    if (p.length > 1) return p[0];
    return row.folder_name || NONE;
  }
  return row.project || NONE;
}

// tags come from the notes themselves (lib:tags, loaded on demand); file id -> its most common tag
let TAGS = new Map();
/** tagIndex result ({tags:[{tag,count}], files:{tag:[ids]}}) -> each note gets its most common tag */
export function setTags(index) {
  const m = new Map();
  for (const { tag } of (index && index.tags) || []) for (const id of index.files[tag] || []) if (!m.has(id)) m.set(id, tag);
  TAGS = m;
}
export const tagsLoaded = () => TAGS.size > 0;

/** @returns {string} group key of a file row */
export function groupOf(row, by) {
  if (by === "type") return (row.ext || "").toLowerCase() || NONE;
  if (by === "folder") return folderOf(row);
  if (by === "top") return topOf(row);
  if (by === "time") return monthOf(row) || NONE;
  if (by === "tag") return TAGS.get(row.id) || NONE;
  return row.project || NONE;
}
export const isNone = k => k === NONE;

// file types get fixed, well separated hues so md/png/luau never look alike
const TYPE_HUE = { md: .53, txt: .58, luau: .08, lua: .1, json: .14, png: .83, jpg: .86, jpeg: .86, gif: .9, webp: .88, pdf: .0, docx: .62, rbxl: .3, rbxm: .33 };
// 12 clearly different hues; groups get a slot from their name, and a taken slot moves on to the next free one,
// so the groups on screen never share a colour (up to 12) and a group keeps its colour while the set stays the same
const PALETTE = [.52, .9, .07, .25, .75, .15, .6, .0, .36, .82, .45, .11].map(h => hsl(h, .9, .6));
const slots = new Map();   // by -> Map(key -> slot)
// time: a colour ramp from old (violet) over magenta and orange to new (yellow). Months get their place on
// the ramp by how many files came before them, so a vault that grew mostly last year still uses the whole ramp.
const RAMP = [[.36, .3, .95], [.78, .3, .85], [1, .42, .38], [1, .66, .2], [1, .93, .45]];
let timePos = new Map();   // month -> 0..1
export function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i, a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const hashOf = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0) || 0; h = Math.imul(h, 16777619); } return h >>> 0; };
/** fix the colour slots for the groups that exist now (call after the library changed) */
export function assignColors(rows, by) {
  if (by === "time") {
    const n = new Map(); let total = 0;
    for (const r of rows) { const m = monthOf(r); if (m) { n.set(m, (n.get(m) || 0) + 1); total++; } }
    let before = 0; timePos = new Map();
    for (const m of [...n.keys()].sort()) { const c = n.get(m); timePos.set(m, total ? (before + c / 2) / total : .5); before += c; }
    return;
  }
  const keys = [...new Set(rows.map(r => groupOf(r, by)))].filter(k => k !== NONE).sort();
  const m = new Map(), used = new Set();
  for (const k of keys) {
    let s = hashOf(k) % PALETTE.length;
    if (used.size < PALETTE.length) while (used.has(s)) s = (s + 1) % PALETTE.length;
    used.add(s); m.set(k, s);
  }
  slots.set(by, m);
}
/** @returns {[number,number,number]} */
export function groupColor(key, by) {
  if (key === NONE) return [.55, .58, .62];
  if (by === "time") return rampColor(timePos.has(key) ? timePos.get(key) : 1);
  if (by === "type" && key in TYPE_HUE) return hsl(TYPE_HUE[key], .85, .6);
  const m = slots.get(by);
  if (m && m.has(key)) return PALETTE[m.get(key)];
  return nameColor(key);
}

/** groups sorted by file count, biggest first */
export function groupCounts(rows, by) {
  const m = new Map();
  for (const r of rows) { const k = groupOf(r, by); m.set(k, (m.get(k) || 0) + 1); }
  const list = [...m].map(([key, n]) => ({ key, n }));
  // time: newest month first, files without a date last
  if (by === "time") return list.sort((a, b) => (a.key === NONE) - (b.key === NONE) || String(b.key).localeCompare(String(a.key)));
  return list.sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
}

/** "YYYY-MM" of the file's own date (last change), falling back to the import date */
export function monthOf(row) {
  const d = row.mtime ? new Date(row.mtime) : row.imported_at ? new Date(row.imported_at) : null;
  if (!d || isNaN(+d)) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/**
 * Month histogram. Every month between the first and last one is present (empty months count 0),
 * each with its counts per group. At most `maxMonths` (newest kept).
 */
export function histogram(rows, by, maxMonths = 72) {
  const per = new Map(); let undated = 0;
  for (const r of rows) {
    const m = monthOf(r); if (!m) { undated++; continue; }
    const g = groupOf(r, by), x = per.get(m) || new Map(); x.set(g, (x.get(g) || 0) + 1); per.set(m, x);
  }
  const keys = [...per.keys()].sort();
  const months = [];
  if (keys.length) {
    let [y, mo] = keys[0].split("-").map(Number); const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && mo <= lm)) {
      const k = y + "-" + String(mo).padStart(2, "0"), g = per.get(k) || new Map();
      months.push({ month: k, total: [...g.values()].reduce((a, b) => a + b, 0), groups: g });
      if (++mo > 12) { mo = 1; y++; }
    }
  }
  const cut = Math.max(0, months.length - maxMonths);
  const hidden = months.slice(0, cut).reduce((a, m) => a + m.total, 0);
  return { months: months.slice(cut), undated, hidden, max: Math.max(1, ...months.slice(cut).map(m => m.total)) };
}

/** ids of the rows in one month */
export const idsInMonth = (rows, month) => new Set(rows.filter(r => monthOf(r) === month).map(r => r.id));
/** ids of the rows in one group */
export const idsInGroup = (rows, by, key) => new Set(rows.filter(r => groupOf(r, by) === key).map(r => r.id));

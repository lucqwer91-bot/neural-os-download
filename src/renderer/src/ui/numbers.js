// "Numbers": plain statistics about the user's own library, all from real rows and links.
import { monthOf, histogram } from "./groups.js";

const NOTE = new Set(["md", "txt"]);

/**
 * @param {any[]} rows library rows (listFiles)
 * @param {any[]} links knowledge edges (listLinks)
 * @param {number} now ms
 */
export function computeNumbers(rows, links, now = Date.now()) {
  const notes = rows.filter(r => NOTE.has(r.ext)).length;
  const bytes = rows.reduce((a, r) => a + (r.size || 0), 0);
  const projects = new Set(rows.map(r => r.project).filter(Boolean)).size;
  const linked = links.filter(l => l.status === "linked");
  const byUser = linked.filter(l => l.origin === "user").length;
  const suggested = links.filter(l => l.status === "suggested").length;
  const deg = new Map();
  for (const l of linked) { deg.set(l.from_id, (deg.get(l.from_id) || 0) + 1); deg.set(l.to_id, (deg.get(l.to_id) || 0) + 1); }
  const orphans = rows.filter(r => !deg.get(r.id)).length;
  const hubs = rows.filter(r => r.links > 0).sort((a, b) => b.links - a.links || a.name.localeCompare(b.name)).slice(0, 5);
  const largest = rows.slice().sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 3);
  const types = new Map(); for (const r of rows) { const k = (r.ext || "").toLowerCase() || "—"; types.set(k, (types.get(k) || 0) + 1); }
  const H = histogram(rows, "type", 100000);
  const busiest = H.months.reduce((b, m) => (!b || m.total > b.total ? m : b), null);
  const day = 864e5;
  const recent = rows.filter(r => { const t = r.mtime || Date.parse(r.imported_at); return t && now - t <= 30 * day; }).length;
  const dated = rows.map(monthOf).filter(Boolean).sort();
  return {
    files: rows.length, notes, other: rows.length - notes, bytes, projects,
    links: linked.length, byUser, auto: linked.length - byUser, suggested,
    orphans, hubs, largest,
    types: [...types].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n),
    busiest: busiest && busiest.total ? busiest : null, recent,
    first: dated[0] || null, last: dated[dated.length - 1] || null,
  };
}

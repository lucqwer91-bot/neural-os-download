// Command palette search (Ctrl/Cmd+K). Pure: the caller supplies the items and note sources.

// Short excerpt around a full-text hit, on one line.
export function excerptAt(src, j) {
  return "…" + src.slice(Math.max(0, j - 26), j + 44).replace(/\n/g, " ") + "…";
}

// items: [{label, kind, run}]. Matches by label; from two characters on, notes whose text
// (but not whose name) contains the query are added as full-text hits with an excerpt.
// Excerpts are left out in privacy mode. Returns at most `limit` entries.
/**
 * @param {{label:string, kind:string, run:Function, ex?:string}[]} items
 * @param {string} query
 * @param {{files?:{n:string}[], srcOf?:(i:number)=>string, nameOf?:(F:{n:string}, i:number)=>string, hitKind?:string, open?:(i:number)=>void, privacy?:boolean, limit?:number}} [opts]
 */
export function paletteMatches(items, query, { files = [], srcOf, nameOf = (F) => F.n, hitKind = "", open = () => {}, privacy = false, limit = 12 } = {}) {
  const q = query.trim().toLowerCase();
  const out = items.filter(x => x.label.toLowerCase().includes(q));
  if (q.length >= 2 && srcOf) {
    files.forEach((F, i) => {
      const s = srcOf(i), j = s.toLowerCase().indexOf(q);
      if (j >= 0 && !F.n.toLowerCase().includes(q))
        out.push({ label: nameOf(F, i), kind: hitKind, ex: privacy ? "" : excerptAt(s, j), run: () => open(i) });
    });
  }
  return out.slice(0, limit);
}

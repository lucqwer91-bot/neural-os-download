// File explorer module (Obsidian replacement, Paket 1): linked folders as a tree with their real folders
// (also empty ones, from fs:tree) and the files of the index. Folders open on click; a file opens its
// note. Changes (new, rename, move by drag and drop, trash with undo) only where editing is on.

const PER_DIR = 400;

export const FS = { tree: null, open: new Set(), ren: null, undo: null, busy: false, dropOn: null, more: new Set() };

const parentOf = rel => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const baseOf = rel => rel.split("/").pop();

/** Folders and files of one linked folder, grouped by parent folder. */
export function buildIndex(folder, rows) {
  const dirs = new Map([["", []]]);
  for (const d of folder.dirs) { if (!dirs.has(d)) dirs.set(d, []); const p = parentOf(d); if (!dirs.has(p)) dirs.set(p, []); }
  const files = new Map();
  for (const r of rows) {
    if (r.folder_id !== folder.folderId || !r.rel_path) continue;
    const p = parentOf(r.rel_path);
    if (!files.has(p)) files.set(p, []);
    files.get(p).push(r);
    // a file in a folder the tree did not list (just created, or tree capped): show the folder anyway
    let q = p;
    while (q && !dirs.has(q)) { dirs.set(q, []); q = parentOf(q); }
  }
  const sub = new Map();
  for (const d of dirs.keys()) { if (!d) continue; const p = parentOf(d); if (!sub.has(p)) sub.set(p, []); sub.get(p).push(d); }
  for (const l of sub.values()) l.sort((a, b) => baseOf(a).localeCompare(baseOf(b), undefined, { sensitivity: "base" }));
  for (const l of files.values()) l.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return { sub, files };
}

/** Number of files below a folder (for the count next to it). */
function countBelow(idx, rel) {
  let n = (idx.files.get(rel) || []).length;
  for (const d of idx.sub.get(rel) || []) n += countBelow(idx, d);
  return n;
}

export function filesBody({ t, tf, esc, privacy, rows, curId }) {
  if (!FS.tree) return `<p class="hint">${t("fxLoading")}</p>`;
  if (!FS.tree.length) return `<p class="hint">${t("fxNone")}</p><div class="btns"><button class="btn sm" type="button" data-x="tryexample">${t("imp_example")}</button></div><p class="hint">${t("imp_example_d")}</p>`;
  const nm = s => (privacy ? "…" : esc(s));
  let h = "";
  if (FS.undo) h += `<div class="fsnote">${esc(tf("fxTrashed", { n: baseOf(FS.undo.rel) }))} <button class="btn sm" type="button" data-x="fsundo">${t("fxUndo")}</button></div>`;
  for (const f of FS.tree) {
    const idx = buildIndex(f, rows), rootKey = f.folderId + "|";
    const ed = f.editable;
    const tools = (key, isDir) => ed ? `<span class="fst">${isDir ? `<button type="button" data-x="fsnew:${esc(key)}" title="${esc(t("fxNewNote"))}">＋</button><button type="button" data-x="fsdir:${esc(key)}" title="${esc(t("fxNewFolder"))}">▭</button>` : ""}${key !== rootKey ? `<button type="button" data-x="fsren:${esc(key)}" title="${esc(t("fxRename"))}">✎</button><button type="button" data-x="fstrash:${esc(key)}" title="${esc(t("fxTrash"))}">🗑</button>` : ""}</span>` : "";
    const renInput = (key, name) => `<input class="fsren" id="fsren" data-k="${esc(key)}" value="${esc(name)}" spellcheck="false">`;
    const dirRow = (rel, depth) => {
      const key = f.folderId + "|" + rel, open = FS.open.has(key) || rel === "";
      const name = rel ? baseOf(rel) : f.name, n = countBelow(idx, rel);
      const head = `<div class="ft d${FS.dropOn === key ? " drop" : ""}${rel ? "" : " root"}" data-fd="${esc(key)}"${ed && rel ? ' draggable="true"' : ""} style="padding-left:${6 + depth * 14}px"><span class="car">${open ? "▾" : "▸"}</span>${FS.ren === key ? renInput(key, name) : `<span class="fn" data-x="fsopen:${esc(key)}">${nm(name)}</span>`}<small>${n}</small>${rel ? "" : `<span class="pill ${ed ? "ok" : "mute"}">${t(ed ? "edTagOn" : "roTag")}</span>`}${tools(key, true)}</div>`;
      if (!open) return head;
      let body = "";
      for (const d of idx.sub.get(rel) || []) body += dirRow(d, depth + 1);
      const fl = idx.files.get(rel) || [], lim = FS.more.has(key) ? fl.length : PER_DIR;
      for (const r of fl.slice(0, lim)) {
        const fk = f.folderId + "|" + r.rel_path;
        body += `<div class="ft f${r.id === curId ? " sel" : ""}" data-ff="${esc(fk)}" data-id="${esc(r.id)}"${ed ? ' draggable="true"' : ""} style="padding-left:${20 + depth * 14}px">${FS.ren === fk ? renInput(fk, r.ext === "md" ? r.name.replace(/\.md$/i, "") : r.name) : `<span class="fn" data-real="${esc(r.id)}">${nm(r.ext === "md" ? r.name.replace(/\.md$/i, "") : r.name)}</span>${r.ext && r.ext !== "md" ? `<small>${esc(r.ext)}</small>` : ""}`}${tools(fk, false)}</div>`;
      }
      if (fl.length > lim) body += `<div class="ft more" style="padding-left:${20 + depth * 14}px"><button class="btn sm" type="button" data-x="fsmore:${esc(key)}">${esc(tf("fxMore", { n: fl.length - lim }))}</button></div>`;
      return head + body;
    };
    h += `<div class="fstree">${dirRow("", 0)}</div>`;
    if (!ed) h += `<p class="hint" style="margin-top:2px">${t("fxRoHint")}</p>`;
  }
  return h + `<p class="hint">${t("fxHint")}</p>`;
}

export const splitKey = k => { const i = k.indexOf("|"); return [k.slice(0, i), k.slice(i + 1)]; };
export { parentOf, baseOf };

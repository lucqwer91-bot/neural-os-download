// Real library (Phase 2), shown above the demo data in Memory → Library.
// Talks to the main process through window.neuralOS.library (see src/preload/index.ts).
// In a plain browser (design previews) the bridge is missing and nothing real is shown.

export const bridge = () => (typeof window !== "undefined" && window.neuralOS && window.neuralOS.library) || null;

export const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : b > 0 ? Math.max(1, Math.round(b / 1e3)) + " KB" : "0 KB";

// cached state; refreshLibrary() reloads it and calls onChange
export const lib = { ready: false, libDir: "", count: 0, bytes: 0, byType: {}, rows: [], links: [], folders: [], autoLink: true };

export async function refreshLibrary(onChange) {
  const b = bridge(); if (!b) return;
  try {
    const [info, rows, links, folders, autoLink] = await Promise.all([b.info(), b.list(), b.links(), b.folders(), b.getAutoLink()]);
    Object.assign(lib, info, { rows, links, folders, autoLink, ready: true });
  } catch (_) { lib.ready = false; }
  onChange && onChange();
}

/**
 * HTML for the real library block.
 * @param {(k:string)=>string} t translate
 * @param {(k:string,o:object)=>string} tf translate with values
 * @param {(s:string)=>string} esc
 * @param {boolean} privacy hide names and paths
 */
export function libraryBlock(t, tf, esc, privacy) {
  if (!bridge()) return "";
  if (!lib.ready) return `<div class="sec">${t("realLib")}</div><p class="hint">…</p>`;
  const types = Object.keys(lib.byType);
  const shown = lib.typeFilter ? lib.rows.filter(r => (r.ext || "—") === lib.typeFilter) : lib.rows;
  const rows = shown.slice(0, 50).map((r, i) => `<div class="row" data-real="${esc(r.id)}" style="cursor:pointer"><span class="n">${esc(privacy ? (t("files") + " " + (i + 1)) : r.name)}</span><span class="m">${esc(privacy ? "…" : (r.project || t("noProject")))} · ${esc(r.ext || "—")} · ${fmtBytes(r.size)}${r.links ? " · " + esc(tf("linksN", { n: r.links })) : ""}${r.source === "linked" ? " · " + esc(t("linkedTag")) : ""}</span><span class="pill ${r.status === "indexed" ? "ok" : r.status === "failed" ? "bad" : r.status === "indexing" ? "warn" : r.status === "nameonly" ? "mute" : "mute"}">${esc(t("st_" + r.status))}</span></div>`).join("");
  return `<div class="sec">${t("realLib")}</div>
  <div class="kv"><span>${t("libFiles")}</span><span>${lib.count} · ${fmtBytes(lib.bytes)}</span></div>
  ${types.length ? `<div class="chips">${types.map(k => `<button type="button" class="chip${lib.typeFilter === k ? " on" : ""}" data-x="rltype:${esc(k)}">${esc(k)}<em>${lib.byType[k]}</em></button>`).join("")}</div>` : `<p class="hint">${t("realLibEmpty")}</p>`}
  ${rows ? `<div class="list">${rows}</div>` : ""}
  ${shown.length > 50 ? `<p class="hint">${tf("realLibMore", { a: 50, b: shown.length })}</p>` : ""}
  <div class="btns"><button class="btn pri" type="button" data-x="libnew">${t("edNew")}</button><button class="btn" type="button" data-x="libdaily">${t("dailyNote")}</button><button class="btn" type="button" data-x="libadd:files">${t("addFiles")}</button><button class="btn" type="button" data-x="libadd:folder">${t("addFolder")}</button><button class="btn" type="button" data-x="liblink">${t("linkFolder")}</button><button class="btn${lib.health ? " on" : ""}" type="button" data-x="libhealth">${t("hlCheck")}</button></div>
  ${lib.health ? healthBlock(lib.health, t, tf, esc, privacy) : ""}
  ${lib.folders.length ? `<div class="sec">${t("linkedFolders")}</div>${lib.folders.map(f => `<div class="row"><span class="n">${esc(privacy ? "…" : f.name)}<small style="display:block;color:var(--silver);font-size:11px">${f.files} ${esc(t("files"))} · ${fmtBytes(f.bytes)} · ${esc(t(f.editable ? "edTagOn" : "roTag"))}</small></span><span class="seg sm" title="${esc(t("edFolderTip"))}"><button type="button" data-x="libedit:${esc(f.id)}:0" class="${f.editable ? "" : "on"}">${t("edRo")}</button><button type="button" data-x="libedit:${esc(f.id)}:1" class="${f.editable ? "on" : ""}">${t("edRw")}</button></span><button class="btn sm${lib.exclOpen === f.id || f.exclude ? " on" : ""}" type="button" data-x="libexcl:${esc(f.id)}" title="${esc(t("exclTip"))}">${t("excl")}</button><button class="btn sm" type="button" data-x="librescan:${esc(f.id)}" title="${esc(t("rescanTip"))}">${t("rescan")}</button><button class="btn sm" type="button" data-x="libunlink:${esc(f.id)}">${t("unlink")}</button></div>${lib.exclOpen === f.id ? exclEditor(f, t, esc) : ""}`).join("")}<p class="hint">${t("liveWatch")}</p>` : ""}
  <div class="row"><span class="n">${t("autoLink")}</span><span class="seg sm"><button type="button" data-x="autolink:1" class="${lib.autoLink ? "on" : ""}">${t("on")}</button><button type="button" data-x="autolink:0" class="${lib.autoLink ? "" : "on"}">${t("off")}</button></span></div>
  <p class="hint" style="margin-top:2px">${t("autoLinkD")}</p>
  <div class="row"><span class="n mono">${esc(privacy ? "…" : lib.libDir)}</span><button class="btn sm" type="button" data-x="libopen">${t("openFolder")}</button></div>
  <div class="sec">${t("demoBelow")} <span class="tag">${t("demo")}</span></div>`;
}

function exclEditor(f, t, esc) {
  return `<div class="excl"><p class="hint" style="margin:0 0 4px">${esc(t("exclD"))}</p><textarea id="lexcl" rows="4" spellcheck="false" placeholder="${esc(t("exclPh"))}">${esc(f.exclude || "")}</textarea><div class="btns"><button class="btn sm pri" type="button" data-x="libexclok:${esc(f.id)}">${t("exclSave")}</button><button class="btn sm" type="button" data-x="libexcl:${esc(f.id)}">${t("cancel")}</button></div></div>`;
}

/** Broken [[links]] and notes without links (read-only report, lib:health). */
export function healthBlock(h, t, tf, esc, privacy) {
  const nm = (n, i) => esc(privacy ? t("files") + " " + (i + 1) : n.replace(/\.md$/i, ""));
  const broken = h.broken.map((b, i) => `<div class="row hl"><span class="n">${esc(privacy ? "…" : "[[" + b.stem + "]]")}<small>${b.from.map((f, j) => `<a class="wl" data-real="${esc(f.id)}">${nm(f.name, j)}</a>`).join(", ")}${b.count > b.from.length ? " …" : ""}</small></span><span class="pill warn">${esc(tf("hlFromN", { n: b.count }))}</span></div>`).join("");
  const orph = h.orphans.slice(0, 60).map((o, i) => `<a class="chip" data-real="${esc(o.id)}">${nm(o.name, i)}</a>`).join("");
  return `<div class="sec">${t("hlTitle")}</div>
  <div class="kv"><span>${t("hlBroken")}</span><span>${esc(tf("hlBrokenN", { n: h.brokenTotal, m: h.brokenNotes }))}</span></div>
  ${broken ? `<div class="list hlist">${broken}</div>${h.brokenTotal > h.broken.length ? `<p class="hint">${esc(tf("realLibMore", { a: h.broken.length, b: h.brokenTotal }))}</p>` : ""}` : `<p class="hint">${t("hlBrokenNone")}</p>`}
  <div class="kv"><span>${t("hlOrphans")}</span><span>${esc(tf("hlOrphansN", { n: h.orphanTotal, m: h.notes }))}</span></div>
  ${orph ? `<div class="chips">${orph}</div>${h.orphanTotal > 60 ? `<p class="hint">${esc(tf("realLibMore", { a: 60, b: h.orphanTotal }))}</p>` : ""}` : ""}
  <p class="hint">${t("hlHint")}</p>`;
}

// one-line summary after an import, e.g. "3 imported · 2 sorted into “Roblox Game” · 4 links"
export function importSummary(r, t, tf) {
  const o = r.organized || { links: 0, suggested: 0, projects: {} };
  const p = Object.entries(o.projects).map(([name, n]) => tf("sortedInto", { n, p: name })).join(", ") || t("notSorted");
  let s = tf("imp_org", { a: r.imported.length, p, l: o.links });
  if (r.duplicates.length || r.failed.length) s += " · " + tf("imp_res", { a: r.imported.length, b: r.duplicates.length, c: r.failed.length }).split(", ").slice(1).join(", ");
  return s;
}

export function linkSummary(r, t, tf) {
  const p = Object.entries(r.projects || {}).map(([name, n]) => tf("sortedInto", { n, p: name })).join(", ");
  return tf("link_res", { f: r.folders, n: r.files, l: r.links }) + (p ? " · " + p : "");
}

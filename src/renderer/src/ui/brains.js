// Memory → Brains: share my brain as a .brain file, import other people's brains (read-only),
// show/hide them next to mine. NEURAL OS uploads nothing: the user shares the file themselves.

export const brainsBridge = () => (typeof window !== "undefined" && window.neuralOS && window.neuralOS.brains) || null;

/** shared state for the tab, the panel and the 3D layer */
export const BR = {
  list: [], ready: false,
  exp: { name: "", author: "", projects: null, sessions: false },   // projects: null = all, else Set of names ("" = no project)
  plan: null, busy: null, prog: null, last: null, err: null,
  data: new Map(),      // brain id → { name, author, files, links, bridges }
  content: new Map()    // brain id + "|" + file id → read result
};

/** my projects for the export form: name ("" = no project), files, bytes; sessions counted apart */
export function projectList(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.source === "session" || r.project === "Claude Sessions") continue;
    const k = r.project || "", x = m.get(k) || { name: k, files: 0, bytes: 0 };
    x.files++; x.bytes += r.size || 0; m.set(k, x);
  }
  return [...m.values()].sort((a, b) => (a.name === "") - (b.name === "") || a.name.localeCompare(b.name));
}

/** what the export call gets */
export function exportOpts(exp, fallbackName) {
  return { name: exp.name.trim() || fallbackName, author: exp.author.trim() || null, projects: exp.projects ? [...exp.projects].map(p => p || null) : null, sessions: !!exp.sessions };
}

const pct = p => p && p.total ? Math.round(p.done / p.total * 100) : 0;

export function brainsBlock({ t, tf, esc, fmtB, nm, rows, tints, bridgeCounts }) {
  const B = brainsBridge();
  if (!B) return `<p class="hint">${t("bNoApp")}</p>`;
  const projs = projectList(rows), sel = BR.exp.projects, sessN = rows.filter(r => r.source === "session" || r.project === "Claude Sessions").length;
  const plan = BR.plan ? tf("bPlan", { n: BR.plan.files.toLocaleString(), s: fmtB(BR.plan.bytes) }) : "…";
  const busy = BR.busy, prog = busy ? `<div class="bar"><i style="width:${pct(BR.prog)}%"></i></div><p class="hint">${tf(busy === "export" ? "bSaving" : "bImporting", { d: (BR.prog?.done || 0).toLocaleString(), t: (BR.prog?.total || 0).toLocaleString() })}</p>` : "";
  const last = BR.last ? `<div class="note-ok">${esc(tf("bSaved", { n: BR.last.files.toLocaleString(), s: fmtB(BR.last.bytes) }))}${BR.last.missing ? "<br>" + esc(tf("bMissing", { n: BR.last.missing })) : ""}<div class="btns" style="margin-top:6px"><button class="btn sm" type="button" data-x="breveal">${t("bReveal")}</button></div></div>` : "";
  const err = BR.err ? `<div class="note-w">${esc(tf("bFailed", { e: BR.err }))}</div>` : "";
  const share = `<div class="sec">${t("bShareH")}</div><p class="hint" style="margin-top:0">${t("bShareD")}</p>
  <div class="fld"><input id="bname" class="inp" placeholder="${esc(t("bName"))}" value="${esc(BR.exp.name)}"><input id="bauthor" class="inp" placeholder="${esc(t("bAuthor"))}" value="${esc(BR.exp.author)}"></div>
  <div class="sub">${t("bProjects")}</div>
  <div class="list">${!projs.length ? `<p class="hint" style="margin:0">${t("bNoFiles")}</p>` : `<label class="row"><input type="checkbox" data-x="bproj:all"${sel ? "" : " checked"}><span class="n">${t("all")}</span></label>` + projs.map((p, i) => `<label class="row"><input type="checkbox" data-x="bproj:${i}"${!sel || sel.has(p.name) ? " checked" : ""}><span class="n">${esc(p.name ? nm(p.name, "p") : t("noProject"))}</span><span class="m">${p.files.toLocaleString()} · ${fmtB(p.bytes)}</span></label>`).join("")}</div>
  <label class="row" style="margin-top:6px"><input type="checkbox" data-x="bsess"${BR.exp.sessions ? " checked" : ""}><span class="n">${t("bSessions")}</span><span class="m">${sessN.toLocaleString()}</span></label>
  <div class="kv"><span>${t("bSize")}</span><span>${plan}</span></div>
  <div class="btns"><button class="btn pri" type="button" data-x="bexport"${busy || !BR.plan || !BR.plan.files ? " disabled" : ""}>${t("bSave")}</button></div>${busy === "export" ? prog : ""}${last}`;
  const items = BR.list.map((b, k) => {
    const tint = tints[b.id];
    return `<div class="brow"><span class="bdot" style="background:${tint || "transparent"};border-color:${tint || "var(--silver)"}"></span><span class="n">${esc(b.name)}<small>${esc(tf("bMeta", { n: b.files.toLocaleString(), s: fmtB(b.bytes), a: b.author || t("bNoAuthor") }))}${b.visible && bridgeCounts[b.id] !== undefined ? " · " + esc(tf("bBridges", { n: bridgeCounts[b.id] })) : ""}</small></span>
    <span class="seg sm"><button type="button" data-x="bvis:${k}:1" class="${b.visible ? "on" : ""}">${t("bShow")}</button><button type="button" data-x="bvis:${k}:0" class="${b.visible ? "" : "on"}">${t("bHide")}</button></span>${b.visible ? `<button class="btn sm" type="button" data-x="bfly:${k}">${t("bFly")}</button>` : ""}<button class="btn sm" type="button" data-x="brm:${k}">${t("bRemove")}</button></div>`;
  }).join("");
  const imp = `<div class="sec">${t("bImportedH")}</div>${items || `<p class="hint">${t("bNone")}</p>`}
  <div class="btns"><button class="btn" type="button" data-x="bimport"${busy ? " disabled" : ""}>${t("bImport")}</button></div>${busy === "import" ? prog : ""}
  <p class="hint">${t("bReadOnly")}</p>`;
  return share + err + imp;
}

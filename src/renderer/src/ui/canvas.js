// Obsidian canvas (.canvas, JSON Canvas 1.0), read only: cards, groups, arrows, labels, colours.
// Text cards are rendered as Markdown, file cards as embeds (filled in by hydrate), link cards show their URL.
// renderCanvas is a plain function (no DOM); wireCanvas adds zoom (wheel) and pan (drag).

const PRESET = { 1: "#fb464c", 2: "#e9973f", 3: "#e0de71", 4: "#44cf6e", 5: "#53dfdd", 6: "#a882ff" };
export const canvasColor = c => (c == null || c === "" ? null : PRESET[c] || (/^#[0-9a-f]{3,8}$/i.test(c) ? c : null));

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/** Point on a card's side, and the direction pointing away from it. */
export function anchor(n, side) {
  const x = num(n.x), y = num(n.y), w = num(n.width, 200), h = num(n.height, 60);
  switch (side) {
    case "top": return [x + w / 2, y, 0, -1];
    case "bottom": return [x + w / 2, y + h, 0, 1];
    case "left": return [x, y + h / 2, -1, 0];
    default: return [x + w, y + h / 2, 1, 0];
  }
}
// without a stored side: the side facing the other card
function facing(a, b) {
  const ax = num(a.x) + num(a.width, 200) / 2, ay = num(a.y) + num(a.height, 60) / 2, bx = num(b.x) + num(b.width, 200) / 2, by = num(b.y) + num(b.height, 60) / 2;
  const dx = bx - ax, dy = by - ay;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top");
}

/**
 * @param {string} text the .canvas file
 * @param {{esc:(s:string)=>string, md:(s:string)=>string, resolve:(name:string)=>string, t:(k:string)=>string}} o
 */
export function renderCanvas(text, o) {
  let j;
  try { j = JSON.parse(text); } catch (_) { return `<p class="hint">${o.esc(o.t("cvBad"))}</p>`; }
  const nodes = Array.isArray(j.nodes) ? j.nodes.filter(n => n && n.id != null) : [], edges = Array.isArray(j.edges) ? j.edges : [];
  if (!nodes.length) return `<p class="hint">${o.esc(o.t("cvEmpty"))}</p>`;
  const byId = new Map(nodes.map(n => [String(n.id), n]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, num(n.x)); y0 = Math.min(y0, num(n.y)); x1 = Math.max(x1, num(n.x) + num(n.width, 200)); y1 = Math.max(y1, num(n.y) + num(n.height, 60)); }
  const pad = 40; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const e = o.esc;
  // groups first (behind), then cards
  const order = [...nodes.filter(n => n.type === "group"), ...nodes.filter(n => n.type !== "group")];
  const cards = order.map(n => {
    const x = num(n.x), y = num(n.y), w = num(n.width, 200), h = num(n.height, 60), col = canvasColor(n.color);
    const st = col ? ` style="--cv:${e(col)}"` : "";
    if (n.type === "group") return `<g class="cv-group"${st}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>${n.label ? `<text x="${x + 4}" y="${y - 8}">${e(String(n.label))}</text>` : ""}</g>`;
    let inner;
    if (n.type === "text") inner = `<div class="cv-md">${o.md(String(n.text || ""))}</div>`;
    else if (n.type === "file") {
      const f = String(n.file || ""), name = f.split("/").pop(), at = o.resolve(name);
      inner = `<div class="cv-file"><div class="cv-fh"${at}>${e(name.replace(/\.md$/i, ""))}${n.subpath ? " › " + e(String(n.subpath).replace(/^#\^?/, "")) : ""}</div>${at ? `<span class="embed" data-embed="${e(name)}"${n.subpath ? ` data-sub="${e(String(n.subpath).replace(/^#/, ""))}"` : ""}>${e(name)}</span>` : `<p class="hint">${e(o.t("cvMissing"))}</p>`}</div>`;
    } else if (n.type === "link") inner = `<div class="cv-link"><a class="ext" data-href="${e(String(n.url || ""))}">${e(String(n.url || ""))}</a></div>`;
    else inner = `<p class="hint">${e(String(n.type || "?"))}</p>`;
    return `<foreignObject x="${x}" y="${y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" class="cv-card md"${st}>${inner}</div></foreignObject>`;
  }).join("");
  const lines = edges.map(ed => {
    const a = byId.get(String(ed.fromNode)), b = byId.get(String(ed.toNode)); if (!a || !b) return "";
    const [ax, ay, anx, any] = anchor(a, ed.fromSide || facing(a, b)), [bx, by, bnx, bny] = anchor(b, ed.toSide || facing(b, a));
    const k = Math.max(40, Math.hypot(bx - ax, by - ay) / 3), col = canvasColor(ed.color);
    const d = `M${ax},${ay} C${ax + anx * k},${ay + any * k} ${bx + bnx * k},${by + bny * k} ${bx},${by}`;
    const toArrow = (ed.toEnd || "arrow") === "arrow", fromArrow = ed.fromEnd === "arrow";
    const mx = (ax + bx) / 2 + (anx + bnx) * k * 0.375, my = (ay + by) / 2 + (any + bny) * k * 0.375;
    return `<g class="cv-edge"${col ? ` style="--cv:${e(col)}"` : ""}><path d="${d}"${toArrow ? ' marker-end="url(#cvarr)"' : ""}${fromArrow ? ' marker-start="url(#cvarrs)"' : ""}/>${ed.label ? `<text x="${mx}" y="${my}">${e(String(ed.label))}</text>` : ""}</g>`;
  }).join("");
  const vb = `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
  return `<div class="cvs"><div class="cv-bar"><span class="hint" style="margin:0">${e(o.t("cvHint"))}</span><span class="sp"></span><button class="btn sm" type="button" data-cv="fit">${e(o.t("cvFit"))}</button></div>
<svg class="cv" viewBox="${vb}" data-vb="${vb}" preserveAspectRatio="xMidYMid meet"><defs><marker id="cvarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker><marker id="cvarrs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>${cards}${lines}</svg></div>`;
}

/** Zoom with the wheel (around the pointer), pan by dragging the background, "fit" resets. */
export function wireCanvas(root) {
  root.querySelectorAll(".cvs:not([data-wired])").forEach(box => {
    box.dataset.wired = "1";
    const svg = box.querySelector("svg.cv"); if (!svg) return;
    const get = () => svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const set = v => svg.setAttribute("viewBox", v.map(x => Math.round(x * 100) / 100).join(" "));
    svg.addEventListener("wheel", ev => {
      ev.preventDefault();
      const [x, y, w, h] = get(), r = svg.getBoundingClientRect(), f = Math.exp(ev.deltaY * 0.0015);
      const px = x + (ev.clientX - r.left) / r.width * w, py = y + (ev.clientY - r.top) / r.height * h;
      const nw = Math.min(Math.max(w * f, 80), 40000), nh = nw * h / w;
      set([px - (px - x) * nw / w, py - (py - y) * nh / h, nw, nh]);
    }, { passive: false });
    svg.addEventListener("pointerdown", ev => {
      if (ev.target.closest("foreignObject") || ev.button !== 0) return;
      const s = get(), r = svg.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, k = Math.max(s[2] / r.width, s[3] / r.height);
      svg.setPointerCapture(ev.pointerId);
      const mv = e2 => set([s[0] - (e2.clientX - sx) * k, s[1] - (e2.clientY - sy) * k, s[2], s[3]]);
      const up = () => { svg.removeEventListener("pointermove", mv); svg.removeEventListener("pointerup", up); };
      svg.addEventListener("pointermove", mv); svg.addEventListener("pointerup", up);
    });
    box.querySelector('[data-cv="fit"]')?.addEventListener("click", () => svg.setAttribute("viewBox", svg.dataset.vb));
  });
}

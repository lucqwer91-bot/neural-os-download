// Real library files as nodes in the Memory region, with their links as lines.
// Shapes as in the demo: note (md/txt) = dot, other file = ring, project = diamond.
// Links the user wrote (wikilinks) are brighter; automatic links are fainter, so they never read as fact.

const NOTE_EXT = new Set(["md", "txt"]);

// Pure layout: projects get evenly spaced anchors along the Memory region (sorted front to back),
// their files take the nearest free points around the anchor. Files without a project share one group.
// pts: point indices of the region, pos: flat xyz array. Returns { files: Map(id -> [x,y,z]), projects: Map(name -> [x,y,z]) }
export function layoutReal(rows, pts, pos) {
  const order = pts.slice().sort((a, b) => pos[a * 3 + 2] - pos[b * 3 + 2] || pos[a * 3] - pos[b * 3]);
  const groups = new Map();
  for (const r of rows) { const k = r.project || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const names = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
  const used = new Set(), files = new Map(), projects = new Map(), point = new Map();   // point: id or 'p:'+project -> brain point index
  const at = i => [pos[i * 3] * 1.03, pos[i * 3 + 1] * 1.03, pos[i * 3 + 2] * 1.03];   // just above the surface
  const d2 = (a, b) => { const x = pos[a * 3] - pos[b * 3], y = pos[a * 3 + 1] - pos[b * 3 + 1], z = pos[a * 3 + 2] - pos[b * 3 + 2]; return x * x + y * y + z * z; };
  names.forEach((name, g) => {
    // anchor spread along the region; the group's files take the free points spatially closest to it
    const anchor = order[Math.round((g + .5) / names.length * (order.length - 1))];
    const near = order.filter(i => !used.has(i)).sort((a, b) => d2(a, anchor) - d2(b, anchor));
    let k = 0;
    // every 4th nearest point, so nodes do not sit on top of each other; more files than points: share the anchor
    const take = () => { const i = near[k] ?? near[k % Math.max(1, near.length)] ?? anchor; k += 4; used.add(i); return i; };
    if (name) { const i = take(); projects.set(name, at(i)); point.set('p:' + name, i); }
    const list = groups.get(name).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const r of list) { const i = take(); files.set(r.id, at(i)); point.set(r.id, i); }
  });
  return { files, projects, point };
}

// Pure cluster layout ("brain <-> clusters" slider): every group becomes its own ball of points,
// the balls sit spread over a sphere around the brain centre, bigger groups get bigger balls.
// keyOf(row) -> group key. Returns Map(id -> [x,y,z]) and Map(key -> centre).
export function layoutClusters(rows, keyOf, center = [0, 0, 0], radius = 1.2) {
  const groups = new Map();
  for (const r of rows) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const keys = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || String(a).localeCompare(String(b)));
  const files = new Map(), centres = new Map(), G = keys.length;
  const maxN = Math.max(1, ...keys.map(k => groups.get(k).length));
  keys.forEach((k, g) => {
    // group centres spread evenly over a sphere (Fibonacci), so the clusters read well from every side while the brain turns
    const yy = G === 1 ? 0 : 1 - (g + .5) / G * 2, rad = Math.sqrt(1 - yy * yy), th = g * 2.399963 + .6, rr = G === 1 ? 0 : radius;
    const c = [center[0] + Math.cos(th) * rad * rr, center[1] + yy * rr * .8, center[2] + Math.sin(th) * rad * rr];
    centres.set(k, c);
    const list = groups.get(k).slice().sort((x, y) => String(x.name).localeCompare(String(y.name))), n = list.length;
    const br = .07 + .38 * Math.cbrt(n / maxN);
    list.forEach((r, i) => {
      // Fibonacci sphere, filled from the inside out so small groups are not hollow
      const y = 1 - (i + .5) / n * 2, rad = Math.sqrt(1 - y * y), th = i * 2.399963, fill = br * Math.cbrt((i + 1) / n);
      files.set(r.id, [c[0] + Math.cos(th) * rad * fill, c[1] + y * fill, c[2] + Math.sin(th) * rad * fill]);
    });
  });
  return { files, centres };
}

// Big libraries (spec 5.1 "Graph size"): above COLLAPSE_AT files the media and other files of every
// project are shown as one collapsed cluster node; clicking it shows its files. Notes (md/txt) stay
// visible one by one (up to NOTE_BUDGET, the most linked first), so the brain keeps growing with the
// vault instead of shrinking to a few blobs. Links to hidden files are drawn to their cluster, one line
// per pair. Pure, so it can be tested.
export const COLLAPSE_AT = 150000;
export const NOTE_BUDGET = 12000;
export const LINE_MAX = 120000;
/** keep at most max lines (index pairs): first one line for every point that has any (user lines preferred),
 *  then the remaining user lines, then auto lines. Pure, so it can be tested. */
export function capLines(U, AU, n, max) {
  const has = new Uint8Array(n), keepU = new Uint8Array(U.length / 2), keepA = new Uint8Array(AU.length / 2);
  let left = max;
  for (const [arr, keep] of [[U, keepU], [AU, keepA]]) for (let l = 0; l < arr.length && left > 0; l += 2) {
    const a = arr[l], b = arr[l + 1]; if (has[a] && has[b]) continue;
    has[a] = has[b] = 1; keep[l / 2] = 1; left--;
  }
  for (const [arr, keep] of [[U, keepU], [AU, keepA]]) for (let i = 0; i < keep.length && left > 0; i++) if (!keep[i]) { keep[i] = 1; left--; }
  const pick = (arr, keep) => { const o = []; for (let i = 0; i < keep.length; i++) if (keep[i]) o.push(arr[i * 2], arr[i * 2 + 1]); return o; };
  return [pick(U, keepU), pick(AU, keepA)];
}
export const groupKey = r => r.project || "";
/** four stable numbers 0..1 from a file id (same file, same place) */
export function spread(id) {
  let h = 2166136261; for (const ch of String(id)) { h ^= ch.codePointAt(0) || 0; h = Math.imul(h, 16777619); }
  const o = []; for (let i = 0; i < 4; i++) { h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; o.push((h >>> 0) / 4294967296); }
  return o;
}
export function collapseView(rows, links, expanded, limit = COLLAPSE_AT, noteBudget = NOTE_BUDGET) {
  if (rows.length <= limit) return { rows, clusters: [], pairs: null, shown: null };
  // notes that stay visible: all of them, or the most linked ones when there are more than the budget
  let keepNotes = new Set();
  const notes = rows.filter(r => NOTE_EXT.has(r.ext));
  if (notes.length && noteBudget > 0) {
    if (notes.length <= noteBudget) keepNotes = new Set(notes.map(r => r.id));
    else {
      const deg = new Map();
      for (const l of links) if (l.status === "linked") { deg.set(l.from_id, (deg.get(l.from_id) || 0) + 1); deg.set(l.to_id, (deg.get(l.to_id) || 0) + 1); }
      keepNotes = new Set(notes.map(r => r.id).sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0)).slice(0, noteBudget));
    }
  }
  const visible = rows.filter(r => expanded.has(groupKey(r)) || keepNotes.has(r.id));
  const vis = new Set(visible.map(r => r.id));
  const count = new Map();
  for (const r of rows) if (!vis.has(r.id)) { const k = groupKey(r); count.set(k, (count.get(k) || 0) + 1); }
  const clusters = [...count.entries()].map(([key, n]) => ({ key, count: n }));
  // link ends: a visible file, or the cluster of a hidden one; one line per pair, user link wins
  const grp = new Map(rows.map(r => [r.id, groupKey(r)]));
  const end = id => (vis.has(id) ? id : grp.has(id) ? "c:" + grp.get(id) : null);
  const pairs = new Map();
  for (const l of links) {
    if (l.status !== "linked") continue;
    const a = end(l.from_id), b = end(l.to_id);
    if (!a || !b || a === b) continue;
    const k = a < b ? a + "|" + b : b + "|" + a, user = l.origin === "user";
    const o = pairs.get(k); if (!o) pairs.set(k, { a, b, user, n: 1 }); else { o.n++; o.user = o.user || user; }
  }
  return { rows: visible, clusters, pairs: [...pairs.values()], shown: vis };
}

/** colorOf(node) returns [r,g,b] or null (silver); focus = Set of file ids to keep bright, others dim */
export function createRealLayer(THREE, { parent, material, regionPts, allPts = null, pos, colorOf = () => null, lineColorOf = null, keyOf = r => r.project || "", center = [0, 0, 0], radius = 1.2, collapseAt = COLLAPSE_AT }) {
  let focus = null, morph = 0, morphGoal = 0, rowsNow = [], linksNow = [], allRows = [], allLinks = [];
  const expanded = new Set();
  let groupOfId = new Map(), maxCluster = 1;
  let A0 = new Float32Array(0), A1 = new Float32Array(0), B0 = new Float32Array(0), U = [], AU = [];   // anatomy / cluster positions, line index pairs
  // particle look ("dust"): files are soft dots spread into the brain's volume instead of sitting on its surface
  let dust = false;
  const pts = new THREE.Points(new THREE.BufferGeometry(), material);
  // links: thin curved arcs that fade from one file's colour to the other's; the more links, the fainter each one,
  // so a big vault reads as a fine web instead of a white blob
  const lineMat = () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false });
  const userLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat());
  const autoLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat());
  let SEG = 6;   // segments per arc; fewer when a vault has many links (fewer vertices, see update)
  parent.add(pts, userLines, autoLines);
  /** @type {{kind:string,row?:any,project?:string,p:number[]}[]} */
  let nodes = [];
  let hover = -1, glow = new Float32Array(0);
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = .06;

  function paint() {
    const g = pts.geometry, col = g.getAttribute("aColor"), size = g.getAttribute("aSize");
    if (!col) return;
    nodes.forEach((n, i) => {
      const h = Math.max(glow[i], i === hover ? .8 : 0), b = .62 + .38 * h;
      const dim = focus && !(n.row && focus.has(n.row.id)) && h < .5 ? .22 : 1, c = colorOf(n), w = .35 + .65 * (1 - h), bb = b * dim * (h > .5 ? 1 : lum) * (dust && n.row ? 1.3 : 1);
      if (c) col.setXYZ(i, Math.min(1, c[0] * bb * w + bb * (1 - w)), Math.min(1, c[1] * bb * w + bb * (1 - w)), Math.min(1, c[2] * bb * w + bb * (1 - w)));
      else col.setXYZ(i, bb * .95, bb, Math.min(1, bb * 1.05));
      size.setX(i, (n.kind === "cluster" ? 11 + 17 * Math.cbrt(n.count / maxCluster) : n.kind === "project" ? 10 : (n.kind === "note" ? 7 : 7.5) * sizeK) * (1 + .35 * h));
    });
    col.needsUpdate = true; size.needsUpdate = true;
    paintLines();
  }
  let sizeK = 1;   // files get smaller as the library grows, so a vault does not become one big blob
  // brightness: the user's setting (Settings → View) times a density factor, so tens of thousands of
  // additive points and lines do not add up to a white glare
  let bright = 1, lum = 1;
  const density = n => (n > 3000 ? Math.max(.45, Math.pow(3000 / n, .3)) : 1);
  // line colours: each end in its file's colour (silver without colour theme), dimmed when outside the focus
  function paintLines() {
    const col = pts.geometry.getAttribute("aColor"); if (!col) return;
    for (const [obj, arr, k] of [[userLines, U, .85], [autoLines, AU, .5]]) {
      const c = obj.geometry.getAttribute("color"); if (!c) continue;
      for (let l = 0; l < arr.length; l += 2) {
        const a = arr[l], b = arr[l + 1], na = nodes[a], nb = nodes[b];
        const lc = lineColorOf || colorOf, ca = lc(na) || [.85, .9, 1], cb = lc(nb) || [.85, .9, 1];
        const inF = n => (n.row && focus.has(n.row.id)) || (n.kind === "cluster" && n.ids && [...focus].some(id => n.ids.has(id)));
        const out = focus && !(inF(na) || inF(nb)) ? .12 : 1;
        for (let s2 = 0; s2 < SEG; s2++) for (let e = 0; e < 2; e++) {
          const t = (s2 + e) / SEG, v = ((l / 2) * SEG + s2) * 2 + e, f = k * out * (1 - .6 * (1 - Math.abs(2 * t - 1)));   // bright at the files, faint in the middle
          c.setXYZ(v, (ca[0] + (cb[0] - ca[0]) * t) * f, (ca[1] + (cb[1] - ca[1]) * t) * f, (ca[2] + (cb[2] - ca[2]) * t) * f);
        }
      }
      c.needsUpdate = true;
      // overall strength falls with the number of links
      const n = arr.length / 2;
      obj.material.opacity = bright * Math.max(k === .85 ? .012 : .007, Math.min(k === .85 ? .5 : .25, (k === .85 ? 3 : 1.6) / Math.sqrt(Math.max(1, n))));
    }
  }

  function update(rowsIn, linksIn) {
    allRows = rowsIn; allLinks = linksIn;
    groupOfId = new Map(rowsIn.map(r => [r.id, groupKey(r)]));
    if (rowsIn.length <= collapseAt) expanded.clear();
    const V = collapseView(rowsIn, linksIn, expanded, collapseAt);
    const rows = V.rows, links = linksIn;
    rowsNow = rows; linksNow = links;
    // layout of what is shown: open files plus one stand-in per closed cluster; a whole vault gets the whole brain
    const stand = V.clusters.map(c => ({ id: "c:" + c.key, name: "", project: c.key || null, ext: "" }));
    const shown = stand.length ? rows.concat(stand) : rows;
    const L = layoutReal(shown, allPts && shown.length * 4 > regionPts.length ? allPts : regionPts, pos);
    sizeK = (rows.length > 150 ? Math.max(.35, Math.sqrt(150 / rows.length)) : 1) * (dust ? 2.6 : 1);
    lum = bright * density(rows.length);
    nodes = [];
    const closed = new Set(V.clusters.map(c => c.key));
    maxCluster = Math.max(1, ...V.clusters.map(c => c.count));
    for (const [name, p] of L.projects) if (!closed.has(name)) nodes.push({ kind: "project", project: name, p, pt: L.point.get('p:' + name), open: !!V.pairs });
    for (const c of V.clusters) {
      // the cluster sits where its project anchor is (files without a project: their stand-in)
      const p = L.projects.get(c.key) || L.files.get("c:" + c.key), pt = L.point.get('p:' + c.key) ?? L.point.get("c:" + c.key);
      nodes.push({ kind: "cluster", project: c.key, key: c.key, count: c.count, p, pt, ids: new Set(allRows.filter(r => groupKey(r) === c.key && !V.shown.has(r.id)).map(r => r.id)) });
    }
    for (const r of rows) nodes.push({ kind: NOTE_EXT.has(r.ext) ? "note" : "file", row: r, p: L.files.get(r.id), pt: L.point.get(r.id) });
    const n = nodes.length, P = new Float32Array(n * 3), S = new Float32Array(n);
    B0 = new Float32Array(n * 3);
    nodes.forEach((x, i) => { B0.set(x.p, i * 3); S[i] = shapeOf(x); });
    anatomy();
    clusterTargets();
    blend(P);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aShape", new THREE.BufferAttribute(S, 1));
    pts.geometry.dispose(); pts.geometry = g;
    glow = new Float32Array(n); hover = -1;
    // lines: links between files, and each file to its project (faint, like auto links); kept as node index pairs
    const idx = new Map(), pidx = new Map();
    nodes.forEach((x, i) => { if (x.row) idx.set(x.row.id, i); else if (x.kind === "cluster") idx.set("c:" + x.key, i); else pidx.set(x.project, i); });
    U = []; AU = [];
    if (V.pairs) for (const q of V.pairs) { const a = idx.get(q.a), b = idx.get(q.b); if (a !== undefined && b !== undefined) (q.user ? U : AU).push(a, b); }
    else for (const l of links) {
      if (l.status !== "linked") continue;
      const a = idx.get(l.from_id), b = idx.get(l.to_id);
      if (a !== undefined && b !== undefined) (l.origin === "user" ? U : AU).push(a, b);
    }
    // spokes from each file to its project only for small libraries; in a vault they would hide the real links
    if (rows.length <= 300) for (const r of rows) if (r.project && pidx.has(r.project)) AU.push(idx.get(r.id), pidx.get(r.project));
    // very big webs: at most LINE_MAX lines; every point keeps at least one, then your own [[links]] first
    if ((U.length + AU.length) / 2 > LINE_MAX) [U, AU] = capLines(U, AU, nodes.length, LINE_MAX);
    const nl = (U.length + AU.length) / 2;
    SEG = nl > 8000 ? 2 : nl > 3000 ? 3 : 6;
    for (const [obj, arr] of [[userLines, U], [autoLines, AU]]) {
      const nv = arr.length / 2 * SEG * 2, lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      obj.geometry.dispose(); obj.geometry = lg;
    }
    syncLines();
    paint();
  }
  const shapeOf = x => (dust && (x.kind === "note" || x.kind === "file") ? 4 : x.kind === "note" ? 0 : x.kind === "file" ? 1 : 2);
  // brain positions: on the surface, or (particle look) pulled inward by a stable random amount per file
  function anatomy() {
    A0 = new Float32Array(B0.length);
    nodes.forEach((x, i) => {
      const b = [B0[i * 3], B0[i * 3 + 1], B0[i * 3 + 2]];
      if (!dust || !x.row) { A0.set(b, i * 3); return; }
      const r = spread(x.row.id), k = 1 - .38 * r[0];
      for (let j = 0; j < 3; j++) A0[i * 3 + j] = center[j] + (b[j] - center[j]) * k + (r[j + 1] - .5) * .05;
    });
  }
  // cluster positions for the current grouping; project nodes sit at the centre of their files
  function clusterTargets() {
    const C = layoutClusters(rowsNow, keyOf, center, radius);
    A1 = new Float32Array(nodes.length * 3);
    const sum = new Map();
    nodes.forEach((x, i) => {
      if (!x.row) return;
      const p = C.files.get(x.row.id); A1.set(p, i * 3);
      if (x.row.project) { const s = sum.get(x.row.project) || [0, 0, 0, 0]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; sum.set(x.row.project, s); }
    });
    nodes.forEach((x, i) => { if (!x.row) { const s = sum.get(x.project); A1.set(s ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : x.p, i * 3); } });
  }
  const ease = t => t * t * (3 - 2 * t);
  function blend(P) {
    const e = ease(morph);
    for (let i = 0; i < A0.length; i++) P[i] = A0[i] + (A1[i] - A0[i]) * e;
    nodes.forEach((x, i) => { x.p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; });
  }
  // each link is a gentle arc bowing away from the brain centre (quadratic Bezier, SEG pieces)
  function syncLines() {
    const P = new Float32Array(3 * (SEG + 1));
    for (const [obj, arr] of [[userLines, U], [autoLines, AU]]) {
      const a = obj.geometry.getAttribute("position"); if (!a) continue;
      const out = a.array;
      for (let l = 0; l < arr.length; l += 2) {
        const p = nodes[arr[l]].p, q = nodes[arr[l + 1]].p;
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, mz = (p[2] + q[2]) / 2;
        let dx = mx - center[0], dy = my - center[1], dz = mz - center[2]; const dl = Math.hypot(dx, dy, dz) || 1;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), bow = len * .18 / dl;
        const cx = mx + dx * bow, cy = my + dy * bow, cz = mz + dz * bow;
        for (let s2 = 0; s2 <= SEG; s2++) {
          const t = s2 / SEG, u = 1 - t;
          P[s2 * 3] = u * u * p[0] + 2 * u * t * cx + t * t * q[0]; P[s2 * 3 + 1] = u * u * p[1] + 2 * u * t * cy + t * t * q[1]; P[s2 * 3 + 2] = u * u * p[2] + 2 * u * t * cz + t * t * q[2];
        }
        let o = (l / 2) * SEG * 6;
        for (let s2 = 0; s2 < SEG; s2++) { for (let k = 0; k < 3; k++) out[o + k] = P[s2 * 3 + k]; for (let k = 0; k < 3; k++) out[o + 3 + k] = P[(s2 + 1) * 3 + k]; o += 6; }
      }
      a.needsUpdate = true; obj.geometry.computeBoundingSphere();
    }
  }
  function applyMorph() {
    const a = pts.geometry.getAttribute("position"); if (!a) return;
    blend(a.array); a.needsUpdate = true; pts.geometry.computeBoundingSphere(); syncLines();
  }

  function pick(camera, ndc) {
    if (!pts.visible || !nodes.length) return -1;
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObject(pts);
    return h.length ? h[0].index : -1;
  }
  function setHover(i) { if (i !== hover) { hover = i; paint(); return true; } return false; }
  function pulse(i) { if (i >= 0 && i < glow.length) { glow[i] = 1; paint(); } }
  // fade glows; returns true while something is still moving
  function step() {
    let busy = false; for (let i = 0; i < glow.length; i++) if (glow[i] > 0) { glow[i] = Math.max(0, glow[i] - .012); busy = true; } if (busy) paint();
    if (morph !== morphGoal) { const d = morphGoal - morph; morph = Math.abs(d) < .01 ? morphGoal : morph + d * .12; applyMorph(); busy = true; }
    return busy;
  }
  /** 0 = brain anatomy, 1 = clusters; animates in step() */
  function setMorph(t, now) { morphGoal = Math.max(0, Math.min(1, t)); if (now) { morph = morphGoal; applyMorph(); } }
  /** grouping changed (colour by): new cluster targets */
  function relayout() { if (!nodes.length) return; clusterTargets(); applyMorph(); }
  function worldPos(i) { return new THREE.Vector3(...nodes[i].p).applyMatrix4(pts.matrixWorld); }
  // a file in a closed cluster is found as its cluster
  const indexOfFile = id => { const i = nodes.findIndex(n => n.row && n.row.id === id); if (i >= 0 || !groupOfId.has(id)) return i; return nodes.findIndex(n => n.kind === "cluster" && n.key === groupOfId.get(id)); };
  /** open (or close) a cluster; returns true when the view changed */
  function setOpen(key, on) { if (allRows.length <= collapseAt || expanded.has(key) === on) return false; if (on) expanded.add(key); else expanded.delete(key); const m = morph; update(allRows, allLinks); setMorph(m, true); return true; }
  /** index of a file, opening its cluster first if needed */
  function revealFile(id) { const k = groupOfId.get(id); if (k !== undefined) setOpen(k, true); return nodes.findIndex(n => n.row && n.row.id === id); }

  function setFocus(ids) { focus = ids && ids.size ? ids : null; paint(); }
  /** brightness 0.3–1.5 (Settings → View) */
  function setBright(v) { bright = Math.max(.2, Math.min(2, +v || 1)); lum = bright * density(rowsNow.length); paint(); }
  /** particle look on/off: soft dots in the volume, or the classic dots and rings on the surface */
  function setLook(on) {
    if (dust === !!on) return; dust = !!on;
    if (!nodes.length) return;
    const S = pts.geometry.getAttribute("aShape"); nodes.forEach((x, i) => S.setX(i, shapeOf(x))); S.needsUpdate = true;
    sizeK *= dust ? 2.6 : 1 / 2.6; anatomy(); applyMorph(); paint();
  }
  function setLinks(on) { userLines.visible = autoLines.visible = !!on; }
  const dispose = () => { for (const o of [pts, userLines, autoLines]) o.geometry.dispose(); };
  return { update, dispose, setBright, setLook, setOpen, revealFile, get collapsed() { return allRows.length > collapseAt; }, isOpen: k => expanded.has(k), repaint: paint, repaintLines: paintLines, setFocus, setLinks, setMorph, relayout, get morph() { return morph; }, pick, setHover, pulse, step, worldPos, indexOfFile, get nodes() { return nodes; }, get count() { return nodes.length; } };
}

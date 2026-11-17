// Imported brains (.brain files), "side by side with a bridge" (user decision 2026-11-17):
// each foreign brain is a smaller copy of the brain shape next to mine, in its own colour,
// holding its notes. Glowing threads run from my notes to theirs where they match (same
// name, shared links) and between projects of the same name. Foreign brains are read-only.
import { createRealLayer } from "./realnodes.js";

// distinct tints for up to six foreign brains
export const TINTS = [[1, .62, .25], [.45, .85, 1], [.8, .5, 1], [.4, 1, .6], [1, .45, .6], [1, .9, .4]];

/** Where foreign brain k sits: alternating right/left of my brain, further out for more brains. */
export function slotOffset(k, radius) {
  const side = k % 2 === 0 ? 1 : -1, ring = Math.floor(k / 2);
  return { side, dist: radius * (2.35 + ring * 1.45) };
}

/** Rows for the node layer: ids made unique per brain. */
export const foreignRows = (brainId, files) => files.map(f => ({ id: "b:" + brainId + ":" + f.id, fid: f.id, name: f.name, ext: f.ext, size: f.size, project: f.project }));

/** The brain shape as a compact point cloud: only points with shade > 0, coloured by tint. */
export function silhouetteArrays(geo, shade) {
  const P = geo.getAttribute("position"), S = geo.getAttribute("aSize"), U = geo.getAttribute("aU");
  const idx = [];
  for (let i = 0; i < P.count; i++) if ((shade[i] || 0) > 0) idx.push(i);
  const pos = new Float32Array(idx.length * 3), size = new Float32Array(idx.length), u = new Float32Array(idx.length), sh = new Float32Array(idx.length);
  idx.forEach((i, k) => { pos[k * 3] = P.getX(i); pos[k * 3 + 1] = P.getY(i); pos[k * 3 + 2] = P.getZ(i); size[k] = S ? S.getX(i) : 1; u[k] = U ? U.getX(i) : 0; sh[k] = shade[i]; });
  return { pos, size, u, sh, count: idx.length };
}

export function createForeignBrains(THREE, { scene, brainG, sil, nodeMaterial, regionPts, allPts, pos, center, radius, camera, REAL, myColor }) {
  // sil: { geo, material (the brain's point material, for its shared size uniforms), shade: per-point brightness, 0 = leave out }
  let list = [];   // { id, name, author, tint, group, layer, rows, data }
  let silA = null;
  function silhouette(tint) {
    silA = silA || silhouetteArrays(sil.geo, sil.shade);
    const g = new THREE.BufferGeometry(), col = new Float32Array(silA.count * 3);
    for (let k = 0; k < silA.count; k++) for (let c = 0; c < 3; c++) col[k * 3 + c] = Math.min(1, silA.sh[k] * (tint[c] * .8 + .2) * 1.3);
    g.setAttribute("position", new THREE.BufferAttribute(silA.pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(silA.size, 1));
    g.setAttribute("aU", new THREE.BufferAttribute(silA.u, 1));
    const U = sil.material.uniforms;
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPR: U.uPR, uK: U.uK, uDen: { value: 1 }, uFade: { value: .6 } }, vertexShader: sil.material.vertexShader, fragmentShader: sil.material.fragmentShader });
    return new THREE.Points(g, m);
  }
  const bridgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
  const bridgeLines = new THREE.LineSegments(new THREE.BufferGeometry(), bridgeMat);
  scene.add(bridgeLines);
  let ends = [], nodesRef = null, myIdx = new Map();
  const SEG = 10;

  function clear() {
    for (const b of list) { scene.remove(b.group); b.layer.dispose && b.layer.dispose(); b.sil.geometry.dispose(); b.sil.material.dispose(); }
    list = [];
  }

  /** brains: [{ id, name, author, data: { files, links, bridges } }] (only visible ones) */
  function setBrains(brains) {
    if (!list.length) takeRight();
    clear();
    brains.forEach((b, k) => {
      const tint = TINTS[k % TINTS.length];
      const group = new THREE.Group(), inner = new THREE.Group();
      inner.position.set(-center[0], -center[1], -center[2]);
      group.add(inner);
      // the brain shape, faint, so it reads as a second brain even with few notes
      const sil = silhouette(tint);
      inner.add(sil);
      const rows = foreignRows(b.id, b.data.files);
      const layer = createRealLayer(THREE, { parent: inner, material: nodeMaterial, regionPts, allPts, pos, colorOf: () => tint, lineColorOf: () => tint, center, radius });
      const links = b.data.links.map(l => ({ from_id: "b:" + b.id + ":" + l.from, to_id: "b:" + b.id + ":" + l.to, origin: l.origin, status: "linked" }));
      layer.update(rows, links);
      scene.add(group);
      list.push({ id: b.id, name: b.name, author: b.author, tint, group, layer, rows, data: b.data, sil });
    });
    place();
    rebuildEnds();
  }

  // beside my brain, as seen from the start view: along the camera's right axis
  // the camera's horizontal right axis when the brains were set, so they stay put while the user turns
  let right = new THREE.Vector3(1, 0, 0);
  function takeRight() {
    camera.updateMatrixWorld();
    const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); r.y = 0;
    if (r.lengthSq() > 1e-6) right = r.normalize();
  }
  function place() {
    const s = brainG.scale.x, c = new THREE.Vector3(...center).applyMatrix4(brainG.matrixWorld);
    list.forEach((b, k) => {
      const o = slotOffset(k, radius * s);
      b.group.position.copy(c).addScaledVector(right, o.side * o.dist);
      b.group.scale.setScalar(s * .6);
      b.group.updateMatrixWorld(true);
    });
  }

  // bridge end points as node indices (recomputed when my or their nodes change)
  function rebuildEnds() {
    nodesRef = REAL.nodes;
    myIdx = new Map();
    REAL.nodes.forEach((n, i) => { if (n.row) myIdx.set(n.row.id, i); else if (n.kind === "cluster") myIdx.set("c:" + n.key, i); else myIdx.set("p:" + n.project, i); });
    const mine = id => { if (myIdx.has(id)) return myIdx.get(id); const i = REAL.indexOfFile(id); return i >= 0 ? i : undefined; };
    ends = [];
    for (const b of list) {
      const theirIdx = new Map();
      b.layer.nodes.forEach((n, i) => { if (n.row) theirIdx.set(n.row.fid, i); else if (n.kind === "cluster") theirIdx.set("c:" + n.key, i); else theirIdx.set("p:" + n.project, i); });
      const theirs = fid => theirIdx.get(fid) ?? (() => { const i = b.layer.indexOfFile("b:" + b.id + ":" + fid); return i >= 0 ? i : undefined; })();
      const seen = new Set();
      for (const br of b.data.bridges.files) {
        const a = mine(br.mine), t = theirs(br.theirs);
        if (a === undefined || t === undefined) continue;
        const k = a + "|" + t; if (seen.has(k)) continue; seen.add(k);
        ends.push({ b, a, t, strong: br.why === "name" });
      }
      for (const p of b.data.bridges.projects) {
        const a = myIdx.get("p:" + p.mine) ?? myIdx.get("c:" + p.mine), t = theirIdx.get("p:" + p.theirs) ?? theirIdx.get("c:" + p.theirs);
        if (a !== undefined && t !== undefined) ends.push({ b, a, t, strong: true, project: true });
      }
    }
    const nv = ends.length * SEG * 2, g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    bridgeLines.geometry.dispose(); bridgeLines.geometry = g;
    sync();
  }

  // threads as arcs lifted above the gap between the brains, bright at the notes, faint in the middle
  function sync() {
    if (!list.length) { bridgeLines.visible = false; return; }
    bridgeLines.visible = true;
    if (nodesRef !== REAL.nodes) { rebuildEnds(); return; }
    place();
    const P = bridgeLines.geometry.getAttribute("position"), C = bridgeLines.geometry.getAttribute("color");
    if (!P) return;
    const up = new THREE.Vector3(0, 1, 0);
    let v = 0;
    for (const e of ends) {
      const p = REAL.worldPos(e.a), q = e.b.layer.worldPos(e.t);
      const lift = p.distanceTo(q) * .22, m = p.clone().add(q).multiplyScalar(.5).addScaledVector(up, lift);
      const ca = myColor(REAL.nodes[e.a]) || [.85, .9, 1], cb = e.b.tint, k = e.project ? 1 : e.strong ? .75 : .45;
      let prev = null;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG, u = 1 - t;
        const x = u * u * p.x + 2 * u * t * m.x + t * t * q.x, y = u * u * p.y + 2 * u * t * m.y + t * t * q.y, z = u * u * p.z + 2 * u * t * m.z + t * t * q.z;
        const f = k * (1 - .65 * (1 - Math.abs(2 * t - 1)));
        const col = [(ca[0] + (cb[0] - ca[0]) * t) * f, (ca[1] + (cb[1] - ca[1]) * t) * f, (ca[2] + (cb[2] - ca[2]) * t) * f];
        if (prev) { P.setXYZ(v, prev[0], prev[1], prev[2]); C.setXYZ(v, ...prev[3]); v++; P.setXYZ(v, x, y, z); C.setXYZ(v, ...col); v++; }
        prev = [x, y, z, col];
      }
    }
    P.needsUpdate = true; C.needsUpdate = true; bridgeLines.geometry.computeBoundingSphere();
    bridgeMat.opacity = Math.max(.12, Math.min(.6, 6 / Math.sqrt(Math.max(1, ends.length))));
  }

  function pick(ndc) {
    for (const b of list) { const i = b.layer.pick(camera, ndc); if (i >= 0) return { brain: b, i, node: b.layer.nodes[i] }; }
    return null;
  }
  function setHover(hit) { let ch = false; for (const b of list) ch = b.layer.setHover(hit && hit.brain === b ? hit.i : -1) || ch; return ch; }
  function step() { let busy = false; for (const b of list) busy = b.layer.step() || busy; return busy; }
  function pulse(hit) { hit.brain.layer.pulse(hit.i); }
  /** open a closed cluster of a foreign brain */
  function openCluster(hit) { if (hit.node.kind === "cluster") { hit.brain.layer.setOpen(hit.node.key, true); rebuildEnds(); } }
  /** bridges of one foreign file, for its panel */
  const bridgesOf = (brainId, fid) => { const b = list.find(x => x.id === brainId); return b ? b.data.bridges.files.filter(x => x.theirs === fid) : []; };
  const worldCenter = k => list[k] ? list[k].group.position.clone() : null;
  return { setBrains, sync, pick, setHover, step, pulse, openCluster, bridgesOf, worldCenter, get brains() { return list; }, get bridgeCount() { return ends.length; }, bridgesCount: id => ends.filter(e => e.b.id === id).length };
}

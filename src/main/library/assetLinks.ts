import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'
import { stem } from './organize'

// Links for every file of a linked folder (user wish 2026-11-17: "for every file a point, linked to other things").
// Vaults are linked by the user's [[wikilinks]] only (organize.ts, no guessing). Images, 3D models and other
// assets have no wikilinks, so they stood alone. These rules give them links from facts that can be shown:
//   samename   same object, other format or texture map in the same folder (Rhino.fbx, Rhino.glb, Rhino_albedo.png)
//   folder     every file to its folder's note (README, index, note named like the folder), else to the folder's
//              first file; big folders in groups of GROUP, so no file gets thousands of lines
//   foldertree a folder's lead file to the lead file of the nearest parent folder that has files
//   mention    a note names the file ("Dragon.glb")
//   name       a file or folder is named exactly like a note
// All are origin 'auto' (shown fainter, removable with the auto-link setting) and fully recomputed:
// cheap groupings, never every pair, so 50,000 files take about a second.

export const GROUP = 24
const NOTE = new Set(['md', 'txt'])
const MAX_TEXT = 512 * 1024
// texture-map and preview suffixes that still mean the same object
const SUFFIX = /[ _.-](albedo|diffuse|diff|basecolor|base_color|color|col|normal|normalgl|normaldx|nrm|nor|norm|rough|roughness|metal|metallic|metalness|ao|occlusion|ambientocclusion|height|disp|displacement|bump|emissive|emission|spec|specular|gloss|glossiness|opacity|alpha|mask|orm|arm|preview|thumb|thumbnail|icon|render|lod\d+|\d+k)$/i
export const REASONS = ['samename', 'folder', 'foldertree', 'mention', 'name'] as const
// words joined by space or dot only ('-' and '_' belong to a word), at most 6 words: no catastrophic backtracking
const FILE_REF = /([A-Za-z0-9][\w-]*(?:[ .][\w-]+){0,5})\.(png|jpe?g|webp|gif|tga|psd|svg|fbx|obj|glb|gltf|blend|rbxm|rbxmx|rbxl|mp3|ogg|wav|mp4|mov|luau|lua|json|exr|hdr)\b/gi

export function baseName(name: string): string {
  let b = name.normalize('NFC').toLowerCase()
  const dot = b.lastIndexOf('.'); if (dot > 0) b = b.slice(0, dot)
  for (let i = 0; i < 3; i++) { const n = b.replace(SUFFIX, ''); if (n === b || !n) break; b = n }
  return b.trim()
}
const dirOf = (rel: string) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i) }
const lastSeg = (d: string) => d.slice(d.lastIndexOf('/') + 1)
const isLead = (name: string, dir: string) => { const s = stem(name); return s === 'readme' || s === 'index' || s === '_index' || s === '00 index' || (!!dir && s === lastSeg(dir).normalize('NFC').toLowerCase()) }

interface F { id: string; name: string; ext: string; rel_path: string; folder_id: string; folder_path: string }
export interface AssetLinkResult { links: number; byReason: Record<string, number>; files: number; ms: number }

export async function assetLinks(db: Db, opts: { autoLink?: boolean; now?: () => Date; readText?: (f: F) => Promise<string | null> } = {}): Promise<AssetLinkResult> {
  const t0 = Date.now()
  const status = opts.autoLink === false ? 'suggested' : 'linked'
  const now = (opts.now || (() => new Date()))().toISOString()
  const files = db.prepare(`SELECT f.id, f.name, f.ext, f.rel_path, f.folder_id, lf.path AS folder_path FROM file_asset f JOIN linked_folder lf ON lf.id = f.folder_id
    WHERE f.source = 'linked' AND f.rel_path IS NOT NULL ORDER BY f.folder_id, f.rel_path`).all() as unknown as F[]
  const edges: [string, string, string][] = []
  const add = (a: string, b: string, r: string) => { if (a && b && a !== b) edges.push([a, b, r]) }

  // folders: files per folder (key = folder id + dir)
  const dirs = new Map<string, F[]>()
  for (const f of files) { const k = f.folder_id + ':' + dirOf(f.rel_path); const l = dirs.get(k); if (l) l.push(f); else dirs.set(k, [f]) }
  const lead = new Map<string, F>()
  for (const [k, l] of dirs) {
    const dir = k.slice(k.indexOf(':') + 1)
    const notes = l.filter((f) => NOTE.has(f.ext))
    const hub = notes.find((f) => isLead(f.name, dir)) || notes[0] || l[0]
    lead.set(k, hub)
    // samename: same object in other formats → star around its first file (a model before its pictures)
    const groups = new Map<string, F[]>()
    for (const f of l) { if (NOTE.has(f.ext)) continue; const b = baseName(f.name); if (!b) continue; const g = groups.get(b); if (g) g.push(f); else groups.set(b, [f]) }
    const inGroup = new Map<string, F>()
    for (const g of groups.values()) {
      if (g.length < 2 || g.length > 60) continue
      const head = g.find((f) => /^(fbx|obj|glb|gltf|blend|rbxm|rbxmx)$/.test(f.ext)) || g[0]
      for (const f of g) if (f !== head) { add(head.id, f.id, 'samename'); inGroup.set(f.id, head) }
    }
    // folder: the rest to the folder's lead, in groups of GROUP (group head → lead, members → group head)
    const rest = l.filter((f) => f !== hub && !inGroup.has(f.id))
    for (let i = 0; i < rest.length; i += GROUP) {
      const chunk = rest.slice(i, i + GROUP), head = chunk[0]
      add(hub.id, head.id, 'folder')
      for (const f of chunk.slice(1)) add(rest.length <= GROUP ? hub.id : head.id, f.id, 'folder')
    }
  }
  // foldertree: each folder's lead to the lead of the nearest parent folder with files
  for (const [k, hub] of lead) {
    const fid = k.slice(0, k.indexOf(':')); let dir = k.slice(k.indexOf(':') + 1)
    while (dir) { dir = dirOf(dir); const p = lead.get(fid + ':' + dir); if (p) { add(p.id, hub.id, 'foldertree'); break } }
  }
  // name: a file (without its format) or a folder named exactly like a note elsewhere
  const noteByStem = new Map<string, F[]>()
  for (const f of files) if (NOTE.has(f.ext)) { const s = stem(f.name); const l = noteByStem.get(s); if (l) l.push(f); else noteByStem.set(s, [f]) }
  const noteFor = (s: string) => { const l = s.length >= 4 ? noteByStem.get(s) : undefined; return l && l.length <= 3 ? l : [] }
  for (const f of files) if (!NOTE.has(f.ext)) for (const n of noteFor(stem(f.name))) add(n.id, f.id, 'name')
  for (const [k, hub] of lead) { const d = k.slice(k.indexOf(':') + 1); if (!d) continue; for (const n of noteFor(lastSeg(d).normalize('NFC').toLowerCase())) if (n !== hub) add(n.id, hub.id, 'name') }
  // mention: notes that name a file with its format
  const byName = new Map<string, F[]>()
  for (const f of files) if (!NOTE.has(f.ext)) { const k = f.name.normalize('NFC').toLowerCase(); const l = byName.get(k); if (l) l.push(f); else byName.set(k, [f]) }
  const read = opts.readText || (async (f: F) => { try { const b = await readFile(join(f.folder_path, ...f.rel_path.split('/'))); return b.length <= MAX_TEXT ? b.toString('utf8') : null } catch { return null } })
  let n = 0
  for (const f of files) {
    if (!NOTE.has(f.ext)) continue
    if (++n % 200 === 0) await new Promise<void>((r) => setImmediate(r))
    const t = await read(f); if (!t) continue
    const seen = new Set<string>()
    for (const m of t.matchAll(FILE_REF)) {
      // "See Dragon.glb" also captures "See": try the name from each word on, longest first
      const words = m[1].split(' ')
      for (let w = 0; w < words.length; w++) {
        const k = (words.slice(w).join(' ') + '.' + m[2]).normalize('NFC').toLowerCase()
        const hit = byName.get(k); if (!hit) continue
        if (!seen.has(k) && hit.length <= 3) for (const o of hit) add(f.id, o.id, 'mention')
        seen.add(k); break
      }
    }
  }

  // replace the old set in one transaction
  const res: AssetLinkResult = { links: 0, byReason: {}, files: files.length, ms: 0 }
  const ins = db.prepare('INSERT OR IGNORE INTO knowledge_edge (from_id, to_id, origin, reason, status, created_at) VALUES (?, ?, \'auto\', ?, ?, ?)')
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM knowledge_edge WHERE origin = 'auto' AND reason IN (${REASONS.map(() => '?').join(',')}) AND from_id IN (SELECT id FROM file_asset WHERE source = 'linked')`).run(...REASONS)
    for (const [a, b, r] of edges) if (ins.run(a, b, r, status, now).changes) { res.links++; res.byReason[r] = (res.byReason[r] || 0) + 1 }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.ms = Date.now() - t0
  return res
}

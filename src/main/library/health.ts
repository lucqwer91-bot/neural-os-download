import type { Db } from './db'
import { stem } from './organize'

// Library health (spec 5.1 "big vaults"): [[links]] that point at no note, and notes without any link.
// Read-only: it only reports, the user decides what to do.

export interface BrokenTarget { stem: string; count: number; from: { id: string; name: string }[] }
export interface Health { broken: BrokenTarget[]; brokenTotal: number; brokenNotes: number; orphans: { id: string; name: string }[]; orphanTotal: number; notes: number }

const LIST_MAX = 300, FROM_MAX = 6

export function libraryHealth(db: Db): Health {
  const files = db.prepare('SELECT id, name, ext FROM file_asset').all() as { id: string; name: string; ext: string }[]
  const known = new Set<string>()
  for (const f of files) { known.add(stem(f.name)); known.add(f.name.normalize('NFC').toLowerCase()) }
  for (const a of db.prepare('SELECT stem FROM note_alias').all() as { stem: string }[]) known.add(a.stem)
  const name = new Map(files.map((f) => [f.id, f.name]))
  const byStem = new Map<string, string[]>()
  for (const t of db.prepare('SELECT file_id, stem FROM wikilink_target').all() as { file_id: string; stem: string }[]) {
    if (!t.stem || known.has(t.stem)) continue
    const l = byStem.get(t.stem); if (l) l.push(t.file_id); else byStem.set(t.stem, [t.file_id])
  }
  const notesWithBroken = new Set<string>()
  const broken: BrokenTarget[] = []
  for (const [s, ids] of byStem) {
    for (const id of ids) notesWithBroken.add(id)
    broken.push({ stem: s, count: ids.length, from: ids.slice(0, FROM_MAX).map((id) => ({ id, name: name.get(id) || id })) })
  }
  broken.sort((a, b) => b.count - a.count || a.stem.localeCompare(b.stem))

  // orphans: notes (md) with no wikilink in or out (auto links don't count, they are NEURAL OS's guesses)
  const linked = new Set<string>()
  for (const e of db.prepare("SELECT from_id, to_id FROM knowledge_edge WHERE origin = 'user' AND status = 'linked'").all() as { from_id: string; to_id: string }[]) { linked.add(e.from_id); linked.add(e.to_id) }
  const notes = files.filter((f) => f.ext === 'md')
  const orphans = notes.filter((f) => !linked.has(f.id)).map((f) => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name))
  return { broken: broken.slice(0, LIST_MAX), brokenTotal: broken.length, brokenNotes: notesWithBroken.size, orphans: orphans.slice(0, LIST_MAX), orphanTotal: orphans.length, notes: notes.length }
}

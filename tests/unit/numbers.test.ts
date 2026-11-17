import { describe, it, expect } from 'vitest'
// @ts-ignore plain JS module
import { computeNumbers } from '../../src/renderer/src/ui/numbers.js'

const now = Date.UTC(2026, 10, 16)
const rows = [
  { id: 'a', name: 'A.md', ext: 'md', size: 100, project: 'P', links: 2, mtime: now - 5 * 864e5 },
  { id: 'b', name: 'B.md', ext: 'md', size: 50, project: 'P', links: 1, mtime: Date.UTC(2026, 0, 10) },
  { id: 'c', name: 'C.png', ext: 'png', size: 900, project: null, links: 1, mtime: Date.UTC(2026, 0, 12) },
  { id: 'd', name: 'D.txt', ext: 'txt', size: 10, project: 'Q', links: 0, mtime: null, imported_at: 'x' },
]
const links = [
  { from_id: 'a', to_id: 'b', origin: 'user', status: 'linked' },
  { from_id: 'a', to_id: 'c', origin: 'auto', status: 'linked' },
  { from_id: 'b', to_id: 'd', origin: 'auto', status: 'suggested' },
]

describe('computeNumbers', () => {
  it('counts files, links, orphans and hubs from real data', () => {
    const n = computeNumbers(rows, links, now)
    expect(n).toMatchObject({ files: 4, notes: 3, other: 1, bytes: 1060, projects: 2, links: 2, byUser: 1, auto: 1, suggested: 1, orphans: 1, recent: 1 })
    expect(n.hubs[0].id).toBe('a')
    expect(n.largest[0].id).toBe('c')
    expect(n.types[0]).toEqual({ k: 'md', n: 2 })
    expect(n.busiest?.month).toBe('2026-01')
    expect(n.first).toBe('2026-01')
  })
  it('handles an empty library', () => {
    const n = computeNumbers([], [], now)
    expect(n.files).toBe(0); expect(n.busiest).toBeNull(); expect(n.first).toBeNull()
  })
})

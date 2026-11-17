import { describe, it, expect } from 'vitest'
// @ts-ignore plain JS module
import { layoutReal } from '../../src/renderer/src/brain/realnodes.js'

// 50 points on a line: x = i, y = 0, z = i
const pos = new Float32Array(150); for (let i = 0; i < 50; i++) { pos[i * 3] = i; pos[i * 3 + 2] = i }
const pts = Array.from({ length: 50 }, (_, i) => i)
const rows = [
  { id: 'a', name: 'A.md', project: 'P1' }, { id: 'b', name: 'B.md', project: 'P1' },
  { id: 'c', name: 'C.md', project: 'P2' }, { id: 'd', name: 'D.md', project: null }
]

describe('real node layout', () => {
  it('gives every file and project its own spot', () => {
    const L = layoutReal(rows, pts, pos)
    expect(L.files.size).toBe(4)
    expect([...L.projects.keys()]).toEqual(['P1', 'P2'])
    const all = [...L.files.values(), ...L.projects.values()].map((p: number[]) => p.join())
    expect(new Set(all).size).toBe(all.length)
  })
  it('keeps a project\'s files close to it', () => {
    const L = layoutReal(rows, pts, pos)
    const x = (p: number[]) => p[0] / 1.03
    expect(Math.abs(x(L.files.get('a')) - x(L.projects.get('P1')))).toBeLessThanOrEqual(2)
    expect(Math.abs(x(L.files.get('c')) - x(L.projects.get('P2')))).toBeLessThanOrEqual(2)
  })
  it('is stable for the same input', () => {
    expect(layoutReal(rows, pts, pos).files.get('b')).toEqual(layoutReal(rows, pts, pos).files.get('b'))
  })
})

describe('layoutClusters', () => {
  it('puts every group into its own ball on a ring', async () => {
    // @ts-ignore plain JS module
    const { layoutClusters } = await import('../../src/renderer/src/brain/realnodes.js')
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i, name: 'a' + i, project: 'A' })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: 'b' + i, name: 'b' + i, project: 'B' })),
    ]
    const L = layoutClusters(rows, (r: { project: string }) => r.project, [0, 0, 0], 1)
    expect(L.files.size).toBe(10)
    const ca = L.centres.get('A'), cb = L.centres.get('B')
    const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    expect(dist(ca, cb)).toBeGreaterThan(1)
    for (const r of rows) expect(dist(L.files.get(r.id), L.centres.get(r.project))).toBeLessThan(.46)
  })
})

describe('collapseView (big libraries)', () => {
  it('keeps small libraries as they are and collapses big ones by project', async () => {
    const { collapseView } = await import('../../src/renderer/src/brain/realnodes.js')
    const rows = [
      { id: 'a1', project: 'A' }, { id: 'a2', project: 'A' }, { id: 'b1', project: 'B' }, { id: 'n1', project: null }
    ]
    const links = [
      { from_id: 'a1', to_id: 'a2', status: 'linked', origin: 'user' },
      { from_id: 'a1', to_id: 'b1', status: 'linked', origin: 'auto' },
      { from_id: 'a2', to_id: 'b1', status: 'linked', origin: 'user' },
      { from_id: 'a2', to_id: 'n1', status: 'suggested', origin: 'auto' }
    ]
    expect(collapseView(rows, links, new Set(), 10).pairs).toBeNull()
    const v = collapseView(rows, links, new Set(), 3)
    expect(v.rows).toEqual([])
    expect(v.clusters).toEqual([{ key: 'A', count: 2 }, { key: 'B', count: 1 }, { key: '', count: 1 }])
    // links inside a cluster vanish; A–B becomes one line, a user link because one of them is
    expect(v.pairs).toEqual([{ a: 'c:A', b: 'c:B', user: true, n: 2 }])
    const o = collapseView(rows, links, new Set(['A']), 3)
    expect(o.rows.map((r: { id: string }) => r.id)).toEqual(['a1', 'a2'])
    expect(o.clusters.map((c: { key: string }) => c.key)).toEqual(['B', ''])
    expect(o.pairs).toContainEqual({ a: 'a1', b: 'a2', user: true, n: 1 })
    expect(o.pairs).toContainEqual({ a: 'a1', b: 'c:B', user: false, n: 1 })
  })
  it('keeps notes visible one by one and collapses only the other files', async () => {
    const { collapseView } = await import('../../src/renderer/src/brain/realnodes.js')
    const rows = [
      { id: 'n1', project: 'A', ext: 'md' }, { id: 'n2', project: 'A', ext: 'md' }, { id: 'n3', project: 'B', ext: 'txt' },
      { id: 'p1', project: 'A', ext: 'png' }, { id: 'p2', project: 'A', ext: 'glb' }, { id: 'p3', project: 'B', ext: 'jpg' }
    ]
    const links = [
      { from_id: 'n1', to_id: 'n2', status: 'linked', origin: 'user' },
      { from_id: 'n1', to_id: 'n3', status: 'linked', origin: 'user' },
      { from_id: 'n1', to_id: 'p1', status: 'linked', origin: 'user' },
      { from_id: 'n2', to_id: 'p2', status: 'linked', origin: 'user' }
    ]
    const v = collapseView(rows, links, new Set(), 3)
    expect(v.rows.map((r: { id: string }) => r.id)).toEqual(['n1', 'n2', 'n3'])
    expect(v.clusters).toEqual([{ key: 'A', count: 2 }, { key: 'B', count: 1 }])
    expect(v.pairs).toContainEqual({ a: 'n1', b: 'n2', user: true, n: 1 })
    expect(v.pairs).toContainEqual({ a: 'n1', b: 'n3', user: true, n: 1 })
    expect(v.pairs).toContainEqual({ a: 'n1', b: 'c:A', user: true, n: 1 })
    // over the budget: the most linked notes stay
    const b = collapseView(rows, links, new Set(), 3, 1)
    expect(b.rows.map((r: { id: string }) => r.id)).toEqual(['n1'])
    expect(b.clusters).toEqual([{ key: 'A', count: 3 }, { key: 'B', count: 2 }])
  })
})

describe('capLines', () => {
  it('keeps one line for every point first, then user lines', async () => {
    const { capLines } = await import('../../src/renderer/src/brain/realnodes.js')
    // user lines 0-1, 0-2, 1-2 ; auto lines 3-4, 0-3
    const [u, a] = capLines([0, 1, 0, 2, 1, 2], [3, 4, 0, 3], 5, 3)
    expect(u).toEqual([0, 1, 0, 2])
    expect(a).toEqual([3, 4])
  })
})

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
// @ts-ignore plain JS module
import { slotOffset, foreignRows, silhouetteArrays, createForeignBrains } from '../../src/renderer/src/brain/foreign.js'
// @ts-ignore plain JS module
import { projectList, exportOpts } from '../../src/renderer/src/ui/brains.js'
// @ts-ignore plain JS module
import { createRealLayer } from '../../src/renderer/src/brain/realnodes.js'

describe('foreign brains', () => {
  it('places brains alternately right and left, further out per ring', () => {
    expect(slotOffset(0, 1)).toEqual({ side: 1, dist: 2.35 })
    expect(slotOffset(1, 1).side).toBe(-1)
    expect(slotOffset(2, 1).dist).toBeGreaterThan(slotOffset(0, 1).dist)
  })
  it('makes node ids unique per brain and keeps the file id', () => {
    const r = foreignRows('x', [{ id: 'f1', name: 'A.md', ext: 'md', size: 3, project: 'P' }])
    expect(r[0]).toMatchObject({ id: 'b:x:f1', fid: 'f1', name: 'A.md', project: 'P' })
  })
  it('keeps only shaded points of the brain shape', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]), 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([1, 2, 3]), 1))
    const a = silhouetteArrays(g, new Float32Array([.5, 0, .7]))
    expect(a.count).toBe(2)
    expect([...a.pos]).toEqual([0, 0, 0, 2, 2, 2])
    expect([...a.size]).toEqual([1, 3])
  })
  it('draws a thread for each bridge between my note and theirs', () => {
    const n = 40, pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { pos[i * 3] = Math.cos(i) * .5; pos[i * 3 + 1] = Math.sin(i) * .5; pos[i * 3 + 2] = (i % 7) / 10 }
    const pts = Array.from({ length: n }, (_, i) => i)
    const scene = new THREE.Scene(), brainG = new THREE.Group(); scene.add(brainG)
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.ShaderMaterial({ uniforms: { uPR: { value: 1 }, uK: { value: 1 } } })
    const nmat = new THREE.PointsMaterial()
    const REAL = createRealLayer(THREE, { parent: brainG, material: nmat, regionPts: pts, allPts: pts, pos } as never)
    REAL.update([{ id: 'm1', name: 'Idee.md', ext: 'md', size: 1, project: 'P' }, { id: 'm2', name: 'B.md', ext: 'md', size: 1, project: 'P' }], [])
    const FB = createForeignBrains(THREE, { scene, brainG, sil: { geo, material: mat, shade: new Float32Array(n).fill(.5) }, nodeMaterial: nmat, regionPts: pts, allPts: pts, pos, center: [0, 0, 0], radius: 1, camera: new THREE.PerspectiveCamera(), REAL, myColor: () => null })
    FB.setBrains([{ id: 'x', name: 'Anna', author: null, data: { files: [{ id: 't1', name: 'Idee.md', ext: 'md', size: 1, project: 'P' }], links: [], bridges: { files: [{ mine: 'm1', theirs: 't1', why: 'name' }], projects: [{ mine: 'P', theirs: 'P' }] } } }])
    expect(FB.brains.length).toBe(1)
    expect(FB.bridgeCount).toBe(2)
    expect(FB.bridgesCount('x')).toBe(2)
    expect(FB.worldCenter(0)!.x).toBeGreaterThan(0)
    FB.setBrains([])
    expect(FB.bridgeCount).toBe(0)
  })
})

describe('brains tab helpers', () => {
  it('lists my projects without session notes', () => {
    const L = projectList([{ project: 'B', size: 2 }, { project: 'A', size: 1 }, { project: null, size: 5 }, { project: 'Claude Sessions', source: 'session', size: 9 }])
    expect(L.map((p: { name: string }) => p.name)).toEqual(['A', 'B', ''])
  })
  it('turns the form into export options', () => {
    expect(exportOpts({ name: ' ', author: '', projects: null, sessions: false }, 'Mein Gehirn')).toEqual({ name: 'Mein Gehirn', author: null, projects: null, sessions: false })
    expect(exportOpts({ name: 'X', author: 'Lu', projects: new Set(['A', '']), sessions: true }, 'Y').projects).toEqual(['A', null])
  })
})

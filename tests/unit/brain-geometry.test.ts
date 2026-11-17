import { describe, expect, it } from 'vitest'
import { REG, buildBrain } from '../../src/renderer/src/brain/geometry.js'

describe('brain geometry', () => {
  const a = buildBrain()
  it('is deterministic (same seed, same brain)', () => {
    const b = buildBrain()
    expect(b.N).toBe(a.N)
    expect(b.pos.slice(0, 300)).toEqual(a.pos.slice(0, 300))
    expect(b.segs.length).toBe(a.segs.length)
  })
  it('has points in every functional region', () => {
    for (let r = 0; r < REG.length; r++) expect(a.regPts[r].length, REG[r]).toBeGreaterThan(0)
  })
  it('keeps brain points before the outer network', () => {
    expect(a.NB).toBeLessThan(a.N)
    expect(a.reg.slice(a.NB).every((r: number) => r === -2)).toBe(true)
  })
})

import { buildNerveData } from '../../src/renderer/src/brain/nerves.js'

describe('connector nerves', () => {
  const cons = [{ s: 'ok' }, { s: 'warn' }, { s: 'bad' }]
  it('builds exactly one nerve end per real connector', () => {
    const d = buildNerveData(cons)
    expect(d.conIdx.length).toBe(3)
    expect(new Set(d.Cn.filter((c: number) => c >= 0)).size).toBe(3)
  })
  it('builds only the cord when there are no connectors', () => {
    const d = buildNerveData([])
    expect(d.conIdx.length).toBe(0)
    expect(d.Cn.every((c: number) => c === -1)).toBe(true)
  })
  it('is deterministic', () => {
    expect(buildNerveData(cons).P.slice(0, 60)).toEqual(buildNerveData(cons).P.slice(0, 60))
  })
})

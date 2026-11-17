import { describe, it, expect } from 'vitest'
import { setupSteps, setupProgress, readPick } from '../../src/renderer/src/ui/setup.js'

describe('setup guide', () => {
  it('reads each step from the real state, in order', () => {
    const none = setupSteps({ hasBridge: true, libCount: 0, mon: {}, tried: false })
    expect(none.map((s: { k: string }) => s.k)).toEqual(['node', 'notes', 'connect', 'session', 'rule', 'context', 'try'])
    expect(setupProgress(none)).toEqual({ n: 0, total: 7 })
    const all = setupSteps({
      hasBridge: true, libCount: 3, tried: true,
      mon: { status: { node: '/usr/bin/node', installed: true, outdated: false }, sessions: [{}], rule: { installed: true, outdated: false }, ctx: { installed: true, outdated: false } }
    })
    expect(setupProgress(all)).toEqual({ n: 7, total: 7 })
  })
  it('an outdated connection or rule is not done', () => {
    const s = setupSteps({ hasBridge: true, libCount: 1, tried: false, mon: { status: { node: 'n', installed: true, outdated: true }, rule: { installed: true, outdated: true } } })
    expect(s.find((x: { k: string }) => x.k === 'connect')!.done).toBe(false)
    expect(s.find((x: { k: string }) => x.k === 'rule')!.done).toBe(false)
  })
  it('the demo (no bridge) never claims a step as done', () => {
    const s = setupSteps({ hasBridge: false, libCount: 5, tried: true, mon: {} })
    expect(s.every((x: { done: boolean; na: boolean }) => !x.done && x.na)).toBe(true)
  })
  it('shows only the steps of the chosen goals', () => {
    expect(readPick(null)).toEqual(['notes', 'watch', 'memory', 'apps'])
    expect(readPick('["apps","notes"]')).toEqual(['notes', 'apps'])
    const only = setupSteps({ hasBridge: true, libCount: 0, mon: {}, tried: false, pick: ['notes'] })
    expect(only.map(s => s.k)).toEqual(['notes'])
    const mem = setupSteps({ hasBridge: true, libCount: 0, mon: {}, tried: false, pick: ['memory'] })
    expect(mem.map(s => s.k)).toEqual(['node', 'rule', 'context', 'try'])
  })
})

import { describe, it, expect } from 'vitest'
// @ts-ignore plain JS module
import { stickySide, spreadDown, stackColumn } from '../../src/renderer/src/brain/labels.js'
// @ts-ignore plain JS module
import { paletteMatches, excerptAt } from '../../src/renderer/src/ui/palette.js'

describe('label layout', () => {
  it('keeps a label on its side until the marker is clearly across', () => {
    expect(stickySide(0, -5)).toBe(-1)
    expect(stickySide(-1, 30)).toBe(-1)
    expect(stickySide(-1, 60)).toBe(1)
    expect(stickySide(1, -60)).toBe(-1)
  })
  it('spaces labels at least the gap apart', () => {
    const a = [{ ly: 10 }, { ly: 12 }, { ly: 50 }]
    spreadDown(a, 'ly', 22)
    expect(a.map((o) => o.ly)).toEqual([10, 32, 54])
  })
  it('keeps a connector column on screen', () => {
    const c = stackColumn([{ sy: 790 }, { sy: 100 }, { sy: 795 }], 38, 740)
    expect(c.map((o: { y: number }) => o.y)).toEqual([100, 702, 740])
  })
})

describe('palette search', () => {
  const files = [{ n: 'Lobby.rbxl' }, { n: 'Map-Ideen.md' }]
  const src = ['', '# Map-Ideen\nLobby mit drei Portalen']
  const opts = { files, srcOf: (i: number) => src[i], nameOf: (F: { n: string }) => F.n, hitKind: 'text', open: () => {} }
  const items = [{ label: 'Lobby.rbxl', kind: 'note', run: () => {} }]
  it('adds full-text hits with an excerpt', () => {
    const r = paletteMatches(items, 'lobby', opts)
    expect(r.map((x: { label: string }) => x.label)).toEqual(['Lobby.rbxl', 'Map-Ideen.md'])
    expect(r[1].ex).toContain('Lobby mit drei')
  })
  it('hides excerpts in privacy mode', () => {
    expect(paletteMatches(items, 'lobby', { ...opts, privacy: true })[1].ex).toBe('')
  })
  it('needs two characters for full-text search', () => {
    expect(paletteMatches(items, 'd', opts).length).toBe(0)
  })
  it('makes one-line excerpts', () => {
    expect(excerptAt('a\nb', 0)).toBe('…a b…')
  })
})

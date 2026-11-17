import { describe, it, expect } from 'vitest'
import { findVaults, obsidianConfig } from '../../src/main/library/vaults'

describe('obsidian vaults', () => {
  it('knows where obsidian.json lives', () => {
    expect(obsidianConfig('darwin', '/Users/a', {})).toContain('Application Support')
    expect(obsidianConfig('win32', 'C:/u', {})).toBeNull()
  })
  it('lists existing vaults, marks linked ones, ignores broken config', () => {
    const cfg = JSON.stringify({ vaults: { a: { path: '/v/atlas/vault' }, b: { path: '/v/gone' }, c: { path: '/v/atlas/vault' }, d: { path: '/w/Notes' } } })
    const r = findVaults({ platform: 'linux', home: '/h', env: {}, linked: ['/v/atlas'], read: () => cfg, exists: (p) => p !== '/v/gone' })
    expect(r).toEqual([{ path: '/w/Notes', name: 'Notes', linked: false }, { path: '/v/atlas/vault', name: 'vault', linked: true }])
    expect(findVaults({ platform: 'linux', home: '/h', env: {}, linked: [], read: () => '{bad', exists: () => true })).toEqual([])
  })
})

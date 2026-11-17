import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { scanApps, expandPlace } from '../../src/main/monitor/appScan'

describe('app scan', () => {
  it('expands home and environment variables, skips unknown ones', () => {
    expect(expandPlace('~/Applications/X.app', '/Users/a', {})).toBe(join('/Users/a', '/Applications/X.app'))
    expect(expandPlace('%LOCALAPPDATA%/Roblox/Versions', 'C:/Users/a', { LOCALAPPDATA: 'C:/Users/a/AppData/Local' })).toBe('C:/Users/a/AppData/Local/Roblox/Versions')
    expect(expandPlace('%NOPE%/x', '/h', {})).toBeNull()
  })
  it('finds installed programs and matches MCP servers by name', () => {
    const have = new Set(['/Applications/RobloxStudio.app', '/Applications/Blender.app'])
    const r = scanApps({ platform: 'darwin', home: '/Users/a', env: {}, servers: [{ name: 'Roblox_Studio', target: 'rbx-studio-mcp' }, { name: 'obs-studio', target: 'node' }], exists: (p) => have.has(p) })
    const by = Object.fromEntries(r.map((x) => [x.id, x]))
    expect(by.roblox).toMatchObject({ found: true, connected: true, server: 'Roblox_Studio' })
    expect(by.blender).toMatchObject({ found: true, connected: false })
    expect(by.obs).toMatchObject({ found: false, connected: true })
    expect(by.figma.found).toBe(false)
    expect(JSON.stringify(r)).not.toContain('/Applications')
  })
})

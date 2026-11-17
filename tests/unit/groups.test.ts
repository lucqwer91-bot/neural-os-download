import { describe, it, expect } from 'vitest'
// @ts-ignore plain JS module
import { groupOf, folderOf, groupCounts, histogram, monthOf, idsInMonth, isNone, groupColor, assignColors, setTags, topOf, rampColor } from '../../src/renderer/src/ui/groups.js'

const rows = [
  { id: 'a', ext: 'md', project: 'Roblox', source: 'linked', rel_path: 'Roblox/Scripts/Spawn.md', mtime: Date.UTC(2026, 0, 15) },
  { id: 'b', ext: 'md', project: 'Roblox', source: 'linked', rel_path: 'Roblox/Idee.md', mtime: Date.UTC(2026, 2, 3) },
  { id: 'c', ext: 'png', project: null, source: 'copy', original_path: 'C:\\Users\\x\\Bilder\\Logo.png', mtime: null, imported_at: '2026-03-20T10:00:00Z' },
  { id: 'd', ext: 'luau', project: 'Roblox', source: 'linked', rel_path: 'Root.luau', folder_name: 'Vault', mtime: null, imported_at: 'bad' },
]

describe('groups', () => {
  it('finds the folder of linked and copied files', () => {
    expect(folderOf(rows[0])).toBe('Scripts')
    expect(folderOf(rows[2])).toBe('Bilder')
    expect(folderOf(rows[3])).toBe('Vault')
  })
  it('groups by project, folder and type', () => {
    expect(groupOf(rows[0], 'project')).toBe('Roblox')
    expect(isNone(groupOf(rows[2], 'project'))).toBe(true)
    expect(groupOf(rows[2], 'type')).toBe('png')
    expect(groupCounts(rows, 'project')[0]).toEqual({ key: 'Roblox', n: 3 })
  })
  it('gives every group a stable colour', () => {
    expect(groupColor('Roblox', 'project')).toEqual(groupColor('Roblox', 'project'))
    expect(groupColor('md', 'type')).not.toEqual(groupColor('png', 'type'))
  })
  it('builds a month histogram with empty months and undated files', () => {
    expect(monthOf(rows[2])).toBe('2026-03')
    const h = histogram(rows, 'project')
    expect(h.months.map((m: { month: string }) => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(h.months[1].total).toBe(0)
    expect(h.months[2].total).toBe(2)
    expect(h.undated).toBe(1)
    expect([...idsInMonth(rows, '2026-03')]).toEqual(['b', 'c'])
  })
  it('keeps only the newest months', () => {
    const h = histogram(rows, 'type', 2)
    expect(h.months.length).toBe(2)
    expect(h.hidden).toBe(1)
  })
})

describe('colour slots', () => {
  it('gives every group on screen its own colour', async () => {
    // @ts-ignore plain JS module
    const { assignColors, groupColor } = await import('../../src/renderer/src/ui/groups.js')
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), project: 'P' + i }))
    assignColors(many, 'project')
    const cols = new Set(many.map((r) => groupColor(r.project, 'project').join(',')))
    expect(cols.size).toBe(12)
  })
  it('groups by main folder, month and tag', () => {
    expect(topOf(rows[0])).toBe('Roblox')
    expect(topOf(rows[3])).toBe('Vault')
    expect(groupOf(rows[1], 'time')).toBe('2026-03')
    expect(isNone(groupOf(rows[3], 'time'))).toBe(true)
    setTags({ tags: [{ tag: 'idee', count: 2 }, { tag: 'code', count: 1 }], files: { idee: ['b', 'a'], code: ['a'] } })
    expect(groupOf(rows[0], 'tag')).toBe('idee')
    expect(isNone(groupOf(rows[2], 'tag'))).toBe(true)
    setTags(null)
  })
  it('colours months on a ramp from old to new, newest first in the legend', () => {
    assignColors(rows, 'time')
    expect(groupColor('2026-01', 'time')).toEqual(rampColor(1 / 6))
    expect(groupColor('2026-03', 'time')).toEqual(rampColor(4 / 6))
    expect(groupCounts(rows, 'time').map(g => g.key).slice(0, 2)).toEqual(['2026-03', '2026-01'])
  })
})

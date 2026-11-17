import { describe, it, expect } from 'vitest'
import { lineDiff, compactDiff, diffStats, eventKey, eventDetail, timelineEvents, baseName, addLive, mon, isActive } from '../../src/renderer/src/ui/monitor.js'

describe('monitor ui helpers', () => {
  it('diffs lines', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc\nd')
    expect(d).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c'], ['+', 'd']])
    expect(diffStats(d)).toEqual({ add: 2, del: 1 })
    expect(lineDiff(null, 'x')).toEqual([['+', 'x']])
    expect(diffStats(lineDiff('a\nb', 'c\nd', 1))).toEqual({ add: 2, del: 2 })
  })
  it('compacts unchanged runs', () => {
    const a = Array.from({ length: 20 }, (_, i) => 'l' + i)
    const b = [...a]; b[10] = 'X'
    const c = compactDiff(lineDiff(a.join('\n'), b.join('\n')), 1)
    expect(c[0]).toEqual(['…', 9])
    expect(c.filter((x: (string | number)[]) => x[0] === '-' || x[0] === '+')).toHaveLength(2)
    expect(c[c.length - 1]).toEqual(['…', 8])
  })
  it('labels events from real fields only', () => {
    expect(eventKey({ type: 'tool_finished', tool: 'mcp__github__get_me' })).toBe('e_mcp')
    expect(eventDetail({ tool: 'mcp__github__get_me' })).toBe('github · get_me')
    expect(eventDetail({ tool: 'Bash', summary: 'npm' })).toBe('npm')
    expect(eventKey({ type: 'tool_finished', tool: 'Write' })).toBe('e_Edit')
    expect(eventDetail({ tool: 'Grep', summary: 'x' })).toBe('Grep · x')
    expect(timelineEvents([{ type: 'tool_finished', tool_use_id: 'a' }, { type: 'tool_started', tool_use_id: 'a' }, { type: 'tool_started', tool_use_id: 'b' }])).toHaveLength(2)
    expect(eventDetail({ file_path: 'C:\\x\\note.md' })).toBe('note.md')
    expect(eventKey({ type: 'other' })).toBe('m_other')
    expect(baseName('/a/b/')).toBe('b')
  })
  it('keeps the live cache newest first', () => {
    addLive({ event: { id: 'e1' }, session: { id: 's', last_at: new Date().toISOString(), ended_at: null }, change: { id: 'c', before_text: 'x', after_text: 'y' } })
    expect((mon.events[0] as { id: string }).id).toBe('e1')
    expect(mon.changes[0]).not.toHaveProperty('before_text')
    expect(isActive(mon.sessions[0])).toBe(true)
  })
})

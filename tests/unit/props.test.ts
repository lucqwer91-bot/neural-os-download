import { describe, it, expect } from 'vitest'
import { parseProps, serializeProps } from '../../src/renderer/src/ui/props.js'

describe('properties', () => {
  it('reads and writes the simple forms, keeps the body', () => {
    const text = '---\ntitle: "Shop: v2"\ntags:\n  - game\n  - ui\naliases: [Store, Laden]\ndone: true\n---\n# Body\n'
    const P = parseProps(text)
    expect(P.simple).toBe(true)
    expect(P.props).toEqual([{ key: 'title', value: 'Shop: v2' }, { key: 'tags', value: ['game', 'ui'] }, { key: 'aliases', value: ['Store', 'Laden'] }, { key: 'done', value: 'true' }])
    const out = serializeProps(P.props, P.body)
    expect(out).toBe('---\ntitle: "Shop: v2"\ntags:\n  - game\n  - ui\naliases:\n  - Store\n  - Laden\ndone: true\n---\n# Body\n')
    expect(parseProps(out).props).toEqual(P.props)
  })
  it('no frontmatter: adds one; all removed: drops it; nested is not simple', () => {
    expect(serializeProps([{ key: 'a', value: '1' }], '# X\n')).toBe('---\na: 1\n---\n# X\n')
    expect(serializeProps([], parseProps('---\na: 1\n---\n# X\n').body)).toBe('# X\n')
    expect(parseProps('---\nmap:\n  x: 1\n---\n').simple).toBe(false)
  })
})

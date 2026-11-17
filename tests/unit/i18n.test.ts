import { describe, expect, it } from 'vitest'
import en from '../../src/i18n/en.json'
import de from '../../src/i18n/de.json'

describe('translation files', () => {
  it('have the same keys', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  })
  it('have no empty strings', () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(de)]) {
      expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true)
    }
  })
  it('keep {placeholders} identical in both languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(ph(de[k] as string), k).toBe(ph(en[k] as string))
    }
  })
})

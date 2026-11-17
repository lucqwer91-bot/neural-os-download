import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { requestDir, takeRequests, writeResult } from '../../src/main/library/requests'

describe('link requests', () => {
  it('reads single and list requests, removes them, keeps exclude', () => {
    const d = requestDir(mkdtempSync(join(tmpdir(), 'nos-req-')))
    writeFileSync(join(d, 'a.json'), JSON.stringify({ path: '/x', exclude: '*.mp4' }))
    writeFileSync(join(d, 'b.json'), JSON.stringify([{ path: '/y' }, { nope: 1 }, { path: '/z', exclude: 3 }]))
    writeFileSync(join(d, 'note.txt'), 'ignored')
    const r = takeRequests(d)
    expect(r.map((x) => x.file)).toEqual(['a.json', 'b.json'])
    expect(r[0].items).toEqual([{ path: '/x', exclude: '*.mp4' }])
    expect(r[1].items).toEqual([{ path: '/y' }, { path: '/z' }])
    expect(readdirSync(d).sort()).toEqual(['done', 'note.txt'])
    writeResult(d, 'a.json', { ok: true })
    expect(JSON.parse(readFileSync(join(d, 'done', 'a.json'), 'utf8'))).toEqual({ ok: true })
  })
  it('waits for a half-written file, refuses it once old', () => {
    const d = requestDir(mkdtempSync(join(tmpdir(), 'nos-req-')))
    const p = join(d, 'c.json'); writeFileSync(p, '{"path": "/x"')
    expect(takeRequests(d)).toEqual([])
    const old = new Date(Date.now() - 60_000); utimesSync(p, old, old)
    const r = takeRequests(d)
    expect(r).toHaveLength(1); expect(r[0].error).toBeTruthy(); expect(r[0].items).toEqual([])
  })
})

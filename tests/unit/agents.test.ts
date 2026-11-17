import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { agentBoard, gradeLetter, gradeValue, listItems, parseHandoffName, parseHandoffText, tables } from '../../src/main/library/agents'

describe('agent board parsing', () => {
  it('reads handoff names and fields', () => {
    expect(parseHandoffName('2026-10-24 1106 code-reviewer - phase 2 draft review.md')).toEqual({ at: '2026-10-24 11:06', agent: 'code-reviewer', task: 'phase 2 draft review' })
    expect(parseHandoffName('2026-10-24 1256 UTC systems-scripter - lighting.md')?.agent).toBe('systems-scripter')
    expect(parseHandoffName('Notes.md')).toBeNull()
    const x = parseHandoffText('FROM: map-builder   TO: studio   TASK: shop blockout\nSTATUS: done. (walk 8.7 s)\nEVIDENCE: x\nNEXT: playtester tests box 1')
    expect(x).toEqual({ from: 'map-builder', to: 'studio', task: 'shop blockout', status: 'done', next: 'playtester tests box 1' })
    expect(parseHandoffText('# Review\n**Verdict: FAIL. 3 BLOCKING**').status).toBe('fail')
  })
  it('grades, tables, list items', () => {
    expect(gradeValue('B+')).toBeCloseTo(3.3); expect(gradeValue('–')).toBeNull()
    expect(gradeLetter(3.65)).toBe('A-'); expect(gradeLetter(4)).toBe('A'); expect(gradeLetter(3.3)).toBe('B+')
    expect(tables('x\n| Agent | STUDIO grade |\n|---|---|\n| a (X) | A |\n| b | B |\n')).toEqual([{ agent: 'a (X)', 'studio grade': 'A' }, { agent: 'b', 'studio grade': 'B' }])
    expect(listItems('---\ntags: [x]\n---\n- 2026-10-24 (clip): approve?\n- ~~done~~ yes\n- [x] checked\n- [ ] open one\n- [[Link]]')).toEqual([{ date: '2026-10-24', text: '(clip): approve?' }, { date: null, text: 'open one' }])
  })
  it('builds the board from a vault, read-only', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nos-ag-')), v = join(d, 'V')
    await mkdir(join(v, 'Fleet', 'Agents'), { recursive: true }); await mkdir(join(v, 'Fleet', 'Handoffs'), { recursive: true })
    await writeFile(join(v, 'Fleet', 'Agents', 'map-builder.md'), '---\nofficer: Piett\n---\n# Map builder: builds maps')
    await writeFile(join(v, 'Fleet', 'Handoffs', '2026-10-24 1022 map-builder - shop blockout.md'), 'FROM: map-builder TO: studio TASK: shop\nSTATUS: done')
    await writeFile(join(v, 'Fleet', 'Handoffs', 'README.md'), 'about')
    await writeFile(join(v, 'Fleet', 'Scorecard.md'), '| Agent | STUDIO grade | Self-grade |\n|---|---|---|\n| map-builder (Piett) | A- | B |\n| map-builder (Piett) | B+ | B |')
    await writeFile(join(v, 'Fleet', 'Learnings.md'), '- 2026-10-24: Name handoffs in UTC.')
    await writeFile(join(v, 'Fleet', 'Owner Questions.md'), '- 2026-10-24: approve layout?\n- ~~ffmpeg~~ done')
    const db = openDb(join(d, 'n.db'))
    try {
      const f = addFolder(db, v); await scanFolder(db, f.id)
      const b = await agentBoard(db, '')
      expect(b.agents).toEqual([expect.objectContaining({ name: 'map-builder', title: 'Map builder: builds maps', officer: 'Piett', handoffs: 1, grade: 'A-', graded: 2 })])
      expect(b.handoffs).toHaveLength(1)
      expect(b.handoffs[0]).toMatchObject({ agent: 'map-builder', to: 'studio', status: 'done', at: '2026-10-24 10:22' })
      expect(b.learnings.map((x) => x.text)).toEqual(['Name handoffs in UTC.'])
      expect(b.questions.map((x) => x.text)).toEqual(['approve layout?'])
      expect(b.subagents).toEqual([])
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
})

import { checkboxes } from '../../src/main/library/agents'
describe('phases and prompt proposals', () => {
  it('counts boxes, reads phases, gates, linked handoffs and proposals', async () => {
    expect(checkboxes('- [x] a\n- [ ] b\n  * [X] c\ntext [ ] no')).toEqual({ done: 2, total: 3 })
    const d = await mkdtemp(join(tmpdir(), 'nos-ph-')), v = join(d, 'V')
    await mkdir(join(v, 'Phases'), { recursive: true }); await mkdir(join(v, 'Handoffs'), { recursive: true }); await mkdir(join(v, 'Fleet'), { recursive: true })
    await writeFile(join(v, 'Phases', 'Phase 2.md'), '---\nstatus: todo\n---\n# Phase 2: Data · `systems-scripter`\nAgents: [[systems-scripter]]\nGate: [[G4 Build]] before, [[G5 QA]] after.\n- [x] one\n- [ ] two')
    await writeFile(join(v, 'Phases', 'Phase 10.md'), '# Phase 10\n- [ ] x')
    await writeFile(join(v, 'Handoffs', '2026-10-24 1059 systems-scripter - draft.md'), '[[systems-scripter]] · [[Phase 2]]\nSTATUS: done')
    await writeFile(join(v, 'Fleet', 'Prompt Proposals.md'), '| Date | Agent | Proposed change | Why (lesson) | Status |\n|---|---|---|---|---|\n| 2026-10-24 | [[trend-scout]] | Add a `source` block | needed | proposed |')
    const db = openDb(join(d, 'n.db'))
    try {
      const f = addFolder(db, v); await scanFolder(db, f.id)
      const b = await agentBoard(db, '')
      expect(b.phases.map((p) => p.name)).toEqual(['Phase 2', 'Phase 10'])
      expect(b.phases[0]).toMatchObject({ title: 'Phase 2: Data · systems-scripter', status: 'todo', done: 1, total: 2, gates: ['G4 Build', 'G5 QA'], agents: ['systems-scripter'], handoffs: 1 })
      expect(b.proposals).toEqual([expect.objectContaining({ date: '2026-10-24', agent: 'trend-scout', change: 'Add a source block', why: 'needed', status: 'proposed' })])
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
})

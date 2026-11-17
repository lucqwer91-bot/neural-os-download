import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { openDb, type Db } from '../../src/main/library/db'
import { normalize } from '../../src/main/monitor/normalize'
import { record, listSessions, listEvents, listChanges, getChange } from '../../src/main/monitor/store'
import { withOurs, withoutOurs, isInstalled, installedCommand, plan, apply, SCRIPT_NAME } from '../../src/main/monitor/installer'
import { startReceiver } from '../../src/main/monitor/receiver'
import { FORWARDER_SOURCE } from '../../src/main/monitor/forwarder'

let dir: string, db: Db
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nos-mon-')); db = openDb(join(dir, 'nos.db')) })
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

const base = { session_id: 's1', cwd: '/w', hook_event_name: 'PostToolUse' }

describe('normalize', () => {
  it('rejects malformed payloads', () => {
    expect(normalize({})).toBeNull()
    expect(normalize({ hook_event_name: 'Stop' })).toBeNull()
    expect(normalize({ session_id: 's', hook_event_name: 'x y' })).toBeNull()
  })
  it('maps verified events and leaves missing fields empty', () => {
    const e = normalize({ ...base, tool_name: 'Read', tool_input: { file_path: '/w/a.md' }, duration_ms: 12 })!
    expect(e).toMatchObject({ event_type: 'tool_finished', region: 'memory', file_path: '/w/a.md', duration_ms: 12, model: null, status: 'ok' })
    expect(normalize({ ...base, hook_event_name: 'SessionStart', model: 'm', source: 'startup' })).toMatchObject({ event_type: 'session_started', model: 'm', summary: 'startup' })
    expect(normalize({ ...base, hook_event_name: 'Brandnew' })!.event_type).toBe('other')
    // a model field on other events is ignored (only SessionStart and PostModelSwitch carry it)
    expect(normalize({ ...base, model: 'm' })!.model).toBeNull()
  })
})

describe('store and change log', () => {
  it('records sessions and events, and before/after for edits', async () => {
    const f = join(dir, 'note.md')
    await writeFile(f, 'new text')
    const now = '2026-11-17T08:00:00.000Z'
    record(db, dir, normalize({ ...base, hook_event_name: 'SessionStart', model: 'm' })!, now)
    record(db, dir, normalize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 't1', tool_input: { file_path: f }, before_text: 'old text' })!, now)
    const r = record(db, dir, normalize({ ...base, tool_name: 'Edit', tool_use_id: 't1', tool_input: { file_path: f } })!, now)!
    expect(r.change).toMatchObject({ before_text: 'old text', after_text: 'new text', how: 'snapshot' })
    expect(listSessions(db)[0]).toMatchObject({ id: 's1', events: 3, model: 'm' })
    expect(listEvents(db)).toHaveLength(3)
    expect(listChanges(db)[0]).not.toHaveProperty('before_text')
    expect(getChange(db, r.change!.id)!.after_text).toBe('new text')
  })
  it('marks a missing before text, drops failed edits and skips excluded sessions', () => {
    const now = '2026-11-17T08:00:00.000Z'
    record(db, dir, normalize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 't2', tool_input: { file_path: '/x/new.md' }, before_missing: true })!, now)
    expect(listChanges(db)[0].how).toBe('new_file')
    record(db, dir, normalize({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Write', tool_use_id: 't2', tool_input: { file_path: '/x/new.md' } })!, now)
    expect(listChanges(db)).toHaveLength(0)
    expect(record(db, dir, normalize({ ...base, session_id: 'hidden' })!, now, new Set(['hidden']))).toBeNull()
  })
})

describe('hook installer', () => {
  const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-check' }] }] }, model: 'x' }
  it('adds and removes only its own entries', () => {
    const on = withOurs(mine, '/d/hooks/' + SCRIPT_NAME, '/d/e.json', '/usr/bin/node')
    expect(isInstalled(on)).toBe(true)
    const pre = (on.hooks as Record<string, unknown[]>).PreToolUse
    expect(pre).toHaveLength(3)
    expect(JSON.stringify(pre)).toContain('"async":true')
    expect(JSON.stringify(pre)).toContain('"snap"')
    expect(withoutOurs(on)).toEqual(mine)
    expect(installedCommand(on)).toEqual({ command: '/usr/bin/node', script: '/d/hooks/' + SCRIPT_NAME })
    expect(installedCommand(mine)).toBeNull()
    expect(withoutOurs(withOurs({}, '/d/' + SCRIPT_NAME, '/e'))).toEqual({})
  })
  it('backs up before writing and refuses a broken file', async () => {
    const home = join(dir, 'home')
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify(mine))
    const script = join(dir, 'hooks', SCRIPT_NAME)
    const p = plan(home, script, join(dir, 'e.json'), false, 'node')
    expect(p.after).toContain(SCRIPT_NAME)
    const r = apply(home, script, join(dir, 'e.json'), join(dir, 'bak'), false, new Date(), 'node')
    expect(r.ok).toBe(true)
    expect(JSON.parse(await readFile(r.backup!, 'utf8'))).toEqual(mine)
    expect(await readFile(script, 'utf8')).toContain('NEURAL OS hook forwarder')
    apply(home, script, join(dir, 'e.json'), join(dir, 'bak'), true, new Date())
    expect(JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'))).toEqual(mine)
    await writeFile(join(home, '.claude', 'settings.json'), '{ broken')
    expect(apply(home, script, join(dir, 'e.json'), join(dir, 'bak'), false, new Date()).error).toBe('invalidJson')
    expect(await readFile(join(home, '.claude', 'settings.json'), 'utf8')).toBe('{ broken')
    expect((await readdir(join(dir, 'bak'))).length).toBe(2)
  })
})

function run(script: string, args: string[], stdin: string): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    let out = ''
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => res({ code, out }))
    p.stdin.end(stdin)
  })
}

describe('receiver and forwarder', () => {
  it('rejects requests without the secret', async () => {
    const r = await startReceiver(join(dir, 'ep.json'), () => undefined)
    const code = await new Promise<number>((res) => {
      const q = request({ host: '127.0.0.1', port: r.port, path: '/event', method: 'POST' }, (s) => { s.resume(); res(s.statusCode!) })
      q.end('{}')
    })
    expect(code).toBe(403)
    await r.close()
  })
  it('forwards a stripped payload silently and stays silent when the app is closed', async () => {
    const script = join(dir, SCRIPT_NAME)
    await writeFile(script, FORWARDER_SOURCE)
    const note = join(dir, 'n.md'); await writeFile(note, 'before')
    const got: Record<string, unknown>[] = []
    const ep = join(dir, 'ep.json')
    const r = await startReceiver(ep, (p) => got.push(p))
    const send = (o: object, mode?: string) => run(script, mode ? [ep, mode] : [ep], JSON.stringify(o))
    const a = await send({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'secret prompt' })
    const b = await send({ ...base, tool_name: 'Bash', tool_input: { command: '/usr/bin/curl -H "token: abc" x' }, tool_response: { stdout: 'secret' } })
    const c = await send({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: note } }) // async entry skips edits
    const d = await send({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: note } }, 'snap')
    for (const x of [a, b, c, d]) expect(x).toEqual({ code: 0, out: '' })
    expect(got).toHaveLength(3)
    expect(JSON.stringify(got)).not.toContain('secret')
    expect(JSON.stringify(got)).not.toContain('token')
    expect(got[1].tool_input).toEqual({ command_word: 'curl' })
    expect(got[2].before_text).toBe('before')
    await r.close()
    const t0 = Date.now()
    expect(await send({ ...base })).toEqual({ code: 0, out: '' })
    expect(await run(script, [join(dir, 'missing.json')], 'not json')).toEqual({ code: 0, out: '' })
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('session notes (S2)', () => {
  it('writes observed facts only and links library files', async () => {
    const { writeSessionNote, buildNote } = await import('../../src/main/monitor/sessionNote')
    const { organize } = await import('../../src/main/library/organize')
    const { importFiles, listLinks } = await import('../../src/main/library/library')
    const lib = join(dir, 'lib'); await mkdir(lib)
    const src = join(dir, 'Roadmap.md'); await writeFile(src, '# Roadmap')
    const imp = await importFiles(db, lib, [src])
    const libPath = join(lib, (db.prepare('SELECT lib_path FROM file_asset').get() as { lib_path: string }).lib_path)
    const now = '2026-11-17T08:00:00.000Z'
    const rec = (o: object) => record(db, lib, normalize({ ...base, cwd: '/u/neural-os', ...o })!, now)
    rec({ hook_event_name: 'SessionStart' })
    rec({ hook_event_name: 'UserPromptSubmit', prompt: 'secret' })
    rec({ tool_name: 'Read', tool_input: { file_path: libPath } })
    rec({ tool_name: 'Edit', tool_input: { file_path: '/u/neural-os/src/a.ts' } })
    rec({ tool_name: 'mcp__github__get_me' })
    rec({ hook_event_name: 'Stop', note_line: 'SESSION-NOTE: Roadmap gelesen, a.ts angepasst. Offen: Tests.' })
    const n = buildNote(db, 's1', 'de')!
    expect(n.text).toContain('## Von Claude zusammengefasst')
    expect(n.text).toContain('Roadmap gelesen, a.ts angepasst. Offen: Tests.')
    expect(n.text).toContain('[[Roadmap]]')
    expect(n.text).toContain('`/u/neural-os/src/a.ts`')
    expect(n.text).toContain('github')
    expect(n.text).toContain('Modell: nicht verfügbar')
    expect(n.text).not.toContain('secret')
    const id = writeSessionNote(db, lib, 's1', 'de', new Date(now))!
    expect(await readFile(join(lib, 'Sessions', n.fileName), 'utf8')).toBe(n.text)
    await organize(db, lib, [id], { wikilinksOnly: true })
    expect(listLinks(db).some((l) => l.from_id === id && l.to_id === imp.imported[0].id)).toBe(true)
    // rewriting keeps one file and one row
    expect(writeSessionNote(db, lib, 's1', 'en', new Date(now))).toBe(id)
    expect((db.prepare("SELECT count(*) AS n FROM file_asset WHERE source = 'session'").get() as { n: number }).n).toBe(1)
    expect(await readdir(join(lib, 'Sessions'))).toHaveLength(1)
  })
})

describe('readiness rule (spec 10.5)', () => {
  it('adds, updates and removes only its own block', async () => {
    const { withRule, withoutRule, findBlock, ruleApply, ruleStatus, rulePlan, RULE_TEXT, RULE_VERSION } = await import('../../src/main/monitor/readiness')
    const mine = '# My rules\n\nBe brief.\n'
    const on = withRule(mine)
    expect(on.startsWith(mine)).toBe(true)
    expect(findBlock(on)!.version).toBe(RULE_VERSION)
    expect(withRule(on)).toBe(on)
    expect(withoutRule(on)).toBe(mine)
    const old = on.replace('BEGIN v' + RULE_VERSION, 'BEGIN v1').replace('Before starting a larger task', 'OLD')
    expect(withRule(old)).toBe(on)
    expect(withoutRule(withRule(''))).toBe('')
    const home = join(dir, 'h'); await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'CLAUDE.md'), mine)
    const r = ruleApply(home, join(dir, 'bak'), false, new Date())
    expect(r.ok).toBe(true)
    expect(await readFile(r.backup!, 'utf8')).toBe(mine)
    expect(ruleStatus(home)).toMatchObject({ installed: true, version: RULE_VERSION, outdated: false })
    expect(ruleStatus(home)).toMatchObject({ installed: true })
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toContain(RULE_TEXT)
    ruleApply(home, join(dir, 'bak'), true, new Date())
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe(mine)
    await writeFile(join(home, '.claude', 'CLAUDE.md'), mine + '<!-- NEURAL-OS:READINESS:BEGIN v1 -->\nno end')
    expect(rulePlan(home, false).error).toBe('brokenBlock')
    expect(ruleApply(home, join(dir, 'bak'), true, new Date()).ok).toBe(false)
  })
  it('reads only the READINESS marker line from Claude', async () => {
    const { parseReadiness } = await import('../../src/main/monitor/readiness')
    expect(parseReadiness('READINESS: ready=GitHub,Roblox Studio missing=Figma Dev Mode needs_signin= failed=none')).toEqual({ ready: ['GitHub', 'Roblox Studio'], missing: ['Figma Dev Mode'], needs_signin: [], failed: [] })
    expect(parseReadiness('nothing here')).toBeNull()
    const e = normalize({ ...base, hook_event_name: 'Stop', readiness_line: 'READINESS: ready=a' })!
    expect(e.readiness_line).toBe('READINESS: ready=a')
    const r = record(db, dir, e, '2026-11-17T08:00:00.000Z')!
    expect(r.readiness!.type).toBe('readiness_report')
    expect(r.readiness!.region).toBe('connectors')
  })
  it('forwards only the marker line of the last message', async () => {
    const script = join(dir, SCRIPT_NAME)
    await writeFile(script, FORWARDER_SOURCE)
    const got: Record<string, unknown>[] = []
    const ep = join(dir, 'ep.json')
    const r = await startReceiver(ep, (p) => got.push(p))
    await run(script, [ep], JSON.stringify({ ...base, hook_event_name: 'Stop', last_assistant_message: 'Secret plan.\nREADINESS: ready=GitHub missing=Figma\nmore secret\nSESSION-NOTE: Shop gebaut.\nLESSON: Tests mit npm test laufen lassen.' }))
    await r.close()
    expect(got[0].readiness_line).toBe('READINESS: ready=GitHub missing=Figma')
    expect(got[0].note_line).toBe('SESSION-NOTE: Shop gebaut.')
    expect(got[0].lesson_line).toBe('LESSON: Tests mit npm test laufen lassen.')
    // the note line counts only on Stop of the main agent
    expect(normalize({ ...base, hook_event_name: 'Stop', note_line: 'SESSION-NOTE: x' })!.note_line).toBe('x')
    expect(normalize({ ...base, hook_event_name: 'SubagentStop', note_line: 'SESSION-NOTE: x' })!.note_line).toBeNull()
    expect(JSON.stringify(got)).not.toContain('ecret')
  })
})

import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { guardrails, managedPath, readGuardFile } from '../../src/main/monitor/guardrails'

describe('guardrails (read-only)', () => {
  it('reads permissions and hooks of user and project settings', async () => {
    const d = await mkdtemp(join(tmpdir(), 'nos-gr-')), home = join(d, 'home'), proj = join(d, 'proj')
    await mkdir(join(home, '.claude'), { recursive: true }); await mkdir(join(proj, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm run *)'], deny: ['Read(./.env)'], defaultMode: 'acceptEdits' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['/x/neural-os-forward.cjs'] }, { type: 'command', command: 'say hi' }] }] } }))
    await writeFile(join(proj, '.claude', 'settings.local.json'), '{bad')
    const db = openDb(join(d, 'n.db'))
    try {
      db.prepare("INSERT INTO claude_session (id, cwd, started_at, last_at) VALUES ('s', ?, 'a', 'b')").run(proj)
      const g = guardrails(db, home, { platform: 'linux' })
      const u = g.files.find((f) => f.scope === 'user')!
      expect(u).toMatchObject({ found: true, defaultMode: 'acceptEdits', allow: ['Bash(npm run *)'], deny: ['Read(./.env)'], ask: [], hooks: [{ event: 'Stop', commands: 2, ours: 1 }] })
      expect(g.files.find((f) => f.scope === 'local')).toMatchObject({ found: true, error: 'json' })
      expect(g.files.some((f) => f.scope === 'project')).toBe(false)
      expect(readGuardFile(join(d, 'none.json'), 'user').found).toBe(false)
      expect(managedPath('darwin')).toBe('/Library/Application Support/ClaudeCode/managed-settings.json')
    } finally { db.close(); await rm(d, { recursive: true, force: true }) }
  })
})

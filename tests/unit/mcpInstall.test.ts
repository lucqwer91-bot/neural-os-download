import { describe, it, expect } from 'vitest'
import { bundledClaude, addArgsPlain, shellLine, serverSpec } from '../../src/main/monitor/mcpInstall'
import { join as pjoin } from 'node:path'

describe('Claude Code inside the desktop app (Windows)', () => {
  it('picks the newest version folder', () => {
    const L = 'C:/L', base = pjoin(L, 'Claude-Data')
    const tree: Record<string, string[]> = {
      [base]: ['claude_abc', 'other'],
      [pjoin(base, 'claude_abc', 'claude-code')]: ['2.1.99', '2.1.325', 'tmp'],
      [pjoin(base, 'claude_abc', 'claude-code', '2.1.99')]: ['b1'],
      [pjoin(base, 'claude_abc', 'claude-code', '2.1.325')]: ['806e']
    }
    const exe = new Set([pjoin(base, 'claude_abc', 'claude-code', '2.1.99', 'b1', 'claude.exe'), pjoin(base, 'claude_abc', 'claude-code', '2.1.325', '806e', 'claude.exe')])
    const fs = { readdir: (p: string) => { if (!tree[p]) throw new Error('no'); return tree[p] }, exists: (p: string) => exe.has(p) }
    expect(bundledClaude(L, fs)).toBe(pjoin(base, 'claude_abc', 'claude-code', '2.1.325', '806e', 'claude.exe'))
    expect(bundledClaude(undefined, fs)).toBeNull()
    expect(bundledClaude('C:/none', fs)).toBeNull()
  })
})

describe('hand-typed registration command', () => {
  it('needs no JSON and runs in PowerShell', () => {
    const s = serverSpec('C:\\Program Files\\nodejs\\node.exe', 'C:\\a\\mcp.cjs', 'C:\\a\\db', 'C:\\a\\Lib', 'C:\\a\\ep.json')
    const line = shellLine('C:\\x y\\claude.exe', addArgsPlain(s), true)
    expect(line.startsWith('& "C:\\x y\\claude.exe" mcp add --scope user neural-os -- ')).toBe(true)
    expect(line).toContain("'C:\\Program Files\\nodejs\\node.exe' --no-warnings")
    expect(line).not.toContain('{')
  })
})

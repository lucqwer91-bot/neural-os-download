import { describe, expect, it } from 'vitest'
import { mcpServer, regionFor } from '../../src/shared/regions'

describe('regionFor', () => {
  it('maps verified tool names', () => {
    expect(regionFor({ hook_event_name: 'PostToolUse', tool_name: 'Read' })).toBe('memory')
    expect(regionFor({ hook_event_name: 'PostToolUse', tool_name: 'PowerShell' })).toBe('execution')
    expect(regionFor({ hook_event_name: 'PostToolUse', tool_name: 'WebSearch' })).toBe('research')
  })
  it('covers the official tool list (final mapping, docs/event-regions.md)', () => {
    const r = (t: string) => regionFor({ hook_event_name: 'PostToolUse', tool_name: t })
    expect([r('EnterPlanMode'), r('TaskList'), r('CronCreate')]).toEqual(['planning', 'planning', 'planning'])
    expect([r('Monitor'), r('EnterWorktree')]).toEqual(['execution', 'execution'])
    expect([r('Workflow'), r('Skill')]).toEqual(['workflows', 'workflows'])
    expect([r('ReadMcpResourceTool'), r('ToolSearch')]).toEqual(['connectors', 'connectors'])
    expect([r('SendMessage'), r('Agent')]).toEqual(['subagents', 'subagents'])
    // talking to the user is not one of the brain's functions
    expect([r('AskUserQuestion'), r('PushNotification')]).toEqual(['other', 'other'])
  })
  it('maps MCP tools to connectors', () => {
    expect(regionFor({ hook_event_name: 'PostToolUse', tool_name: 'mcp__obs__obs-get-stats' })).toBe('connectors')
  })
  it('maps subagent lifecycle events', () => {
    expect(regionFor({ hook_event_name: 'SubagentStart' })).toBe('subagents')
  })
  it('never guesses: unknown or malformed input goes to other', () => {
    expect(regionFor({ hook_event_name: 'PostToolUse', tool_name: 'SomethingNew' })).toBe('other')
    expect(regionFor({ hook_event_name: 'Stop' })).toBe('other')
    expect(regionFor({ tool_name: 42 })).toBe('other')
  })
})

describe('mcpServer', () => {
  it('extracts the server name', () => {
    expect(mcpServer('mcp__Roblox_Studio__script_read')).toBe('Roblox_Studio')
    expect(mcpServer('Read')).toBeNull()
  })
})

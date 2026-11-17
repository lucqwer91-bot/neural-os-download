// Functional brain regions (spec 4.5) and the final mapping from Claude Code hook events
// to regions (Phase 3, 2026-11-17). Tool names come from the official tools reference
// (code.claude.com/docs/en/tools-reference, read 2026-11-17) and were seen live on Windows
// and macOS (docs/hooks-verified.md). The full table with reasons: docs/event-regions.md.
// Anything not listed goes to the neutral 'other' path, never to a guessed region.

export const REGIONS = [
  'memory',
  'planning',
  'execution',
  'research',
  'workflows',
  'connectors',
  'subagents'
] as const

export type Region = (typeof REGIONS)[number] | 'other'

const TOOL_REGION: Record<string, Region> = {
  // Memory: reading and finding what exists
  Read: 'memory', Grep: 'memory', Glob: 'memory', LSP: 'memory',
  // Execution: changing files, running commands
  Edit: 'execution', Write: 'execution', MultiEdit: 'execution', NotebookEdit: 'execution',
  Bash: 'execution', PowerShell: 'execution', Monitor: 'execution', TaskStop: 'execution',
  EnterWorktree: 'execution', ExitWorktree: 'execution',
  // Research: the web
  WebSearch: 'research', WebFetch: 'research',
  // Planning: task lists, plan mode, schedules
  TodoWrite: 'planning', TaskCreate: 'planning', TaskUpdate: 'planning', TaskGet: 'planning', TaskList: 'planning',
  EnterPlanMode: 'planning', ExitPlanMode: 'planning',
  CronCreate: 'planning', CronDelete: 'planning', CronList: 'planning', ScheduleWakeup: 'planning',
  // Workflows: skills and orchestrated workflows
  Skill: 'workflows', Workflow: 'workflows',
  // Connectors: loading tools, MCP resources, remote routines (mcp__* is handled below)
  ToolSearch: 'connectors', ListMcpResourcesTool: 'connectors', ReadMcpResourceTool: 'connectors',
  WaitForMcpServers: 'connectors', RemoteTrigger: 'connectors',
  // Subagents: spawning and messaging other agents
  Agent: 'subagents', Task: 'subagents', SendMessage: 'subagents', ListAgents: 'subagents', SubagentHandback: 'subagents'
}

export interface HookPayload {
  hook_event_name?: unknown
  tool_name?: unknown
}

/** Region for a hook payload. Unknown events go to the neutral 'other' path, never a guess. */
export function regionFor(p: HookPayload): Region {
  const ev = typeof p.hook_event_name === 'string' ? p.hook_event_name : ''
  if (ev === 'SubagentStart' || ev === 'SubagentStop') return 'subagents'
  if (ev === 'TaskCreated' || ev === 'TaskCompleted') return 'planning'
  const tool = typeof p.tool_name === 'string' ? p.tool_name : ''
  if (!tool) return 'other'
  if (tool.startsWith('mcp__')) return 'connectors'
  return TOOL_REGION[tool] ?? 'other'
}

/** MCP server name from a tool name like mcp__github__get_me, or null. */
export function mcpServer(toolName: string): string | null {
  const m = /^mcp__(.+?)__/.exec(toolName)
  return m ? m[1] : null
}

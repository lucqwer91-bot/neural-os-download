# Claude Code event → brain region (final, Phase 3)

Status: final for Phase 3, 2026-11-17. Code: `src/shared/regions.ts` (tests in
`tests/unit/regions.test.ts`). Tool names come from the official tools reference
(https://code.claude.com/docs/en/tools-reference, read 2026-11-17) and were seen live
on Windows (Claude Code 2.1.325) and macOS (`docs/hooks-verified.md`).

Rule: a region lights up only for a real event. Anything not listed below goes to the
neutral "other" path; NEURAL OS never guesses a region (spec 4.5).

## Hook events

| Hook event | Event type | Region | What the brain shows |
|---|---|---|---|
| SessionStart | session_started | (none) | the project's cluster in Memory lights up softly |
| UserPromptSubmit | prompt_submitted | (none) | session count goes up; the prompt is never stored |
| PreToolUse / PostToolUse / PostToolUseFailure | tool_started / tool_finished / tool_failed | by tool, see below | region pulse, file node pulse, path between regions in the order they happened |
| SubagentStart / SubagentStop | subagent_started / subagent_finished | Subagents | side branch |
| Stop | turn_finished | (none) | session note is written; READINESS and SESSION-NOTE lines are read |
| SessionEnd | session_ended | (none) | session ends in Live |
| PostModelSwitch | model_switched | (none) | model shown in the session |
| (READINESS line) | readiness_report | Connectors | scan across the nerves (spec 10.6) |
| (SESSION-NOTE line) | session_summary | Memory | stored in the session note as Claude's words |
| (NEURAL OS context request) | – | Memory → Connectors | memory flash: the handed notes pulse, toast |

## Tools

| Region | Tools |
|---|---|
| Memory | Read, Grep, Glob, LSP |
| Execution | Edit, Write, MultiEdit, NotebookEdit, Bash, PowerShell, Monitor, TaskStop, EnterWorktree, ExitWorktree |
| Research | WebSearch, WebFetch |
| Planning | TodoWrite, TaskCreate, TaskUpdate, TaskGet, TaskList, EnterPlanMode, ExitPlanMode, CronCreate, CronDelete, CronList, ScheduleWakeup |
| Workflows | Skill, Workflow |
| Connectors | every `mcp__<server>__<tool>` (the server's own nerve), ToolSearch, ListMcpResourcesTool, ReadMcpResourceTool, WaitForMcpServers, RemoteTrigger |
| Subagents | Agent, Task (older name), SendMessage, ListAgents, SubagentHandback |
| other | AskUserQuestion, PushNotification, SendUserFile, SendFeedback, Artifact, ReportFindings, ShareOnboardingGuide, EndConversation, and any tool not listed |

Why "other" for the last row: these tools talk to the user or to claude.ai; none of
them is reading, doing, researching, planning, a workflow, a connector or a subagent.

Edit tools (Edit, Write, MultiEdit, NotebookEdit) also feed the change log (S1):
PreToolUse = before, PostToolUse = after.

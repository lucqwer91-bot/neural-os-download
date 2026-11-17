# Claude Code hooks: verified facts

Sources: official docs (code.claude.com/docs/en/hooks, /settings, /memory),
read 2026-11-16, plus a live test on the user's Windows PC the same day.

## Environment tested

- Windows, Claude Code 2.1.325 (bundled with the desktop app, not on PATH)
- Node v24.21.0 present; no Git Bash, so shell tool = `PowerShell`
- macOS: not tested yet

## Received events (http hook to 127.0.0.1, project-local settings)

| Event | Extra keys (besides session_id, transcript_path, cwd, scratchpad_dir, prompt_id, hook_event_name, permission_mode*) |
|---|---|
| UserPromptSubmit | prompt (never stored by NEURAL OS) |
| PreToolUse | effort, tool_name, tool_input, tool_use_id |
| PostToolUse | effort, tool_name, tool_input, tool_response, tool_use_id, duration_ms |
| Stop | effort, stop_hook_active, last_assistant_message, background_tasks, session_crons |
| SessionEnd | reason (*no permission_mode) |

Observed tool_name values: Read, PowerShell, ToolSearch, WebSearch.
Not yet observed (not triggered): SubagentStart/Stop, PostToolUseFailure.

## Decisions

- `SessionStart` does not support `http` hooks (docs + test). Model name only
  exists on SessionStart (optional) and PostModelSwitch. Otherwise: "not available".
- With the receiver closed, http hooks cause no delay, but SessionEnd prints an
  ECONNREFUSED line on stderr; the interactive UI may show "hook error" notices.
- Therefore: use a `command` hook with `async: true` running a tiny forwarder
  that prints nothing and always exits 0. Works under PowerShell (no Git Bash).
- Settings: user level `~/.claude/settings.json` (Windows `%USERPROFILE%\.claude\settings.json`);
  the desktop app reads the same file. Readiness rule: marked block in `~/.claude/CLAUDE.md`.

## Phase 3 additions (official docs, read 2026-11-17)

- Settings shape: `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type": "command", "command": "...", "args": [...], "async": true, "timeout": 5}]}]}}`.
  `matcher` is optional (omitted = all). Events without matcher support ignore it.
- Exec form: when `args` is set, `command` runs without a shell on every platform (no PowerShell or
  sh quoting issues). On Windows the command must be a real `.exe`; NEURAL OS writes the absolute
  path of `node` (found via PATH, on macOS also via a login shell, because GUI apps miss the shell PATH).
- `async: true` runs the hook in the background; `timeout` is not enforced for async hooks.
- Plain stdout is added to Claude's context for UserPromptSubmit, UserPromptExpansion, SessionStart and
  PostModelSwitch. The forwarder prints nothing on every event.
- Event names used by NEURAL OS: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse,
  PostToolUseFailure, SubagentStart, SubagentStop, Stop, PostModelSwitch.
- `model` exists only on SessionStart (may be missing) and PostModelSwitch. Common fields include
  session_id, cwd, hook_event_name, agent_id, agent_type.
- Not found in the docs: the tool_input fields of Edit/Write/MultiEdit besides `file_path`. So S1 does not
  rely on old_string/new_string: a synchronous PreToolUse hook (matcher `Edit|Write|MultiEdit|NotebookEdit`,
  timeout 5 s) reads the file before the change, PostToolUse reads it after.
- Still to confirm live on Windows and macOS: SubagentStart/Stop, PostToolUseFailure, PostModelSwitch payloads.

## MCP context server (official docs, read 2026-11-17)

- User-scope MCP servers are stored in `~/.claude.json`, a file Claude Code "writes for itself; you
  don't need to edit it". NEURAL OS therefore never edits it. It runs the documented command
  `claude mcp add-json neural-os '<json>' --scope user` (remove: `claude mcp remove neural-os --scope user`),
  shows the exact command first and backs up `~/.claude.json`. Without a `claude` command (or with a
  Windows `.cmd` shim) the user copies the command and runs it.
- Entry shape: `{"type":"stdio","command":<node>,"args":["--no-warnings",<script>,<db>,<library>,<endpoint>]}`.
  Server names: letters, digits, `-`, `_` only.
- Output limits: warning above 10,000 tokens, default cap 25,000 (`MAX_MCP_OUTPUT_TOKENS`). NEURAL OS
  answers stay under 12,000 characters.
- Tool names seen by hooks: `mcp__neural-os__<tool>` (pattern observed for other servers, e.g. `mcp__github__get_me`).

## Session note line (rule v2, 2026-11-17)

The readiness rule v2 asks Claude to end the final message of a finished task with
`SESSION-NOTE: <one or two sentences>`. The forwarder (v3) reads `last_assistant_message`
of `Stop` (the field is verified, see above) and keeps only that one line (≤600 chars);
the rest of Claude's message is never sent. It is stored as event `session_summary` and
shown in the session note under "Von Claude zusammengefasst", clearly marked as Claude's
own words. Cost: about 120 input tokens for the rule text per session (cached) and about
40–60 output tokens per finished task.

## Lesson line (readiness rule v3, 2026-11-17)

Same source as the session note: `last_assistant_message` of the `Stop` hook. The forwarder (v4) keeps only a line starting with `LESSON:` (max 500 characters); the rest of the message is dropped. NEURAL OS stores it as a new, unconfirmed lesson for the project folder (folder name of `cwd`). Claude reads lessons back through the NEURAL OS MCP tool `lessons`.

## Stop runs synchronously (2026-11-17, Mac test)

With `claude -p` the async `Stop` hook did not arrive (SessionEnd did): the process exits before the background hook finishes. `Stop` carries the `READINESS:`, `SESSION-NOTE:` and `LESSON:` lines, so NEURAL OS installs its `Stop` entry without `async` and with `"timeout": 5`. The forwarder prints nothing and exits 0, so it never blocks Claude from stopping. All other events stay `async: true`. An older setup is shown as outdated ("Neu verbinden").

## Memory lookup (readiness rule v4, 2026-11-17)

User wish: Claude should use NEURAL OS as its memory without being asked. The rule (v4) asks Claude, at the start of a larger task and only if the neural-os MCP server is available, to call `recent_sessions` for the project and `search_notes` / `context_pack` with the task's topic, use the result as background and name the notes it relied on. NEURAL OS still pushes nothing into Claude's context itself; Claude calls the tools. The user updates the rule with Konnektoren → Regel aktualisieren.

# NEURAL OS — project instructions

The full specification is `docs/NEURAL_OS_Development_Handoff.md`. Do not
read it in full every session. Read section 0 (decisions), section 17
(development instructions), and only the sections the current phase
needs. Read the whole file once at project start (Phase 0).

## Core rules (always apply)

- Claude works; NEURAL OS visualizes and organizes; the user stays in
  control. NEURAL OS has no AI of its own and never gives Claude tasks.
- Never fake observability: no invented thoughts, models, or events.
  Missing data is shown as "not available". Demo data is always labeled.
- Never change the user's original files. Linked folders are read-only
  unless the user enabled editing for that folder (spec 5.1).
- Writes to Claude Code files only per spec 3.4: consent, backup, diff,
  undo.
- Hooks are silent and fail fast (spec 6.3).
- Windows and macOS: the user tests on both. After each phase, give a
  short test checklist per platform.
- Clarity principle (spec 4.6): every new feature names where it lives
  and adds nothing permanent to the main screen.
- UI text only in the German/English translation files.
- Verify Claude Code hook names, payload fields, and settings paths in
  the official documentation. Never guess them.
- Before larger tasks, run the plugin and connector readiness check
  (spec 10.4).

## Design reference

`design/neural-os-prototype.html` is the clickable design prototype
(v12). It shows the intended look and flows with demo data. It is a
reference, not production code.

## Status

Phases 0–3 are built; Phase 4 (big libraries) and Phase 5 (context server)
are partly built. See the spec for the roadmap. Keep this section short:
what changed goes into the commit messages.

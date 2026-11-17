# Security

NEURAL OS reads your notes and watches Claude Code on your computer, so security problems matter.

## Report a problem

Please **do not** open a public issue for a security problem. Use GitHub's private report instead:
**Security → Report a vulnerability** in this repository. You get an answer within a few days.

## What NEURAL OS promises (and where to check it)

- No internet connection. The only network use is `127.0.0.1` on your own computer
  (`src/main/monitor/receiver.ts`, `forwarder.ts`). No telemetry, no auto-update.
- From Claude Code only metadata is stored: tool, file path, time, status. Never prompts, answers
  or tool output, except the short `SESSION-NOTE:` / `LESSON:` lines (`src/main/monitor/forwarder.ts`).
- Files named like keys or passwords (`.env`, `*_key.txt`, `*.pem`, `credentials.*`, …) are never indexed,
  and key-like text is masked in previews, search and everything handed to Claude (`src/main/library/secrets.ts`).
- Claude Code's files are changed only after consent, with a diff, a backup and one-click undo
  (`src/main/monitor/installer.ts`, `readiness.ts`, `mcpInstall.ts`).
- Linked folders are read-only unless you enable editing for a folder.

## Installers

Installers are built by GitHub Actions from this repository (`.github/workflows/release.yml`) with a
build-provenance attestation. Check a download with:

```
gh attestation verify NEURAL-OS-Setup-<version>.exe --repo lucqwer91-bot/neural-os-download
```

They are not code-signed yet. If you want to be extra careful, try it first in Windows Sandbox or a VM.

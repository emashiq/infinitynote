# Infinity Notes repository instructions

Source of truth: `infinity-notes-claude-pack/PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `TEST_MATRIX.md`, `CLEANUP_POLICY.md` and the current phase in `infinity-notes-claude-pack/phases/` (order: `phases.json`). Respect existing repository instructions and user work; merge, do not overwrite unrelated content.

Build one minimal offline Windows/Linux Electron app. Do not add backend/accounts/sync, collaboration or embedded AI. Notes/stickies share a document and editor; Electron main owns writes, scheduling and native windows. Keep IPC narrow and validated. Persist source and progress; no fake implementations, TODO-only completion or disabled test gates.

## Model roles

Model roles are configured as native project agents in `.claude/agents/` (mirroring `infinity-notes-claude-pack/launch_autonomous.py`) or enforced externally by `run_phases.py`:

| Agent | Model | Effort | Role |
| --- | --- | --- | --- |
| infinity-planner | claude-opus-5-5 | high | Phase plans (`docs/plans/phase-XX.md`) |
| infinity-code-low | claude-sonnet-5-5 | low | Phase 02 straightforward shell UI only |
| infinity-code-medium | claude-sonnet-5-5 | medium | Core logic, tests and all repairs |
| infinity-qa | claude-sonnet-5-5 | medium | Fresh independent review; never edits app source |
| infinity-acceptor | claude-opus-5-5 | high | Phase acceptance (`docs/progress/phase-XX-acceptance.md`) |

The Opus coordinator plans, delegates and records progress; it does not write application source. Only one agent modifies application code at a time. Child role agents do not delegate again or call the runner recursively. Do not claim to change model through prompt wording.

## Working rules

Work within this repository. Preserve user files. Install required project dependencies, write migrations, run checks and package locally. Do not push, publish, send messages or install unrelated global software. Finish each phase's acceptance cases before advancing. Document external blockers precisely and continue independent work. Keep runtime private data outside git (`.infinity-work/`, generated artifacts, test userData are git-ignored).

Never promise notifications while fully quit or guaranteed window positioning under every Wayland compositor. Record tests that actually ran and native cases not run.

## Progress and resume

- Checkpoint: `.infinity-work/agent-status.json` (result, current_phase, phases 00–09 with status/summary/evidence, blockers).
- Plans: `docs/plans/phase-XX.md`. Progress: `docs/progress/phase-XX.md`, QA `docs/progress/phase-XX-qa.md`, acceptance `docs/progress/phase-XX-acceptance.md`.
- Command logs: `.infinity-work/logs/phase-XX/`.
- Resume instructions: `.infinity-work/RESUME.md`. After context compaction, read the checkpoint, reports and actual code before continuing.

## User decisions (2026-10-08)

- **No Python dependency.** Do not install or require Python. The final organizer is the Node port `tools/finalize-docs.mjs` (same behavior as the pack's `finalize_docs.py`): run `node tools/finalize-docs.mjs --repo .`.
- **Linux validation happens in WSL.** WSL2 Ubuntu 26.04 LTS with WSLg is the Linux build/test/native-validation environment (AppImage/.deb build, install, launch, E2E, windows, notifications). Build from a copy on the WSL ext4 filesystem (e.g. `~/infinity-notes`), never share `node_modules` across OSes. Record the actual compositor (WSLg/Weston) and versions in evidence; do not label WSLg results as GNOME. Cases that only exist on GNOME/X11 desktops are recorded as outside the user-selected validation scope, not as passes.
- **Commit after each accepted phase.** When the acceptor accepts phase XX and the checkpoint is updated, commit all phase work on the current branch with message `Phase XX: <title>` and the attribution trailer from the session. Never push. Never commit `.infinity-work/`, build output or user data (see .gitignore). The first commit (Phase 00) also includes the bootstrap files (CLAUDE.md, .gitignore, .claude/, tools/, the pack).

## Host notes (Windows development machine)

- Windows has no Python (`python` is the Store alias); none is needed.
- WSL: `wsl -d Ubuntu -- bash -lc '<cmd>'` (Node 24.21 there; Windows has Node 24.15).

## Final organization

Follows `infinity-notes-claude-pack/CLEANUP_POLICY.md`; `node tools/finalize-docs.mjs --repo .` runs only after all required acceptance gates (including native OS validation) pass. While blocked or `ready_for_os_validation`, keep the pack and checkpoints in place.

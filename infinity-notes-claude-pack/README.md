# Infinity Notes — Claude Code development pack

Build a minimal, offline desktop notebook for Windows and Linux. All requirements from this conversation are consolidated in this pack. No existing application code is included: Claude Code will implement it in your repository.

## Start

1. Create a dedicated project folder, then extract this archive into it. Keep `infinity-notes-claude-pack/` inside the project root; application code goes beside it, not inside it.
2. Install/update Claude Code, Node.js LTS compatible with the selected Electron toolchain, npm, Python 3.10+, and Git. Sign in to Claude Code normally. Open an interactive Claude session in the project once to establish workspace trust and check model access. Do not put API keys in these files.
3. Run from the PROJECT ROOT:

```bash
python infinity-notes-claude-pack/launch_autonomous.py --dry-run
python infinity-notes-claude-pack/launch_autonomous.py
```

On Windows, use `py -3` instead of `python` if needed. Run the Python controller from a terminal, not from inside an already running Claude Code session. If starting through Claude, use the bootstrap prompt, which prepares the project and gives you the exact terminal command.

The default launcher runs one autonomous Opus HIGH coordinator using five configured native agents. It proceeds through all phases, testing and repair without phase confirmation prompts, then invokes the shared final document organizer. The coordinator writes .infinity-work/agent-status.json for resume. The separate run_phases.py controller remains available as a stricter sequential fallback.

The sequential controller explicitly launches Opus HIGH to plan, Sonnet 5.5 LOW/MEDIUM to implement, Sonnet 5.5 MEDIUM to test/review, and Opus HIGH to accept each phase. It resumes accepted phases, retries code defects up to three times, records logs, and stops on genuine environment/permission/model blockers. No permission-bypass flag is used. Normal Claude workspace and organization permissions still apply. Narrow automatic command permissions are passed for this dedicated project, including npm install/ci and npm run scripts; those scripts execute project code.

Default models: `claude-opus-5-5` and `claude-sonnet-5-5`. Check these through `/model` in your own account. The runner refuses a reported model substitution. Provider-specific model IDs can be supplied explicitly. Effort is set on each call, not implied by prose.

```bash
python infinity-notes-claude-pack/run_phases.py --from-phase 04
python infinity-notes-claude-pack/run_phases.py --through-phase 05
python infinity-notes-claude-pack/run_phases.py --max-fixes 5 --call-budget-usd 3
```

`--from-phase` requires preceding phases to be accepted in the checkpoint. `--through-phase` pauses after that phase. To rebuild an accepted phase and all downstream phases after a change, use `--restart-phase 04`. This invalidates checkpoint acceptance, not your source files. Budget is a per-Claude-call estimated cap; it is NOT a total-project price or a guaranteed billing cap. A call may stop before completing under a small cap. Run costs depend on your account and usage.

## Ten phases

| Phase | Outcome | Sonnet coding effort |
| --- | --- | --- |
| 00 | Repository assessment, UX specification, contracts, backlog | Medium |
| 01 | Electron foundation, secure IPC, SQLite, test/build setup | Medium |
| 02 | Home, Common, projects, folders, tabs, search/navigation | Low |
| 03 | Shared rich-text/plain-text editor, image paste, autosave | Medium |
| 04 | Independent floating sticky windows and desktop lifecycle | Medium |
| 05 | Time-zone reminders, native notifications, optional widget, follow-ups | Medium |
| 06 | Natural-language dates from notes and confirmed reminder suggestions | Medium |
| 07 | References, backlinks, side panel, pinning and full-text search | Medium |
| 08 | Backup/export/import, restore, preferences and accessibility | Medium |
| 09 | Integrated QA, fixes, performance measurements, Windows/Linux packages | Medium |

LOW is reserved for Phase 02's UI assembly after the architecture is established. Use MEDIUM if its first implementation fails. Core persistence, multiwindow editing and time arithmetic stay MEDIUM. The runner uses MEDIUM for all fixes.

## Files to read

- `START_HERE_CLAUDE.md`: startup instructions.
- `AUTONOMOUS_AGENT_PROMPT.md`: complete autonomous coordinator prompt.
- `launch_autonomous.py`: one-command native-agent launcher.
- `CLEANUP_POLICY.md` and `finalize_docs.py`: final documentation organization and safe cleanup.
- `PRODUCT_PLAN.md`: scope, behaviors, UX and release criteria.
- `ARCHITECTURE.md`: implementation design and data contracts.
- `TEST_MATRIX.md`: failure cases and native OS acceptance tests.
- `roles/`: role prompts used by the controller.
- `phases/`: executable work specifications for all ten phases.
- `run_phases.py`: actual model-switching controller.
- `SOURCES.md`: official documentation checked on 2026-10-08.
- `reference/framecapt-reference.png`: your supplied visual reference.
- `templates/CLAUDE.md`: instructions for the generated application repository.

Runtime output is written to `.infinity-work/` at the project root. `status.json` tracks accepted phases; `logs/` contains Claude results and command evidence. Treat this folder as private because diagnostics may contain development content. Resume reads on-disk plans and code, so conversation context loss is recoverable.

The pack has been checked as a prompt pack and controller, not as a completed desktop app. The controller can finish development on a provisioned machine; it cannot supply account access, signing certificates, a missing Windows/Linux test host, or notifications when the app is fully exited. Native tests missing on the second OS produce `ready_for_os_validation`, never `complete`.

## Automatic final cleanup

After all required implementation/testing gates pass, both workflows archive their active prompt pack, plans, progress and private run evidence under docs/development/, update owned documentation paths and create docs/INDEX.md. Root README.md and CLAUDE.md remain useful. Only task-owned temporary bytecode/status staging files are removed automatically. Source, tests, data, backups and installers are preserved. Cleanup waits while execution or native validation is blocked. See CLEANUP_POLICY.md for the exact final layout.

Native agents have explicit model/effort fields; account restrictions may still substitute models or cap effort. Verify model access at startup; the launcher checks the returned model-usage families before claiming completion. This launcher has been checked with simulated CLI execution; real account/native OS execution occurs on your machine. Never run the launcher and sequential controller against the same project concurrently.

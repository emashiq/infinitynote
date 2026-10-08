# Phase 00 progress: Scope, contracts and repository planning

Implementer: infinity-code-medium (Sonnet 5.5 MEDIUM), 2026-10-08. Plan: `docs/plans/phase-00.md`. Status: implemented, awaiting QA and acceptance. Nothing was committed.

## 1. Summary

Produced the five planning documents, the dependency-free traceability checker and the append-only `.gitignore` block. All 187 requirement IDs from plan Appendix A are mapped to a phase, test types and planned tests, the TEST_MATRIX cross-reference is expanded to explicit IDs, and the D-001 to D-034 decision log carries the dependency pins re-verified with `npm view`. No application source, `package.json`, lockfile, `src/` or `tests/` exist; scope is intentionally limited to documentation and one documentation tool. No Python was used or required.

## 2. Files created or changed

- `docs/PRODUCT_SPEC.md` (created): scope, non-goals, 187-row requirement catalogue with acceptance criteria, reminder behavior, NLP policy and Appendix B table, platform promises, release targets, performance targets, glossary.
- `docs/UX_SPEC.md` (created): reference adaptation, layout, tokens, typography, screens, dialog and banner copy, keyboard map, states, accessibility, sticky colors.
- `docs/ARCHITECTURE.md` (created): process model, layout, data model and migration allocation, hierarchy and tab rules, IPC catalogue, windows, capability table, autosave and lease, attachments, reminder state machine and scheduler, DST, NLP pipeline, search, references, backup, security, testing, performance, packaging.
- `docs/DECISIONS.md` (created): pin table, D-001 to D-034, risks R-01 to R-09, verification log.
- `docs/BACKLOG.md` (created): legend, requirement table between the markers, TEST_MATRIX cross-reference, W01 to W09 work packages, change rule.
- `tools/check-traceability.mjs` (created): checker per plan section 10 (options `--repo`, `--plan`, `--backlog`, `--allow-phase-moves`). One refinement: "always-on-top" is treated as a feature name and not as a promise word in the promise review, because the requirement text itself is named that way.
- `docs/progress/phase-00.md` (this file).
- `.gitignore` (append only; existing lines and order unchanged). Appended lines:

```
(blank line)
# Phase 00 additions: tooling caches and local databases/archives (user data never committed)
.vite/
.eslintcache
*.sqlite3
*.sqlite3-wal
*.sqlite3-shm
*.db-wal
*.db-shm
*.infinitybackup
*.infinityexport
!tests/fixtures/**
```

Not touched: `infinity-notes-claude-pack/`, `.claude/`, `tools/finalize-docs.mjs`, `CLAUDE.md`, `.infinity-work/agent-status.json`.

## 3. Commands run

Logs are in `.infinity-work/logs/phase-00/` (git-ignored).

| Command | Exit code | Log |
| --- | --- | --- |
| `node -v; npm -v; git --version; systeminfo` (Windows) | 0 | `env.log` |
| `wsl -d Ubuntu -- bash -lc 'lsb_release -ds; uname -r; ldd --version; node -v; npm -v; cat /mnt/wslg/versions.txt; echo $WAYLAND_DISPLAY $DISPLAY'` | 0 | `wsl-env.log` |
| `npm view <pkg> version license engines peerDependencies --json` for every package in the pin table | 0 | `npm-view.log` |
| `npm view <pkg>@<pin> version` and `license` for all 37 pinned specs | 0 (all resolved) | `npm-pins.log` |
| `git check-ignore -v` on sample paths and `git status --porcelain` | each ignored sample 0; `docs/PRODUCT_SPEC.md` correctly not ignored (exit 1) | `gitignore.log` |
| `node tools/check-traceability.mjs` | 0 | `traceability.log` (copy `check-traceability.log`) |
| `node tools/check-traceability.mjs --backlog <copy with INF-HIER-05 removed>` | 1 (expected) | `traceability-negative.log` |
| `sha256sum CLAUDE.md tools/finalize-docs.mjs .claude/agents/*` before and after | identical | `sha-before.log`, `sha-after.log` |

Traceability summary line: `SUMMARY ids=187 backlog_rows=187 per_phase[01:13 02:30 03:23 04:15 05:31 06:24 07:16 08:22 09:13] fails=0 warns=0`. The negative run reports `FAIL backlog: missing plan ID INF-HIER-05` (plus link failures because the temp copy sits outside `docs/`) and exits 1.

## 4. Dependency and OS decisions summary

- Stack pins (all MIT unless noted, all resolved by `npm view`): electron 44.7.0, electron-vite 5.0.0, vite 7.3.7, @vitejs/plugin-react 5.2.0, react and react-dom 19.3.0, typescript 6.0.3 (Apache-2.0), Tiptap 3.31.4 family, better-sqlite3 13.0.3, zod 4.6.5, luxon 3.7.2, chrono-node 2.10.2, dompurify 3.4.16 (MPL-2.0 OR Apache-2.0, used under Apache-2.0), lucide-react 1.53.0 (ISC), vitest 5.0.3, jsdom 30.1.2, @playwright/test 1.64.0 (Apache-2.0), eslint 10.12.0, typescript-eslint 8.71.1, eslint-plugin-react-hooks 7.1.1, electron-builder 26.15.3, yazl 3.3.1, yauzl 3.4.0.
- Three peer-range constraints: vite held at 7.3.7 by electron-vite 5, @vitejs/plugin-react held at 5.2.0 by vite 7, TypeScript held at 6.0.3 by typescript-eslint 8.71.1 (`<6.1.0`).
- better-sqlite3 13.0.3: N-API prebuilds, SQLite 3.53.4 with FTS5 and JSON1, needs GLIBC_2.34 (evidence from planner probes in `planner-probes.log`). No source rebuild because that needs Python; `node:sqlite` is the recorded fallback (risk R-01, proven or disproven in Phase 01).
- OS minimums: Windows 11 24H2 (build 26100) or later x64; Ubuntu 24.04 LTS or later x64 (declared). Validation: Windows 11 Pro 10.0.26300 host; Ubuntu 26.04.1 LTS on WSL2 with WSLg 1.0.73 (Weston). GNOME and X11 sessions are `outside_validation_scope`.

## 5. Requirement coverage

Total 187 IDs. Per phase: 01=13, 02=30, 03=23, 04=15, 05=31, 06=24, 07=16, 08=22, 09=13. Per area: FND 13, SHELL 6, HOME 4, HIER 12, TABS 8, KEY 6, EDIT 14, SAVE 6, STKY 13, DESK 3, REM 18, SCHED 9, WIDG 3, NLP 14, SUG 10, REF 9, SRCH 6, PORT 8, PREF 5, A11Y 6, PERF 5, PKG 6, SEC 3. Every ID has a phase, a non-empty test-type set, planned tests and an acceptance criterion in PRODUCT_SPEC; the checker verified this (`ids=187 backlog_rows=187 fails=0`). Every ID is also listed in at least one W01 to W09 work item (checked during generation).

## 6. Contract checklist

| Contract | Resolved in |
| --- | --- |
| Home dashboard and filter | UX_SPEC section 5 (Home); PRODUCT_SPEC INF-HOME-01 to 04 |
| Common/project hierarchy | ARCHITECTURE section 3 "Hierarchy rules" |
| Nested folders and cycles | ARCHITECTURE section 3 "Hierarchy rules" (depth 32, `CYCLE`) |
| Tab session | ARCHITECTURE section 3 "Tab session model"; UX_SPEC section 5 |
| Sticky window / editor reuse and lease | ARCHITECTURE sections 5 and 6; UX_SPEC section 5 |
| Right context panel | UX_SPEC sections 2 and 5 |
| Reminder state machine | ARCHITECTURE section 8 |
| Recurrence and DST | ARCHITECTURE section 9; DECISIONS D-023 |
| Follow-up, snooze, quiet hours | ARCHITECTURE section 8; PRODUCT_SPEC section 5; D-024 |
| Notification delivery uncertainty | ARCHITECTURE section 8 (Scheduler, delivery uncertainty) |
| Autosave, revision and lease | ARCHITECTURE section 6; D-018 |
| Attachments safety | ARCHITECTURE section 7; D-019 |
| Backup and restore | ARCHITECTURE section 13; D-030 |
| Weekday parsing | ARCHITECTURE section 10; D-025; PRODUCT_SPEC Appendix B |
| EOD 17:00 and date-only 09:00 | ARCHITECTURE section 10; D-025 |
| Capability fallbacks | ARCHITECTURE section 5 "Capabilities"; PRODUCT_SPEC section 7 |

## 7. CLAUDE.md merge comparison

`CLAUDE.md` was not modified. `sha256sum CLAUDE.md` before and after: `5f1228b185ff0fa2c4c7d511a09af6f2bae49dd7fc8a8b0092674e83cf43f187` (identical). `tools/finalize-docs.mjs` (`f6a5bafe...bec`) and the five `.claude/agents/*.md` files are also identical before and after (`sha-before.log`, `sha-after.log`).

| Template clause | Root CLAUDE.md location | Result |
| --- | --- | --- |
| Source of truth and merge, do not overwrite | first paragraph | covered |
| Minimal offline Electron app; shared document and editor; main owns writes; narrow IPC; no fakes | second paragraph | covered |
| Model roles, no recursive runner, no model-change claims | "Model roles" | covered |
| Work in repo, preserve files, no push or publish, document blockers | "Working rules" | covered |
| Durable plans and reports after compaction | "Progress and resume" | covered |
| Never promise notifications while quit or guaranteed Wayland positioning | "Working rules" last paragraph | covered |
| Coordinator delegation; finalize after gates | "Model roles" and "Final organization" | covered |

## 8. Consistency review

- The docs never promise reminders or notifications while the app is fully quit (PRODUCT_SPEC sections 5 and 7, ARCHITECTURE section 8, UX_SPEC close dialog).
- The docs never promise Wayland window positioning or always-on-top; both are listed as unsupported with disabled controls.
- No GNOME or X11 validation is claimed; WSLg/Weston results are labeled as such and GNOME/X11-only cases are `outside_validation_scope`. Whether those permit a final `complete` is left to the Phase 09 acceptor.
- No out-of-scope feature (backend, accounts, sync, collaboration, AI, telemetry and others in D-001) was introduced.
- Promise-review WARN count: 0.
- No conflict between the plan and the pack or CLAUDE.md was found.

## 9. Risks carried forward and pending native cases

Risks R-01 to R-09 are recorded in DECISIONS. No native case was executed in Phase 00. Future native (N) cases by ID: INF-FND-02, INF-FND-11, INF-FND-12, INF-SHELL-06, INF-KEY-05, INF-DESK-02, INF-DESK-03, INF-STKY-02, INF-STKY-06, INF-STKY-12, INF-STKY-13, INF-REM-06, INF-REM-07, INF-SCHED-05, INF-WIDG-02, INF-A11Y-06, INF-PKG-01 to INF-PKG-05.

## 10. Handoff to Phase 01

Work items W01-01 to W01-14 are in `docs/BACKLOG.md` section 4 (scaffold, pinned install, DB adapter and migration 001, settings, paths, secure windows and IPC, contracts, attachment protocol, single instance and identity, test harness, scripts, CI definitions, native-module verification on Windows and WSL, capabilities skeleton). Phase 01 must not start any work that conflicts with the pins in DECISIONS.

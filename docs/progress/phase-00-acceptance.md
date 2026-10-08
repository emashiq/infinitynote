# Phase 00 acceptance: Scope, contracts and repository planning

Acceptor: infinity-acceptor (Opus HIGH), 2026-10-08. Host: Windows 11 Pro 10.0.26300, Node v24.15.0. No application source exists or was written. The documents under review were not edited.

## Decision: ACCEPTED

Phase 00 meets its acceptance criteria based on the document content itself, not on the implementer or QA summaries. The low and info issues found by QA, plus the gaps listed below, do not block acceptance. Each one is assigned to a later phase.

## Acceptance criteria, judged on content

| Criterion | Verdict | Basis |
| --- | --- | --- |
| All requested desktop features mapped | pass | I read PRODUCT_PLAN and TEST_MATRIX feature by feature against the 187-ID catalogue in `docs/PRODUCT_SPEC.md` section 4. Every user feature has an ID: Home, Common/projects, nested folders, tabs and session, rail pages, keyboard shortcuts, the shared Tiptap editor, plain-text conversion, image and document paste, Bangla, autosave and lease, floating stickies, close/tray, reminders, follow-ups, snooze, quiet hours, DST, the widget, the NLP parser and confirmation card, references, search, tags, backup, export and import, retention, accessibility, performance, packaging and security. Each ID has a phase, test types and named planned tests in `docs/BACKLOG.md`, and each ID is in a W01 to W09 work package. My script found 0 phase mismatches between PRODUCT_SPEC and BACKLOG, and 0 IDs outside the work packages. |
| Scope explicitly small | pass | PRODUCT_SPEC section 3 and DECISIONS D-001 list the non-goals. There is no backend, account, sync, collaboration, AI, telemetry or plugin. Parsing is English only. DECISIONS lists the excluded tools (no ORM, no UI framework, no `@electron/remote`, no node-gyp or Python). |
| State and data contracts resolve the open routine choices | pass | ARCHITECTURE sections 3 to 13 and D-014 to D-034 settle all of these: the hierarchy invariants (depth 32, `CYCLE`, transactional scope moves, trash batch restore), the tab session format, the save message shape, the revision/conflict/draft rules, lease timeouts (3000 ms take, 2000 ms flush), the occurrence state machine (pending, snoozed, completed, missed and cancelled, with overdue derived), claim-before-dispatch with the `uncertain` outcome, follow-up counting at claim time, the recovery batch (3 alerts, then one summary), quiet hours, the DST gap and fold rules with worked examples, the weekday, EOD and date-only rules, attachment limits and magic-number checks, the backup, restore and import preflight, and retention. I recomputed the Appendix B frozen-clock table rows for weekdays, Monday and Sunday, "next" and "last", the New York versus Dhaka "tomorrow" case, and the gap and fold rows. All are consistent with D-025 and the Dhaka (+06:00) and New York offsets. |
| Existing work preserved | pass | The SHA-256 hashes of `CLAUDE.md`, `tools/finalize-docs.mjs` and `.claude/agents/*` today match `sha-before.log`. Pack file mtimes (13:52:04) all predate the phase. `.gitignore` keeps its original lines with an appended block. `git check-ignore` shows `.infinity-work/` and `*.sqlite3` are ignored, `tests/fixtures/**` is re-included and `docs/PRODUCT_SPEC.md` is not ignored. No `package.json`, `src/` or `tests/` exist. |
| No contradictory reminder or window promises | pass | PRODUCT_SPEC section 7 gives the two promises verbatim: notifications only while running, and no guaranteed Wayland positioning. ARCHITECTURE sections 5 and 8, UX_SPEC (close dialog copy, disabled "Not supported by this desktop" controls) and D-026/D-027 agree with them. The checker's promise review gives 0 WARN. GNOME and X11 are marked `outside_validation_scope` and never pass (D-021). |
| Phase 01 can start without a new product-design discussion | pass | See the next section. |

## Phase 01 readiness

The plan gives Phase 01 everything it needs to start:

- **Package layout and identity:** source layout in ARCHITECTURE section 2. Identity in D-013: `infinity-notes`, `com.infinitynotes.desktop`, version 0.1.0. Data paths and the `INFINITY_NOTES_USER_DATA_DIR` override in D-014.
- **Scripts:** ARCHITECTURE section 15 lists all 11 standard npm scripts, with the rule that a script that does not apply yet must exit non-zero.
- **Migration 001:** the tables are listed in ARCHITECTURE section 3. They are settings, projects, folders, notes, notes_fts, note_versions, note_drafts, attachments and note_attachments, with columns and conventions (epoch ms, 0/1 booleans, foreign keys, WAL, `synchronous=FULL`). The section also defines the runner semantics: forward-only migrations, a transaction plus `user_version`, a pre-migration backup (last 3 kept), the exact failure-screen copy, and refusal of a newer schema. Migrations 002 to 006 are allocated to later phases.
- **IPC:** ARCHITECTURE section 4 defines `domain:action` channel names, the `{ok,data}` / `{ok:false,error:{code,message}}` envelope, the error-code list, a per-phase channel catalogue (Phase 01: `app:getInfo`, `settings:get|set`, `capabilities:get`, `settings:changed`), the whitelisted `subscribe`, and test hooks gated by `!app.isPackaged`.
- **Security:** ARCHITECTURE section 14 requires contextIsolation, sandbox and no nodeIntegration. It also specifies sender-URL plus Zod validation, a 5 MB payload limit, the exact CSP, blocked navigation and window.open, and denied permissions. Section 7 defines the restricted `infinity-attachment://` protocol.
- **DB adapter and fallback:** D-004 and R-01 cover the better-sqlite3 13.0.3 N-API prebuild. The planner probe shows per-platform `prebuilds/*.node` with no ABI tag, SQLite 3.53.4, FTS5 and JSON1, and a GLIBC_2.34 floor against WSL glibc 2.43. The adapter interface and `node:sqlite` fallback are specified, source rebuild is ruled out, and electron-builder uses `npmRebuild:false` with `asarUnpack`. W01-13 sets the exact proof: FTS5, BLOB, `db.backup()` and `compile_options` in Electron main on Windows and WSL.
- **Pins:** 37 exact pins, each resolved with its license in `npm-pins.log`. Peer ranges are checked: electron-vite to vite 7, vite to plugin-react 5, typescript-eslint to TS `<6.1`, and vitest 5.0.3 peer `vite ^6‖^7‖^8`.

## QA low issue: templated acceptance criteria

QA flagged that the PRODUCT_SPEC criterion column is templated ("Observable when <planned test> shows that <requirement>"). I checked whether this leaves Phases 01 to 09 without criteria they can implement. It does not, for three reasons:

1. Each requirement sentence is concrete and testable on its own terms. Examples: "Close via Ctrl+W, button or middle-click; never deletes the note; pending save flushed first", "Recovery … at most one alert per occurrence per batch; summary notification when more than 3", and "tomorrow EOD at 2026-10-08 13:00 Dhaka -> 2026-10-09 17:00 Dhaka (11:00Z)".
2. Each ID names a specific planned test file and case in BACKLOG, such as `integration/scheduler-recovery.test › crash after claim` or `unit/resolve-local.test › 2026-03-08 02:30`.
3. The observable outcomes are fixed in ARCHITECTURE and UX_SPEC: the state-transition table, error codes, timeouts, exact UI copy, the Appendix B frozen-clock table and the DST examples.

Together these give each phase acceptor something objective to check. Each phase plan must still turn its IDs into explicit assertions (follow-up F-1 below).

## Commands I ran

| Command | Exit | Result |
| --- | --- | --- |
| `node tools/check-traceability.mjs --repo .` | 0 | `SUMMARY ids=187 backlog_rows=187 per_phase[01:13 02:30 03:23 04:15 05:31 06:24 07:16 08:22 09:13] fails=0 warns=0` |
| Node script: PRODUCT_SPEC rows vs BACKLOG rows (phase, requirement text) and coverage of §4 work packages | 0 | spec 187, backlog 187, missing 0, phase mismatches 0, IDs outside work packages: none |
| `sha256sum CLAUDE.md tools/finalize-docs.mjs .claude/agents/*` vs `sha-before.log` | 0 | identical |
| `git check-ignore -v docs/PRODUCT_SPEC.md .infinity-work/x foo.sqlite3 tests/fixtures/a.sqlite3` | 0 | ignore rules behave as documented |
| `ls -la --time-style=full-iso infinity-notes-claude-pack` | 0 | all files 2026-10-08 13:52:04, before the phase |

## Evidence reviewed

- Pack: `infinity-notes-claude-pack/phases/00-scope-contracts-and-repository-planning.md`, `01-…md`, `PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `TEST_MATRIX.md`, `CLEANUP_POLICY.md`; root `CLAUDE.md` (user decisions)
- Deliverables: `docs/PRODUCT_SPEC.md`, `docs/UX_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/BACKLOG.md`, `tools/check-traceability.mjs`, `.gitignore`
- Reports: `docs/plans/phase-00.md`, `docs/progress/phase-00.md`, `docs/progress/phase-00-qa.md`
- Logs in `.infinity-work/logs/phase-00/`: `coordinator-traceability.log`, `qa-traceability.log`, `qa-checker-negative.log`, `qa-consistency.log`, `qa-dst.log`, `qa-doc-grep.log`, `qa-npm-view.log`, `planner-probes.log`, `npm-pins.log`, `npm-view.log`, `env.log`, `wsl-env.log`, `sha-before.log`, `sha-after.log`, `traceability-negative.log`

## Non-blocking follow-ups

| ID | Phase | Follow-up |
| --- | --- | --- |
| F-1 | Each of 01–09 (planner) | Each phase plan restates its IDs as explicit test assertions (inputs, expected output, failure case), building on the PRODUCT_SPEC requirement text, the BACKLOG planned test and the ARCHITECTURE contract, instead of reusing the templated criterion sentence. |
| F-2 | 01 | Migration 001: `notes_fts` is "rowid mapped to an integer key of notes", but `notes.id` is a UUID. Define a stable integer key that survives VACUUM, such as an explicit `INTEGER PRIMARY KEY` alias column or a unique integer column. Do not rely on the implicit rowid. Record the choice in DECISIONS. |
| F-3 | 01 | If the `node:sqlite` fallback (R-01) is needed, it must pass the same proof as better-sqlite3 in Electron 44 main and in Node integration tests: FTS5 including the D-029 `categories` tokenizer option, BLOB, the online backup API and `compile_options`. If neither driver passes, that is a recorded blocker, not a silent downgrade. |
| F-4 | 01 | State whether `INFINITY_NOTES_USER_DATA_DIR` is honored in packaged builds. ARCHITECTURE section 4 gates the test hooks on `!app.isPackaged`, but D-014 does not gate the data-dir override. Document the choice and test it. |
| F-5 | 01 (or first phase that edits the backlog) | Extend `tools/check-traceability.mjs` to compare the PRODUCT_SPEC phase per ID with BACKLOG so drift is detected (QA low issue 2). |
| F-6 | 01 | Fix the stale cross-reference in BACKLOG W01-02: "DECISIONS section 4" should point to the "Pinned dependency table" at the top of DECISIONS. |
| F-7 | 06 | PRODUCT_SPEC section 6 calls "Appendix B of the Phase 00 plan" the contract. The plan moves under `docs/development/` at finalization. Name the PRODUCT_SPEC section 6 table itself as the test contract. |
| F-8 | 05 / 09 | R-02: WSLg has no notification server or StatusNotifier host. Decide, with a recorded decision, whether to install a daemon for native validation, or to record those cases as fallback-validated or `not_run`. |
| F-9 | 09 (acceptor) | Decide whether `outside_validation_scope` for GNOME Wayland and X11 (D-021, the CLAUDE.md user decision) permits a final `complete`, given that the pack's PRODUCT_PLAN asks for GNOME Wayland plus X11 acceptance. |

## OS-dependent cases pending (none run in Phase 00, none claimed)

These native (N) cases are recorded in the Phase 09 NATIVE_OS_MATRIX: INF-FND-02, INF-FND-11, INF-FND-12, INF-SHELL-06, INF-KEY-05, INF-DESK-02, INF-DESK-03, INF-STKY-02, INF-STKY-06, INF-STKY-12, INF-STKY-13, INF-REM-06, INF-REM-07, INF-SCHED-05, INF-WIDG-02, INF-A11Y-06, and INF-PKG-01 to INF-PKG-05.

- Validation environments: the Windows 11 host, and WSL2 Ubuntu 26.04.1 with WSLg 1.0.73 (Weston).
- GNOME Wayland and X11-session columns are `outside_validation_scope` and are never counted as passes.
- Native-module loading (INF-FND-12) must be shown on both Windows and WSL starting in Phase 01.

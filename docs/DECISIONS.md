# Infinity Notes decisions (ADR log)

Format: each entry is `### D-0NN Title` with Context, Decision, Consequences, Status and Evidence. Status is `accepted` for every entry written in Phase 00. Accepted decisions change only through a new entry that supersedes the old one and names the phase that made the change. Where the product pack and a decision disagree, the pack wins on scope; the user decisions in the root `CLAUDE.md` (2026-10-08) win on validation environment, Python and commits. No such conflict was found in Phase 00.

Companion documents: [PRODUCT_SPEC](PRODUCT_SPEC.md), [UX_SPEC](UX_SPEC.md), [ARCHITECTURE](ARCHITECTURE.md), [BACKLOG](BACKLOG.md).

Pinned dependency table (installed in Phase 01; exact versions, all re-confirmed with `npm view` on 2026-10-08, raw output in the Phase 00 evidence log `npm-view.log` and `npm-pins.log`):

| Package | Pin | License | Reason |
| --- | --- | --- | --- |
| electron | 44.7.0 | MIT | Latest stable (2026-10-07); bundles Node 24.21.0 and Chromium 152; 44.x end of life 2027-03-02; 45.0.0 (scheduled 2026-10-20) is not chased mid-project |
| electron-vite | 5.0.0 | MIT | Latest stable; peer `vite ^5 \|\| ^6 \|\| ^7`; 6.0.0 is beta only and rejected |
| vite | 7.3.7 | MIT | Highest version inside the electron-vite 5 peer range; vite 8 rejected |
| @vitejs/plugin-react | 5.2.0 | MIT | Peer range includes vite 7; 6.x needs vite 8 and is rejected |
| react, react-dom | 19.3.0 | MIT | Latest; Tiptap React peer accepts 19 |
| typescript | 6.0.3 | Apache-2.0 | typescript-eslint 8.71.1 peer is `<6.1.0`; TypeScript 7 is not yet supported by it |
| @tiptap/core, react, pm, starter-kit, extension-list, extension-unique-id, extension-image, extensions | 3.31.4 | MIT | One exact version for all Tiptap packages; no Pro or cloud packages |
| better-sqlite3 | 13.0.3 | MIT | N-API prebuilds for win32-x64 and linux-x64; SQLite 3.53.4 with FTS5 and JSON1; needs GLIBC_2.34 |
| @types/better-sqlite3 | 9.6.0 | MIT | Typings only |
| zod | 4.6.5 | MIT | IPC and settings validation |
| luxon, @types/luxon | 3.7.2, 3.7.6 | MIT | IANA zone arithmetic over the runtime ICU |
| chrono-node | 2.10.2 | MIT | Local English component extraction only |
| dompurify | 3.4.16 | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) | Defense in depth for pasted HTML |
| lucide-react | 1.53.0 | ISC | Line icons |
| vitest, jsdom | 5.0.3, 30.1.2 | MIT | Unit and integration runner, DOM tests |
| @playwright/test | 1.64.0 | Apache-2.0 | Real Electron E2E via `_electron.launch` |
| eslint, @eslint/js | 10.12.0, 10.0.1 | MIT | Flat config |
| typescript-eslint | 8.71.1 | MIT | Peer eslint `^8.57 \|\| ^9 \|\| ^10`, typescript `<6.1.0` |
| eslint-plugin-react-hooks | 7.1.1 | MIT | Peer includes eslint 10 |
| globals | 17.13.0 | MIT | ESLint environments |
| @types/react, @types/react-dom | 19.3.0 | MIT | Match React |
| @types/node | 24.19.1 | MIT | Match the Node 24 line |
| electron-builder | 26.15.3 | MIT | NSIS, AppImage, deb; `npmRebuild: false`; `asarUnpack` for `**/*.node` |
| yazl, yauzl | 3.3.1, 3.4.0 | MIT | Phase 08 backup and export archives; installed in Phase 08 |

Explicitly not used: `@electron/rebuild` and any source rebuild of native modules (node-gyp needs Python), an ORM, a UI component framework, Prettier, electron-log, any Tiptap Pro or cloud package, any network or AI SDK, any telemetry, `@electron/remote`.

Toolchain floor: Node `>=24.15.0 <25` for development on both hosts (engines field set in Phase 01), npm 11, no Python.

## Decisions

### D-001 Product scope and non-goals
- Context: the pack defines a minimal offline notes app.
- Decision: one offline desktop app. Non-goals: backend, accounts, sync, collaboration, AI or LLM features, calendar integration, OCR, drawing, audio or video, Kanban, plugins, formula or database views, telemetry. Natural-language parsing is English only.
- Consequences: any proposal in these areas needs a new decision entry and user approval.
- Status: accepted.
- Evidence: PRODUCT_PLAN.md; CLAUDE.md.

### D-002 Stack
- Context: need one renderer bundle for main window, sticky windows and widget, cross-platform packaging.
- Decision: Electron 44.7.0, electron-vite 5.0.0, vite 7.3.7, React 19.3.0, TypeScript 6.0.3. vite is capped by the electron-vite peer range, TypeScript by the typescript-eslint peer range, @vitejs/plugin-react by vite.
- Consequences: do not upgrade vite or TypeScript mid-project unless a security fix requires it (risk R-04); Electron 44 end of life 2027-03-02 is acceptable for this release (R-05).
- Status: accepted.
- Evidence: npm view logs; releases.electronjs.org.

### D-003 Editor
- Context: notes and stickies must share one document model with stable block IDs.
- Decision: Tiptap 3.31.4 MIT packages listed above, one shared `NoteEditor` component. No hand-written contentEditable engine.
- Consequences: one exact Tiptap version across packages; block IDs via UniqueID with incoming IDs stripped on paste (R-06).
- Status: accepted.
- Evidence: npm view of each package (license MIT, version 3.31.4).

### D-004 SQLite driver
- Context: need FTS5, JSON1, online backup and no source compilation (Python is forbidden).
- Decision: better-sqlite3 13.0.3 N-API prebuilds. FTS5 and JSON1 are compiled in. `npmRebuild: false` and `asarUnpack: ["**/*.node"]`. Fallback: `node:sqlite` (bundled with Electron's Node 24.21) behind the same adapter if the prebuild fails inside Electron. Source rebuild is rejected because it needs Python.
- Consequences: Phase 01 must load it in Electron main on Windows and in WSL, create an FTS5 table, write and read a BLOB, run `db.backup()` and `PRAGMA compile_options` (risk R-01).
- Status: accepted.
- Evidence: planner probes (tarball inspection, glibc symbol check) in `planner-probes.log`.

### D-005 Validation
- Decision: Zod 4.6.5 schemas in `src/shared/contracts`, validated in main on every IPC call.
- Context: the renderer is untrusted. Consequences: contracts are the single source of types. Status: accepted. Evidence: ARCHITECTURE section Security.

### D-006 Time
- Context: reminders depend on correct zone arithmetic. Decision: Luxon 3.7.2 plus an app-owned DST resolver (gap and fold policy); instants stored as INTEGER epoch milliseconds UTC. Consequences: Luxon defaults are never relied on for gaps and folds. Status: accepted. Evidence: planner probe: 2026-03-08 02:30 America/New_York shifts to 03:30 by Luxon default, 2026-11-01 01:30 resolves to -04:00.

### D-007 Natural-language parsing
- Context: chrono-node mishandles several phrases. Decision: chrono-node 2.10.2 components only (`knownValues`), app-owned rules for end of day, date-only, weekdays, ambiguity. Observed quirks (reference 2026-10-08T07:00Z): "tomorrow end of the day" gives two results and does not understand end of day; "by 5 CST" gives no result; `forwardDate` rolls "03/04 at 5" to 2027. Consequences: frozen-clock tables in PRODUCT_SPEC Appendix B are the contract. Status: accepted. Evidence: planner probes.

### D-008 Sanitization
- Decision: Tiptap schema whitelist as primary control, DOMPurify 3.4.16 (Apache-2.0) as defense in depth, strip incoming block IDs on paste. Context: pasted HTML is hostile input. Consequences: remote images are not fetched. Status: accepted. Evidence: npm view dompurify license.

### D-009 Icons and styling
- Decision: lucide-react 1.53.0, plain CSS with CSS variables, no UI framework. Context: minimal reference-inspired UI. Consequences: tokens live in UX_SPEC. Status: accepted. Evidence: npm view.

### D-010 Tests
- Decision: Vitest 5.0.3 with jsdom 30.1.2, Playwright 1.64.0 `_electron`. Test-type legend U unit, I integration, E Electron E2E, N native OS validation, V visual or accessibility review, P performance, R review. Context and consequences: no browser downloads needed; native cases are recorded separately. Status: accepted. Evidence: npm view.

### D-011 Lint
- Decision: ESLint 10.12.0 flat config, typescript-eslint 8.71.1, eslint-plugin-react-hooks 7.1.1. Context: peer ranges verified. Consequences: lint is a gate of `npm run check`. Status: accepted. Evidence: npm view peerDependencies.

### D-012 Packaging
- Decision: electron-builder 26.15.3; NSIS on Windows; AppImage and deb built from a copy on the WSL ext4 filesystem; unsigned builds labeled "unsigned local build"; no publishing or auto-update. Context: no signing certificates. Consequences: `node_modules` is never shared across OSes. Status: accepted. Evidence: CLAUDE.md user decision.

### D-013 App identity
- Decision: npm name `infinity-notes`, productName `Infinity Notes`, appId and Windows AppUserModelID `com.infinitynotes.desktop`, Linux executable `infinity-notes`, version `0.1.0`. Context: stable identity is required for toasts and data paths. Consequences: changing it later moves userData. Status: accepted. Evidence: pack ARCHITECTURE.

### D-014 User data layout
- Decision: `app.getPath('userData')/data/infinity-notes.sqlite3`, `data/attachments/<first two hex of id>/<attachmentId>.<ext>`, `data/pre-migration/`, `data/restore-staging/`, `data/rollback-<timestamp>/`, `logs/`. Never the install directory. Notes store attachment IDs and the database stores paths relative to `data/`. Environment `INFINITY_NOTES_USER_DATA_DIR` (absolute path) overrides userData before `ready` for tests.
- Context: uninstall and reinstall must preserve data. Consequences: the data folder can be relocated without rewriting notes. Status: accepted. Evidence: ARCHITECTURE section Data model.

### D-015 IDs
- Decision: `crypto.randomUUID()` for every entity and block ID. Context: portable import remaps IDs. Consequences: IDs are validated as UUIDs at every boundary. Status: accepted. Evidence: contracts.

### D-016 Hierarchy rules
- Decision: Common is permanent; folders nest to depth 32 in Common and projects; cycle moves are rejected; scope moves update the subtree in one transaction; trash uses batch IDs. Full text in ARCHITECTURE section Hierarchy rules. Context: pack requires Common and project hierarchy. Consequences: invariants are enforced in main inside transactions. Status: accepted. Evidence: plan 7.2.

### D-017 Tab session model
- Decision: one Home tab, one tab per note, singleton pages, only the active note tab mounts an editor, session persisted in `session.tabs`. Context and consequences: memory stays bounded. Status: accepted. Evidence: UX_SPEC; ARCHITECTURE.

### D-018 Autosave, revision and lease protocol
- Decision: 400 ms debounced saves, revision check, acknowledgments, `note_drafts` for conflicts and lost leases, single editing lease per note, `synchronous=FULL`. Context: stickies and tabs can show the same note. Consequences: edits within the last debounce window before a crash may be lost; acknowledged saves are durable. Status: accepted. Evidence: ARCHITECTURE section Autosave.

### D-019 Attachments safety and limits
- Decision: main validates bytes by magic number (PNG, JPEG, GIF, WebP images only), atomic write, SHA-256 dedupe, `infinity-attachment://<id>` protocol, image limit 20 MB (1-100) and document limit 50 MB (1-200), executables never launched. Context and consequences: see ARCHITECTURE section Attachments. Status: accepted. Evidence: plan 7.7.

### D-020 OS minimums
- Decision: Windows 11 24H2 (build 26100) or later x64; Linux Ubuntu 24.04 LTS or later x64. Windows 10 and arm64 are not supported targets. Native Ubuntu 24.04 and GNOME or X11 desktops are declared, not validated. Context: glibc 2.39 meets the 2.34 SQLite prebuild need. Consequences: no claim is made outside these. Status: accepted. Evidence: planner probes (host versions, glibc check).

### D-021 Linux validation in WSLg
- Context: PRODUCT_PLAN and TEST_MATRIX ask for GNOME Wayland and X11 sessions; the user selected WSL2 Ubuntu 26.04 with WSLg (Weston) as the validation environment. Decision: the native matrix columns are Windows 11 host, WSLg Wayland, optional WSLg XWayland, and GNOME Wayland or X11 session marked `outside_validation_scope` (never pass). WSLg results are never labeled GNOME or an X11 session; every Linux result records the compositor and version. Xvfb E2E validates application logic only. Whether outside-scope cases permit a final `complete` is decided by the Phase 09 acceptor under the CLAUDE.md user decision; Phase 00 does not pre-claim an outcome. Consequences: INF-PKG-05 is the matrix requirement. Status: accepted. Evidence: CLAUDE.md; wsl-env.log.

### D-022 Reminder state machine and delivery policy
- Decision: occurrence states `pending`, `snoozed`, `completed`, `missed`, `cancelled`; overdue is derived; delivery claims before dispatch; uncertain claims are never re-dispatched. Context and consequences in ARCHITECTURE section Reminders. Status: accepted. Evidence: plan 7.8-7.9.

### D-023 Recurrence and DST policy
- Decision: store zone plus local wall-clock schedule; gap resolves to the first valid instant after the gap; fold defaults to the earlier instant with the later selectable; OS zone changes never alter stored reminder zones. Context: examples in Appendix B. Consequences: `resolveLocal` is app-owned. Status: accepted. Evidence: planner probes (Luxon behavior).

### D-024 Follow-ups, snooze, quiet hours, recovery and storm limits
- Decision: follow-ups off by default, 15 minutes times 2 when enabled; snooze presets 5/10/15/30/60 minutes and Tomorrow 09:00; quiet hours default off, 22:00-07:00 in an explicit zone; recovery batch sends at most 3 individual alerts, otherwise one summary. Context: avoid notification storms. Consequences: each occurrence has one nextAlertAt. Status: accepted. Evidence: ARCHITECTURE section Reminders.

### D-025 Weekday, end-of-day and date-only parsing policy
- Decision: week is Monday-Sunday; bare weekday is the first date on or after today whose resolved instant is in the future; "next W" is the following week; end of day default 17:00; date-only default 09:00; both disclosed and configurable. Context: Appendix B is the frozen table. Consequences: ambiguous input requires user choice. Status: accepted. Evidence: PRODUCT_SPEC Appendix B.

### D-026 No native notification action buttons in V1
- Decision: no OS offers action buttons in V1; Snooze, Done and Open are always in the app and the widget. Context: Linux server support is inconsistent. Consequences: INF-REM-16. Status: accepted. Evidence: capability table.

### D-027 Close and tray behavior
- Decision: the first main-window close shows a choice dialog (keep running in the background or quit), remembered and editable; menus always have Quit; a fully quit app stops reminders. Context: honest lifecycle messaging. Consequences: tray-less desktops rely on single-instance relaunch. Status: accepted. Evidence: UX_SPEC dialogs.

### D-028 Sticky windows
- Decision: sticky windows use native OS frames (no custom drag regions in V1) and there is one window per note ID. Context: reliable move and resize. Consequences: header is in-content. Status: accepted. Evidence: ARCHITECTURE section Windows.

### D-029 Search
- Decision: FTS5 tokenizer `unicode61 remove_diacritics 2 categories 'L* N* Co M*'` (keeps Bangla combining marks inside tokens; SQLite 3.45 and later support `categories`), prefix queries, title substring fallback for 1-2 character queries, capped at 50 results. Context: Bangla must be searchable. Consequences: verified with Bangla tests in Phases 03 and 07; fallback is the trigram tokenizer with a recorded decision (risk R-07). Status: accepted. Evidence: bundled SQLite 3.53.4.

### D-030 Backup and export formats
- Decision: `*.infinitybackup` zip with manifest and online-backup database copy; `*.infinityexport` portable zip with ID remapping on import; Markdown or plain-text export is lossy and documented as such. Context and consequences in ARCHITECTURE section Backup. Status: accepted. Evidence: plan 7.12.

### D-031 No Python anywhere
- Decision: no Python dependency; the final organizer is `node tools/finalize-docs.mjs --repo .`. Context: user decision. Consequences: node-gyp builds are impossible, see D-004. Status: accepted. Evidence: CLAUDE.md.

### D-032 Commit after each accepted phase
- Decision: the coordinator commits after each accepted phase with message `Phase XX: <title>`; never push; never commit `.infinity-work/`, build output or user data. Context: user decision. Consequences: Phase 00 commit also includes bootstrap files. Status: accepted. Evidence: CLAUDE.md.

### D-033 Main window frame
- Decision: native frame and native window controls with an in-window compact header (search and command box); Windows `titleBarOverlay` is an optional later enhancement. Context: reliable controls on Linux. Consequences: matches INF-SHELL-06. Status: accepted. Evidence: UX_SPEC.

### D-034 Retention defaults
- Decision: trash is never auto-purged (options Never, 30, 90 days); automatic versions kept 30 days and at most 100 per note; conversion, conflict and restore versions kept until the note is permanently deleted; attachment GC grace period 7 days. Context: data-loss avoidance. Consequences: configurable in Phase 08 (INF-PORT-07, INF-PORT-08). Status: accepted. Evidence: ARCHITECTURE.

## Risks carried forward

- R-01 better-sqlite3 prebuild in Electron 44: N-API should load unchanged but V8 memory-cage rules may reject external buffers; Phase 01 proves loading (dev and packaged, Windows and WSL); fallback `node:sqlite`; builder must not trigger node-gyp.
- R-02 WSLg has no notification server or tray host by default; those native cases may be `not_run` or `fail`; installing a daemon is an environment change needing a recorded decision in Phase 05 or 09; in-app fallbacks keep reminders usable.
- R-03 WSLg window behavior differs from GNOME; positions are compositor-controlled; record actual behavior and never label it GNOME.
- R-04 TypeScript held at 6.0.3 and vite at 7.3.7 by peer ranges.
- R-05 Electron 44 end of life 2027-03-02.
- R-06 Tiptap UniqueID may keep source IDs on paste; policy strips them (Phase 03 test).
- R-07 FTS5 `categories` tokenizer with Bangla needs fixture verification; fallback trigram.
- R-08 Windows toast visibility in development needs `app.setAppUserModelId`; packaged NSIS shortcut needed for reliable click activation.
- R-09 Electron default ozone platform under WSLg must be logged (Wayland versus XWayland); production never forces X11.

## Verification log

| Claim | Command or URL | Date | Result |
| --- | --- | --- | --- |
| Windows host | `systeminfo`, `node -v`, `npm -v`, `git --version` (env.log) | 2026-10-08 | Windows 11 Pro 10.0.26300; Node v24.15.0; npm 11.12.1; git 2.54.0.windows.1 |
| WSL host | `lsb_release -ds`, `uname -r`, `ldd --version`, `node -v`, `npm -v` (wsl-env.log) | 2026-10-08 | Ubuntu 26.04.1 LTS; kernel 6.6.114.1-microsoft-standard-WSL2; glibc 2.43; Node v24.21.0; npm 11.19.0 |
| WSLg and compositor | `/mnt/wslg/versions.txt` (wsl-env.log) | 2026-10-08 | WSLg 1.0.73, weston build listed, `WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0` |
| WSL notification server and tray host | `busctl --user list` (planner-probes.log) | 2026-10-08 | none present |
| Every pin in the table exists with the stated license | `npm view <pkg>@<version> version license` (npm-pins.log) | 2026-10-08 | all pinned specs resolved, licenses as listed |
| Peer ranges for electron-vite, @vitejs/plugin-react, vitest, typescript-eslint, eslint-plugin-react-hooks | `npm view <pkg> engines peerDependencies --json` (npm-view.log) | 2026-10-08 | raw output saved |
| better-sqlite3 prebuilds, SQLite 3.53.4, FTS5 and JSON1, GLIBC_2.34 | tarball inspection and `objdump` symbol check (planner-probes.log) | 2026-10-08 | as stated in D-004 |
| Luxon gap and fold behavior; chrono-node quirks | probe scripts (planner-probes.log) | 2026-10-08 | as stated in D-006 and D-007 |
| No Python required | Windows has no Python (CLAUDE.md host notes); no tool in this repository calls it | 2026-10-08 | satisfied |

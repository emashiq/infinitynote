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
| @tiptap/core, react, pm, starter-kit, extension-list, extension-unique-id, extensions | 3.31.4 | MIT | One exact version for all Tiptap packages; no Pro or cloud packages |
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
| @electron/fuses | 1.8.0 | MIT | Phase 09: the packaged E2E reads the fuse wire of the built binary; the same version electron-builder uses to flip the fuses |
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
- Decision: the first main-window close shows a choice dialog (keep running in the background or quit), remembered and editable; menus always have Quit; a fully quit app stops reminders. Context: honest lifecycle messaging. Consequences: tray-less desktops rely on single-instance relaunch. Status: accepted (refined by D-066: Cancel button, remember checkbox checked by default, background mode closes the main window). Evidence: UX_SPEC dialogs.

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

## Phase 01 decisions

Recorded by the Phase 01 planner on 2026-10-08. Probe output is in `.infinity-work/logs/phase-01/planner-probes.log`. The implementation plan is `docs/plans/phase-01.md`.

### D-035 Renderer origin is a privileged custom scheme, not file://
- Context: ARCHITECTURE section 14 said the packaged renderer loads a `file://` index. The planner probe loaded a sandboxed, context-isolated window under the exact section 14 CSP. A `file://` page could still `fetch`, `XMLHttpRequest` and `<img>` arbitrary local files, because CSP `'self'` on a `file://` page matches every `file:` URL. The same page served from a custom scheme had all three blocked.
- Decision: built and packaged renderers load `infinity-app://renderer/index.html` from a scheme that is registered privileged (`standard`, `secure`, `supportFetchAPI`) before `ready`. The scheme is served by `protocol.handle` from the bundled `out/renderer` directory only. It reads with asar-aware `fs`, uses a fixed MIME map, contains every path inside the renderer root and answers 404 otherwise. The HTML response also carries the CSP header. Development loads the electron-vite dev server URL, and only when `!app.isPackaged` and `ELECTRON_RENDERER_URL` is set. IPC sender validation accepts the origin `infinity-app://renderer`, plus the dev origin in development only.
- Consequences: this supersedes the "packaged `file://` index" wording in ARCHITECTURE section 14. `will-navigate` is allowed only to the window's own renderer origin. Every other navigation is prevented.
- Status: accepted.
- Evidence: planner-probes.log, Probe E.

### D-036 Stable integer key for notes_fts (follow-up F-2)
- Context: `notes.id` is a UUID. FTS5 needs an integer rowid, and the implicit rowid of a table without an `INTEGER PRIMARY KEY` may change on `VACUUM`.
- Decision: `notes.doc_key INTEGER PRIMARY KEY AUTOINCREMENT` is an explicit rowid alias, so VACUUM keeps it and AUTOINCREMENT never reuses it. `notes.id TEXT NOT NULL UNIQUE` stays the public key that every foreign key and IPC payload uses. `doc_key` never leaves main. `notes_fts` is an external-content FTS5 table: `content='notes'`, `content_rowid='doc_key'`, columns `title, plain_text`, tokenizer per D-029. It is kept in sync by `AFTER INSERT/UPDATE/DELETE` triggers on `notes`, which index only rows with `deleted_at IS NULL`. Trash removes a row from the index and restore re-adds it, inside the same transaction as the write.
- Consequences: the ARCHITECTURE section 3 FTS columns are `title, plain_text` (previously "title, body"). Phase 01 integration tests check `doc_key` stability across VACUUM, the trigger behavior and `INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')`.
- Status: accepted.
- Evidence: planner-probes.log, Probes A, B and K (`rowidAfterVacuum`, Bangla match with the `categories` tokenizer).

### D-037 INFINITY_NOTES_USER_DATA_DIR in packaged builds (follow-up F-4)
- Context: D-014 defines the override but does not say whether packaged builds honor it. The test hooks are gated by `!app.isPackaged`.
- Decision: packaged builds honor the override too, so the Phase 01 and Phase 09 packaged smoke tests never touch a real notebook. The value must be an absolute path without NUL characters, and it is normalized. A relative or invalid value is ignored and a warning is logged. The override is applied with `app.setPath('userData')` before the single-instance lock and before `ready`, so the lock is scoped to that directory. When active, it is logged once. Test hooks (fake shell, diagnostics globals) stay limited to `!app.isPackaged && INFINITY_NOTES_E2E === '1'`, even when the override is set.
- Consequences: unit tests cover the resolver for both values of `isPackaged`. The packaged E2E (`npm run test:e2e:packaged`) proves the override is honored and the hooks are absent.
- Status: accepted.
- Evidence: plan section 6.

### D-038 Native module policy: prebuilt N-API binary, no source rebuild, no install scripts (follow-up F-3)
- Context: the Phase 01 pack criterion "native-module rebuild works on the current host" assumes node-gyp, which needs Python (D-031). better-sqlite3 13.0.3 ships `prebuilds/<platform>-<arch>.node` (N-API 10) and sets `gypfile:false`. Electron 44.7.0 has no postinstall and downloads its binary lazily. npm 11.19 in WSL lists an implicit `node-gyp rebuild` install script for better-sqlite3 under its install-script approval feature.
- Decision: for this project the criterion means "the prebuilt better-sqlite3 binary loads, with no source rebuild, in Electron main in development, in the packaged unpacked app and in the Linux AppImage on Windows and WSL, and passes the self-test". The self-test checks FTS5 with the D-029 tokenizer and a Bangla match, a BLOB round trip, `db.backup()`, `PRAGMA compile_options` (ENABLE_FTS5), JSON, migration to latest and `doc_key` stability. Proof is the self-test report, plus a SHA-256 match between the packaged `app.asar.unpacked/.../prebuilds/<platform>-<arch>.node` and the npm tarball copy, plus the absence of `node_modules/better-sqlite3/build/`. A repository `.npmrc` sets `ignore-scripts=true` and `engine-strict=true`, so no dependency install script runs under either npm version. The Electron binary is fetched explicitly with `npm run setup:electron`. electron-builder runs with `npmRebuild:false`, `nodeGypRebuild:false`, `buildDependenciesFromSource:false` and `asarUnpack: ["**/*.node"]`.
- Fallback: the `node:sqlite` fallback (D-004) is not implemented in Phase 01. The planner probes show better-sqlite3 passing in Electron 44 main on Windows (dev and packaged) and on WSL (dev, linux-unpacked and AppImage). If the implementation-time self-test fails on either host, the implementer adds a `node:sqlite` driver behind the same `Db` interface. It must pass the identical self-test (FTS5 with the `categories` tokenizer, BLOB, backup, compile_options) in Electron 44 main and in the Node integration tests. If neither driver passes, that is recorded as a blocker, not a silent downgrade.
- Status: accepted.
- Evidence: planner-probes.log, Probes A to D, G, J, K, P and Q.

### D-039 Linux leg runs as an unprivileged WSL user
- Context: the only WSL account was root. Chromium aborts as root unless `--no-sandbox` is passed ("Running as root without --no-sandbox is not supported"), and disabling the sandbox is forbidden.
- Decision: the WSL user `infinity` (created by the planner with `useradd -m -s /bin/bash infinity`) runs every Linux build, test and launch through `wsl -d Ubuntu -u infinity -- bash -lc '...'`. The build copy is `/home/infinity/infinity-notes` on ext4. It is synced from `/mnt/e/notecapt` with `rsync -a --delete`, excluding `node_modules/`, `out/`, `release/`, `.git/`, `.infinity-work/`, `test-results/`, `playwright-report/` and `coverage/`, and it has its own `node_modules` from `npm ci`. `WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0` is exported because the per-user runtime directory has no `wayland-0` socket. xvfb, fakeroot, dpkg-deb, git and rsync are already installed, so no apt package is installed. chrome-sandbox is not made SUID because the user-namespace sandbox works.
- Observed (R-09): with no `XDG_SESSION_TYPE`, Electron 44 under WSLg selects ozone `x11` (XWayland). `--ozone-platform=wayland` also works. Production never forces either one. Results are labeled WSLg/Weston (WSLg 1.0.73), never GNOME.
- Status: accepted.
- Evidence: planner-probes.log, Probes H, I and L to N.

### D-040 Migration runner and startup failure states
- Decision:
  - All pending migrations run in one `BEGIN IMMEDIATE` transaction together with `PRAGMA user_version`, and `PRAGMA foreign_key_check` runs before commit. Any failure rolls the whole set back, so "your data was not changed" is literally true.
  - An existing database file is first probed read-only. A `user_version` above the app's latest refuses startup before any write, including the switch to WAL.
  - The pre-migration copy (`db.backup()` into `data/pre-migration/infinity-notes-v<from>-<UTC timestamp>.sqlite3`, last 3 kept) is made only when an existing database with at least one table is upgraded.
  - Tables are `STRICT`. Migration SQL files are LF-only (`.gitattributes`) and frozen by SHA-256 in `src/main/db/migrations/checksums.json`, which a unit test checks.
  - Startup states are `MIGRATION_FAILED`, `SCHEMA_TOO_NEW` and `DB_OPEN_FAILED`. Each shows a full-window screen with Show data folder and Quit, using the copy in UX_SPEC section 6.
- Status: accepted.
- Evidence: ARCHITECTURE section 3.

### D-041 Settings storage and the Phase 01 setting
- Decision:
  - Each settings row stores `{"v":<schemaVersion>,"value":<json>}`.
  - A typed registry in `src/shared/contracts/settings.ts` maps each key to a Zod schema, a version and a default. Unknown keys and invalid values are rejected with `VALIDATION_FAILED` and nothing is written.
  - A stored value that fails validation or has an unknown version reads as the default, and a warning is logged.
  - `settings:changed` is broadcast to every window after commit.
  - Phase 01 registers `appearance.theme` (`system|light|dark`, default `system`). Main applies it through `nativeTheme.themeSource`, and the renderer applies it through `data-theme`.
  - The Phase 01 window is a minimal foundation screen with an Appearance theme control. Phase 02 replaces it with the shell, and the control moves to Settings > Appearance (Phase 08 completes INF-PREF-01).
- Status: accepted.
- Evidence: plan section 5.

### D-042 IPC envelope details, Phase 01 channels and the save/lease service contract
- Decision:
  - The error envelope gains an optional JSON `details` field. Example: `CONFLICT` carries `{currentRevision, draftId}`.
  - Phase 01 adds `app:showDataFolder` and `app:quit` to the catalogue. Both are needed by the startup failure screen.
  - `subscribe` accepts only the event names of phases already implemented. In Phase 01 that is `settings:changed`.
  - The save and lease services (`NoteWriter`, `LeaseManager`) are implemented and integration-tested in main in Phase 01, with no IPC registration until Phase 03. Their rules:
    - A lease binds `viewId` to the owning `webContents` id. A call with a matching `viewId` from another `webContents` is rejected with `FORBIDDEN`.
    - Any save rejected because of a stale revision, a trashed note or a lost lease keeps its content as a `note_drafts` row (`conflict` or `lease_lost`). Only validation and size failures store nothing.
    - A repeated `requestId` for the same note returns the original acknowledgment without writing again. Each note remembers its last 100 request IDs in memory.
    - `lease:take` waits up to 3000 ms for the holder to call `lease:release` after its flush. On timeout, or if the holder's `webContents` is destroyed, the lease is revoked.
  - `note_drafts` gains a nullable `title` column.
- Status: accepted.
- Evidence: ARCHITECTURE sections 4 and 6.

### D-043 Package metadata, scripts and network guard
- Decision:
  - electron-builder configuration lives in `electron-builder.json`.
  - Artifact names contain `unsigned`. The deb metadata needs a homepage and a maintainer, and there is no website, so it uses the reserved, non-resolving domain `infinity-notes.invalid`. The user's personal email is never placed in artifacts.
  - CLIs (electron-builder, electron-vite, playwright) are started by `tools/*.mjs` through `process.execPath` and the CLI file path, never through `npx` and never through a shell. npm 11 parses flags after `npx --no <cmd>` as npm configuration.
  - Cross-OS packaging is refused with exit code 2 and a message that names the correct host.
  - Main installs a `webRequest` guard that cancels every `http`, `https`, `ws` and `wss` request (the dev server origin is allowed in development only). Blocked URLs are logged, and the E2E checks that startup makes no requests. `spellcheck` is off for all windows until Phase 03 decides on dictionaries, because Linux dictionary downloads would be network traffic.
- Status: accepted.
- Evidence: planner-probes.log, Probes F and O.

## Phase 02 decisions

Recorded by the Phase 02 planner on 2026-10-08. The implementation plan is `docs/plans/phase-02.md`; section numbers below refer to it.

### D-044 Migration 002 (hierarchy indexes) and renumbered migration allocation
- Context: migration 001 already holds every Phase 02 column. Purging trash deletes parent rows guarded by `ON DELETE RESTRICT`, and SQLite scans the child table for each deleted parent unless the child column has a full index. `notes_scope` is partial (live rows only) and cannot serve that check or subtree queries that must include trashed rows.
- Decision: Phase 02 adds `002_hierarchy_indexes.sql` with indexes only: `notes(folder_id)`, `notes(project_id)`, partial `folders(trash_batch_id)` and `projects(trash_batch_id)` where not null, and partial `notes(deleted_at)`, `folders(deleted_at)` where not null. No table or trigger changes. Migration numbers are assigned in phase order: 002 Phase 02, 003 Phase 04 (window_state), 004 Phase 05 (reminders), 005 Phase 06 (reminder sources), 006 Phase 07 (references, tags), 007 Phase 08 only if needed.
- Consequences: `LATEST` becomes 2; tests that hard-coded schema version 1 change to 2; the Phase 01 failure-injection tests inject version 3. A populated v1 database upgrades with a pre-migration copy (integration test).
- Status: accepted; the allocation of numbers 003 and later is superseded by D-051 (Phase 03).
- Evidence: plan section 5.

### D-045 Phase 02 IPC catalogue and settings keys
- Context: INF-TABS-03 (Phase 02) requires flushing a pending save before a tab closes, and the phase allows a temporary text area whose saves must already use stable IDs and revisions.
- Decision:
  - `note:open`, `note:save`, `lease:acquire` and `lease:release` move from Phase 03 to Phase 02 and use the existing `NoteWriter` and `LeaseManager`. `lease:take` and the events `note:revision`, `note:lease`, `lease:release-request` stay in Phase 03.
  - New Phase 02 channels: `tree:list`, `project:create|rename|trash`, `folder:create|rename|move|trash`, `note:create|rename|move|trash|setPinned`, `item:setFavorite`, `trash:list|restore|purge`, `home:summary`, `session:get|set`, `palette:searchTitles`. New event: `tree:changed {reason, trashedNoteIds}`.
  - The settings registry gains a `public` flag. Public keys (settable through `settings:set`): `appearance.theme`, `layout.treeOpen`, `layout.treeWidth` (220-280, default 248), `layout.panelOpen`, `home.scope`, `tree.expanded`. Internal key `session.tabs` is read and written only through `session:get|set`; `settings:get|set` reject it with `VALIDATION_FAILED`.
  - Tab IDs are deterministic: `home`, `note:<uuid>`, `page:stickies`, `page:reminders`, `page:settings`.
- Consequences: ARCHITECTURE section 4 updated. A fresh launch without user interaction still writes no settings row.
- Status: accepted.
- Evidence: plan sections 6 and 7.

### D-046 Hierarchy, trash and restore semantics
- Decision:
  - Scope consistency holds for every row, live or trashed: a folder's `project_id` equals its parent's; a note's equals its folder's. A live folder or note never sits under a trashed folder or project. Every move, restore and purge transaction ends with an invariant query and rolls back on violation.
  - A trash batch has exactly one root (the item the user trashed). Restore works per batch. The root returns to its original parent if live; otherwise to the nearest live ancestor folder; otherwise to its scope root; if its project is trashed or gone, to the Common root. Relocation updates `project_id` across the whole subtree (all rows). The response says whether it relocated.
  - Purge (Delete forever, Empty trash) requires `confirmed: true`. Rows of other batches that reference a purged folder are re-anchored to the nearest surviving ancestor (Common when the project is purged). Folders are deleted deepest first because `ON DELETE RESTRICT` is checked per row.
  - Renaming, moving, pinning and favoriting a note never change `notes.revision`; only content saves do. `note:save` without a title keeps the stored title.
  - Duplicate sibling names are stored as given. Pickers, palette results and Home show the path; identical sibling labels get an ordinal suffix " (2)", " (3)" by creation time (display only).
- Status: accepted.
- Evidence: plan section 8.

### D-047 Shell behavior for Phase 02
- Decision:
  - The header shows the product name as the page `h1` ("Infinity Notes"); view headings are `h2`.
  - New-item location for Ctrl+N, Ctrl+Shift+N and the palette: (1) focus inside the tree with a selected item uses that item's location; (2) else an active note tab uses that note's folder; (3) else the Home tab uses the Home filter (Project means its root, Common or All means the Common root); (4) else the Common root.
  - Note and page tabs are appended at the end of the strip; closing the active tab activates its right neighbor, else its left neighbor. At most 200 tabs. The session is written immediately on every structural change (open, close, activate) and scroll positions are debounced 500 ms.
  - Phase 02 pages: Stickies lists sticky notes with Open and New sticky (Float arrives in Phase 04); Reminders states that reminders are not available in this build yet; Settings has Appearance (theme) and About (version and storage).
  - Drag and drop in the tree is not part of Phase 02; the keyboard-accessible Move to dialog is the required path.
- Status: accepted.
- Evidence: plan sections 9-11.

### D-048 Temporary text area until Phase 03
- Decision: notes are created as `format 'rich'` with `{"type":"doc","content":[{"type":"paragraph"}]}`. The Phase 02 text area maps one line to one paragraph (`textToDoc`, `docToText` in `src/shared/text/textarea-doc.ts`); a document with other node types opens read-only. Saves go through `note:save` with a lease held by one `viewId` per window. Flush happens on tab switch, tab close, blur and page hide. Flushing on window close and quit is Phase 03 (INF-SAVE-01); until then text typed within the 400 ms debounce before the window closes may be lost, and the progress report states this.
- Status: accepted.
- Evidence: plan section 12.

### D-049 Toolchain Node for CI and the E2E runner (follow-up F-01-1)
- Context: Node 24.15 on Windows intermittently kills the Playwright worker (0xC0000409); Node 24.21 showed 0 crashes in 50 runs (Phase 01 Repair 2).
- Decision: `.github/workflows/ci.yml` uses Node `24.21.0`. Local Windows E2E gates run Playwright under Node 24.21 via `INFINITY_E2E_NODE` (`.infinity-work/node-portable/node-v24.21.0-win-x64/node.exe`). The `engines` floor stays `>=24.15.0 <25` because the host's installed Node is 24.15 and `engine-strict=true`; raise it only if the user upgrades the host Node.
- Status: accepted.
- Evidence: `docs/progress/phase-01-acceptance.md` decision 1.

### D-050 Keyboard activation in E2E steps (follow-up F-01-4)
- Context: under WSLg with forced `--ozone-platform=wayland` the Electron window is not visible at start (`isVisible()` false) and `requestAnimationFrame` fires 0 times per second, so Playwright's stability wait ("waiting for element to be visible, enabled and stable") never completes for `check()` and `click()`. `click({force:true})`, focus plus Space and `dispatchEvent('click')` work, and `win.focus(); win.show()` restores 60 rAF per second. Default ozone (x11 under WSLg) and Xvfb are unaffected (probe logs `f014-probe-*.log`).
- Decision: E2E steps whose subject is not pointer behavior use keyboard activation through `tests/e2e/ui.ts` `activate`. Pointer-specific cases (middle click, splitter drag, row click, scroll buttons) stay pointer and are expected informational failures under forced Wayland. Product code never calls `win.focus()` or `show()` as a workaround and never forces an ozone platform. The forced-Wayland run is informational, never a gate.
- Status: accepted.
- Evidence: `docs/progress/phase-02.md` section F-01-4.

## Phase 03 decisions

Recorded by the Phase 03 planner on 2026-10-08. The implementation plan is `docs/plans/phase-03.md`; section numbers below refer to it. Probe output is in `.infinity-work/logs/phase-03/planner-probe-*.log`.

### D-051 Migration 003 recorded; allocation renumbered (follow-up F-02-2)
- Context: Phase 02 Repair 1 (QA-P02-4) added `003_trash_reanchored.sql` (table `trash_reanchored`), while D-044, ARCHITECTURE section 3 and BACKLOG W04-01 still gave 003 to `window_state`. The application is consistent (`LATEST = 3`, checksum key 3).
- Decision: 003 is Phase 02 `trash_reanchored`. Phase 03 adds no migration: every table it needs (`note_versions`, `note_drafts`, `attachments`, `note_attachments`) is in 001, draft dedupe (F-01-3) is in memory like the acknowledgment cache, and retention settings are constants until Phase 08. Later numbers shift by one: 004 Phase 04 `window_state`, 005 Phase 05 reminders, 006 Phase 06 reminder sources, 007 Phase 07 references and tags, 008 Phase 08 only if needed. If a later phase needs no migration, the next phase takes the next free number and records it.
- Consequences: `schemaVersion` stays 3 through Phase 03; ARCHITECTURE section 3 and BACKLOG W02-02, W04-01, W05-01, W06-02, W07-01 updated.
- Status: accepted.
- Evidence: `src/main/db/migrations/index.ts`, `checksums.json`; `docs/progress/phase-02-acceptance.md` F-02-2.

### D-052 Phase 03 IPC catalogue changes
- Decision:
  - `attachment:importImageBytes` becomes `attachment:importBytes {kind:'image'|'document', originalName?, bytes: Uint8Array}`, because dropped and pasted documents use the same path as images. The router measures this channel as `bytes.byteLength` plus the JSON of the other fields; its ceiling is the largest configurable limit (200 MB) plus 64 KiB, and the service enforces the configured limit.
  - `shell:openExternal {url}` moves from Phase 07 to Phase 03 because INF-SEC-01 (Phase 03) needs it.
  - `note:trashed` moves from Phase 03 to Phase 04: `tree:changed` already carries `trashedNoteIds` for the single main window, and only sticky windows need a dedicated event. (Superseded by D-063: the trash state travels in `sticky:state` instead.)
  - New: invoke `app:flushed {flushId}` and event `app:flush-request {flushId}` for acknowledged flush on window close and quit (INF-SAVE-01).
  - `note:create` accepts an optional `format` (`rich` default, or `plain`) for "New plain-text note".
  - `lease:release-request` and `app:flush-request` are sent to one `webContents` only; `note:revision` and `note:lease` are broadcast.
- Consequences: ARCHITECTURE section 4 rows 03, 04 and 07 updated; boundary tests now guard Phase 04 names instead.
- Status: accepted.
- Evidence: plan section 6.

### D-053 Editor schema, block IDs and the end of the temporary editor
- Context: the planner probe (`planner-probe-tiptap.log`) showed that Tiptap 3.31.4 UniqueID (a) assigns missing IDs in a create-time transaction with `addToHistory:false`, (b) gives a split paragraph a new ID, but (c) keeps a duplicated ID when a copy of an existing block is inserted (`insertContentAt`), and (d) strips pasted IDs only when a DOM `paste` event set its flag. The stock Image extension parsed `<img src="http://...">` into a node (R-06 confirmed).
- Decision:
  - One `NoteEditor` (Tiptap) for rich and plain notes, used by tabs now and stickies in Phase 04. D-048's text area is removed.
  - Rich schema: StarterKit (paragraph, heading levels 1-3, bold, italic, strike, underline, inline code, code block, blockquote, horizontal rule, hard break, bullet and ordered lists, link, undo and redo), TaskList and TaskItem (nested), an app `image` node (attributes `attachmentId`, `alt`, `size` small|medium|full, `width`, `height`) parsed only from `img[data-attachment-id]`, and an app `fileAttachment` atom (`attachmentId`, `name`, `sizeBytes`, `mime`). Links allow only `http:` and `https:`. Plain schema: document, paragraph, text; content stored as a string, one paragraph per line.
  - Block IDs: UniqueID with types paragraph, heading, codeBlock, blockquote, listItem, taskItem, image, fileAttachment. An app `BlockIdGuard` plugin (a) strips IDs from every pasted or dropped slice except an internal move, and (b) after any transaction whose steps insert nodes carrying IDs, regenerates every ID that now occurs twice, keeping the occurrence that existed before the transaction. IDs assigned at load are not a user edit: they are persisted with the next real edit, so opening a note never bumps its revision or `updated_at`.
  - Main validates and normalizes every rich document on save with the shared `normalizeRichDoc` (whitelisted node and mark types, known attributes only, UUID `id` and `attachmentId`, depth at most 64, at most 100,000 nodes). Unknown node or mark types are rejected with `VALIDATION_FAILED` and nothing is stored; unknown attributes are dropped; a link mark with a disallowed URL is dropped and its text kept. A drift test feeds real editor output for every feature through the normalizer.
- Consequences: D-048 is superseded. INF-EDIT-06 and INF-REF-07 rely on `BlockIdGuard`, not only on UniqueID.
- Status: accepted.
- Evidence: `planner-probe-tiptap.log`.

### D-054 Paste and attachment pipeline
- Context: Electron 44 replaced the synchronous clipboard API (`clipboard.writeImage` no longer exists) with an async W3C-style API (`clipboard.write([new ClipboardItem({...})])`, `clipboard.has`). The planner probe (`planner-probe-clipboard-{win,wslg,xvfb}.log`) wrote a PNG and HTML to the OS clipboard from main and pasted into a sandboxed, context-isolated renderer with `webContents.paste()` and with a synthesized Ctrl+V. On Windows 11, WSLg (ozone x11) and Xvfb the paste event carried one `image/png` File named `image.png`, or `text/html` plus `text/plain`. A `Uint8Array` sent through the bridge arrived in main as a `Uint8Array`. The DataTransfer files were no longer readable after the handler's first `await`.
- Decision:
  - Clipboard bitmaps use the paste-event PNG File. The renderer captures files synchronously in the handler, then sends the bytes through `attachment:importBytes`; main never trusts the declared type and re-checks the magic number. HTML paste is sanitized by DOMPurify (scripts, styles, frames, objects, embeds, forms, SVG, MathML and event-handler attributes removed), then parsed by the schema whitelist. Remote `<img>` becomes a link with the text "Image: <alt or host>" and is never fetched. `data:image/(png|jpeg|gif|webp)` images are decoded and imported.
  - Main sniffs PNG, JPEG, GIF and WebP from the bytes, reads the dimensions from the header, rejects anything else (SVG, HTML, HEIC, unknown, truncated) and rejects images over 100 megapixels. Files are written to `attachments/tmp/<id>.part`, fsynced, renamed into `attachments/<aa>/<id>.<ext>`, then registered in a transaction with `unreferenced_since = now`. Identical SHA-256 reuses the row; an image import that hits a `document` row with valid image bytes promotes it to `image`. `attachments/tmp` entries older than 1 hour are deleted at startup.
  - Limits come from the public settings `attachments.imageMaxMb` (1-100, default 20) and `attachments.documentMaxMb` (1-200, default 50). The renderer checks `File.size` before reading bytes, and main checks again (`stat` before reading for the dialog path). Until the Settings control exists (Phase 08) the messages are "This image is larger than N MB. Use a smaller image." and "This file is larger than N MB. Use a smaller file."
  - F-01-2 lands early: the attachment protocol also compares `realpath` of the file with `realpath` of the attachments directory and refuses symlinks or junctions that escape it.
  - E2E seeds the real OS clipboard from main (`clipboard.write` with `ClipboardItem`) and pastes with a real Ctrl+V. If a host does not deliver the keystroke paste, `webContents.paste()` (the Edit > Paste menu path) is the fallback and is recorded. A synthetic DataTransfer is used only for file drop, which Playwright cannot perform natively, and is labelled synthetic.
- Status: accepted.
- Evidence: planner probe logs listed above.

### D-055 Autosave, conflict and lease behavior in Phase 03
- Decision:
  - The renderer saves the editor JSON lazily: an edit marks the controller dirty, and the debounced drain reads `editor.getJSON()`, removes transient upload nodes and sends `note:save`. Transactions with `addToHistory:false` that the app did not mark `infinity:persist` (the create-time ID pass, external reloads) are not edits.
  - On `CONFLICT` (stale) the controller reloads the current content and shows the conflict banner with Compare, Restore draft and Dismiss; the edits are already in `note_drafts`. On `CONFLICT` (trashed) the tab closes through `tree:changed` and a notice says the edits were kept as a recovered draft (F-02-1). On `LEASE_REQUIRED` the note becomes read-only with the lease banner and the recovered-draft actions. Opening a note with unresolved drafts shows the recovered-draft banner.
  - A tab or the window is never closed after a failed flush unless main kept a draft (`CONFLICT`, `LEASE_REQUIRED`) or the note no longer exists (`NOT_FOUND`).
  - Lease reset when a window's renderer document goes away (main-frame `did-navigate` or `render-process-gone`), crash auto-reload and the `FlushCoordinator` as in ARCHITECTURE section 6. A second `viewId` in the same live document (as the E2E seed helper uses) still gets `granted:false` and never steals the lease. Retried conflicts reuse the first draft (F-01-3).
  - Flush awaits in-flight image imports for up to 10 s, but window close and quit still stop waiting after 2000 ms per window; an image still importing then may be missing from the note (stated limitation).
- Status: accepted.
- Evidence: plan sections 8 and 10.

### D-056 Version retention scaffolding
- Decision: `note_versions` rows are written inside the save transaction: `auto` snapshots the stored content before a save when the note has revision of at least 1 and no `auto` version from the last 10 minutes; `conversion` before a format change; `conflict` before Restore draft; `restore` before a version restore. Each stores the format, the content and the attachment IDs it references. After an `auto` insert, `auto` versions of that note older than 30 days, or beyond the newest 100, are deleted; other reasons are kept until the note is purged (D-034). Titles are not versioned; a restore keeps the current title. Constants live in `src/shared/versions/retention.ts`; Phase 08 makes them configurable and adds the full history screen (INF-PORT-07). Phase 03 has a minimal Version history dialog (list and Restore).
- Status: accepted.
- Evidence: D-034; plan section 8.4.

### D-057 Spellcheck stays off in V1
- Context: D-043 turned spellcheck off until Phase 03 decided on dictionaries, because Linux dictionary downloads would be network traffic.
- Decision: `spellcheck: false` stays in every window and the editor sets `spellcheck="false"`. No dictionary is bundled. A later release may enable the OS spellchecker on Windows only, with a new decision.
- Status: accepted.
- Evidence: D-043.

### D-058 Find in note
- Decision: Ctrl+F opens an in-editor find bar implemented as a ProseMirror decoration plugin (literal, case-insensitive, Unicode-aware RegExp with the `iu` flags over each text block, at most 1,000 matches, Enter and Shift+Enter for next and previous with wrap, Escape closes and returns focus to the editor at the current match). `webContents.findInPage` is not used because it searches the whole window (tree, tabs, panel).
- Status: accepted.
- Evidence: plan section 9.6.

### D-059 Files dropped or pasted into a plain-text note
- Context: the Phase 03 plan defines the message for an image pasted into a plain-text note but not for a document file; the plain-text schema has no file chip node.
- Decision: a plain-text note refuses every pasted or dropped file. When any file is an image the message is "Plain-text notes cannot contain images. Convert to rich text to add images."; otherwise "Plain-text notes cannot contain files. Convert to rich text to add files." Nothing is imported. Plain-text notes take only the text of a paste or drop.
- Status: accepted (implementer, Phase 03).
- Evidence: `src/renderer/editor/paste.ts`; `tests/unit/renderer/editor/paste-pipeline.test.ts`.

### D-060 Paste size limit, flush before large pastes, linear block IDs (Phase 03 Repair 1, QA-2)
- Context: QA-2 found that pasting 12,000 paragraphs took 34 s (Windows) and a 9.6 MB paste ran the renderer out of memory, losing the typing of the last 400 ms. The quadratic step was UniqueID's per-node pass over the pasted range (one `setNodeMarkup` per block plus a duplicate search per block).
- Decision:
  - Pasted and dropped slices receive fresh block IDs inside `BlockIdGuard.transformPasted`; UniqueID skips paste and drop transactions (`filterTransaction`), and the duplicate repair is one scan of each document. 12,000 pasted paragraphs now take well under a second in the app.
  - The clipboard text or HTML of one paste (or non-file drop) may be at most 8 MiB (8,388,608 characters); a larger paste is refused before ProseMirror parses it, with "This paste is too large (over 8 MB). Paste a smaller part." Nothing is inserted. 8 MB is above the 5 MB note limit, so a paste that a note could still store is never refused for size.
  - From 256 KiB on, the editor first saves pending edits (the controller flush) and then runs the paste, so text typed just before a large paste is acknowledged first.
- Status: accepted (implementer, Phase 03 Repair 1).
- Evidence: `src/renderer/editor/{paste,block-id-guard,extensions}.ts`; `tests/unit/renderer/editor/{paste-scaling,paste-limits}.test.ts`; `tests/e2e/paste.spec.ts › large pastes are linear…`; QA probes `p03-probe-big*.spec.ts`.

### D-061 The editor keeps notes within the save limits (Phase 03 Repair 1, QA-3)
- Context: `normalizeRichDoc` refuses documents deeper than 64 levels or with more than 100,000 nodes (D-053), but the editor accepted such content (a 40-level pasted list), leaving the note unsavable until the paste was undone.
- Decision: a `DocLimits` editor plugin refuses any change that would make the document deeper than 64 levels or larger than 100,000 nodes, counted the way `normalizeRichDoc` counts, with "This would nest lists or quotes more deeply than a note can store. Use fewer levels." or "This would make the note too large to store. Paste or add a smaller part." The check is proportional to the size of each change (the node count is tracked incrementally). Lists can therefore be nested 31 levels deep.
- Also (QA-1): an oversized `note:save` request answers with the UX_SPEC copy "This note is too large to save (over 5 MB). Remove some content to keep editing safely." whether the router's payload ceiling or the writer's content limit trips (`RegisterOptions.tooLargeMessage`), and the note view shows a save error as visible text below the save status, not only as a tooltip.
- Status: accepted (implementer, Phase 03 Repair 1).
- Evidence: `src/renderer/editor/doc-limits.ts`, `src/main/ipc/router.ts`, `src/main/ipc/handlers/note-handlers.ts`, `src/renderer/notes/NoteView.tsx`; `tests/unit/renderer/editor/paste-limits.test.ts`; `tests/integration/ipc-handlers-phase02.test.ts`; `tests/e2e/paste.spec.ts` (QA-1, QA-3 cases).

## Phase 04 decisions

Recorded by the Phase 04 planner on 2026-10-09. The implementation plan is `docs/plans/phase-04.md`; section numbers below refer to it. Probe output is in `.infinity-work/logs/phase-04/planner-probe-*.log`.

### D-062 Migration 004 `window_state`
- Context: D-051 gives 004 to Phase 04. Window state must survive trash and restore, and must disappear with a purged note.
- Decision: `004_window_state.sql` creates `window_state(key PK, note_id NULL REFERENCES notes(id) ON DELETE CASCADE, bounds JSON NULL, display_id INTEGER NULL, open, collapsed, always_on_top, updated_at)` with a CHECK that a sticky key is `'sticky:' || note_id` and that other keys are `main` or `widget` (reserved). A unique index covers `note_id`. `bounds` holds the outer bounds of the expanded window, `{x|null, y|null, width, height}`; `x`/`y` are null where positioning is unsupported. Opening, collapsing, pinning or recoloring never changes `notes.revision` or `notes.updated_at`.
- Consequences: `LATEST = 4`; purge removes window state through the cascade inside its transaction; tests that hard-coded schema version 3 change to 4.
- Status: accepted.
- Evidence: plan section 5.

### D-063 Phase 04 IPC catalogue
- Decision:
  - Invoke: `sticky:float|dock|hide|setColor|setPinned|setCollapsed|remove|restore` and `window:getState`. `removeSticky` from the Phase 00 catalogue is named `sticky:remove`. `sticky:restore` restores the trash batch of the sticky's own note.
  - Events: `sticky:state` (sent only to that sticky window) and `app:openNote` (sent only to the main window; moved from Phase 05 because Dock and Remove from stickies need it; Phase 05 notification clicks reuse it).
  - `note:trashed` (D-052) is not added. The trash state travels inside `sticky:state` (`trashed: {batchId} | null`), so a sticky window has one source of state and the IPC surface stays smaller.
  - `window:getState` is also the main renderer's ready handshake: main queues note opens for a main window that is still loading and returns them in the answer.
  - `tree:changed` gains the reason `sticky` (flag or color change).
- Consequences: ARCHITECTURE section 4 rows 04 and 05 updated; boundary tests now guard Phase 05 names.
- Status: accepted.
- Evidence: plan section 6.

### D-064 Window roles, per-role channel allowlist and note ownership
- Context: sticky windows share the preload and the renderer origin with the main window. Sender validation alone would give every sticky the full surface, including `session:set` and `trash:purge`.
- Decision: the registry records each window's role (`main` or `sticky`, plus the sticky's note ID). The sender policy returns that information. The router refuses with `FORBIDDEN` any channel outside `STICKY_ALLOWED_CHANNELS` (plan section 6.4) for a sticky sender. A sticky's request that has a `noteId` must name its own note. The route hash is never trusted. Main windows keep the full surface. `getAllWindows()` is not in creation order (probe), so code and tests identify windows by registry role or URL.
- Status: accepted.
- Evidence: `planner-probe-windows-*.log`; plan section 6.4.

### D-065 Sticky window lifecycle and edit-control transfer
- Decision:
  - Float validates the note, sets `sticky_enabled = 1` (color `yellow` if none), and opens or focuses the one window for that note ID. Float is an implicit take: `sticky:state.activation` counts explicit activations, and the sticky renderer takes edit control when it starts with `activation > 0` or sees it increase. Stickies restored at startup start at 0 and only acquire.
  - Hide (OS close button, Hide, Ctrl+W, Close window in the trash state) flushes with acknowledgment, saves bounds, sets `open = 0`, resets the window's leases and destroys the window. The note and its sticky flag are unchanged, and reopening creates a fresh window from the stored state. No hidden renderer keeps a lease or memory.
  - Dock runs the hide sequence and then opens the note in the main window with `takeEdit`. Remove from stickies does the same and clears the sticky flag and window state.
  - Trash shows a recoverable trash state with Restore and Close window. Pending edits become a trashed-conflict draft first. Restore brings the editor back. Purge closes the window.
  - A read-only mirror whose reason is `lease` acquires the lease by itself when `note:lease` reports no holder and it is not busy. A `leaseLost` mirror keeps its recovered-draft banner.
  - At most 50 sticky windows are open at once.
- Status: accepted.
- Evidence: plan section 8.5 and 9.5.

### D-066 Main window close, background mode and quit
- Decision:
  - Setting `app.closeBehavior` (`ask` default, `background`, `quit`; public, edited in Settings > Windows and tray).
  - `ask` shows a native message box parented to the main window with the UX_SPEC copy, buttons "Keep running in background", "Quit" and "Cancel", and the checkbox "Remember my choice" (checked by default). On Linux, or wherever the tray is not supported, it adds the relaunch sentence.
  - Background flushes the main window and closes (destroys) it. Stickies and the process keep running. `window-all-closed` no longer quits while storage is available.
  - The second-instance handler, the tray and `app:openNote` recreate the main window when it is missing; session restore brings the tabs back.
  - Quit (menu, tray, sticky menu, or the close choice) flushes every window, keeps `open = 1` for open stickies and exits.
  - `session-end` and `shutdown` mark quitting without a dialog.
  - The E2E dialog seam answers from a queue (empty means Cancel) and records the options.
- Consequences: supersedes the "first close shows a choice dialog" detail of D-027 only by adding Cancel and the default checkbox state. `editor.spec › flush on window close` queues a Quit answer.
- Status: accepted.
- Evidence: plan section 8.7.

### D-067 Tray detection and tray menu
- Context: `new Tray()` succeeds silently on WSLg, which has no StatusNotifier host (probe). An invisible tray would make background mode look supported.
- Decision: Windows always has a tray. Linux checks `NameHasOwner org.kde.StatusNotifierWatcher` on the session bus once at startup, through `gdbus` (fallback `dbus-send`) with `execFile`, no shell, and a 2000 ms bound. The result maps to `supported`, `unsupported` (`no-status-notifier-host`) or `unknown`. A tray is created only when supported. The menu is "Open Infinity Notes", "New sticky" and "Quit Infinity Notes"; "Show widget" arrives with the widget in Phase 05. Left click opens the main window.
- Status: accepted.
- Evidence: `planner-probe-tray-detect-wsl.log`.

### D-068 Bounds persistence and display clamping
- Decision:
  - `move` and `resize` are debounced 500 ms and saved; bounds are also saved at hide, dock and quit. Probe: programmatic bounds changes emit these events on every host.
  - Restore uses the pure `computeStickyBounds`. A window is reachable when its top 36 px strip overlaps a work area by at least 80 px. A reachable window is kept on the best-overlapping display and shifted fully inside it. An unreachable one goes to the hint display if it is still connected, else to the primary display, centered with a 24 px cascade. Size is clamped to 220x120 at minimum and to the work area at maximum.
  - Where positioning is unsupported (Wayland, WSLg), only size, collapse and pin are restored, and `x`/`y` are stored as null. Display changes re-clamp only unreachable open windows.
  - Restored windows are shown inactive, or shown normally under a Wayland session (probe: forced-Wayland `showInactive` stayed invisible).
  - Test seams, only in unpackaged E2E runs: `INFINITY_NOTES_TEST_DISPLAYS` (fake display set with a hook to change it) and `INFINITY_NOTES_TEST_CAPS` (capability override).
- Status: accepted.
- Evidence: `planner-probe-windows-*.log`, `planner-probe-events-*.log`; plan section 8.6.

### D-069 New sticky floats immediately
- Context: a sticky is a note with sticky presentation. Opening a new sticky in a tab (Phase 02 behavior, before windows existed) hides the presentation the user asked for.
- Decision: New sticky (Ctrl+Shift+N, the Home tile, the tree menu, the Stickies page, the palette and the tray) creates the sticky in the current location (D-047) and floats it. No tab opens. `keyboard.spec` and `tree.spec` assert the sticky window instead of the tab, with the same scope, sticky and color checks.
- Status: accepted.
- Evidence: plan section 9.6.

### D-070 Sticky window presentation
- Decision: native OS frame (D-028 kept; no drag regions). The application menu is removed from sticky windows. The 36 px in-content header holds color, title, source badge, pin ("Keep on top", disabled with "Not supported by this desktop" where unsupported), collapse and the actions menu (Open in app, Change color, Hide, Remove from stickies, Move to Trash, Quit Infinity Notes). The same `NoteEditor` uses `variant="sticky"` with a wrapping toolbar. Collapse sets the content height to 36 px and makes the window non-resizable; expand restores the stored size. The window background is the sticky color (light and dark palettes in UX_SPEC section 10). Ctrl+W hides and Ctrl+F finds.
- Status: accepted.
- Evidence: plan section 9.4.

### D-071 Main window ready handshake and note-open queue
- Decision: the main renderer calls `window:getState` once its tabs are initialized. Until then, main queues `app:openNote` requests for that window, de-duplicated by note, at most 50, and returns them in the answer. Afterward it sends `app:openNote` events. A recreated main window starts not ready.
- Status: accepted (Repair 1: the renderer asks once at startup, before it builds its services, and uses the answer as its window identity, see D-072).
- Evidence: plan section 8.7.

### D-072 Closing windows only with safe text; window identity from main (Phase 04 Repair 1, QA-1, QA-2)
- Context: QA-1 showed that Hide, Open in app, Remove and the OS close destroyed a sticky after its last save failed or did not finish within the 2000 ms flush wait, losing the typed text. That breaks D-055 ("a tab or the window is never closed after a failed flush unless main kept a draft"). QA-2 showed that a sticky document whose hash was changed to `#/` rendered the main shell.
- Decision:
  - `app:flush-request` carries a `reason` (`close` or `quit`) and `app:flushed` carries `saved`: true when the text is saved, or main kept it as a draft (`CONFLICT`, `LEASE_REQUIRED`), or the note is gone (`NOT_FOUND`); the same rule the tab uses on Ctrl+W. The flush wait is 5000 ms per window (the renderer's 3 save retries, 1 s apart, plus 2 s), so a save that succeeds on a retry is not cut off; a hung renderer still cannot block quitting.
  - Closing one window (sticky Hide, Open in app, Remove from stickies, the OS close button, and the main window's "Keep running in background") happens only when its renderer answered `saved`. Otherwise the window stays open with its text and shows "Could not save this note. The window stays open."; Open in app opens no tab and Remove keeps the sticky flag. Sticky actions save first in the renderer and stop with the same notice when that fails.
  - Quit: when a window answers that its text is not saved, the first Quit is canceled and that window shows "Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it." A repeated Quit goes ahead (an explicit escape when storage keeps failing). A renderer that does not answer within the wait does not block quitting, and the OS session end never waits (D-066).
  - The renderer takes its window identity from `window:getState` at startup (main's registry), renders the main shell only for the main role and a sticky only for its own note, and shows "This window could not be opened." when the URL hash names anything else.
- Consequences: D-055's 2000 ms close/quit bound becomes 5000 ms per window. The flush log line gains `unsaved=<n>`. Regression: `tests/e2e/save-failure.spec.ts`, `tests/unit/window-lifecycle.test.ts`, `integration/{flush-coordinator,sticky-manager,main-window-controller}.test.ts`, `unit/renderer/{sticky-header.test.tsx,state/app-events,state/sticky-services}`.
- Status: accepted (implementer, Phase 04 Repair 1); the "repeated Quit goes ahead" rule is refined by D-085 (Phase 05, F04-A1): the escape covers only the one Quit that follows a canceled Quit, within 2 minutes.
- Evidence: `docs/progress/phase-04-qa.md` QA-1, QA-2; `docs/progress/phase-04.md` Repair 1.

## Phase 05 decisions

Recorded by the Phase 05 planner on 2026-10-09. The implementation plan is `docs/plans/phase-05.md`; section numbers below refer to it. Probe output is in `.infinity-work/logs/phase-05/planner-probe-*.log`.

### D-073 Migration 005: reminders, occurrences and alert deliveries
- Context: D-051 gives 005 to Phase 05. ARCHITECTURE section 8 lists the fields; the delivery kind `recovery_summary` mixed what an alert is with how it was shown, and a stored `suspended` flag would have to be kept in sync with trash.
- Decision: `005_reminders.sql` creates `reminders`, `occurrences` (UNIQUE `(reminder_id, due_at_utc)`, `alert_sequence` as the next sequence to claim, partial index on `next_alert_at_utc`) and `alert_deliveries` (UNIQUE `(occurrence_id, alert_sequence)`, `kind` initial, followup or snooze, `presentation` single or summary, `reason`, `outcome` claimed, dispatched, failed, unsupported or uncertain, `closed_at`, `clicked_at`). Suspension is derived: every scheduler and view query requires a live note and a live reminder. `enabled` exists (pack data model) and is always 1 in V1. `cancelled` marks only an occurrence that already alerted and was replaced by an edit of a one-time reminder; open occurrences that are not yet due are deleted on a schedule edit (they cannot have deliveries). Purge cascades.
- Consequences: `LATEST = 5`; tests that hard-code 4 change to 5.
- Status: accepted.
- Evidence: plan section 5.

### D-074 Phase 05 IPC catalogue and window roles
- Decision:
  - Invoke: `zones:list`, `reminder:create|update|delete|undoDelete|listForNote|open`, `reminders:listView|summary`, `occurrence:complete|snooze`, `widget:show|hide|setPinned|setCollapsed`, `autostart:get|set` (moved from Phase 08, D-082). `reminder:open` is new: the widget and stickies cannot send `app:openNote`.
  - Events: `reminder:changed` (broadcast), `reminder:alert` (in-app fallback), `widget:state`, `app:openReminders` (main window, queued like note opens). `app:openNote` gains an optional `blockId`. `window:getState` gains the widget variant and, for the main window, `openReminders`.
  - Roles: `main`, `sticky`, `widget`. Stickies add `reminder:listForNote` (router ownership) and `reminder:open` (handler checks the reminder's note). The widget has its own allowlist (plan section 6.4) and cannot read notes or edit reminders.
- Consequences: ARCHITECTURE section 4 updated (67 invoke channels, 12 events); boundary tests guard Phase 06 names.
- Status: accepted.
- Evidence: plan section 6.

### D-075 Scheduler: single timer, claims, batches and recovery
- Decision: one `ReminderScheduler` in main with one timer set to the earliest live `next_alert_at_utc`, capped at 60 s, re-armed after every tick; a tick that made no progress with an overdue minimum backs off from 1 s to 60 s. Each due occurrence is claimed in its own transaction that increments `alert_sequence` and `revision` under `WHERE revision = ?` and inserts the delivery; dispatch happens after the commit and never inside a transaction. Done and Snooze bump the revision without a revision precondition, so the user always wins. Kind: snoozed → `snooze`, first alert → `initial`, else `followup`; `followups_sent` counts only follow-ups and increments at claim. Every tick (not only recovery ticks) applies the batch rule: up to 3 due occurrences get one notification each, more get one summary notification with a claim per occurrence. Stale `claimed` rows at startup become `uncertain` and are never re-sent. A wall-clock delta that differs from the monotonic delta by more than 120 s is a clock jump: forward → recovery batch; backward → reschedule only. Follow-ups missed during downtime, sleep or quiet hours are not replayed; the cadence restarts from the late claim.
- Consequences: storms are bounded in every situation, including a minute with many due reminders. Recovery reasons are recorded on the delivery.
- Status: accepted.
- Evidence: plan section 9.5; integration tests `scheduler`, `scheduler-recovery`.

### D-076 Notification adapter and capability
- Context: probe: on Windows an unpackaged build's toast reaches the notification platform (`show` fires); on Linux without a notification server `Notification.isSupported()` is still true and `show()` emits `failed` synchronously.
- Decision: Electron `Notification` behind `NotificationAdapter`; listeners attached before `show()`; `show` → `dispatched`, `failed` or a throw → `failed`, nothing within 3000 ms → `uncertain`. Linux capability from `NameHasOwner org.freedesktop.Notifications` (same bounded `execFile` mechanism as the tray probe): unsupported → the adapter is not called and the outcome is `unsupported`. Any outcome other than `dispatched` raises the in-app banner and `flashFrame` on the main window. Click opens the source note (summary: Reminders > Overdue); close is recorded and never completes. No actions, toast XML or reply (D-026). E2E uses a fake adapter unless `INFINITY_NOTES_TEST_NOTIFY=real`; the packaged E2E dispatches one real notification.
- Status: accepted.
- Evidence: `planner-probe-notify-win.log`, `planner-probe-notify-wsl.log`.

### D-077 No notification daemon in WSL (Phase 00 F-8, R-02)
- Context: WSLg has no `org.freedesktop.Notifications` owner and no StatusNotifier host (probe). Installing a daemon (apt) changes the user's WSL environment, and no Python or extra npm dependency may provide a test server.
- Decision: nothing is installed. On WSLg the capability is `unsupported('no-notification-server')`, the in-app fallback (banner, Reminders lists, widget, taskbar attention) is the real behavior and is E2E-tested with the real capability. Native Linux toast and click cases are `not_run` for WSLg with the probe as the reason; GNOME notification cases stay `outside_validation_scope` (D-021). The Phase 09 acceptor may revisit this only with user approval.
- Status: accepted.
- Evidence: `planner-probe-notify-wsl.log`; D-039.

### D-078 Series, edits, completion and snooze semantics
- Decision: series generation inserts the latest due instant (if newer than any existing row) and the next future instant with `ON CONFLICT DO NOTHING`; an existing row at an instant (for example completed early) counts as that occurrence; older open occurrences become `missed`; intermediate instants are never created. Done applies to one occurrence (also ahead of time) and keeps one future open occurrence per series. Snooze is allowed only for a due open occurrence; presets 5, 10, 15, 30, 60 minutes are instant arithmetic, "Tomorrow 09:00" is calendar arithmetic in the reminder's zone; snooze replaces the next alert and never moves the series. A schedule edit deletes not-yet-due open occurrences and regenerates; a recurring series' overdue open occurrence follows the explicit choice keep (default) or complete; a one-time reminder's open occurrence is replaced (cancelled when it already alerted). Non-schedule edits keep occurrence rows. The Completed view lists completed and missed occurrences of the last 30 days.
- Status: accepted.
- Evidence: plan sections 8.2 and 9.2.

### D-079 Time zones, resolver and display zone
- Decision: the zone list is `Intl.supportedValuesOf('timeZone')` plus `UTC` plus the computer's zone when ICU lists it under an alias (probe: `Asia/Calcutta`, no `UTC`); zones are validated against this list, not Luxon validity (Luxon accepts `EST` and `CST`). `resolveLocal` uses the two offsets 12 h before and after the naive instant, keeps matching candidates (fold: earlier by default) and binary-searches whole minutes for a gap. The display zone is the computer's zone read on every wake and query; stored reminder zones never change. The default zone for new reminders is the `reminders.defaultZone` setting or the computer's zone, never a hard-coded zone; an unknown zone requires a choice. When the computer's zone is unknown, views disclose that days are shown in UTC. Electron main may only see a live OS zone change after a restart; this is a stated limitation and is tested through the provider seam.
- Status: accepted.
- Evidence: `planner-probe-resolve.log`, `planner-probe-notify-win.log`.

### D-080 Block anchors and reminder chips
- Decision: a reminder may name a block whose ID is in the stored content; otherwise main answers `blockMissing` and the renderer persists the editor's block IDs (a flush) and retries, or offers a note-level reminder when the note is read-only. Anchor state is synchronized inside every content transaction (`ContentIndexer`), so deleting a block sets `block_missing` and restoring it sets `ok`. Chips are ProseMirror widget decorations set by meta-only transactions (never saved, never copied); note-level and anchor-missing reminders show in a chip bar above the editor. Stickies show chips read-only; a chip click there opens the reminder in the main window.
- Status: accepted.
- Evidence: plan sections 8.3 and 9.8.

### D-081 Reminder widget window
- Decision: one optional widget window (`#/widget`, role `widget`), default off, native frame, 300x420 default, minimum 240x160, 36 px header with Keep on top (capability-checked), Collapse and Hide. Hide destroys the window and stores `open = 0` in `window_state` key `widget`; a widget open at Quit is restored at the next start. It reads `reminders:listView` and acts through `occurrence:complete|snooze` and `reminder:open`; it owns no scheduler and answers flush requests at once. The tray gains "Show widget".
- Status: accepted.
- Evidence: plan sections 8.8, 8.9 and 9.9.

### D-082 Launch at login mechanism in Phase 05
- Context: the Phase 05 contract says startup launch is optional; INF-DESK-03 belongs to Phase 08 (Settings completion) and moving its row would break the frozen traceability baseline.
- Decision: Phase 05 implements the mechanism and a Settings switch, default off, packaged builds only. Windows uses login items with the argument `--launched-at-login`; Linux writes `$XDG_CONFIG_HOME/autostart/infinity-notes.desktop`; WSL and development builds report `unsupported`. A launch at login starts in the background when a tray exists, otherwise with the main window. Tests never change the host's login items or autostart folder. INF-DESK-03 stays a Phase 08 row with status `in_progress`; `autostart:get|set` move from the Phase 08 catalogue row to Phase 05.
- Status: accepted.
- Evidence: plan section 8.11.

### D-083 Reminder settings keys
- Decision: public settings `reminders.defaultZone` (null = computer zone), `reminders.followupDefault` (`{enabled:false, intervalMinutes:15, maxFollowups:2}`) and `reminders.quietHours` (`{enabled:false, start:'22:00', end:'07:00', zoneId:null}`, the zone stored explicitly when enabled). Phase 05 adds a Settings > Reminders section with these controls and the statement that reminders are not sent while the app is not running; INF-PREF-02..04 remain Phase 08 rows. End-of-day and date-only defaults arrive with Phase 06.
- Status: accepted.
- Evidence: plan section 7.

### D-084 Reminder test seams
- Decision: under test hooks only, `INFINITY_NOTES_TEST_CLOCK` freezes the reminder subsystem's clock (advance, set and wall-only jump hooks wait for the triggered tick), `INFINITY_NOTES_TEST_ZONE` fixes the computer zone (with a hook to change it), the notification adapter is a fake (shown list, click, close, failure modes) unless `INFINITY_NOTES_TEST_NOTIFY=real`, power events can be emitted, and `INFINITY_NOTES_TEST_CAPS` gains `nativeNotifications` and `launchAtLogin`. Every hook that touches the database resolves on a fresh macrotask (F04-A2), so it never runs inside a statement paused by an inspector interrupt. Packaged builds ignore all of these.
- Status: accepted.
- Evidence: plan section 8.13.

### D-085 Quit escape covers one following Quit (F04-A1)
- Context: D-072 let any Quit after one canceled Quit exit without the warning, for the rest of the run.
- Decision: a canceled Quit arms the escape with a timestamp. The next Quit attempt consumes it: with unsaved text it exits only when the escape was armed within the last 2 minutes, otherwise it is canceled again and re-arms. A Quit whose flush saved everything exits and leaves the escape cleared. The renderer copy is unchanged.
- Status: accepted.
- Evidence: plan section 8.12; `tests/unit/window-lifecycle.test.ts`.

### D-086 Two contract refinements found while building the reminder UI
- Context: the Reminders page and the widget must say "Repeats daily" or "Repeats weekly", but the planned `OccurrenceItem.recurring` boolean cannot tell them apart. The main window must also show "Show widget" or "Hide widget" from its first frame, but a widget restored at startup announces itself with `widget:state` right after the main window's first load, which can reach the renderer before it subscribed, and no channel reads the widget state.
- Decision: `OccurrenceItem.repeat` (`'daily' | 'weekly' | null`) replaces `recurring`. The main window's `window:getState` answer gains `widget: WidgetState` (closed without storage); later changes still arrive as `widget:state`. The catalogue stays at 67 invoke channels and 12 events.
- Status: accepted (implementer, Phase 05).
- Evidence: `tests/unit/contracts-phase05.test.ts`, `tests/integration/ipc-handlers-phase05.test.ts`, `docs/progress/phase-05.md`.

### D-087 Follow-up edits, superseded claims and the summary total (Phase 05 Repair 1)
- Context: Phase 05 QA (QA5-01..04) found that an edit of the follow-up settings left an already pending follow-up in place, that Done or Snooze on a claimed but not yet shown sibling of the same tick did not stop its notification, that more than 500 due alerts produced one summary per 500, and asked how quiet hours without a zone behave.
- Decision: (1) An edit that changes the follow-up interval or maximum re-targets, in the edit's transaction, the next follow-up of every pending occurrence that already alerted: none when follow-ups are off or `followupsSent` reached the new maximum, else last alert plus the new interval (a late one fires at once). Snoozed occurrences keep their snooze alert. Every open occurrence of the reminder takes a new revision, so a claim prepared under the old settings loses. (2) The scheduler re-reads the claimed occurrences right before each notification; one that is no longer pending on a live reminder and note is not shown, and its delivery gets the new outcome `skipped` (detail `superseded-before-dispatch`), which raises no in-app alert and reports no outcome in views. `skipped` is added to the delivery outcome CHECK of migration 005 itself, because Phase 05 is not released (no profile outside development and test data has version 5); its checksum is regenerated. (3) One tick claims every due alert, reading pages of 500 with a cursor, into one batch; the presentation comes from the first page and a summary names the number still current at dispatch. Same-instant alerts go out in creation order (`rowid`). (4) Quiet hours keep D-083: switching them on requires a stored zone; a write without one is refused and a stored value without one reads as the default (off) with a warning. No read-time fallback to the computer zone, so the quiet window never moves with travel.
- Status: accepted (implementer, Phase 05 Repair 1).
- Evidence: `tests/integration/scheduler.test.ts` (follow-up edits, user action while a batch is shown, 1,000 overdue at a resume), `tests/integration/settings.test.ts`, `docs/progress/phase-05.md` Repair 1.
- Clarification (Phase 06 planner, follow-up A05-F1, QA6-01): a claimed follow-up counts toward `followups_sent` whatever its delivery outcome turns out to be: `dispatched`, `failed`, `unsupported`, `uncertain` or `skipped`. The count increments at claim time (D-075) and is never decremented. So a Snooze that supersedes an already claimed follow-up can leave one follow-up fewer than the maximum, never more. This states the existing contract and changes no behavior.

## Phase 06 decisions

Recorded by the Phase 06 planner on 2026-10-09. The implementation plan is `docs/plans/phase-06.md`; section numbers below refer to it. Probe output is in `.infinity-work/logs/phase-06/planner-probe-*.log`.

### D-088 Migration 006: reminder sources and suggestion dismissals
- Context: D-051 gives 006 to Phase 06. Migration 005 is frozen now that Phase 05 is committed (A05-F3). ARCHITECTURE section 3 sketched both tables, but it did not cover plain-text notes (which never store character offsets, section 12), the user's "keep current time" choice, or how the renderer compares dismissals without hashing.
- Decision: `006_reminder_sources.sql` creates:
  - `reminder_sources`: `reminder_id` PK, cascades with the reminder; `note_id`, cascades with the note; `block_id` NULL for plain-text notes; `source_text` 1-500 characters, the literal phrase; `span_start` and `span_end`, block-relative and NULL exactly when `block_id` is NULL; `span_ordinal`, the number of earlier occurrences of the same text in the block, or in the whole text of a plain note; `reference_instant_utc`; `reference_zone`; `parser_version`; `origin` `suggestion|selection`; `source_state` `ok|changed|missing|detached`; `created_at`, `updated_at`.
  - `suggestion_dismissals`: `dedupe_key` PK, 64 hex characters, the SHA-256 that main computes over `["v1", noteId, blockId or "", normalized text, span ordinal, reference date]`; the parts themselves (`block_id`, `span_text`, `span_ordinal`, `reference_date`), so the renderer compares dismissals without hashing; `note_id`, cascades with the note; `created_at`.
  - Migrations 001-005 and their checksums are not touched.
- Consequences: `LATEST = 6`. Tests that hard-code schema version 5 change to 6. A populated version 5 database upgrades with a pre-migration copy.
- Status: accepted.
- Evidence: plan section 5.

### D-089 Phase 06 IPC catalogue and window roles
- Decision:
  - Invoke channels are appended after `autostart:set` in this order: `reminder:createFromSuggestion`, `reminder:updateFromSource`, `suggestion:dismiss`, `suggestion:listDismissed`. That gives 71 invoke channels. No event is added.
  - `suggestion:listDismissed` also answers with main's reference context: `asOf` (the reminder clock), the computer zone and the default zone. Detection then uses main's clock and zone, which the E2E seams of D-084 control, and never the renderer's `Date.now()` or `Intl` zone.
  - `reminder:createFromSuggestion` is idempotent per source. If a live reminder is already linked to the same note, block, normalized text and ordinal, and that link is not detached, main returns that reminder with `existing: true` instead of creating a duplicate.
  - `reminder:updateFromSource` is `{action:'apply', …}` (new schedule and new source, with the revision check and pending policy of `reminder:update`) or `{action:'keep', reminderId}` (the source becomes `detached`, and the schedule is unchanged).
  - `ReminderDto` gains `source` (or null). `reminder:changed {reason:'anchor'}` also announces source-state changes that a content write caused.
  - Sticky windows additionally get `zones:list`, `reminder:create`, `reminder:createFromSuggestion`, `suggestion:dismiss` and `suggestion:listDismissed`. The router's note-ownership rule applies to each of these, so a sticky can confirm suggestions and enter a reminder by hand only for its own note. `reminder:updateFromSource` stays main-only: a sticky offers "Open in app to update" instead. The widget allowlist is unchanged.
  - Boundary tests now guard the Phase 07 names (`refs:list`, `search:query`, `notes:pick`, `attachment:open`, `attachment:showInFolder`, `tags:list`, `tags:set`).
- Consequences: ARCHITECTURE section 4 updated.
- Status: accepted.
- Evidence: plan section 6.

### D-090 NLP adapter rules (refines D-007 and D-025)
- Context: planner probes of chrono-node 2.10.2 (`planner-probe-chrono*.log`) showed:
  - "end of (the) day", "EOD" and "by 5 CST" produce no result.
  - "at 5pm CST" yields a fixed `timezoneOffset`.
  - Bare weekdays with `forwardDate:false` resolve to the past ("Monday" → Oct 5).
  - "Thursday" resolves to today; "tomorrow morning" gets an implied 06:00.
  - "this evening" has no known values.
  - Lowercase "sun", "mon" and "wed" match as weekdays; "in a second" is a 1 s duration.
  - Month-only and "next week" return dates.
  - Parsing a 2,300-character block takes about 0.6 ms.
- Decision:
  - Parsing runs only in renderers, in `src/shared/nlp`, through `chrono-node/en` (`casual`, `forwardDate:false`, the reference instant, and the selected zone's offset at that instant). Main never imports chrono-node and never parses.
  - Before chrono runs, end-of-day phrases and zone abbreviations are masked with spaces, so offsets stay stable. Each result is classified from its known values, its text and its tags into a date intent (absolute, relative days, weekday with modifier, or none) and a time intent (explicit, ambiguous hour, end of day, date-only default, day-part default, or needs a time), or into an instant duration. Anything else is dropped.
  - Rules beyond PRODUCT_SPEC section 6:
    - Durations are minutes and hours only. They are floored to the whole minute, and in a fold they keep the instant through the fold preference.
    - "in N days/weeks" is calendar arithmetic.
    - A time-only phrase means today in the selected zone if that instant is still ahead, otherwise tomorrow.
    - Fixed, disclosed day-part times: morning 09:00, afternoon 15:00, evening 19:00, tonight and night 20:00, noon 12:00. "midnight" requires the user to enter a time.
    - A bare hour 1-12 without am/pm or a day-part needs an am/pm choice. A leading zero ("09:30") or an hour of 13-23 is 24-hour time.
    - Ranges use their start.
    - Weekday abbreviations count only when capitalized, and "may" counts as a month only when it is capitalized "May".
    - "UTC" and "GMT" select the UTC zone without a choice. Other abbreviations need an IANA choice from a suggestion list that is filtered to known zones, aliases included.
    - Unsupported, with no candidate: "now", "next week", "next month", "this weekend", month-only phrases, seconds, and non-English text.
  - A candidate keeps its intents and its reference instant. The confirmation card re-resolves them when the user changes the zone, until the user edits the date or time by hand. `PARSER_VERSION = 1` is stored with each source.
- Consequences: ARCHITECTURE section 10 carries the full rule list. The plan's rules table (section 9.2) is tested row by row in `unit/nlp-parse.test`. "Appendix B" in D-007, D-023 and D-025 means the PRODUCT_SPEC section 6 table (D-095).
- Status: accepted.
- Evidence: `planner-probe-chrono.log`, `planner-probe-chrono-edge.log`, `planner-probe-chrono-en.log`, `planner-probe-dst-zones.log`.

### D-091 Detection policy: edit-triggered, touched spans only, bounded
- Decision:
  - Detection runs in rich and plain editors, in tabs and in stickies.
    - It runs 1000 ms after the last user edit, as counted by `isUserEdit`. Load, reload and ID passes are not edits.
    - It looks only at blocks whose text changed in this editor session, and it keeps only candidates whose span touches changed text.
    - Opening a note, restarting or switching tabs never re-suggests unchanged text, so an old "tomorrow" is never re-read against a new day.
  - Results are applied by a meta-only transaction. It is never added to history, never saved and never dispatched while an IME composition is active. Focus is never taken.
  - Budgets:
    - work runs in slices of at most 8 ms, and any edit aborts the rest of a pass;
    - at most 2,000 changed blocks per pass, and at most 100 live candidates per editor;
    - a single change that inserts more than 64 KiB of text is not scanned automatically;
    - a block longer than 5,000 characters is scanned only within ±300 characters of the changed text.
  - Candidates for a note survive an editor remount within the same window session (in memory, at most 20 notes). They are not persisted.
  - Candidates are suppressed when they match a persisted dismissal, or a live linked source in state `ok`. Code blocks are not scanned automatically.
  - The public setting `reminders.suggestFromText` (default true) turns automatic detection off. "Create reminder from text" in the toolbar More menu always stays available.
- Status: accepted.
- Evidence: plan sections 9.3 and 9.4; probe timings.

### D-092 Source anchors, dedupe and explicit update
- Decision:
  - Source states are kept inside every content transaction by `ReminderAnchors.sync`, together with the Phase 05 block anchors:
    - `ok`: the source block (or, for a plain note, the note text) still contains the source text;
    - `changed`: the block exists but no longer contains the source text;
    - `missing`: the block is gone;
    - `detached`: chosen by the user ("Keep current time"), or set by a Phase 05 re-anchor ("Attach to current paragraph", "Keep note-level"). A detached source is never recomputed.
  - A changed source never moves the reminder. The user chooses Update (re-read the current text, with the reference instant set to now, through the confirmation card) or Keep current time.
  - The dismissal key uses the span ordinal instead of the span start that ARCHITECTURE section 3 had sketched, so edits elsewhere in the block do not revive a dismissed phrase. The reference date is the calendar date of the parse in the parse zone.
  - Dismissals are pruned at startup when their reference date is more than 2 days before today (UTC), and capped at 500 per note (newest kept).
  - Confirmed links are deduped by reminder ID: one source per reminder, plus the idempotent create of D-089.
  - Main checks, in the create transaction, that the stored text at the span equals the source text. A mismatch answers `sourceMismatch`, and the renderer flushes once and retries.
  - Plain-text notes get note-level reminders. Their source has a NULL block and NULL span, and the ordinal over the whole text.
- Status: accepted.
- Evidence: plan sections 5, 8.3 and 8.4.

### D-093 Confirmation card
- Decision:
  - The confirmation card is a modal dialog ("Create reminder" or "Update reminder"), the same in tabs and stickies, built from the Phase 05 reminder form pieces. It shows:
    - the title;
    - the literal source phrase;
    - the reference instant for relative phrases;
    - the date input with the full weekday date;
    - the time with its default disclosure;
    - the IANA zone;
    - the preview with "Your time" and the DST notices and choices;
    - Repeat and Follow up;
    - Add (or Update) and Cancel.
  - Ambiguous date order, am/pm, zone abbreviations and "midnight" have no default: Add stays disabled and shows the missing choice.
  - A past result shows the Phase 05 past notice. A year-omitted past date offers "Use next year". Adding a past reminder needs "Add anyway".
  - Title rule: the source text without the phrase and one adjacent connector word (by, on, at, before, until, till, due), with whitespace collapsed, at most 120 characters. If that is empty, the note title is used.
  - Without a phrase (selected text with no date), the card switches to manual entry and creates an ordinary `reminder:create` reminder, with no source row.
  - Nothing is written before Add. Cancel and Escape write nothing. Dismiss is a separate action in the suggestion bar.
- Status: accepted.
- Evidence: plan section 9.6 and UX_SPEC section 6.

### D-094 Phase 06 settings keys
- Decision: new public settings:
  - `reminders.endOfDayTime` (`HH:mm`, default `17:00`);
  - `reminders.dateOnlyTime` (`HH:mm`, default `09:00`);
  - `reminders.suggestFromText` (boolean, default `true`).

  Settings > Reminders gains the controls and the sentence "Suggestions understand English dates and times only." INF-PREF-02 stays a Phase 08 row (final Settings layout and its E2E). Its planned tests name these keys.
- Status: accepted.
- Evidence: plan section 7.

### D-095 Parsing test contract location (Phase 00 F-7)
- Decision: the parsing test contract is the frozen-clock table in PRODUCT_SPEC section 6, not "Appendix B of the Phase 00 plan" (that plan moves under `docs/development/` at finalization). The references to "Appendix B" in D-007, D-023 and D-025 mean that table. Additional rows are in the Phase 06 plan's rules table and in ARCHITECTURE section 10.
- Status: accepted.
- Evidence: `docs/progress/phase-00-acceptance.md` F-7.

### D-096 Implementation decisions of Phase 06 (implementer)
Recorded by the Phase 06 implementer on 2026-10-09. Each item is a deviation from, or a detail the plan left open in, `docs/plans/phase-06.md`.
- Bundling `chrono-node/en`: TypeScript resolves the subpath typings through the package exports, but Vite's bundled exports resolver reads the package's `./*/*` pattern with an unescaped second `*` and maps `chrono-node/en` to `dist/esm/locales/en/en/index.js`, which does not exist. `aliases.config.ts` maps exactly `chrono-node/en` to the package's own ESM English entry (`dist/esm/locales/en/index.js`, what Node resolves) for the electron-vite renderer build and Vitest. No dependency changes; the root `chrono-node` entry (all locales) is still never imported.
- The `BST` row of the abbreviation table suggests `Asia/Dhaka`; the INF-REM-02 boundary test forbids that literal anywhere in `src`. The test now removes exactly that one table row from `shared/nlp/abbreviations.ts` before scanning, so any other `Asia/Dhaka` literal (a default zone) still fails it. `UTC` is used through the new `UTC_ZONE` constant in `shared/time/zones.ts`, the only file allowed to quote it.
- "Touches a changed range" (plan section 9.3): text written inside a phrase, or a deletion inside it or at its edges. Text typed right after or right before a phrase does not touch it, so continuing to type keeps its underline, and appending to old text does not suggest the old phrase. A detection pass adds its phrases and replaces only the phrases they overlap; untouched phrases of the same block stay.
- Live phrases re-read their block offsets and ordinal from their current positions before a card, a dismissal or the memory uses them (edits earlier in the block move them).
- A phrase in the block of a reminder whose source is `changed` (the whole note for plain-text notes) offers "Update reminder" for that reminder; its text differs from the stored phrase by definition, so it is matched by block, not by text.
- In update mode the card pre-selects the phrase with the source's text, else the one at its ordinal, else the first (`ReminderSourceDto` carries no span).
- The card keeps the "Date order" and "Time of day" groups and the abbreviation buttons after a choice, so a choice can be changed. `Choices` gains `fold` (the "Use the later one" choice) and "Use next year" applies only when that date exists (29 February).
- More → "Create reminder from text" on the paragraph at the cursor (no selection, no phrase at the cursor) stores origin `selection`: the user asked for that text.
- `reminder:updateFromSource {keep}` on a reminder without a source answers VALIDATION_FAILED "This reminder was not created from note text." (UX_SPEC section 6 errors).
- `undoDelete` re-reads the source state from the stored content, as it does the Phase 05 anchor (content may have changed while the reminder was deleted).
- The renderer drift case of `nlp-source-text` lives in `tests/unit/renderer/editor/block-text.test.ts`, because it needs a jsdom Tiptap editor; the JSON side stays in `tests/unit/nlp-source-text.test.ts`.
- Status: accepted (implementer).
- Evidence: `tests/unit/{boundaries,nlp-parse,nlp-source-text}.test.ts`, `tests/unit/renderer/editor/{suggest-detect,block-text}.test.ts`, `tests/unit/renderer/suggestion-card.test.tsx`, `tests/integration/suggestions.test.ts`.

### D-097 Custom title bars (user direction, 2026-10-09)
- Context: the user asked for one custom top bar in the main window (like the FrameCapt reference) instead of the OS title bar plus the app header, and for frameless stickies and widget. This supersedes the native-frame part of D-033 and the "native frame" notes of D-070 and D-081.
- Decision:
  - Main window: `titleBarStyle: 'hidden'` with `titleBarOverlay` (Windows and Linux): the OS still draws minimize, maximize/restore and close (so snapping, double-click and accessibility stay native), over the right end of the app's 44 px bar; their colors follow the theme through `setTitleBarOverlay` on `nativeTheme` updates (the app's theme setting drives `themeSource`). The window has no OS menu: `Menu.setApplicationMenu(null)`, `removeMenu()`; the old File/Edit application menu (`src/main/menu.ts`) is removed (Chromium still handles the editing keys).
  - The header becomes the only title bar: icon and name, the in-app File, View and Help menus over existing commands (theme, panels, widget, quit, new note/sticky, close tab, shortcuts and About dialogs), the centered search box and the panel toggles. It is `-webkit-app-region: drag`; every control is `no-drag`; its right padding uses the Window Controls Overlay variables.
  - Stickies and the widget: `frame: false`; the 36 px header is the drag region; the sticky header gains "Close sticky" (×, the existing hide action); the widget keeps "Hide widget".
  - No new IPC channel: the OS draws the main window's caption buttons, and the sticky and widget close through their existing, role-checked channels (`sticky:hide`, `widget:hide`), so the security surface is unchanged.
- Consequences: INF-SHELL-06 is reworded; UX_SPEC section 2 and 5 updated; the native check of the caption buttons stays in the Phase 09 matrix. Page screenshots do not include the OS-drawn caption buttons.
- Amendment (Phase 07, user-reported defect "the background behind the caption buttons does not match the bar"): OS screen captures (`.infinity-work/logs/phase-07/titlebar/`) showed the fill colours already equal (#ffffff / #17181d) in every theme and after live switches, but the 44 px overlay covered the bar's 1 px bottom border, so the separator line (#e4e6ee / #30333d) stopped at the buttons and the caption area read as a different block. The design tokens moved to `src/shared/theme/tokens.css` (single source; new token `--header-border: 1px`); main reads them as raw text (`themeTokens`), so the overlay is `color: --bg`, `symbolColor: --text`, `height: --header-h - --header-border` (43 px) and the border runs under the buttons. The main window records each applied overlay for tests (`titleBarOverlay` in the test hooks). A first probe that seemed to show a light bar under a dark overlay in "system" mode was Playwright's default `prefers-color-scheme: light` emulation, not an app defect (re-run with `colorScheme: null`).
- Status: accepted (user direction via the coordinator).
- Evidence: `tests/unit/{main,sticky,widget}-window-options.test.ts`, `tests/unit/renderer/sticky-header.test.tsx`, `tests/e2e/titlebar.spec.ts`, `.infinity-work/logs/phase-06/titlebar-targeted-*.log`; amendment: `tests/unit/{main-window-options,theme-tokens}.test.ts`, `titlebar.spec › the caption-button overlay matches the bar…`, `.infinity-work/logs/phase-07/titlebar/{before*,after-scale*}.json|png`.

### D-098 Phase 07 references, search, tags and file hand-off (implementer, fast mode)
- Context: Phase 07 runs in fast mode (no separate planner); this records the contract choices of the implementation. D-051 gives migration 007 to Phase 07.
- Decision:
  - Migration `007_references_tags.sql`: `note_references` (source cascades with its note; the target is not a foreign key so a reference survives the target's purge; unique per source block and target; a `BEFORE DELETE ON notes` trigger copies the purged title into `target_title_snapshot`), `tags` (1-32 characters, unique) and `note_tags` (cascades with note and tag). Migrations 001-006 are untouched.
  - Rich documents gain an inline atom `noteRef {noteId, blockId|null, label, excerpt|null}` (no marks). `normalizeRichDoc` drops a block ID that already appeared earlier in the same document, so a pasted or duplicated block can never alias another block (INF-REF-07). Plain-text notes hold no references; they are note-level targets only.
  - `ContentIndexer` rewrites the source note's `note_references` rows in the same transaction as the content, plain text, FTS row and attachment links. The plain text contains a reference's label.
  - Seven invoke channels are appended after `suggestion:listDismissed`: `refs:list {noteId}` (outgoing with state `ok|blockMissing|trashed|missing`, trash batch and block text; backlinks from live notes with their block text), `notes:pick {noteId, query}` (a note's textblocks for the picker; notes are found with `palette:searchTitles`), `search:query {query, scope?, tags?, limit<=50}`, `tags:list {noteId?}`, `tags:set {noteId, tags<=20}`, `attachment:open` and `attachment:showInFolder {noteId, attachmentId}`. 78 invoke channels, no new event. Stickies additionally get the two attachment channels, under the router's note-ownership rule.
  - Search: FTS5 prefix query per word (each word quoted, so FTS operators are never interpreted), title hits weighted 10:1 (bm25), titles-only substring match for 1-2 characters, scope and all-of tag filters, a tag alone lists its notes. Highlights come back as `{text, hit}` segments split on control-character markers in main; the renderer renders text nodes and `<mark>` only.
  - Hand-off: the note must link the attachment, the path comes from the stored row and must resolve (real path, no symbolic link) inside `attachments/`; only known document types and the app's image types are opened (`shell.openPath`); any other type, executables included, is refused with "This kind of file is not opened from Infinity Notes. Use Show in folder."; Show in folder only selects the file.
  - UI: More "Link to note…" and the palette action open a two-step picker (note by title, then Whole note or a paragraph). Chips show the target's live title from the tree; a non-live target keeps its inserted label, dashed and struck through, and opens the note's own Trash or missing state (with Restore and Search). The Details panel gains Outgoing references and Backlinks sections, tags in Info, and a docked close control. The palette shows Pinned and Favorites before typing, full-text results with highlighted snippets, and Filters (scope and tag) behind a toggle.
- Consequences: `LATEST = 7`; boundary tests now check the Phase 07 channels instead of their absence. Search p95 at 10,000 notes is measured in `integration/search.test` (recorded in docs/progress/phase-07.md; the release target is checked in Phase 09).
- Status: accepted (implementer; reviewed at acceptance).
- Evidence: docs/progress/phase-07.md.

### D-099 Phase 08 backup, export/import, retention, preferences and accessibility (implementer, fast mode)
- Decision (archives): `yazl` 3.3.1 and `yauzl` 3.4.0 (pinned in the dependency table) write and read zips in main only (`src/main/portability/`). Every read goes through one preflight (`openArchive`): relative NFC forward-slash names only (no absolute, drive-letter, backslash, NUL, `.` or `..` segments; yauzl `strictFileNames`), no symlink attributes, no encryption, stored or deflate only, at most 200,000 entries, at most 4 GiB declared in total (yauzl enforces declared sizes), compression ratio at most 100 for entries over 1 MiB. Backups store the database and attachments uncompressed, so a genuine backup never trips the ratio guard; JSON is deflated.
- Decision (backup and restore): the backup database is a `db.backup()` snapshot switched to rollback-journal mode inside the archive; the manifest (`formatVersion` 1) lists the database and every attachment file with SHA-256 and size, plus `missing` rows whose file was already gone. Restore is two-step: `backup:prepareRestore` (dialog, preflight, extraction to `data/restore-staging/`, hash check, read-only `integrity_check`, schema at most the app's, attachment rows covered by the manifest) and `backup:restore` (after the in-app confirmation: marker `data/restore-pending.json`, then `app.relaunch()` and quit with the usual flush). At the next start, before the database opens, `openWithPendingRestore` re-verifies the staging, records the swap in the marker, moves live data to `data/rollback-<stamp>/`, moves staging in and opens it (older schemas migrate forward). Any failure, a failed open, or a swap interrupted by a crash moves the rollback copy back and the app starts on the previous data with "The backup could not be restored. Your data was not changed." Under the E2E hooks the restart only quits (no detached relaunch) and the test starts the app again.
- Decision (portable export/import): `*.infinityexport` holds `data.json` (live projects, folders, notes with content, tags, sticky/color/pin/favorite, reminders that still remind, attachments) and the attachment files; references travel inside rich content. Import remaps every project, folder, note, block and attachment ID (identical bytes reuse the stored attachment), rewrites `noteRef` targets (a target outside the archive gets a fresh ID and shows as missing, never aliasing a local note), image and file nodes and reminder blocks. Projects arrive as new projects and Common items in a new Common folder "Imported <date time>"; the database part is one transaction. Reminders in a zone this computer does not know are skipped and counted.
- Decision (Markdown and plain text): one note at a time from the File menu or the palette; images and files are copied to "<name> files/" beside the `.md`. Lossy: block IDs, reminders, tags, sticky state and colors, image size presets and underline are dropped; references become their label.
- Decision (automatic backup): internal setting `backup.auto` `{enabled: false, directory: null, intervalDays 1|7|14|30 (7), keep 3|5|10|20 (5)}`; the folder only comes from main's folder dialog; files are named `Infinity Notes auto YYYY-MM-DD HHmmss.infinitybackup` and only those are pruned; a failure is recorded in `backup.lastAuto` and retried after an hour. The check runs hourly while the app runs and maintenance every six hours, both first 30 s after start.
- Decision (retention, F-03-4): public settings `retention.trashDays` (null = never, 30, 90), `retention.autoVersionDays` (1-365, default 30), `retention.autoVersionMax` (10-1000, default 100). Open `lease_lost` drafts are capped at 20 per note (older ones resolved, at save time and in maintenance); resolved drafts are deleted after 30 days. Attachment GC counts links of live and trashed notes, version `attachment_ids` and open drafts as references, deletes rows in one transaction after 7 days unreferenced and the files after the commit, and waits while a portability operation runs.
- Decision (preferences and keyboard): Settings sections General, Appearance, Notes and attachments, Reminders, Windows and tray, Backup and Keyboard, each a labelled region. Global quick-sticky shortcut: internal `shortcut.quickSticky` `{enabled: false, accelerator}` with presets Ctrl+Alt+N, Ctrl+Shift+Alt+N and Ctrl+Alt+Space, written through `shortcut:setGlobal`, which registers first and stores "off" when the OS refuses; capability `globalShortcut` is supported on Windows and X11 and unsupported on Wayland and WSLg. Ctrl+/ opens keyboard help (App, Notes tree, Editor, Sticky windows). Oversize messages now end "Change the limit in Settings or use a smaller image/file." (D-054).
- Decision (accessibility): new tokens `--border-strong` (#80869A / #70758A) for input, button and switch outlines and `--on-accent` (#FFFFFF / #17181D); light `--accent-soft` is #F5F4FE. `tests/unit/contrast.test.ts` checks every text pair at 4.5:1 and control boundaries at 3:1 in both themes. One global reduced-motion rule (`*, *::before, *::after`) also disables smooth scrolling, and scripted tab scrolling follows it.
- IPC (appended, 90 invoke channels, main window only): `backup:create|prepareRestore|restore|status|setAuto|chooseAutoFolder|deleteRollback`, `export:markdown|portable`, `import:portable`, `shortcut:getGlobal|setGlobal`. No migration (008 stays unused).
- Status: accepted by the implementer for Phase 08 acceptance. Evidence: `docs/progress/phase-08.md`.

### D-100 Phase 09 release hardening and defect closure (implementer, fast mode)
- Decision (fuses, F-01-6, INF-SEC-02): `electron-builder.json` `electronFuses`: `runAsNode` off, `enableNodeOptionsEnvironmentVariable` off, `onlyLoadAppFromAsar` on, `enableEmbeddedAsarIntegrityValidation` on (validated on Windows; Electron does not validate on Linux), `grantFileProtocolExtraPrivileges` off. `enableNodeCliInspectArguments` stays on because Playwright drives the packaged app through `--inspect=0`; turning it off would make `test:e2e:packaged` and the installed-build checks impossible. A distribution build may turn it off after those checks (docs/RELEASE_CHECKLIST.md). Cookie encryption stays off: the app stores no cookies, and on Linux it would ask the keyring.
- Decision (Linux identity, F-01-6, F04-A3): `package.json` `desktopName` is `infinity-notes.desktop` and `linux.syncDesktopName` is true, so the installed `.desktop` file, `StartupWMClass`, the Wayland `app_id` and the launch-at-login entry share one name.
- Decision (renderer bundle, F-01-5): the renderer is minified with esbuild (2.60 MB to 1.16 MB); no code splitting.
- Decision (A08-F1): an `EditorHandle` per note view replaces the editor ref. Enter in the title focuses the editor synchronously (Tiptap's `focus` command waits for an animation frame, so keys typed right after Enter reached the title); a request made before the editor exists or is editable is applied once it is, unless the focus has meanwhile left the title.
- Decision (A08-F2): without a restore marker, startup removes `data/restore-staging/` before the database opens.
- Decision (F-03-1): blocks with a run of more than 4,096 characters without whitespace get `word-break: break-all` through a node decoration (`long-runs.ts`); only changed blocks are re-checked. The text is never changed. Measured: a 256K Bangla run becomes responsive about 0.2 s after the paste (was 3,370 ms) and reopens in under 50 ms (docs/FINAL_REPORT.md).
- Decision (F-03-2): `doc-limits` measures each transaction's change once (a WeakMap shared by the filter and the state update) and walks only up to the changed range (`nodesBetween`); the limits are injectable for tests. Typing latency at 20,000 paragraphs did not change measurably (p95 27.0 ms before, 26.9 ms after): this cost was not the dominant one.
- Decision (A05-F2): the Electron notification adapter keeps a notification referenced until it is clicked (bounded at 50, oldest dropped); a `close` (Windows raises it when a toast times out into Action Center) no longer drops it. Clicks after an app restart remain out of scope (no COM activator).
- Decision (CL-F1): the E2E sandbox verdict accepts the SUID sandbox (own PID namespace, `Seccomp: 2`, root-owned setuid `chrome-sandbox` beside the executable) in addition to the user-namespace sandbox, and records the mode; `--no-sandbox` (shared namespaces) still fails.
- Decision (F-03-3): `@tiptap/extension-image` removed (the app's own `ManagedImage` node is used).
- Status: accepted by the implementer for Phase 09 acceptance. Evidence: `docs/progress/phase-09.md`, `docs/FINAL_REPORT.md`.

### D-101 Phase 09 Repair 1: native Windows findings (implementer, fast mode)
- Decision (N-D1, N-D3): `windowsNotificationIdentity(isPackaged)` in `src/shared/app-identity.ts`. Packaged builds use AppUserModelID `com.infinitynotes.desktop` and the pinned toast activator CLSID `{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}` (the one the installed build already used). Unpackaged runs use `com.infinitynotes.desktop.dev` and `{998F6E0F-58F6-4AC2-950E-A82981DA57C4}`. Main sets both with `app.setAppUserModelId` and `app.setToastActivatorCLSID` before any window. Without a pinned CLSID, Electron registered a new random activator on every run.
- Decision (N-D3): `resources/installer.nsh` (electron-builder `nsis.include`) defines `customUnInstall`. It deletes only `HKCU\Software\Classes\CLSID\{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}`, and not during an update. Stale `Electron.lnk` and activator keys from earlier development runs are documented for manual removal (RELEASE_CHECKLIST section 6); no tool deletes them.
- Decision (N-D2): reminder chip decorations follow block IDs through edits. On a document change, the chips and the reveal highlight of every block the change touches are rebuilt from the block IDs, and the rest are mapped. Before, mapping alone carried a chip into the paragraph created by Enter at its position, and a block inserted there could delete it.
- Status: accepted by the implementer for Phase 09 Repair 1. Evidence: `docs/progress/phase-09.md` (Repair 1).

### D-102 Simplified note view: the tab is the title, floating formatting, closed Details panel, draggable sticky header (user request, 2026-10-09)
- Context: the user asked for a "super simple" note view: no extra rows around the text, formatting only on demand, the Details panel as a drawer, the tab as the note's title, and a sticky header that drags everywhere except its small controls (native observation N-O2: the sticky title field covered most of the header and did not drag).
- Decision (note view): the main window's note area is only the text. Removed: the title field, the path line, the persistent save line, the toolbar row and its More menu, and the header's Float button. The save state stays a `role="status"` element read by screen readers; it is visible only as a small "Not saved" pill when a save failed or is retrying, with the reason (for example too large) below it. Conflict, recovered-draft, conversion, lease and Trash banners, the title error and the note-level reminder chip bar are unchanged.
- Decision (the tab is the title): a note tab's label is its title. A new note's tab opens in rename mode (the existing `noteTitle` focus request now starts the tab rename once the note is open and editable), double-click or F2 on a note tab renames it. The field ("Title") overlays the tab label, so the tab stays in the tab list. Typing renames as it goes through the note controller (debounced; flushed on Enter, blur and tab close), so tree renames and Ctrl+W keep their behavior and external renames never replace typed text. Enter moves into the text synchronously through one `EditorHandle` for the active note tab (A08-F1 kept); Escape puts the title back and returns the focus to the tab. Read-only notes are not renamed. Tree F2 and other renames are unchanged.
- Decision (formatting): rich notes get a floating "Formatting" toolbar (own component; Tiptap's BubbleMenu is an optional transitive package and appends to the editor's parent, so it was not used). It shows above a non-empty selection (below when the visible area has no room), with the link actions while the cursor is in a link and "Image size" for a selected image. Alt+F10 shows it at the cursor and moves the focus into it; Left/Right move between buttons, Escape returns to the text. It lives inside the scrolling text area, so it scrolls with the text. Pointer presses keep the focus and selection in the text, except on the image size radios.
- Decision (insert and note actions): "/" at the start of a line or after a space (never inside a word, in code blocks or with a selection; queries are up to 20 letters, digits or combining marks) opens the "Insert" list filtered with the palette's matcher (now generic with keywords). The note menu (right-click or Shift+F10, also on read-only text, which is now keyboard-focusable) holds Insert image, Attach file, Link to note…, Add reminder…, Create reminder from text, Find in note, Convert, Version history… and, in tabs, Float as sticky. The palette, Ctrl+F and the editor shortcuts are unchanged. After a note link is picked the focus moves into the text synchronously, so keys typed right away are not lost.
- Decision (Details panel): `layout.panelOpen` defaults to false (contract and renderer fallback); the panel opens with the existing title-bar toggle, View menu or Ctrl+Shift+\, docked from 1180 px and as an overlay drawer below, and the choice is still persisted. The D-097 title bar is unchanged.
- Decision (sticky header, N-O2; revised by the user's final fix): the title is edited in place in the sticky: a no-drag `Title` field as wide as its text (`field-sizing: content`, at most 60% of the header), so the gaps, the empty space before × and the source badge stay `-webkit-app-region: drag`; the color, pin, collapse, actions and × buttons are the other no-drag islands. A click puts the caret in the title; Enter or a click elsewhere saves (Enter moves into the text), Escape puts back the title it had when the editing started. F2 in the sticky and "Rename" in its actions menu select the title (the menu's rename waits until the menu has returned the focus). Double-clicking a drag region is never used: Windows maximizes the window on it. Stickies get the same floating formatting, "/" list and note menu as tabs (without Float).
- Consequences: `NoteTitleInput` and the toolbar component are replaced by `NoteTitleField` (tab rename and sticky title), `FormatBubble`, `Floating`, `useSlashMenu` and `note-actions`. E2E helpers open formatting with Alt+F10, menus with Shift+F10 and renames with F2 on the tab; `setContentSize` waits for the resize to reach the layout. Keyboard help lists Alt+F10, "/", Shift+F10 and F2.
- Status: implemented on the user's request; targeted checks only (docs/progress/simplify-note-view.md).

### D-103 Live sync of one note between its views; supersedes the lease (user request, 2026-10-09)
- Context: the user asked that the main tab and the sticky of a note (and any other view of it) be editable at the same time, each showing the other's edits live. The single-writer lease of D-018, D-042, D-055 and D-065 (one editing view, read-only mirrors with "Take edit control", release requests, `lease_lost` drafts) did the opposite.
- Decision (protocol): ProseMirror collab with main as the central authority. `prosemirror-collab` 1.3.1 (pinned; `@tiptap/pm` 3.31 has no collab entry; it shares `@tiptap/pm`'s `prosemirror-state`) runs in every editor. Main's `CollabHub` keeps one session per open note: the authoritative document in the shared schema (`src/shared/editor/schema.ts` builds it with Tiptap's `getSchema` from the same StarterKit options and node definitions the editor extends, `src/shared/editor/nodes.ts`), a version, the recent steps (2000) and an epoch. `collab:join` returns a snapshot; `collab:push {epoch, version, steps}` is applied in order (`Step.fromJSON` against the schema, then `step.apply`; a step that does not apply is refused with VALIDATION_FAILED) only at the current version, else `behind` (the view rebases and pushes again) or `reset` (the session started over); confirmed steps go to every view of the note as `collab:steps` (the sender's own confirm them); `collab:pull` fills a gap; `collab:leave` and the window going away end a view.
- Decision (saving): main saves the authoritative document through the existing transactional path (revision, FTS, references, attachment links, automatic versions, block-ID normalization, the 5 MB limit and sanitization in `normalizeRichDoc`) 400 ms after the last accepted step, at once on `collab:flush` (blur, tab switch and close, window close and quit through the flush coordinator, before content operations), when the last view leaves, and for every session on quit. With `force` the flush also stores the block IDs a session gave the note, which an anchored reminder needs. INTERNAL failures are retried 3 times 1 s apart; `collab:status` tells every view saved (with the version saved), retrying or failed (the message, for example over 5 MB), so the save indicator is the same in all views. The authoritative document may grow past 5 MB (saving then fails visibly; deleting or undoing makes it savable again) but not past 4 × 5 MB.
- Decision (opening never saves): when a session opens, main gives rich blocks their missing IDs and adds the closing paragraph (what UniqueID and TrailingNode would do in each editor), so no view creates steps on open; that alone is not saved (D-055), only with an edit or a forced flush. Steps from another view are marked remote: UniqueID, the size and depth filter, the suggestion detector and the edit marking ignore them.
- Decision (plain text): the same steps on the plain-text editor schema; main stores the text (`docToText`). Both formats travel as editor documents.
- Decision (conflicts kept): any write from outside the session (`note:save` by another writer, a conversion, a version or draft restore, an external writer under the test hooks) starts the session over with a new epoch (`collab:reset`); edits main had not saved are stored first as a `conflict` draft and named in the reset, so the conflict banner offers Compare, Restore draft and Dismiss as before. A view whose steps were never confirmed keeps them by sending its whole text as `note:save` on its old revision, which stores a `conflict` draft. Saving into a note trashed meanwhile stores a trashed `conflict` draft (F-02-1). Content operations save the session first (`settle`) and keep their base-revision check. The D-072 close safety is unchanged: a view answers the flush request only after its steps are confirmed and main saved, and a refused save keeps the window open.
- Decision (removed): `LeaseManager`, `lease:acquire|release|take`, `note:lease`, `lease:release-request`, the `leaseToken` field of `note:save` and content operations, the `LEASE_REQUIRED` error code, the read-only lease banner, "Take edit control", `ensureEditing` and the `takeEdit` flag of note opens (Float and Dock no longer transfer anything). `note_drafts.reason` keeps `lease_lost` for drafts written by earlier versions; maintenance still caps and prunes them.
- Decision (IPC): five invoke channels appended (`collab:join|push|pull|flush|leave`, 92 in all; push allows 15 MiB for a large paste), three events (`collab:steps|reset|status`) sent only to the windows of a note's views. Every request is Zod-validated and role-checked; a view is bound to the window it joined from (FORBIDDEN otherwise); a sticky may sync only its own note (router ownership rule).
- Supersedes: the lease parts of D-018, D-042, D-055 and D-065 (lease, take, release request, lease-lost drafts, read-only mirrors). Their revision, conflict-draft, flush and close-safety parts stay. The requirement rows INF-SAVE-04 ("main-managed editing lease") and INF-STKY-07 ("lease transfer between tab and sticky") keep their pack wording; they are now met by main-managed live sync, in which no view is read-only and no acknowledged text is lost (tests: integration `collab.test`, E2E `live-sync.spec` and `stickies.spec` › tab and sticky edit together).
- Tests: integration `collab.test` (interleaved edits of two clients converge with the authority and the stored note equals it; plain text; opening never saves; external writes keep a draft; refused steps; trash; last view leaving); unit `note-controller.test` (two views, rebase, reset with unsynced edits, status); E2E `live-sync.spec` (tab to sticky, sticky to tab, simultaneous typing converging in both views and the database, closing the sticky right after typing). Deleted with the behavior they covered: `tests/integration/lease.test.ts`; the E2E tests "read-only mirror and take control", "take from a busy holder", "silent holder times out", "a mirror becomes editable when the editing sticky closes"; unit tests of leases, take edit control, release requests, lease events and `takeEdit` opens.
- Status: implemented on the user's request; targeted checks only (docs/progress/simplify-note-view.md, Final fix).

## v0.2.0 decisions (user request, 2026-10-10; Run A)

### D-104 The note text fills the pane
- Context: the note view was a centered 760 px column, so a wide window had an empty area left of the text and the scrollbar floated beside the text in the middle of the pane (`.infinity-work/refs/note-view-current.png`).
- Decision: `.note-view` has no maximum width and no side padding; the scrolling area (`.note-editor-scroll`) is the whole pane, so its scrollbar is at the pane's right edge. The text, the find bar, the banners, the save pill and the reminder chip bar share one side padding (`--note-pad-x`, 32 px), and lines use the width up to the scrollbar (no maximum line length). The floating toolbar, the "/" list and the reminder chips stay inside the scrolling surface (D-102) and are placed against it as before. Stickies keep their own padding.
- Supersedes: the "content max width 760 px" row of UX_SPEC section 2.
- Status: implemented. Evidence: E2E `rich-formatting.spec` › the note text fills the pane (pane-edge and text-start geometry, toolbar inside the pane).

### D-105 Tables in rich notes
- Decision (schema): `@tiptap/extension-table` 3.31.4 (pinned like every Tiptap package) adds `table > tableRow > (tableCell | tableHeader) > block+` to the shared schema (`src/shared/editor/tables.ts`), so main's live-sync authority and every editor use the same nodes (D-103). `normalizeRichDoc` accepts them anywhere a block may stand (also inside cells, lists and quotes, as the editor allows) with validated cell attributes: `colspan` and `rowspan` 1-1000, `colwidth` (one width of 1-10,000 px per spanned column, else null) and `align` (left, center, right, else null); anything else falls back to the default. Columns resize by dragging (prosemirror-tables' column resizing, widths in `colwidth`); Tab and Shift+Tab move between cells and Tab in the last cell adds a row.
- Decision (block IDs): `table` is in `BLOCK_ID_TYPES` like the other containers; rows and cells have no ID; the paragraphs in cells keep theirs, so a reminder or a reference can target a cell's text and the reference picker lists it. Pasted tables get fresh IDs through the existing BlockIdGuard.
- Decision (UI): "Table" in the "/" list and "Insert table…" in the note menu open the "Insert table" dialog (Rows 1-100, Columns 1-20, Header row; 3 x 3 with a header row to start). Inside a table, the note menu (right-click, Shift+F10) starts with the table actions and the formatting toolbar gains a "Table" menu: Add row above/below, Add column left/right, Delete row, Delete column, Add/Remove header row, Delete table. The dialog is closed synchronously before the table is inserted, because a modal dialog keeps the focus out of the text and keys typed right after Insert must reach the first cell.
- Decision (text): plain text (search index, previews, Compare, rich-to-plain conversion) reads a table as one line per row with tab-separated cells (`src/shared/text/table-text.ts`), so cell text is searchable. Markdown export writes a GFM table: the first row is the header row (Markdown needs one), alignment from the header cells, inline marks kept, `|` escaped, several blocks of a cell joined with `<br>`, a column span followed by empty cells; row spans and widths are dropped.
- Decision (clipboard): a copy that holds a table or cells of one also puts tab-separated text on the clipboard (`clipboardTextSerializer`; the HTML is ProseMirror's table). Pasted HTML tables (spreadsheets, web pages) go through the sanitizer, which now keeps `colspan`, `rowspan`, `width`, `align` and `colwidth` values (DOMPurify drops every attribute value that does not match the URL allowlist unless it is listed as URI-safe). Tab-separated text without HTML becomes a table when it has at least two rows and two columns, every row has the same number of cells and no column is entirely empty (so tab-indented lines stay text); quoted fields may hold tabs and line breaks. Never in code blocks or plain-text notes, and not for "paste as plain text" except a deferred large paste, which ProseMirror always marks as plain.
- Status: implemented. Evidence: unit `renderer/editor/tables.test`, `table-text.test`, `doc-schema.test`, `plain-text.test`, `markdown.test`, `renderer/editor/doc-drift.test`, `renderer/editor/sanitize.test`; integration `collab.test` (steps with a table and formatting converge and save; cell text found by search); E2E `rich-formatting.spec` › tables.

### D-106 Font, size, text color and highlight
- Decision (values): `@tiptap/extension-text-style` 3.31.4: the `textStyle` mark with `Color`, `BackgroundColor` (the highlight), `FontFamily` and `FontSize`, whose commands are kept while their attributes are replaced by validated ones (`src/shared/editor/text-style.ts`, `formatting.ts`). Stored values: colors only as lowercase `#rrggbb` (`#rgb` and `rgb(r, g, b)` input is converted; names, alpha and anything else are refused), fonts only as keys of a short list (Serif, Monospace, Arial, Times New Roman, Courier New, Georgia, Verdana; each renders as a stack that names the font, then Linux look-alikes such as Liberation and DejaVu, then a generic family; Default is no font), sizes only 12, 14, 16, 18, 20, 24, 28 and 32 px (Default is the 15 px body; pasted points that equal a listed size, such as 12pt, are converted). A span becomes the mark only when it carries a valid value; a mark with no valid value left is dropped. The same checks run in the editor's parse and render rules, the paste sanitizer (which rewrites every inline style to these declarations only, and `text-align` on cells) and `normalizeRichDoc` in main, so no other CSS can reach a stored document.
- Decision (readability): the stored color is shown as stored in both themes. The nine text color presets are mid-tones with at least 3:1 on both the light and the dark editor background (the most any one color can reach on both is about 4.2:1); "Default" removes the color, so the text follows the theme. Highlighted text without its own color gets black or white ink from the highlight's luminance (`data-ink`; black or white reach at least 4.58:1 on any color). Pasted documents set black or white text and white highlights on all of their text; a paste drops exactly those (they would vanish in the other theme), while choosing them in the app keeps them.
- Decision (UI): the formatting toolbar gains Font and Font size menus and Text color and Highlight popovers (preset swatches as a radio group, Default or None, and a custom color from the system color dialog or a hex field; Enter applies, a wrong value says "Enter a color as #rrggbb, for example #3366ff."). An open color popover keeps the toolbar up while the system color dialog has the focus. The same toolbar works in stickies.
- Decision (lossy): Markdown export and rich-to-plain conversion drop fonts, sizes and colors; the conversion warning now names colors and tables.
- Status: implemented. Evidence: unit `formatting.test` (values, contrast of the presets and of the ink on a grid of all colors), `renderer/editor/text-style.test`, `sanitize.test`, `doc-schema.test`; E2E `rich-formatting.spec` › formatting persisted after a restart.

### D-107 Sticky colors, text color and header
- Context: the sticky header's title and project label were not on one line and the label could push the title; the sticky color menu had only six presets; sticky text could not be colored (`.infinity-work/refs/sticky-header-current.png`). In that screenshot the outer 3-4 px around the window are not part of the page (pixel samples show the olive sticky color up to the window edge and a red-brown desktop and frame shadow outside it); the window background did, however, stay at its first color after a theme change, which showed while resizing.
- Decision (header): the title field and the project label sit in one flex group, vertically centered on the header line, 6 px apart; the label shrinks first (`flex-shrink` 1000) and ends with an ellipsis with the whole path as tooltip; the title ends with an ellipsis only when even it does not fit. The drag regions of D-102 are unchanged.
- Decision (colors): `notes.color` (unconstrained TEXT since migration 001) holds a preset name or a custom `#rrggbb`; `NoteColor` is the union of `StickyColorPreset` and `HexColor`, validated with Zod on `sticky:setColor`, in `StickyState` and in portable exports. A new nullable `notes.text_color` (migration 008, `CHECK` lowercase `#rrggbb`) is the sticky's default text color; null is Automatic. The new invoke channel `sticky:setTextColor {noteId, textColor | null}` (appended, 93 invoke channels) is in the sticky allowlist under the own-note rule. Portable exports carry `textColor` (optional, so 0.1 exports still import).
- Decision (painting): the renderer sets the sticky's colors on the page root (`sticky-appearance.ts`), so html, body and the sticky all show the sticky color: a preset by name (its light or dark variant comes from CSS), a custom color inline with black or white ink chosen from its luminance (at least 4.58:1), and a default text color replacing the ink. The header, the title, the source badge, the placeholder, code and quotes use the sticky ink instead of the theme's tints; menus and popovers keep the theme colors. Main sets the window background on every color change and, for every open sticky, when the theme changes (`nativeTheme` "updated"), so the native background matches the page during resizes.
- Decision (UI): the "Sticky color" popover (button and actions menu "Change color") has two radio groups with custom fields: "Sticky color" (the six presets in the current theme's variant, or a custom color) and "Text color" (Automatic, Black, White and the nine text presets, or a custom color). A choice applies at once and the popover stays open; Escape or a click outside closes it. Selected text in a sticky gets its own color from the formatting toolbar (D-106). Lists, tabs and the tree show a custom color's dot as the color itself.
- Status: implemented. Evidence: unit `sticky-colors.test`, `renderer/sticky-header.test`, `renderer/sticky-appearance.test`, `contracts*.test`; integration `sticky-manager.test` (custom color, theme change, text color), `ipc-handlers-phase04.test` (validation and ownership), `migrations.test` (migration 008), `ipc-validation.test`; E2E `sticky-colors.spec` (header geometry; custom color and text color stored, painted and restored; theme change).

## v0.2.0 decisions (user request, 2026-10-10; Run B)

### D-108 Copy a file into Infinity Notes or link to the original
- Context: every added document was copied into the attachment store (up to a 50 MB limit, configurable to 200 MB). The user asked for a choice between a copy and a link to the file where it is, a setting for it, and never copying files over 25 MB.
- Decision (rule): images keep today's copy. Other files follow the public setting `attachments.addFiles` (`ask` default, `copy`, `link`; Settings > Notes and attachments "When adding files"). The copy limit `attachments.documentMaxMb` is now 1-25 MB, default 25 ("Largest file to copy"); the key moved to setting version 2 with an `upgrade` hook in the settings registry, so a stored version-1 value reads as `min(value, 25)` (the settings layer gained a generic per-key upgrade; values are not rewritten until the user changes them). A file over the copy limit is never copied: the dialog marks it "Larger than N MB: can only be linked" and links it, and "Always copy" links it with a notice. A file without a path (clipboard data) can only be copied; one that can be neither (clipboard data over the limit) is refused with the message from limits.ts. The rules are pure functions in `src/shared/attachments/file-choice.ts`, and main enforces the limit again on every copy. `IMPORT_MAX_PAYLOAD_BYTES` now follows the larger of the image and copy ranges (100 MB).
- Decision (dialog): with Ask, one "Add file"/"Add N files" dialog per drop, paste or pick, shown only when some file has a path. The renderer inserts "Adding file…" chips first and then asks (so their position stays right); Cancel removes them. "Remember my choice" writes the setting; stickies cannot write settings (D-064), so the checkbox is shown only in the main window.
- Decision (paths): picked files never leave main: `attachment:pickFiles {kind}` (replaces `attachment:importFromDialog` in place) shows the native picker and keeps the paths in a per-window pick session, answering names and sizes; `attachment:addPicked {pickId, index, action}` copies or links one picked file once (images only copy). For dropped and pasted files the preload exposes `fileLink.pathOf(file)` (`webUtils.getPathForFile`, no IPC); the renderer sends that path to `fileLink:create {path}` (Zod: 1-4096 characters, no NUL) and main accepts only an absolute, normalized path (Windows: a drive or UNC path without a second colon, so no NTFS streams or device paths) of an existing regular file. A link may point at any file (a program too); opening is what is restricted. Amended by D-115: the bridge takes the File, not a path, and network paths are refused.
- Decision (data): migration 009 `linked_files(id, path, name, size_bytes, created_at, unreferenced_since)` and `note_linked_files(note_id, link_id)` (cascade with the note, restrict on the link). Documents hold a new shared block node `fileLink {id, linkId, name, sizeBytes}`; the path is never in a document, so a pasted chip cannot name a path. `ContentIndexer` records the links a saved note uses (unknown IDs keep their chip and show as missing). Plain text and search read the file name; Markdown writes a link with the `file://` URL of the stored path (no URL for a path that is not absolute on this system); portable exports carry `links [{id, path, name, sizeBytes}]` (optional, so 0.1 exports import) and the import gives them new IDs; backups contain them as part of the database. The linked files themselves are in none of these, which the dialog, Settings and the user guide say. Maintenance deletes link records that no note, version or open draft has named for the attachment grace period (7 days); the files are never touched.
- Decision (use): `fileLink:status {linkId}` (path, current size, `available|blocked|missing`), `fileLink:open|showInFolder|copyIn {noteId, linkId}`; the three actions need a note that uses the link (the editor saves first) and re-check the stored path. Open uses the existing allowlist of document and image types (`isOpenableExtension`) on the link's name and on the resolved file's name, and on Linux refuses a file with an execute bit; anything else shows "This kind of file is not opened from Infinity Notes. Use Show in folder." and the chip offers only Show in folder. Missing files: "File not found at <path>", Show in folder disabled. "Copy into Infinity Notes" on a linked chip (within the copy limit, editable notes) stores the file through the attachment service and replaces the chip as an undoable edit. All new channels are in the sticky allowlist (own note).
- Also fixed: Markdown link targets now percent-encode parentheses (encodeURIComponent leaves them, so a URL with ")" ended the link early).
- Status: implemented. Evidence: unit `file-choice.test` (rules and the uploader: Ask, Link, Copy with a file over 25 MB, Cancel, Always copy fallback, Always link with clipboard data, picked files), `file-link-doc.test`, `attachment-names.test`, `contracts*.test`, `app-events.test`; integration `linked-files.test` (migration checks, create/status/open/show/copy-in, refusals, picker link, search, Markdown, portable round trip, backup and restore, GC), `settings.test` (upgrade), `attachments.test` (picker), `migrations.test` (009), `ipc-handlers-phase03.test`, `ipc-validation.test`; E2E `files.spec` (dialog copy and link, over 25 MB link only, remembered choice and Always copy, open, program, copy-in, missing state).

### D-109 The logo in the app, the tray and a startup loader
- Context: the brand assets come from `resources/brand/logo-source.png` through `tools/brand-assets.mjs` (another agent). The old placeholder generator `tools/make-icon.mjs` would overwrite them.
- Decision (packaging): Windows keeps `resources/icon.ico` (16-256 px); Linux uses the PNG set `resources/icons`; `resources/brand/tray-*.png` join `resources/icon.png` inside the asar, where main loads them. `tools/make-icon.mjs` is deleted (no script referenced it).
- Decision (tray): Windows gets one image with 16, 24 and 32 px representations for 100, 150 and 200% scaling; Linux tray hosts get the 32 px image and scale it.
- Decision (renderer): the title bar (18 px) and Help > About (64 px) show `AppLogo`, which picks the logo file for the CSS size and the next one for 2x. Vite emits the files (`assetsInlineLimit: 0`) because the CSP allows images from the app (`'self'`) but not `data:` URLs.
- Decision (startup): `index.html` holds the loader (logo, app name) so it paints with the first frame. Its colors are the theme's `--bg` and `--text`, chosen by `prefers-color-scheme`, which follows the app's theme setting through `nativeTheme.themeSource` (a unit test keeps them equal to the tokens). The logo and name fade in after 150 ms (a quick start never shows them) and breathe gently unless reduced motion is asked for; the loader fades out in 120 ms as soon as the shell's data is ready (or failed), is removed at once for the startup error and other screens, and stickies and the widget drop it before their first render. The main window gets the theme's `--bg` as native background (also on theme changes), so nothing white shows before the page paints. No minimum display time. Test hooks can hold `app:getInfo` back (`startupDelayMs`) to observe the loader.
- Status: implemented. Evidence: unit `brand.test`, `renderer/app-logo.test`, `app-identity.test`; E2E `brand.spec` (title bar and About logos load under the CSP, tray present where supported, native background, loader shown during a slow start and gone once the shell is ready, none in a sticky); packaged build inspected (tray PNGs, icon.png and the renderer logos identical in app.asar; the exe's icon is the logo).

### D-110 Release and website tests follow the published intent
- Context: five unit tests failed at HEAD: `app-identity.test` still expected the placeholder ICO, and `release-config.test` expected the steps commit 62e8a67 removed from `release.yml` (gates and the native self-test, which run in `ci.yml`) and the old website markup.
- Decision: the tests now check the current intent: the real icon set (512 px PNG; ICO 16, 24, 32, 48, 64, 128, 256; Linux, logo and tray PNGs; no make-icon) and the builder's icon settings; `release.yml` builds on Windows and Ubuntu with `npm ci`, `setup:electron`, `package:current` and artifacts, leaves `check`, `test:e2e` and `verify:native` to `ci.yml` (asserted there), pins Node like `ci.yml`, never disables the sandbox, and publishes the stable names, checksums and notices; the Pages workflow deploys `website/`, writes `releases.json` before the upload and redeploys on release events; download links are plain `<a data-asset>` links to `releases/latest/download/<stable name>`; each page loads only `app.js` and local styles, and every local asset and page they reference exists. `release.yml`'s header comment, which still claimed the gates ran there, was corrected; nothing else in the workflows or the website changed.
- Status: implemented. Evidence: `release-config.test`, `app-identity.test`.

## v0.2.0 decisions (user request, 2026-10-10; Run C)

### D-111 Locked notes: encrypted at rest, unlocked for the session
- Context: the user asked for notes that open only with a password or the OS key, because they may hold passwords or other confidential items.
- Decision (what is locked): the body (rich document or plain text) is encrypted; the title stays visible in the tree, tabs, Home, search results and reminders, because people must find a locked note. The lock dialog says so. Search matches the title only (the body is never indexed while locked). Attached images and files and linked files are not encrypted (the dialog and the user guide say so); a locked note's attachment links are still indexed, so its attachments stay in use. Reminder titles stay visible in the app's reminder lists (they are reminder metadata, like the note title); OS notifications of a locked note's reminder say "Reminder in a locked note" instead of the reminder title (D-112).
- Decision (crypto, main only, `src/main/locks/note-crypto.ts`): a random 256-bit data key per note; content, and sealed drafts, AES-256-GCM with a random 96-bit IV per write and `infinity-notes/v1/<purpose>/<noteId>` as additional data, stored as `version | iv | tag | ciphertext`; the tag is checked, so a changed byte, another note's value or another purpose fails. The data key is wrapped (AES-256-GCM) by a key derived from the NFC-normalized password with scrypt (N 2^17, r 8, p 1, 16-byte random salt, run on the thread pool); the parameters are stored per note (`kdf` JSON) and a stored set is accepted only within bounds (N 2^10..2^20, r <= 32, p <= 16), so stronger defaults later need no migration. A wrong password fails the tag check and is reported generically ("That password is not correct."); no comparison of secrets happens outside GCM's own constant-time tag check. Minimum password length 8 characters (checked in the renderer and again in main); there is no recovery: the dialog asks for the password twice and the "I understand a forgotten password cannot be recovered" tick, and `lock:set` requires `acknowledged: true`.
- Decision (data, migration 010): `note_locks(note_id → notes ON DELETE CASCADE, kdf, salt, password_key NOT NULL, os_key NULL, content, created_at, updated_at)`; `notes.locked` (0/1) is kept by triggers on `note_locks`, so every existing note query (tree, search, export) can tell a locked note without a join. A locked note's `content_json`, `content_text` and `plain_text` are empty: any reader that does not know about locks sees an empty note (fail closed). Guard triggers abort any write that would put plaintext into a locked note's row, add a version, a reminder source or a suggestion dismissal for it, or store an unsealed (or titled) draft for it.
- Decision (lifecycle, `LockService`, `NoteVault`): unlocking (password or Windows Hello) puts the data key in main's memory for the session; every content path (open, live sync, save, drafts, Markdown export, reminder block checks) goes through the vault, and without the key answers FORBIDDEN `{locked: true}`, which the tab shows as the lock screen. Writes encrypt; nothing of a locked note is written in plaintext (the row, versions, drafts, logs; passwords are never logged or echoed, and Zod failures name only the field). A note locks again after `locks.autoLockMinutes` (1, 5, 15, 30 or 60, default 5) without being opened, edited or saved (checked every 15 s), on the OS lock-screen and suspend events (Electron powerMonitor; Linux reports suspend but not screen lock), on quit, by "Lock now" (note menu, Lock settings, palette "Lock note now", Details) and "Lock all notes" (palette). Locking again saves the note's live-sync session, closes it (its views get `collab:reset`, join again and find the note locked) and zeroes the key. Locking a note locks it at once. Change password needs the current one (the data key is re-wrapped; content untouched); Remove lock needs the password and stores the content as plaintext again from then on (sealed drafts are opened); what locking destroyed stays gone. Wrong passwords: three free attempts, then 1, 2, 4 ... up to 30 s between attempts (memory only, per note).
- Decision (scope rules): a locked note never floats as a sticky (a sticky is removed from stickies before it is locked; `sticky:float` refuses a locked note), has no format conversion (it would need a version), no reminder suggestions or "Create reminder from text" (they store source text), and no suggestion dismissals. Conflict drafts made while it is unlocked are sealed with its key (`sealed:<base64>`, no title); attachment GC cannot read sealed drafts, so an image kept only in such a draft may be collected after the grace period. Portable export leaves locked notes, their reminders and attachments out and reports how many were left out; Markdown export of a locked note needs it unlocked (the user writes the text to a file of their choice). Backups contain the database as it is, so a locked note is in them only as ciphertext and restores locked with the same password. References into a locked note show the note without the block text; backlinks from it show no context. All `lock:*` channels are main-window only.
- Status: implemented. Evidence: unit `note-crypto.test`, `os-key.test`, `contracts.test`, `contracts-phase02.test`, `migrations-checksum.test`, `renderer/lock-form.test`, `renderer/editor/note-menus.test`, `renderer/state/note-controller.test`; integration `locks.test`, `migrations.test` (010), `scheduler.test` (locked notification), `ipc-validation.test`, `restore.test`; E2E `locks.spec`.

### D-112 Locking is one-way for confidentiality
- Context: the user: "it's not rollbackable because passwords or confidential items can be there".
- Decision (purge): in the lock transaction, before the lock row exists, main deletes the note's versions, all its drafts, the reminder source texts and dismissed suggestion phrases taken from it, and empties its row (the FTS row is rewritten with the title only). After the commit, with `secure_delete` on, the FTS index is merged (`optimize`, which drops the deleted entries from older segments), the database is rewritten (`VACUUM`, so no free page or free space in a page keeps old content) and the WAL is checkpointed and truncated (`wal_checkpoint(TRUNCATE)`). An integration test proves every table and the FTS vocabulary empty for the note and scans the database file and WAL bytes for the text (UTF-8 and UTF-16) after a lock.
- Decision (history): no version history is kept while a note is locked (none, not encrypted versions): the simplest honest rule. Version history says "Locked notes keep no version history".
- Not guaranteed (documented in the user guide): backups and exports made before locking still contain the text (the dialog says so; the user's backup files are never touched); the app's own pre-migration copies (`data/pre-migration`, last 3) and a restore's rollback copy made before the lock may contain it until they are replaced or deleted; blocks the file system or an SSD keeps after SQLite overwrote or truncated a file are outside SQLite's reach; while a note is unlocked its text is in the memory of main and the renderer, which the OS may page or hibernate to disk.
- Decision (reminders): reminders keep firing; a notification of a locked note's reminder has the title "Reminder in a locked note" and the body "Due <time> · <note title>".
- Status: implemented. Evidence: integration `locks.test` (purge, raw byte scan, FTS vocabulary, history empty, drafts sealed), `scheduler.test`; E2E `locks.spec` (versions and drafts gone, no marker in the database files while running and after quit).

### D-113 The OS key is Windows Hello, and only where it can be verified
- Decision (offer): Windows Hello (PIN, fingerprint or face) is offered only when `UserConsentVerifier.CheckAvailabilityAsync` answers Available and Electron `safeStorage` can protect keys. On Linux, and on Windows without Hello, only the password is offered, with the reason ("Linux has no OS key that Infinity Notes can verify. Use a password.", "Windows Hello is not set up for this Windows account.", ...). A note always has a password; Windows Hello is an extra way in, never the only one, because a Windows reinstall or a lost profile would otherwise make the note unrecoverable.
- Decision (mechanism): no native module. A small injectable adapter (`src/main/locks/os-key.ts`) runs a fixed script in a hidden Windows PowerShell 5.1 (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, `-NoProfile -NonInteractive -EncodedCommand`, `windowsHide`), 20 s timeout for availability and 120 s for a verification. The only values in the script are constants and the main window's native handle as a number; no note title or other user text. Verification calls `IUserConsentVerifierInterop.RequestVerificationForWindowAsync` with that handle, so the prompt belongs to the app window and comes to the front, and falls back to `RequestVerificationAsync`. Only `Verified` unlocks; Canceled, failures, unavailability and timeouts are told apart in the message.
- Decision (key): when Windows Hello is set up for a note (it is verified once then), a copy of the note's data key is protected with `safeStorage` (DPAPI, bound to the Windows account) and stored in `note_locks.os_key`; main releases it only after `Verified`, and checks the released key opens the content. Honest limit, in the user guide: Windows Hello here is a user-presence check guarding a key that Windows protects for the account; code running as the same Windows user could ask DPAPI for that copy without the prompt. The password copy protects against anyone with only the files (another account, a backup, a copied disk). Hello can be turned on or off per note with the password.
- Tests: E2E and integration use an injected fake verifier (test hooks `hello`: availability, queued answers, calls) and a process-bound key protector; real Windows Hello is never called automatically. Manual probe on the Windows development machine (2026-10-10): the availability script answered `Available` in 0.3 s; the interop type compiles under Windows PowerShell 5.1 and the operation IID resolves to `fd596ffd-2318-558f-9dbe-d21df43764a5`; the prompt itself was not shown or answered (it needs a person).
- Status: implemented. Evidence: unit `os-key.test` (availability and verification mapping, timeouts, script contents, Linux and other platforms unsupported, protectors); integration `locks.test` (setup verified once, canceled, timeout and failed refused, Verified unlocks, turned off, unavailable and no protection not offered); E2E `locks.spec` (fake Windows Hello set up, unlock, canceled).

### D-114 A flush joins a save that is being retried; E2E specs state the desktop they need (Run D, CI repair)
- Context: CI had never been green since v0.1.0. `save-failure.spec` › Quit with two unsaved windows failed on Windows and Linux: since live sync (D-103), a view's flush (`collab:flush`) chained a full new save, with its 3 retries, behind a save that was already retrying, so it could take about twice the retry window and passed `FLUSH_TIMEOUT_MS`. The flush coordinator then counted the window as timed out, and a timed-out window does not keep the app from quitting (D-072): with only that window unsaved, Quit would have gone ahead. On the Ubuntu runner (Xvfb, X11, no session bus, AppArmor-restricted user namespaces) seven more specs failed because they assumed WSLg: a tray host, positioning, pinning and notifications all unsupported by detection, and a renderer whose namespace links the test may read.
- Decision (saving): `CollabHub.save` joins a save already running for the note instead of queuing a second retry cycle. Every attempt stores the document as it is at that moment, so the joined save covers the newest edits; once it succeeds, edits that are still unsaved are saved again. A flush therefore answers within one retry window, and a window whose save keeps failing answers "unsaved" (Quit is canceled, D-085) instead of timing out.
- Decision (specs): a spec whose subject needs a capability unsupported calls `h.startUnsupported(capability)`: it keeps the desktop's own detection where that already says unsupported (WSLg, with its real reason) and otherwise starts the app again with the capability forced through `INFINITY_NOTES_TEST_CAPS` (reason `test-override`). The Linux sandbox probe reads the renderer's PID namespace from `NSpid` in `/proc/<pid>/status` and treats unreadable namespace links (EACCES: the setuid sandbox makes its processes non-dumpable) as "no own user namespace", so the setuid-sandbox mode is recognized; `--no-sandbox` still fails (shared PID namespace). The packaged spec expects launch at login per environment (Windows login items, XDG autostart on a Linux desktop, none under WSL) and, where the notification capability is unknown, a real OS answer (dispatched or failed) with the in-app banner on failure (D-076). The palette spec identifies the opened note by its text, since D-102 removed the path line from the note view.
- Status: implemented. Evidence: integration `collab.test` › a flush while main retries a failed save (fails against the chained save); unit `linux-sandbox.test` (NSpid and Seccomp parsing); E2E on Windows, WSLg and a CI-like Xvfb run with the setuid sandbox in WSL (docs/progress/release-0.2.0.md, Run D).

### D-115 Linked files: never touch a network path, and page script never names a path (Run E, acceptance repairs 1 and 2)
- Context: acceptance findings 1 and 2. A crafted `.infinityexport` could carry a link to `\\attacker.example\s\invoice.pdf`; the chip's automatic status check (`realpath`/`stat`) would make Windows connect over SMB or WebDAV and offer the user's NTLM credentials with no click. And `fileLink:create` took any path string from the bridge, so page script could link `~/.ssh/id_rsa`, copy it in and read the copy.
- Decision (paths): on Windows only local drive paths (`C:\…`) can be linked. `isNetworkPath` recognizes UNC shares (`\\server\share`, `//server/share`), WebDAV in UNC form (`\\host@SSL\DavWWWRoot\…`, `\\host@8080\…`) and the `\\?\` / `\\.\` device forms (including `\\?\UNC\`); `isUsableLinkPath` refuses them before any file system call, so status, Open, Show in folder and Copy in never reach them. Creating such a link is refused with "Files on a network location cannot be linked. Copy the file into Infinity Notes instead." A portable import validates every link record with the same `isUsableLinkPath` and does not store a record that fails it (network paths, another system's paths); its chips read as unavailable and the import log counts `refusedLinks`. A drive letter mapped to a share is a location the user set up and stays linkable.
- Decision (bridge): the bridge has no method that takes a path. `fileLink.createFromFile(file)` and `fileLink.isOnDisk(file)` take a `File`; the preload reads its path with `webUtils.getPathForFile` and sends `fileLink:create` itself. Only a File the user dropped, pasted or picked from disk has a path; one built by page script (whatever its name or extra properties say) has none and is refused with "Only a file dropped or pasted from this computer can be linked." without any request to main. `pathOf` was removed, so page script never sees the path of a dropped file either; the link DTO and status still show the stored path of a link the user made. `LINK_MESSAGES` moved to the zod-free `shared/attachments/link-messages.ts` so the preload can use it.
- Status: implemented. Evidence: integration `linked-files.test` › network locations are never touched (the fs spy sees a local link's `stat` and no call naming the host for creation, status, Open, Show in folder, Copy in and an import), unit `preload-file-link.test` (forged Files, plain objects and strings never reach IPC), E2E `security.spec` › bridge surface and renderer cannot read files.

### D-116 Table size limits (Run E, acceptance repair 3)
- Context: acceptance finding 3. A table of about 2,200 nodes with cells spanning 1,000 columns describes a grid of about 100 million positions; the editor's table map and `fixTables` then hang or crash the renderer.
- Decision: `shared/editor/table-limits.ts` sets `MAX_CELL_SPAN = 50` and `MAX_TABLE_CELLS = 10,000` grid positions (columns × rows, where the width of a row counts the columns that cells spanning down from rows above take; the check is linear in the cells). `normalizeRichDoc` refuses a span over 50 ("A table cell spans too many columns or rows"; invalid spans such as 0 still fall back to 1) and a table over the grid limit, at any nesting depth, so saves, live-sync saves and portable imports fail validation. The editor refuses a pasted table over the limits in `handlePaste`, before the table plugin lays its cells out, and any local edit that would make one (drop, add row or column, merge) in the doc-limits filter, with "This table is too large for a note …". Tab-separated text over 10,000 cells is pasted as text with a message. Insert table stays at 100 × 20.
- Status: implemented. Evidence: unit `table-limits.test`, `doc-schema.test` (the acceptor's case at spans 1,000 and 50), `renderer/editor/tables.test` › table size limits in the editor; integration `notes-save.test`.

### D-117 Lock hardening (Run E, acceptance repairs 6, 7, 9 and 10)
- Password attempts on a note run one at a time (a per-note promise chain) and each is counted as a failure before its key is derived, cleared only when the password is verified; parallel requests therefore meet the same delay as sequential ones.
- The lock dialog says that the note title and reminder titles are not encrypted and stay visible (tree, tabs, Home, search; the Reminders page).
- `scrubDatabase` returns false when VACUUM or the truncating checkpoint is blocked; the lock still succeeds, and the idle sweep (every 15 s) and quit run the whole scrub again until it succeeds. An ordinary checkpoint does not overwrite frames after the point where the WAL restarts, so only a successful TRUNCATE empties the file.
- Live sync logs only the error kind, never its message or stack, for a locked note: ProseMirror's schema errors quote the content.
- Status: implemented. Evidence: integration `locks.test` (parallel wrong passwords, a blocked scrub retried by the sweep and at quit, a schema error of a locked note logged without its text), unit `renderer/lock-form.test`.

## Risks carried forward

- R-01 better-sqlite3 prebuild in Electron 44: N-API should load unchanged but V8 memory-cage rules may reject external buffers; Phase 01 proves loading (dev and packaged, Windows and WSL); fallback `node:sqlite`; builder must not trigger node-gyp.
- R-02 WSLg has no notification server or tray host by default; those native cases may be `not_run` or `fail`; installing a daemon is an environment change needing a recorded decision in Phase 05 or 09; in-app fallbacks keep reminders usable. Phase 05 decided not to install one (D-077).
- R-03 WSLg window behavior differs from GNOME; positions are compositor-controlled; record actual behavior and never label it GNOME.
- R-04 TypeScript held at 6.0.3 and vite at 7.3.7 by peer ranges.
- R-05 Electron 44 end of life 2027-03-02.
- R-06 Tiptap UniqueID may keep source IDs on paste; policy strips them (Phase 03 test). Phase 03 planner probe confirmed UniqueID keeps an ID duplicated by inserting a copy of an existing block; mitigated by the app `BlockIdGuard` (D-053).
- R-07 FTS5 `categories` tokenizer with Bangla needs fixture verification; fallback trigram.
- R-08 Windows toast visibility in development needs `app.setAppUserModelId`; packaged NSIS shortcut needed for reliable click activation.
- R-09 Electron default ozone platform under WSLg must be logged (Wayland versus XWayland); production never forces X11. Phase 01 planner observation: Electron 44 picks `x11` (XWayland) under WSLg when `XDG_SESSION_TYPE` is unset; `--ozone-platform=wayland` also works (D-039). The app logs the actual value at startup.
- R-10 (Phase 04) `getAllWindows()` is not in creation order and WSLg XWayland reports a 640x480 screen and shifts windows by the frame; code and tests select windows by registry role or URL, and WSLg is treated as positioning-unsupported (D-064, D-068).

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

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

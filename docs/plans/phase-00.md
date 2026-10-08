# Phase 00 plan: Scope, contracts and repository planning

Planner: infinity-planner (Opus HIGH), 2026-10-08. Implementer: infinity-code-medium (Sonnet 5.5 MEDIUM). QA: infinity-qa. Acceptance: infinity-acceptor.

Status: ready. This plan is the single input the implementer needs. It resolves the routine product/UX/data choices so Phase 01 can start without another design discussion. Where this plan and the pack disagree, the pack wins on scope and the user decisions in root `CLAUDE.md` win on validation environment, Python and commits; record any conflict you discover in `docs/DECISIONS.md` and do not silently change scope.

---

## 1. Inputs read and actual repository state

Read by the planner: `CLAUDE.md` (root, includes "User decisions (2026-10-08)"), `infinity-notes-claude-pack/{PRODUCT_PLAN,ARCHITECTURE,TEST_MATRIX,CLEANUP_POLICY,README,SOURCES,PACK_VALIDATION,AUTONOMOUS_AGENT_PROMPT,MANUAL_WORKFLOW}.md`, `phases.json`, all ten phase files, `roles/*.md`, `templates/CLAUDE.md`, `.claude/agents/*.md`, `.claude/settings.json`, `.gitignore`, `.infinity-work/agent-status.json`, `.infinity-work/RESUME.md`, `tools/finalize-docs.mjs`, and the reference image `infinity-notes-claude-pack/reference/framecapt-reference.png`.

Repository state (verified): no application code, no `package.json`, no `src/`, no `tests/`. Root contains `CLAUDE.md`, `.gitignore`, `.claude/`, `tools/finalize-docs.mjs`, the pack, empty `docs/plans/` and `docs/progress/`, and git-ignored `.infinity-work/`. Git branch `master`, no commits yet. No previous phase report exists (Phase 00 is first).

Planner evidence: `.infinity-work/logs/phase-00/planner-probes.log` (host versions, better-sqlite3 tarball inspection, glibc symbol check, WSL package check, Luxon/chrono-node behavior probe). The scratch install used for probing was removed.

---

## 2. Deliverables and file boundaries

Phase 00 writes documentation and one dependency-free documentation tool. Nothing else.

| Path | Action | Notes |
| --- | --- | --- |
| `docs/PRODUCT_SPEC.md` | create | Scope, non-goals, requirement catalogue (every ID in Appendix A), platform promises/limits, release targets |
| `docs/UX_SPEC.md` | create | Shell layout, tokens, screens, dialogs, keyboard map, states, narrow behavior, accessibility, reference adaptation |
| `docs/ARCHITECTURE.md` | create | Process model, layout, data model, migrations allocation, IPC catalogue, windows, autosave/lease, attachments, scheduler, reminder state machine, time/DST, NLP pipeline, search, backup, security, capabilities, test seams |
| `docs/DECISIONS.md` | create | ADR list D-001... (section 6 of this plan) with dependency pins, licenses, rejected alternatives, verification evidence |
| `docs/BACKLOG.md` | create | Traceable backlog: every requirement ID -> phase -> test types -> planned tests -> status; TEST_MATRIX cross-reference; per-phase work items |
| `tools/check-traceability.mjs` | create | Dependency-free Node script (section 10). Workflow tool, not application source |
| `docs/progress/phase-00.md` | create | Progress report (section 11) |
| `.gitignore` | merge (append only) | Section 9.2 |
| `.infinity-work/logs/phase-00/*.log` | create | Command evidence (git-ignored) |

Forbidden in Phase 00: `package.json`, lockfile, `node_modules/`, `src/`, `tests/`, `electron-builder` config, CI files, any edit to `infinity-notes-claude-pack/`, `.claude/`, `tools/finalize-docs.mjs`, `.infinity-work/agent-status.json`, and `CLAUDE.md` (see section 9.1). Do not install packages (use `npm view` only). Do not commit; the coordinator commits after acceptance.

---

## 3. Verified environment facts (record in DECISIONS and progress)

| Item | Value | Source |
| --- | --- | --- |
| Windows host | Windows 11 Pro 10.0.26300, x64 | session environment |
| Windows Node / npm / git | v24.15.0 / 11.12.1 / 2.54.0.windows.1 | `node -v`, `npm -v`, `git --version` |
| WSL distro | Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, glibc 2.43 | `lsb_release -ds`, `uname -r`, `ldd --version` |
| WSL Node / npm | v24.21.0 / 11.19.0 | `wsl -d Ubuntu -- bash -lc 'node -v; npm -v'` |
| WSLg | 1.0.73 (Weston-based compositor, RDP/RAIL to the Windows desktop), `WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0` (XWayland) | `/mnt/wslg/versions.txt` |
| WSL Electron runtime libs | libnss3, libgtk-3-0t64, libgbm1, libasound2t64, libxss1, libnotify4, libsecret-1-0, libatk-bridge2.0-0t64, libdrm2, libxkbcommon0, xvfb, fakeroot, dbus-x11 installed; `rpm` missing (not needed: no .rpm target) | `dpkg-query` |
| WSL notification server / tray host | none on the session bus (no `org.freedesktop.Notifications`, no StatusNotifierWatcher) | `busctl --user list` |
| WSL sudo | passwordless (`sudo -n true` succeeds); installing extra system packages still requires an explicit decision recorded per phase (CLAUDE.md: no unrelated global software) | probe |
| Python | not available on Windows and must not be required anywhere in the toolchain | CLAUDE.md user decision |

Implementer: re-run the host commands and save output to `.infinity-work/logs/phase-00/env.log` (Windows) and `.infinity-work/logs/phase-00/wsl-env.log` (WSL). From Git Bash, prefix `wsl` invocations with `MSYS_NO_PATHCONV=1` or call through PowerShell to avoid path mangling.

---

## 4. Dependency decisions (pin exact versions; Phase 01 installs them)

All versions below were confirmed to exist today with `npm view <pkg> version license engines peerDependencies`. The implementer must re-run `npm view` for every package in this table and save the raw output to `.infinity-work/logs/phase-00/npm-view.log`. If a pinned version no longer resolves, record the replacement in DECISIONS with the reason; do not silently change majors.

| Package | Pin | License | Why / compatibility evidence |
| --- | --- | --- | --- |
| electron | 44.7.0 | MIT | Latest stable (released 2026-10-07); bundles Node 24.21.0 and Chromium 152.0.7977.130 (releases.electronjs.org). 44.x EOL 2027-03-02; 45.0.0 stable is scheduled 2026-10-20, so do not chase it mid-project. Electron supports Windows 10+ x64/arm64 and Linux distros still supported by Chromium (electron README v44.7.0). |
| electron-vite | 5.0.0 | MIT | Latest stable; peer `vite ^5 || ^6 || ^7`. 6.0.0 is beta only -> rejected. |
| vite | 7.3.7 | MIT | Highest version accepted by electron-vite 5 peer range. vite 8.3.3 rejected (electron-vite peer). |
| @vitejs/plugin-react | 5.2.0 | MIT | Peer `vite ^4..^8`; 6.x requires vite 8 -> rejected. |
| react, react-dom | 19.3.0 | MIT | Latest; Tiptap React peer `^17 || ^18 || ^19`. |
| typescript | 6.0.3 | Apache-2.0 | TypeScript 7.0.2 is latest, but typescript-eslint 8.71.1 peer is `typescript >=4.8.4 <6.1.0`; 6.0.3 (2026-04-16) is the newest compatible. Revisit only when typescript-eslint supports 7. |
| @tiptap/core, @tiptap/react, @tiptap/pm, @tiptap/starter-kit, @tiptap/extension-list (TaskList/TaskItem), @tiptap/extension-unique-id, @tiptap/extension-image, @tiptap/extensions (Placeholder etc.) | 3.31.4 (all identical) | MIT | All MIT open-source; UniqueID is MIT at 3.31.4 (no Pro/cloud packages). starter-kit 3.31.4 already includes bold, italic, code, code-block, heading, lists, link, undo/redo (`@tiptap/extensions`). All Tiptap packages must share one exact version. |
| better-sqlite3 | 13.0.3 | MIT | First N-API (node-addon-api) major; ships prebuilds inside the package for win32-x64 and linux-x64 (glibc) among others; no prebuild-install, `gypfile: false` so npm does not run node-gyp. Embedded SQLite 3.53.4 compiled with `SQLITE_ENABLE_FTS5` and `SQLITE_ENABLE_JSON1`. linux-x64 prebuild needs `GLIBC_2.34` and `GLIBCXX_3.4.29` (Ubuntu 22.04+). N-API is ABI-stable across Node/Electron, so no Electron-specific rebuild should be needed: Phase 01 must prove it by loading it in the Electron main process (see risk R-01). |
| @types/better-sqlite3 | 9.6.0 | MIT | Typings only; better-sqlite3 13 ships no `.d.ts`. The adapter (`src/main/db/adapter.ts`) isolates any typing mismatch. |
| zod | 4.6.5 | MIT | IPC/settings validation in main and shared contracts. |
| luxon / @types/luxon | 3.7.2 / 3.7.6 | MIT | IANA-zone aware via the runtime ICU (Electron ships full ICU). Probe: gap time 2026-03-08 02:30 America/New_York resolves to 03:30-04:00 by default (shift by gap length), fold 2026-11-01 01:30 resolves to -04:00 (earlier). The app must override the gap case (policy: 03:00) and compute both fold candidates explicitly; never rely on Luxon defaults. |
| chrono-node | 2.10.2 | MIT | Local English extraction only. Probe (reference 2026-10-08T07:00Z, offset +360): "tomorrow end of the day" -> two results ("tomorrow" and spurious "the day"), EOD not understood; "in 2 hours" -> 15:00; "Friday" -> 10-09; "next Friday" -> 10-16; "Thursday" (same weekday) -> 10-15; "03/04 at 5" -> month-first, 05:00, year rolled to 2027 by `forwardDate`; "by 5 CST" -> no result. Therefore the app uses only `knownValues` components and applies its own rules (section 7.11). |
| dompurify | 3.4.16 | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) | Defense-in-depth for pasted HTML in the renderer before Tiptap schema parsing (Tiptap schema remains the primary whitelist). Ships its own types. |
| lucide-react | 1.53.0 | ISC | Thin line icons similar to the reference; tree-shakable; no UI framework. |
| vitest | 5.0.3 | MIT | Node `^22.12 || ^24 || >=26`; peer vite `^6.4 || ^7 || ^8` (works with vite 7.3.7). Unit + integration runner. |
| jsdom | 30.1.2 | MIT | DOM environment for editor/sanitizer unit tests only. |
| @playwright/test | 1.64.0 | Apache-2.0 | Real Electron E2E via `_electron.launch` with temporary userData. No browser downloads needed for Electron tests. |
| eslint / @eslint/js | 10.12.0 / 10.0.1 | MIT | Flat config. |
| typescript-eslint | 8.71.1 | MIT | Peer eslint `^8.57 || ^9 || ^10`, typescript `<6.1.0`. |
| eslint-plugin-react-hooks | 7.1.1 | MIT | Peer includes eslint 10. |
| globals | 17.13.0 | MIT | ESLint environments. |
| @types/react, @types/react-dom | 19.3.0 | MIT | Match React. |
| @types/node | 24.19.1 | MIT | Match the Node 24 line used by Electron 44 and the hosts. |
| electron-builder | 26.15.3 | MIT | NSIS (Windows host), AppImage + deb (WSL ext4 copy). Config must set `npmRebuild: false` and `asarUnpack` for `**/*.node` (risk R-01). |
| yazl / yauzl | 3.3.1 / 3.4.0 | MIT | Phase 08 backup/export archive write/read with streaming and per-entry validation. Listed now so the license/size decision is recorded; installed in Phase 08. |

Explicitly not used: `@electron/rebuild` and any source rebuild of native modules (node-gyp requires Python, which the user forbids; see R-01), an ORM, a UI component framework, Prettier (optional formatting is not a gate), electron-log (a tiny file logger in main is enough), any Tiptap Pro/cloud package, any network/AI/LLM SDK, any telemetry, `@electron/remote`.

Toolchain floor recorded in DECISIONS: Node `>=24.15.0 <25` for development on both hosts (engines field set in Phase 01), npm 11, no Python.

---

## 5. Target OS minimums, validation scope and capability fallbacks

### 5.1 Minimums (write into PRODUCT_SPEC "Release targets" and DECISIONS D-020)

- Windows: Windows 11 version 24H2 (build 26100) or later, x64. Validation host: Windows 11 Pro build 26300 x64. Windows 10 and arm64 are not supported targets (Electron may run there, but no claim is made).
- Linux: Ubuntu 24.04 LTS or later, x64 (declared minimum; glibc 2.39 >= the 2.34 required by the SQLite prebuild). Validation environment per user decision: Ubuntu 26.04.1 LTS on WSL2 with WSLg 1.0.73 (Weston). Native Ubuntu 24.04 and GNOME/X11 desktops are not validated by this project and must be described as "declared, not validated".
- Packages: Windows NSIS installer (unsigned, labeled "unsigned local build"); Linux AppImage and .deb built from a copy on the WSL ext4 filesystem (e.g. `~/infinity-notes`), never sharing `node_modules` across OSes.

### 5.2 Validation scope (user decision 2026-10-08; record as D-021)

PRODUCT_PLAN/TEST_MATRIX ask for GNOME Wayland and X11 Linux sessions. The user selected WSL2 Ubuntu 26.04 + WSLg as the Linux validation environment. Therefore the native matrix (Phase 09) has these columns:

| Column | Meaning | Status vocabulary |
| --- | --- | --- |
| Windows 11 (host) | Native desktop on this machine | pass / fail / not_run |
| WSLg Wayland | Electron's native Wayland backend on WSLg/Weston (Electron 44 is expected to auto-select Wayland when `WAYLAND_DISPLAY` is set; Phase 01/04 must log the ozone platform actually used) | pass / fail / not_run |
| WSLg XWayland (optional) | Same app forced with `--ozone-platform=x11` against WSLg's XWayland. This is an X11 client on XWayland, not an X11 desktop session | pass / fail / not_run |
| GNOME Wayland, X11 session | Outside the user-selected validation scope | `outside_validation_scope` (never pass) |

Rules: never label WSLg results as GNOME or as an X11 session; record the compositor (WSLg/Weston + version) in every Linux result; Xvfb E2E validates application logic only. Whether `outside_validation_scope` cases permit a final `complete` is decided by the Phase 09 acceptor under the CLAUDE.md user decision; Phase 00 docs must not pre-claim either outcome.

### 5.3 Platform capability table (write into ARCHITECTURE "Capabilities" and UX_SPEC fallbacks)

Capabilities are detected at runtime by one `PlatformCapabilities` service in main (`src/main/services/capabilities.ts`) and exposed read-only to renderers. UI hides or disables unsupported controls with a short tooltip ("Not supported by this desktop"); it never pretends success.

| Capability | Windows 11 | Linux X11 session (declared, outside validation scope) | Linux Wayland (GNOME, declared, outside scope) | WSLg Wayland (validated env) | Fallback when unsupported |
| --- | --- | --- | --- | --- | --- |
| Independent native windows, user move/resize | yes | yes | yes | expected yes (RAIL windows); verify | none needed |
| Programmatic position set/restore | yes | yes (WM may adjust) | no (Electron: Wayland prohibits global coordinates; `getPosition` returns [0,0]) | treat as Wayland: no | restore size/collapsed/pin only; compositor places window; never claim positioning |
| Display-clamping of restored bounds | yes | yes | n/a (no positions) | n/a | skip |
| Always-on-top (sticky pin, widget pin) | yes | WM-dependent | no (`setAlwaysOnTop` unsupported on Wayland) | no | pin control disabled with tooltip; do not force X11 |
| Tray icon | yes | needs a StatusNotifier/AppIndicator host | Ubuntu GNOME ships AppIndicator extension; others may not | no tray host detected | close dialog explains: app keeps running in background; launching the app again focuses the running instance (single-instance lock); app menu always has Quit |
| Native notifications | yes (needs AppUserModelID; installed shortcut for packaged build) | yes via libnotify + a running notification server | yes | no notification server detected; expect failure/invisible | in-app due banner + Reminders/Home/widget overdue lists + taskbar attention (`flashFrame`); outcome recorded as `failed`/`unsupported`/`uncertain` |
| Notification click -> open note | yes | server-dependent | yes | n/a without server | open from in-app banner/widget |
| Native notification action buttons | Electron supports on Windows | no | no | no | V1 offers none on any OS (D-026); Snooze/Done/Open always in app and widget |
| Launch at login | `app.setLoginItemSettings` | XDG autostart `.desktop` written by app | same | same (session-dependent) | opt-in, default off; report failure in Settings |
| Global shortcut (quick sticky) | `globalShortcut` | X11 yes | Wayland generally no | likely no | opt-in, default off; registration failure shown in Settings |
| Sleep/resume events | `powerMonitor` | yes | yes | WSL suspend semantics differ; record actual | bounded timer + clock-jump detection covers missed events |

Promises (must appear verbatim in PRODUCT_SPEC "Platform promises and limits"): reminders and notifications only fire while the app process is running (window, background or tray); a fully quit app sends nothing until relaunch, and relaunch shows an overdue summary. Window positions are restored only where the platform allows; no guaranteed positioning under any Wayland compositor.

---

## 6. DECISIONS.md content (ADR list)

Write each as `### D-0NN Title` with Context, Decision, Consequences, Status (accepted), Evidence. Required entries:

- D-001 Product scope and non-goals (offline single app; no backend, accounts, sync, collaboration, AI/LLM, calendar integration, OCR, drawing, audio/video, Kanban, plugins, formula/database views, telemetry; English-only NLP).
- D-002 Stack: Electron 44.7.0 + electron-vite 5.0.0 + vite 7.3.7 + React 19.3.0 + TypeScript 6.0.3 (with the peer-range reasoning from section 4).
- D-003 Editor: Tiptap 3.31.4 MIT packages listed in section 4; one shared `NoteEditor` component; no hand-written contentEditable engine.
- D-004 SQLite driver: better-sqlite3 13.0.3 N-API prebuilds; FTS5/JSON1 verified in source config; no rebuild, `npmRebuild: false`, `asarUnpack: ["**/*.node"]`; fallback `node:sqlite` (bundled with Electron's Node 24.21) behind the same adapter if the prebuild fails in Electron; source rebuild rejected because it needs Python.
- D-005 Validation: Zod 4.6.5 schemas in `src/shared/contracts`, validated in main on every IPC call.
- D-006 Time: Luxon 3.7.2; app-owned DST resolver (gap/fold policy, section 7.10); instants stored as INTEGER epoch milliseconds UTC.
- D-007 NLP: chrono-node 2.10.2 components only; app-owned EOD/date-only/weekday/ambiguity rules; observed chrono quirks listed.
- D-008 Sanitization: Tiptap schema whitelist + DOMPurify 3.4.16 (Apache-2.0) + strip incoming block IDs on paste.
- D-009 Icons/styling: lucide-react 1.53.0, plain CSS with CSS variables; no UI framework.
- D-010 Tests: Vitest 5.0.3 (+ jsdom 30.1.2), Playwright 1.64.0 `_electron`; test-type legend U/I/E/N/V/P/R.
- D-011 Lint: ESLint 10.12.0 flat config + typescript-eslint 8.71.1 + react-hooks 7.1.1.
- D-012 Packaging: electron-builder 26.15.3; NSIS on Windows; AppImage + deb in WSL ext4 copy; unsigned labeled builds; no publish/auto-update.
- D-013 App identity: npm name `infinity-notes`, productName `Infinity Notes`, appId and Windows AppUserModelID `com.infinitynotes.desktop`, Linux executable `infinity-notes`, version `0.1.0`.
- D-014 User data layout: `app.getPath('userData')/data/infinity-notes.sqlite3`, `data/attachments/<first two hex of id>/<attachmentId>.<ext>`, `data/pre-migration/`, `data/restore-staging/`, `data/rollback-<timestamp>/`, `logs/`. Never the install directory. Notes store attachment IDs and the DB stores paths relative to `data/`, so the whole data folder can be relocated without rewriting notes. Env `INFINITY_NOTES_USER_DATA_DIR` (absolute path) overrides userData before `ready` for tests.
- D-015 IDs: `crypto.randomUUID()` for every entity and block ID.
- D-016 Hierarchy rules (section 7.2).
- D-017 Tab session model (section 7.3).
- D-018 Autosave/revision/lease protocol (section 7.6).
- D-019 Attachments safety and limits (section 7.7).
- D-020 OS minimums (section 5.1).
- D-021 Linux validation in WSLg; GNOME/X11-only cases `outside_validation_scope` (section 5.2).
- D-022 Reminder state machine and delivery policy (sections 7.8-7.9).
- D-023 Recurrence and DST policy (section 7.10).
- D-024 Follow-up, snooze, quiet hours, recovery and storm limits (section 7.9).
- D-025 Weekday, end-of-day (17:00) and date-only (09:00) parsing policy (section 7.11).
- D-026 No native notification action buttons in V1 on any OS.
- D-027 Close/tray behavior: first-close choice dialog, remembered and editable; explicit Quit in menus; fully quit stops reminders.
- D-028 Sticky windows use native OS frames (no custom drag regions in V1); one window per note ID.
- D-029 Search: FTS5 tokenizer `unicode61 remove_diacritics 2 categories 'L* N* Co M*'` (keeps Bangla combining marks inside tokens; SQLite >= 3.45 supports `categories`), prefix queries, title substring fallback for 1-2 character queries; verified with Bangla tests in Phases 03/07.
- D-030 Backup/export formats (section 7.12).
- D-031 No Python anywhere; final organizer `node tools/finalize-docs.mjs --repo .`.
- D-032 Commit after each accepted phase; never push.
- D-033 Main window uses the native frame and native window controls with an in-window compact header (search/command box); Windows `titleBarOverlay` is an optional later enhancement, not required.
- D-034 Retention defaults: trash never auto-purged (options Never/30/90 days); automatic versions kept 30 days and at most 100 per note; conversion/conflict/restore versions kept until the note is permanently deleted; attachment GC grace period 7 days.

---

## 7. Contracts that the docs must resolve (authoritative content)

The implementer copies these decisions into the named docs (ARCHITECTURE unless noted), expanding prose but not changing the decisions.

### 7.1 Home dashboard and filter (UX_SPEC + PRODUCT_SPEC)

- Exactly one Home tab, always the first tab, not closable, cannot be duplicated; rail Home focuses it. Ctrl+W on Home does nothing.
- Header row: title "Home", scope filter segmented control `All | Common | Project v` (dropdown lists projects alphabetically). Filter persisted in setting `home.scope` (`{kind:'all'} | {kind:'common'} | {kind:'project', projectId}`); a trashed project falls back to All.
- Sections in order: Quick actions (compact tiles like the reference "MORE" tiles, 96x80: New note, New sticky, New project); Pinned (up to 12 tiles by `pinnedAt` desc, "View all" opens a list); Recent (10 most recently updated notes, list rows with scope path and relative time); Reminders (Overdue and Due today, up to 5 each, link to the Reminders page) - added in Phase 05, absent before (no fake placeholders).
- New note/sticky from Home inherits the filter: Project -> project root; Common or All -> Common root.

### 7.2 Common/project hierarchy, nested folders and cycle rules

- Scope = Common (projectId NULL) or a Project. Common is permanent: not renameable, not deletable, always first in the tree.
- Folders exist in Common and in projects (`folders.projectId` nullable, `parentId` nullable = scope root). Notes live at a scope root or in a folder. Stickies are notes with `stickyEnabled = 1` and live anywhere a note can.
- Invariants enforced in main inside transactions: a folder's projectId equals its parent's projectId; a note's projectId equals its folder's projectId when folderId is set; maximum folder depth 32 (error `LIMIT_EXCEEDED`).
- Cycle rule: moving folder F under target T is rejected with error `CYCLE` when T = F or T is a descendant of F (recursive CTE check in the same transaction as the move).
- Moving a folder to another scope updates projectId on the folder, all descendant folders and all contained notes in one transaction. References and reminders are ID-based and unaffected.
- Names: trimmed, 1-200 characters, no control characters; duplicate sibling names allowed; pickers and search show the path to disambiguate. Empty note title displays "Untitled".
- Ordering: folders before notes, then case-insensitive alphabetical by name/title (`sortOrder` column reserved, unused in V1). Drag-and-drop is optional; the required path is a keyboard-accessible "Move to..." dialog with a scope/folder picker.
- Trash: deleting a note, folder or project soft-deletes the item and all descendants with one `trashBatchId` and `deletedAt`. A Trash node at the bottom of the tree lists batches. Restore returns the batch to its original parent if it exists and is not deleted; otherwise to the nearest live ancestor; otherwise to the Common root, with a notice. Permanent delete ("Delete forever", "Empty trash") requires confirmation; attachments are then eligible for GC (7.7). Trashed notes' reminders are suspended (7.8).
- Pin and favorites: notes can be pinned to Home (`pinnedAt`); notes, folders and projects can be favorited (`favorite`) and appear in a Favorites group at the top of the tree. Tags are optional and small (Phase 07): lowercase, 1-32 chars, at most 20 per note, used only as a search filter.

### 7.3 Tab session model

- Tab kinds: `home` (singleton, index 0), `note` (one per noteId in the main window), page singletons `stickies`, `reminders`, `settings`. Opening an already-open note focuses its tab. Opening a reference opens or focuses the target tab, inserted right of the current tab.
- Only the active note tab mounts a `NoteEditor`; inactive tabs keep `{noteId, title, scrollTop}` in memory and no editor instance, no document content. Switching away flushes the pending save first.
- Persisted setting `session.tabs` = `{version:1, tabs:[{id, kind, noteId?, scrollTop?}], activeTabId}` written on every tab change (debounced 500 ms) and on quit. On startup tabs whose notes are missing or trashed are dropped with one notice ("1 tab was closed because its note is in Trash"); duplicates are collapsed.
- Close: Ctrl+W, close button, middle-click; closing flushes then unmounts; never deletes. Trashing a note closes its tabs immediately.
- Navigation: Ctrl+Tab / Ctrl+Shift+Tab cycle in strip order. Overflow: horizontal scrolling strip with scroll buttons plus an "All tabs" list button when overflowing.

### 7.4 Sticky window / editor reuse

- A sticky is the same note row with `stickyEnabled = 1`, `color` set. Float = open a native `BrowserWindow` keyed by noteId (main keeps `Map<noteId, BrowserWindow>`; a second Float focuses the existing window). Floating an ordinary note sets `stickyEnabled = 1`. "Remove from stickies" clears it.
- All windows load the same renderer bundle with hash routes `#/` (main), `#/sticky/<noteId>`, `#/widget`; main validates the noteId (UUID, exists, not purged) before creating the window, and the renderer route re-validates through IPC.
- The sticky renders the same `NoteEditor` plus a 36 px header: color button (6 presets: yellow default, green, blue, pink, violet, gray), title, source badge ("Common" or "Project > Folder"), pin (always-on-top; disabled where unsupported), collapse, overflow menu (Open in app/Dock, Change color, Remove from stickies, Move to Trash). Native OS frame; the OS close button hides the window (stores `open = 0`), never deletes.
- Dock/Open in app: flush, close the sticky window, open/focus the note tab in the main window.
- Window state persisted in `window_state` (`key = 'sticky:<noteId>' | 'widget' | 'main'`): bounds, displayId, open, collapsed, alwaysOnTop. Restore clamps bounds to a currently connected display work area (fallback: primary display, default size 320x300, minimum 220x120); on Wayland only size/collapsed are restored.
- Restore open stickies on startup: setting `stickies.restoreOnStartup`, default false.
- Trashed note: its sticky window shows an overlay "This note is in Trash" with Restore and Close window; editing is disabled.

### 7.5 Right context panel

- One panel in the main window, right side, 280-340 px (default 300), toggled by a header button and Ctrl+Shift+\ ; open state persisted in `layout.panelOpen`. Below 1180 px window width it becomes an overlay drawer.
- Sections for the active note, each collapsible: Info (scope path, created/updated, format, versions link) in Phase 02-03; Reminders (list + Add reminder) in Phase 05; Outgoing references and Backlinks in Phase 07. Non-note tabs (Home/pages) show a short "Open a note to see its details" state.

### 7.6 Autosave, revision and editing lease protocol

- Main is the only writer. Renderer debounces edits 400 ms and sends `note:save {noteId, viewId, leaseToken, baseRevision, requestId, title?, format, content}` (content JSON <= 5 MB, otherwise `LIMIT_EXCEEDED`).
- Main, in one transaction: verify lease (token held by viewId) -> verify `baseRevision == notes.revision` -> write content, extracted `plainText`, FTS row, references (Phase 07) and attachment links -> `revision + 1` -> commit -> reply `{ok, revision, requestId}` (the acknowledgment) -> broadcast `note:revision {noteId, revision, sourceViewId}` to every other view.
- Stale base revision: nothing is overwritten; the submitted content is stored in `note_drafts` (reason `conflict`) and the reply is `CONFLICT {currentRevision, draftId}`; the UI shows "This note changed elsewhere. Your edits were kept as a recovered draft" with Compare / Restore draft (creates a version of the current content first, then saves the draft as a new revision) / Dismiss.
- Flush points with acknowledgment: blur, tab switch, tab close, window close, lease hand-off, format conversion, app quit. Window close and quit wait up to 2000 ms per view for acks.
- Lease: main holds `Map<noteId, {viewId, token, acquiredAt}>`. The first view that opens a note for editing gets the lease; other views open read-only with a banner "This note is being edited in another window" and a Take edit control button. Take: main asks the holder to flush (`lease:release-request`), waits up to 3000 ms for an ack, then grants the lease to the requester and broadcasts `note:lease`. If the holder does not answer or its webContents is destroyed, the lease is revoked; any later save carrying the revoked token is stored as a `lease_lost` draft and rejected with `LEASE_REQUIRED`. Float of a note is an implicit take-control request by the sticky.
- Read-only mirrors reload content on `note:revision`.
- Durability statement (PRODUCT_SPEC): acknowledged saves are durable (WAL with `synchronous=FULL`, so an acknowledged commit survives power loss; `NORMAL` is not used); edits typed within the last debounce window before a crash or kill may be lost; renderer crashes never lose acknowledged content.
- Versions (`note_versions`): created on format conversion, conflict restore, version restore, before permanent overwrite by import, and automatically at most once per 10 minutes of editing per note. Retention per D-034.

### 7.7 Attachments safety

- Main receives image bytes (clipboard bitmap converted to PNG in main via `clipboard.readImage()`/`nativeImage`, or file bytes from paste/drop/import dialog) -> size check -> magic-byte type check (PNG, JPEG, GIF, WebP only; SVG, HTML, HEIC and unknown rejected with a friendly message) -> SHA-256 -> write to a temp file in `data/attachments/tmp/` -> fsync -> atomic rename to `attachments/<aa>/<id>.<ext>` -> register row in a transaction. Identical hash reuses the existing attachment row.
- Documents (Phase 03 import, Phase 07 open): any type copied in as a managed copy up to the document limit; never executed. Opening uses `shell.openPath` on the managed copy only for non-executable extensions; executable/script types (exe, msi, bat, cmd, com, ps1, vbs, js, jar, sh, AppImage, desktop, lnk, scr, run, bin, deb, rpm) are refused for opening and offered "Show in folder" (`shell.showItemInFolder`) instead. Paths are never passed through a shell.
- Limits (settings, bounded): image default 20 MB (range 1-100 MB); document default 50 MB (range 1-200 MB). Oversized input shows "This image is larger than 20 MB. Change the limit in Settings or use a smaller image." and the editor stays responsive.
- Rendering: notes store `attachmentId` only; images load via the privileged scheme `infinity-attachment://<attachmentId>` registered with `protocol.handle`; the handler validates UUID format, looks up the row, serves the file with the stored MIME, `X-Content-Type-Options: nosniff`, only image MIME types inline; never accepts paths; rejects everything else with 404.
- Remote images in pasted HTML are not fetched; they are replaced by a link/placeholder text. Pasted `data:` images are decoded and imported through the same pipeline (subject to limits).
- GC: an attachment file is deleted only when no live note, trashed note, version or draft references it and it has been unreferenced for the 7-day grace period (Phase 08).

### 7.8 Reminder model and occurrence state machine

Reminder (series) fields: id, noteId, blockId nullable, title, zoneId (IANA), startLocalDate (`YYYY-MM-DD`), localTime (`HH:mm`), recurrence (`null | {freq:'daily'} | {freq:'weekly', byWeekday:[1..7]}`, ISO weekday numbers), foldPreference (`earlier|later`, default earlier), followupIntervalMinutes (null = off; 5/10/15/30/60), maxFollowups (1/2/3/5), enabled, anchorState (`ok|block_missing`), suspended (note trashed), revision, createdAt, updatedAt, deletedAt.

Occurrence stored states: `pending`, `snoozed`, `completed`, `missed`, `cancelled`. "Overdue" is derived (pending with dueAt <= now, or snoozed with snoozedUntil <= now and not yet re-alerted), never stored. Fields: dueAtUtc, originalLocalDateTime, snoozedUntilUtc, nextAlertAtUtc (null = no further alerts), followupsSent, revision, completedAt. Unique (reminderId, dueAtUtc).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| (new) | create/confirm, due in future | pending | nextAlertAt = dueAt |
| (new) | create/confirm, due already past (explicitly accepted past date) | pending | nextAlertAt = null (shown overdue, no notification) |
| pending | scheduler tick, nextAlertAt <= now, not in quiet hours, reminder enabled and not suspended | pending | claim AlertDelivery (sequence n) then dispatch; followupsSent += 1 if n > 0; nextAlertAt = now + interval if follow-ups remain else null |
| pending | tick inside quiet hours | pending | nextAlertAt = quiet-hours end (no dispatch) |
| pending, snoozed | Snooze(d) | snoozed | snoozedUntil = now + d; nextAlertAt = snoozedUntil; follow-ups paused |
| snoozed | tick at snoozedUntil | pending | dispatch alert kind `snooze`; follow-ups resume: nextAlertAt = now + interval if remaining else null |
| pending, snoozed | Done | completed | completedAt = now; nextAlertAt = null; all follow-ups stop |
| pending, snoozed (recurring) | next occurrence of the same series becomes due | missed | nextAlertAt = null (bounded backfill; at most one open overdue occurrence per series) |
| pending, snoozed (not yet due) | series edited or deleted | cancelled | regenerated per new rule if edited |
| pending/snoozed overdue | series edited | unchanged or completed | explicit choice in the edit dialog: "Keep the current overdue reminder" (default) or "Mark it done" |
| any | notification dismissed/closed | unchanged | delivery outcome may record `closed`; never completion |

Series generation: on create and whenever an occurrence becomes due or is completed, ensure exactly one future pending occurrence exists for active recurring series. On startup after downtime, generate only the latest occurrence with dueAt <= now (older open ones -> missed) and the next future one; never generate intermediate rows.

Note trash: all reminders of the note get `suspended = 1` (no alerts, hidden from Today/Upcoming, listed under a "In Trash" note in the side panel only). Restore clears it; occurrences that fell due meanwhile show as overdue with at most one recovery alert (same rule as 7.9). Block deleted: reminder stays note-linked with `anchorState = block_missing` and a chip in the side panel "Original text was removed" with Re-anchor / Keep note-level actions. Reminder delete: soft delete with Undo for 10 s, occurrences cancelled.

Snooze presets: 5, 10, 15, 30, 60 minutes and "Tomorrow 09:00" (in the reminder zone). Snooze never moves the series.

### 7.9 Scheduler, delivery uncertainty, follow-ups, quiet hours, recovery

- One `ReminderService` in main serves the app, stickies and widget. Clock via an injectable `Clock` (`now()`, `monotonicNow()`), notifications via `NotificationAdapter` (`show(payload) -> {outcome}`, click/close callbacks). Single timer set to min(next `nextAlertAtUtc`) capped at 60 s; recalculated after every write, `powerMonitor` resume/unlock, settings change, zone change and startup.
- Clock-jump detection: each wake compares wall-clock delta to monotonic delta; |difference| > 120 s triggers recalculation and a recovery batch (forward jump) or rescheduling only (backward jump; already-claimed sequences never repeat).
- Delivery: in one transaction insert `alert_deliveries (occurrenceId, alertSequence, kind, batchId, claimedAt, outcome='claimed')` with UNIQUE(occurrenceId, alertSequence) and update the occurrence using `WHERE id=? AND revision=? AND state IN ('pending','snoozed')`; commit; then call the adapter and record `dispatched`/`failed`/`unsupported` with dispatchedAt. If the update matched 0 rows (user Done/Snooze won), nothing is dispatched.
- Uncertainty: exactly-once delivery across crashes is impossible. A claim found at startup with outcome `claimed` and no dispatchedAt is marked `uncertain`, is never re-dispatched under the same sequence, and the occurrence remains visible as overdue. Delivery attempts never complete an occurrence.
- Follow-ups: default off per reminder; when enabled default 15 min x 2; presets 5/10/15/30/60 min and max 1/2/3/5. followupsSent increments at claim time. Follow-ups that would have fired during downtime or quiet hours are not replayed; because each occurrence has a single nextAlertAt, the next alert simply happens once when eligible, then the cadence continues from that moment. This prevents loops and accidental exhaustion.
- Quiet hours: setting `{enabled:false, start:'22:00', end:'07:00', zoneId}` (zoneId explicitly stored, default the OS zone when first enabled). Alerts falling inside are deferred to the end (one alert per occurrence); occurrences remain overdue in the app meanwhile.
- Recovery batch (startup, resume, forward clock jump, quiet-hours end): collect occurrences with nextAlertAt <= now; if <= 3, dispatch one alert each; if > 3, dispatch one summary notification "N reminders are overdue" (click opens Reminders > Overdue) and record a claim per occurrence with kind `recovery_summary`. The main window shows an overdue summary banner on startup when any overdue occurrences exist. Never more than one alert per occurrence per batch.
- Fully quit: no reminders fire; Settings > Reminders and the close dialog state this.

### 7.10 Recurrence and DST policy

- Store: zoneId + local wall-clock schedule (startLocalDate, localTime, recurrence) on the series; each occurrence stores dueAtUtc + originalLocalDateTime.
- Daily/weekly series keep wall-clock time in the stored zone across DST changes (09:00 stays 09:00 local).
- Resolution function `resolveLocal({date, time}, zoneId, foldPreference)` in `src/shared/time/resolve.ts` returns `{status:'ok'|'gap'|'fold', instantUtc, alternatives?}`:
  - Gap (nonexistent local time): resolve to the first valid instant after the gap, i.e. the transition instant. Example: 2026-03-08 02:30 America/New_York -> 03:00 EDT = 2026-03-08T07:00:00Z, disclosed in the preview: "02:30 does not exist on this date in New York; the reminder will use 03:00".
  - Fold (ambiguous local time): default earlier occurrence, disclosed, later selectable. Example: 2026-11-01 01:30 America/New_York -> 01:30 EDT = 05:30Z (default) or 01:30 EST = 06:30Z.
  - Implementation note: compute candidates with the offsets 12 h before and after the naive instant, keep candidates whose local rendering equals the request; with none, binary-search the transition between the two candidates at minute granularity. Do not rely on Luxon's default shifting.
- Recurring series on a gap day use the gap rule for that day only; on a fold day use the series foldPreference; never two occurrences for one fold.
- OS zone change: affects local display and the default zone for new reminders only; stored reminder zones never change. Detect by re-reading `Intl.DateTimeFormat().resolvedOptions().timeZone` on each scheduler wake and resume.
- Relative durations ("in 2 hours") use instant arithmetic; calendar phrases ("tomorrow 9am", "in 3 days") use calendar arithmetic in the selected zone.

### 7.11 Natural-language parsing policy (Phase 06 implements; Phase 00 documents)

- Pipeline: chrono-node `parse(text, {instant: refInstant, timezone: offsetMinutesOfSelectedZoneAtRef}, {forwardDate: false})` -> keep `knownValues` only -> app rules below -> `resolveLocal` in the selected IANA zone. Parsing runs locally in the renderer during idle time; main re-resolves the confirmed local components and zone before persisting and never trusts a renderer-provided instant.
- End of day: "end of (the) day", "EOD", "by end of day" -> configurable `reminders.endOfDayTime`, default 17:00 in the selected zone; standalone means today. The spurious chrono "the day" result is suppressed when it is part of an EOD phrase.
- Date-only: no explicit time -> `reminders.dateOnlyTime`, default 09:00, shown as "09:00 (default time for date-only phrases)".
- Explicit times ("at 8pm", "20:00") are used as given. A bare hour 1-12 without am/pm or a day-part word is ambiguous and requires an am/pm choice.
- Durations "in N minutes/hours": refInstant + duration. "in N days/weeks": calendar date arithmetic, then the date-only default time unless a time is given.
- Weekdays (week = Monday-Sunday, ISO): bare or "this"/"on"/"by" W = the first date >= today in the selected zone with weekday W whose resolved instant (explicit or default time) is after refInstant; "next W" = W in the following Monday-Sunday week; "last W" = previous occurrence (visibly past). The preview always shows the full date with weekday.
- Ambiguous numeric dates (both parts <= 12 and different, e.g. 03/04) require choosing month/day order; zone abbreviations (CST, IST, BST, EST, ...) require choosing an IANA zone (suggestions offered, no default); unsupported text yields no candidate but manual reminder entry stays available.
- Year omitted: current year in the selected zone; if the result is past, it is shown as past with an explicit "Use next year" button; never silently rolled forward. Past explicit dates stay past.
- Multiple phrases in a block produce separate candidates. English only.
- Frozen-clock reference table: Appendix B (copy verbatim into PRODUCT_SPEC or ARCHITECTURE).

### 7.12 Backup, restore and export (Phase 08 implements; Phase 00 documents)

- Backup file `*.infinitybackup` (zip via yazl): `manifest.json` (`format: "infinity-notes-backup"`, `formatVersion: 1`, appVersion, schemaVersion, createdAt, db `{path, sha256, size}`, attachments `[{id, path, sha256, size}]`), `db/infinity-notes.sqlite3` produced by the SQLite online backup API (`db.backup()`), so WAL content is included; never copy the live file.
- Restore: preflight (zip entry names normalized; reject absolute paths, `..`, drive letters, symlink attributes, entry count > 200,000, total uncompressed > 4 GB default, per-entry compression ratio > 100), extract to `data/restore-staging/`, verify hashes, open staged DB read-only, `PRAGMA integrity_check`, schemaVersion <= app version (older schemas migrate forward after restore; newer are refused), then close live DB, move live data to `data/rollback-<timestamp>/`, move staging into place, reopen; any failure moves the rollback copy back. The previous rollback copy is kept until the next successful start, then deletable from Settings.
- Portable export `*.infinityexport` (zip): JSON documents for projects/folders/notes/references/reminders + attachments; import remaps all note/block/attachment IDs and references and never overwrites existing items. Markdown/plain-text export is documented as lossy (block IDs, reminders, colors, sticky state dropped).
- Automatic backup: off by default; user-chosen destination folder; interval days (default 7) and keep count (default 5).

### 7.13 Security boundaries (ARCHITECTURE "Security")

contextIsolation true, nodeIntegration false, sandbox true for all renderers, single preload exposing `window.infinity` with an explicit method list; every `ipcMain.handle` validates the sender frame URL (app origin: packaged `file://` index or the electron-vite dev URL) and the payload with Zod; JSON payload limit 5 MB except the image import channel (binary, bounded by the image limit). CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob:; font-src 'self'; connect-src 'self'` (+ dev-server/ws in development only); `object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`. `will-navigate` blocked, `setWindowOpenHandler` denies, all permission requests denied. External links open only on Ctrl+Click or the link popover "Open", http/https only, via `shell.openExternal` after URL parsing. No arbitrary file/SQL/shell access from renderers. Production never disables the Chromium sandbox.

### 7.14 IPC conventions and catalogue

- Channel names `domain:action`; request/response via `invoke`; responses `{ok:true, data} | {ok:false, error:{code, message}}` with codes `VALIDATION_FAILED, NOT_FOUND, CONFLICT, LEASE_REQUIRED, CYCLE, LIMIT_EXCEEDED, UNSUPPORTED, FORBIDDEN, INTERNAL`. Events main->renderer through a whitelisted `subscribe(channel, cb)` returning an unsubscribe function.
- Catalogue by phase (ARCHITECTURE lists these; later phase plans may add channels but must update ARCHITECTURE):
  - 01: `app:getInfo`, `settings:get`, `settings:set`, `capabilities:get`; events `settings:changed`.
  - 02: `tree:list`, `project:create|rename|trash`, `folder:create|rename|move|trash`, `note:create|rename|move|trash`, `trash:list|restore|purge`, `note:setPinned`, `item:setFavorite`, `home:summary`, `session:get|set`, `palette:searchTitles`; events `tree:changed`.
  - 03: `note:open`, `note:save`, `lease:acquire|release|take`, `note:convertFormat`, `versions:list|restore`, `drafts:list|resolve`, `attachment:importImageBytes`, `attachment:importFromDialog`; events `note:revision`, `note:lease`, `note:trashed`, `lease:release-request`.
  - 04: `sticky:float|dock|hide|setColor|setPinned|setCollapsed|removeSticky`, `window:getState`; events `sticky:state`.
  - 05: `reminder:create|update|delete|undoDelete|listForNote|listView`, `occurrence:complete|snooze`, `reminders:summary`, `widget:show|hide|setPinned|setCollapsed`, `zones:list`; events `reminder:changed`, `app:openNote`.
  - 06: `reminder:createFromSuggestion`, `suggestion:dismiss|listDismissed`, `reminder:updateFromSource`.
  - 07: `refs:list`, `search:query`, `notes:pick`, `attachment:open|showInFolder`, `shell:openExternal`, `tags:list|set`.
  - 08: `backup:create|restore`, `export:markdown|portable`, `import:portable`, `autostart:set`, `shortcut:setGlobal`.
- Test-only hooks (fake clock control, captured notifications, simulated notification click) exist only when `!app.isPackaged && process.env.INFINITY_NOTES_E2E === '1'`.

### 7.15 Data model and migration allocation (ARCHITECTURE "Data model")

Tables and essential columns (extend the pack's model; keep column names camelCase in TS, snake_case in SQL):

- `meta` (schema via `PRAGMA user_version`), `settings(key PK, value JSON, updated_at)`.
- `projects(id, name, favorite, sort_order, created_at, updated_at, deleted_at, trash_batch_id)`.
- `folders(id, project_id NULL, parent_id NULL, name, favorite, sort_order, created_at, updated_at, deleted_at, trash_batch_id)`.
- `notes(id, project_id NULL, folder_id NULL, title, format 'rich'|'plain', content_json NULL, content_text NULL, plain_text, revision, sticky_enabled, color, pinned_at NULL, favorite, created_at, updated_at, deleted_at, trash_batch_id)`.
- `notes_fts` (FTS5: title, body; tokenizer per D-029; rowid mapped to a notes integer key).
- `note_versions(id, note_id, revision, format, content_snapshot, attachment_ids JSON, reason 'auto'|'conversion'|'conflict'|'restore'|'import', created_at)`.
- `note_drafts(id, note_id, view_id, base_revision, format, content, reason 'conflict'|'lease_lost', created_at, resolved_at)`.
- `attachments(id, managed_relative_path, sha256 UNIQUE, mime, size_bytes, original_name, kind 'image'|'document', created_at, unreferenced_since NULL)`, `note_attachments(note_id, attachment_id, block_id NULL)`.
- `window_state(key PK, bounds JSON, display_id, open, collapsed, always_on_top, updated_at)`.
- `reminders(...)`, `occurrences(...)`, `alert_deliveries(...)` per 7.8-7.9, index on `occurrences(next_alert_at_utc)` where not null.
- `reminder_sources(reminder_id PK, note_id, block_id, source_text, span_start, span_end, reference_instant_utc, reference_zone, parser_version, source_state 'ok'|'changed'|'missing')`, `suggestion_dismissals(dedupe_key PK, note_id, created_at)` with dedupe key = SHA-256 of (noteId, blockId, normalized span text, span start, reference date in zone).
- `note_references(id, source_note_id, source_block_id NULL, target_note_id, target_block_id NULL, target_title_snapshot)`, `tags(id, name UNIQUE)`, `note_tags(note_id, tag_id)`.
- Timestamps INTEGER epoch ms UTC; booleans INTEGER 0/1; foreign keys ON; WAL; `synchronous=FULL`; read queries exclude `deleted_at IS NOT NULL` by default.
- Migration allocation (one forward-only SQL file per number, applied in a transaction with `user_version`; pre-migration backup copy via the backup API into `data/pre-migration/` (keep last 3); a failed migration rolls back and the app shows "Database upgrade failed; your data was not changed" with Show data folder / Quit; a database newer than the app is refused without modification): 001 Phase 01 (settings, projects, folders, notes, notes_fts, note_versions, note_drafts, attachments, note_attachments); 002 Phase 04 (window_state); 003 Phase 05 (reminders, occurrences, alert_deliveries); 004 Phase 06 (reminder_sources, suggestion_dismissals); 005 Phase 07 (note_references, tags, note_tags); 006 Phase 08 only if needed. Accepted migrations are never edited; later phases add new numbers.

### 7.16 Test seams and layout (ARCHITECTURE "Testing")

- Source layout: `src/main/{db,services,windows,ipc}`, `src/preload`, `src/renderer/{shell,editor,stickies,reminders,settings,widget}`, `src/shared/{contracts,types,time,nlp}`, `tests/{unit,integration,e2e,perf,fixtures}`.
- Seams: `Clock`, `NotificationAdapter`, `DisplayProvider` (screens/work areas), `PlatformCapabilities`, `AttachmentStore` root path, DB adapter.
- Integration tests run in Node 24 against real better-sqlite3 temp databases (same N-API binary as Electron). E2E launches the built Electron app with `INFINITY_NOTES_USER_DATA_DIR` pointing to a temp directory. Linux E2E runs under `xvfb-run` in WSL (logic only); native compositor behavior is recorded separately.
- Test-type legend used in BACKLOG: U unit, I integration, E Electron E2E, N native OS validation (manual/semi-manual, recorded in NATIVE_OS_MATRIX), V visual/accessibility review with screenshot evidence, P performance measurement, R review/inspection of code, config or docs.

---

## 8. Document outlines (the implementer writes these headings in this order)

### 8.1 docs/PRODUCT_SPEC.md
1. Purpose and one-paragraph product summary. 2. Users and core flows (create project -> folders -> note -> paste -> link -> reminder -> float). 3. Scope boundaries and non-goals (D-001 list). 4. Requirement catalogue: one table per area with columns `ID | Requirement | Acceptance criterion | Phase` containing every row of Appendix A (criterion = one observable sentence derived from the statement). 5. Reminder behavior in plain language (Done vs dismiss vs snooze vs follow-up vs recurrence; quiet hours; recovery; fully quit). 6. Natural-language policy summary with Appendix B examples. 7. Platform promises and limits (the two promise sentences in 5.3 verbatim, capability table summary). 8. Release targets and OS minimums (5.1) and validation scope (5.2). 9. Performance targets (engineering targets, not measured claims). 10. Glossary (Common, scope, sticky, lease, occurrence, follow-up, recovery batch).

### 8.2 docs/UX_SPEC.md
1. Reference adaptation: what is taken from `framecapt-reference.png` (52 px icon rail with a selected-state pill, compact title/menu row, centered command/search box showing `Ctrl K`, Home tab in a horizontal strip, section labels in small uppercase, softly bordered rounded panels, tile buttons, toggles, violet accent) and what is not copied (capture/record labels, recording options, "Saving to" bar, red badge dot, capture-specific icons). 2. Layout and measurements: rail 52 px; header 44 px; tab strip 36 px (tab width 120-220 px); tree 220-280 (default 248, resizable, persisted `layout.treeWidth`); editor flexible (content max width 760 px); context panel 280-340 (default 300); breakpoints: width < 960 tree becomes a drawer, < 1180 panel becomes a drawer; minimum window 720x480; visual checks at 1100x720 and 760x560. 3. Tokens (light and dark, below). 4. Typography: UI 13 px, editor body 15 px/1.55, H1 22, H2 18, H3 15 semibold, section labels 11 px uppercase letter-spacing 0.04em; font stack `"Segoe UI Variable Text", "Segoe UI", Ubuntu, Cantarell, "Noto Sans", "Noto Sans Bengali", system-ui, sans-serif`; code `"Cascadia Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`. 5. Screens: Home (7.1), Notes tree with Favorites/Common/Projects/Trash, tab strip, note editor (title field, slim formatting toolbar: H, B, I, list, numbered, checklist, link, code block, image, more; no giant toolbar), context panel (7.5), Stickies page (grid of colored cards with Float/Open), sticky window (7.4), Reminders page (tabs Today/Upcoming/Overdue/Completed), reminder widget (default 300x420, min 240x160; header collapse/pin/hide; rows show selected-zone time + local time when different, title, source; Open, Snooze menu, Done), Settings (sections General, Appearance, Notes & attachments, Reminders, Windows & tray, Backup, Keyboard), command palette (Ctrl+K: actions + results). 6. Dialogs and banners with exact copy: close-behavior dialog ("Keep Infinity Notes running in the background? Reminders and stickies only work while the app is running." buttons Keep running in background / Quit, checkbox Remember my choice; Linux adds "If no tray icon appears, launching Infinity Notes again brings this window back."), plain-text conversion warning ("Convert to plain text? Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it."), read-only lease banner, conflict banner, trash overlay in sticky, reminder editor with DST notices, NLP confirmation card (title, literal source text, full date with weekday, time, zone, local conversion, repeat, follow-up, Add/Cancel, disclosures for default times and ambiguity choices), move dialog, delete/empty-trash confirmations, overdue summary banner, migration failure screen. 7. Keyboard map: Ctrl+N new note, Ctrl+Shift+N new sticky, Ctrl+W close tab, Ctrl+Tab / Ctrl+Shift+Tab switch, Ctrl+K palette, Ctrl+F find in note, Ctrl+\ toggle tree, Ctrl+Shift+\ toggle context panel, F2 rename in tree, Delete move to trash (with confirmation), Enter open, arrow keys tree navigation, Escape closes popovers/dialogs, Ctrl+/ keyboard help (Phase 08); editor defaults (Ctrl+B/I, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Ctrl+Shift+7/8/9 lists). Global shortcut optional, off by default. 8. States: empty, loading, saving/saved/error indicator ("Saved", "Saving...", "Not saved - retrying"), read-only, trashed, missing reference, unsupported capability tooltip. 9. Accessibility: ARIA tree/tablist/dialog patterns, visible 2 px focus ring, focus return to invoker, labels on icon buttons, contrast >= 4.5:1 for text and >= 3:1 for UI boundaries in both themes, `prefers-reduced-motion` disables transitions, high-DPI vector icons. 10. Sticky colors (light/dark pairs).

Tokens (light / dark): `--bg #FFFFFF / #17181D`, `--bg-rail #F5F6FA / #1D1F26`, `--bg-subtle #F7F7FB / #22242C`, `--border #E4E6EE / #30333D`, `--text #1D2030 / #E7E8EE`, `--text-muted #5F6475 / #A0A4B3`, `--accent #6A5AE0 / #8E80FF`, `--accent-hover #5848D0 / #A196FF`, `--accent-soft #EFEDFD / #2B2747`, `--accent-border #CFC9F7 / #4A4380`, `--danger #C0392B / #FF7A6E`, `--warning #9A5B00 / #F2B45C`, `--success #2E7D4F / #6BCB8F`, radius 8 px panels / 6 px controls, focus ring 2 px accent with 2 px offset. Sticky colors light/dark: yellow `#FFF4B8/#4A4320`, green `#DDF5D8/#24402A`, blue `#DCEBFF/#22344F`, pink `#FFE0EC/#4A2634`, violet `#ECE6FF/#342C52`, gray `#ECEDF1/#2E3038`. Phase 08 verifies contrast numerically (INF-A11Y-04); adjust values there if a pair fails and record the change.

### 8.3 docs/ARCHITECTURE.md
1. Process model (main/preload/renderers; one renderer bundle, three routes). 2. Source layout (7.16). 3. Data model and migrations (7.15). 4. IPC conventions and catalogue (7.14). 5. Windows: main, sticky map, widget, single-instance, close/tray/quit lifecycle (D-027), capability service and table (5.3). 6. Autosave/revision/lease (7.6) with a sequence diagram in text. 7. Attachments and protocol (7.7). 8. Reminders: model, state machine, scheduler, delivery uncertainty, follow-ups, quiet hours, recovery (7.8-7.9). 9. Time and DST (7.10). 10. NLP pipeline (7.11). 11. Search (D-029; capped 50 results, debounce 150 ms, safe snippets built from text with highlight markers, never raw HTML). 12. References (ID-based links, target title snapshot for missing-target display, block IDs; plain-text notes support note-level references and note-level reminders only in V1, never character offsets). 13. Backup/restore/export (7.12). 14. Security (7.13). 15. Testing architecture (7.16) and standard npm scripts list from the pack (`dev, lint, typecheck, test:unit, test:integration, test:e2e, check, build, package:current, package:win, package:linux`; scripts not yet applicable must print their real status and exit non-zero rather than silently pass). 16. Performance fixtures and targets (pack values). 17. Packaging notes (D-004/D-012, WSL ext4 copy, no shared node_modules).

### 8.4 docs/DECISIONS.md
Header explaining the ADR format, then D-001...D-034 (section 6), then a "Verification log" table: claim | command or URL | date | result (copy from section 3/4 facts and the npm-view log).

### 8.5 docs/BACKLOG.md
1. Legend (ID scheme, test types U/I/E/N/V/P/R, statuses `planned | in_progress | done | not_run | outside_validation_scope | deferred`). 2. Requirement table between the markers `<!-- BACKLOG-TABLE-START -->` and `<!-- BACKLOG-TABLE-END -->`, columns exactly `| ID | Requirement | Phase | Tests | Planned tests | Status |`, one row per Appendix A ID, Status `planned`. 3. TEST_MATRIX cross-reference: one row per TEST_MATRIX area (Hierarchy, Tabs, Editor, Persistence, Floating stickies, References, Reminders, Scheduler recovery, Time zones, Parsing, Suggestions, Widget, Portability, Packaging, Accessibility, Native OS matrix) listing the IDs that cover it (use Appendix C). 4. Per-phase work packages 01-09: ordered work items `W<phase>-<nn>` each listing the IDs it satisfies (derive from Appendix A; Phase 01 must be detailed enough to start immediately: scaffold, pinned install, adapter + migration 001 + settings, secure windows/preload/IPC/CSP/protocol, single-instance + identity, test harness (Vitest unit/integration, Playwright Electron smoke), scripts, CI definitions, native-module verification on Windows and WSL). 5. Change rule: later phases update Status and Planned tests; moving an ID to another phase requires a DECISIONS entry.

---

## 9. Repository instruction merge and ignore entries

### 9.1 CLAUDE.md (preserve; do not edit)

The root `CLAUDE.md` already merges `templates/CLAUDE.md` and adds the user decisions. Do not modify it in Phase 00. Instead, record a clause-by-clause comparison in the progress report:

| Template clause | Root CLAUDE.md location | Result |
| --- | --- | --- |
| Source of truth + merge, do not overwrite | first paragraph (adds CLEANUP_POLICY and phases.json) | covered |
| Minimal offline Electron app, no backend/accounts/sync/collab/AI; shared document/editor; main owns writes/scheduling/windows; narrow IPC; no fake implementations | second paragraph | covered (identical) |
| Model roles via launcher/runner; no recursive runner; no model-change claims | "Model roles" table and paragraph | covered |
| Work in repo, preserve files, install deps, migrations, checks, package; no push/publish; finish acceptance; document blockers; private data outside git | "Working rules" | covered |
| Durable on-disk plans/reports after compaction; read only relevant files | "Progress and resume" (read checkpoint, reports, code after compaction) | covered in substance; "read only relevant files" is efficiency guidance, no edit needed |
| Never promise notifications while quit or guaranteed Wayland positioning | "Working rules" last paragraph | covered |
| Coordinator delegation to five agents; children do not delegate; finalize after gates | "Model roles" + "Final organization" (Node finalizer per user decision) | covered |

If QA finds a template rule genuinely missing, report it to the coordinator rather than editing `CLAUDE.md`.

### 9.2 .gitignore (append only; keep existing lines and order)

Append this block exactly once (skip lines already present):

```
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

Verify with `git check-ignore -v` on sample paths (`x.sqlite3`, `out/main.js`, `.infinity-work/a`) and `git status --porcelain` afterwards; log to `.infinity-work/logs/phase-00/gitignore.log`.

---

## 10. tools/check-traceability.mjs (documentation tool)

Dependency-free ESM script, Node >= 24, no network, read-only. Usage: `node tools/check-traceability.mjs [--repo .] [--plan docs/plans/phase-00.md] [--allow-phase-moves]`. If the plan path does not exist (after final organization it moves to `docs/development/plans/phase-00.md`), try that path before failing.

Checks (each failure printed as `FAIL <check>: <detail>`; exit 1 if any FAIL, else exit 0 with a summary):
Markers are matched only as whole lines (a line that equals the marker after trimming), because this plan also mentions the marker text inline.

1. Parse Appendix A of the plan between the whole-line markers `<!-- REQ-TABLE-START -->` and `<!-- REQ-TABLE-END -->`: rows `| ID | Requirement | Phase | Tests | Planned tests |`. IDs match `^INF-[A-Z0-9]+-\d{2}$`, unique.
2. Parse `docs/BACKLOG.md` between the backlog markers; every plan ID appears exactly once; no extra IDs; Phase is `01`-`09`; Tests is a non-empty comma-separated subset of `U,I,E,N,V,P,R`; Planned tests non-empty; Status in the allowed vocabulary. Phase and Tests must equal the plan's values unless `--allow-phase-moves` is given (later phases), in which case differences are printed as WARN.
3. Every plan ID appears in `docs/PRODUCT_SPEC.md`.
4. Every TEST_MATRIX area name listed in section 8.5 item 3 appears in BACKLOG's cross-reference section.
5. Required files exist and contain their required top-level headings (list from section 8, matched case-insensitively by key words: e.g. PRODUCT_SPEC must contain "Non-goals", "Requirement", "Platform promises", "Release targets"; UX_SPEC "Layout", "Tokens", "Keyboard", "Accessibility", "Dialogs"; ARCHITECTURE "Data model", "IPC", "Autosave", "Attachments", "Reminders", "DST", "Backup", "Security", "Capabilities", "Testing"; DECISIONS D-001 through D-034 headings).
6. Relative Markdown links in the five docs resolve to existing files.
7. Promise review (WARN only, printed for the acceptor): sentences in the five docs that mention notification/reminder/alert together with quit/closed/exited/not running but contain no negation word (not, never, no, stop, stops, cannot, only while, until relaunch), and sentences that contain guarantee/always together with position/placement/on top and no negation or Wayland qualifier. Expected WARN count after implementation: 0 (fix wording rather than suppress).
8. Phase 00 boundary check: fail if `package.json`, `package-lock.json`, `src/` or `tests/` exist while `.infinity-work/agent-status.json` has `current_phase == "00"`.

Run and save output: `node tools/check-traceability.mjs > .infinity-work/logs/phase-00/traceability.log 2>&1; echo exit=$? >> .infinity-work/logs/phase-00/traceability.log`. Also add a negative self-test run (copy BACKLOG to the OS temp dir with one row removed, point the script at it via `--backlog <path>` option, expect exit 1) and log it as `traceability-negative.log`. Support `--backlog <path>` for that purpose.

---

## 11. docs/progress/phase-00.md (what the implementer writes)

Sections:
1. Summary (what was produced; explicit statement that no application source, package.json, lockfile or tests exist yet; scope intentionally small).
2. Files created/changed (paths; `.gitignore` diff lines).
3. Commands run: table `command | exit code | log path` covering env.log, wsl-env.log, npm-view.log, gitignore.log, traceability.log, traceability-negative.log.
4. Dependency and OS decisions summary (pins with licenses, the three peer-range constraints, better-sqlite3 N-API/FTS5/glibc evidence, OS minimums, WSLg validation scope).
5. Requirement coverage: total ID count, counts per phase and per area, statement that every ID maps to a phase and test types (quote the traceability script summary line).
6. Contract checklist: one line per coordinator-listed contract (Home dashboard + filter, Common/project hierarchy, nested folders and cycles, tab session, sticky window/editor reuse and lease, right context panel, reminder state machine, recurrence + DST, follow-up/snooze/quiet hours, notification delivery uncertainty, autosave/revision/lease, attachments safety, backup/restore, weekday parsing, EOD 17:00 and date-only 09:00, capability fallbacks) with the doc section where it is resolved.
7. CLAUDE.md merge comparison table (9.1) and confirmation it was not modified (`git diff --stat CLAUDE.md` is not meaningful before the first commit: record `sha256sum CLAUDE.md` before and after).
8. Consistency review: explicit confirmation lines that the docs never promise reminders while fully quit, never promise Wayland positioning or always-on-top, do not claim GNOME/X11 validation, and do not introduce out-of-scope features; include the promise-review WARN count (expected 0).
9. Risks carried forward (section 13) and pending native cases (none executed in Phase 00; list the future N cases by ID).
10. Handoff to Phase 01: the W01-* work items from BACKLOG.

---

## 12. QA and acceptance verification

QA (fresh session, no doc rewrites except QA report `docs/progress/phase-00-qa.md`):
1. Run `node tools/check-traceability.mjs` (expect exit 0, 0 WARN) and the negative test (expect exit 1). Save logs under `.infinity-work/logs/phase-00/qa-*.log`.
2. Spot-check 10 random IDs across areas: the PRODUCT_SPEC criterion is observable, the phase matches the phase file's work, the test type is plausible (e.g. native notification cases include N).
3. Re-run `npm view` for electron, electron-vite, vite, typescript, typescript-eslint (peerDependencies), better-sqlite3, @tiptap/core, zod, luxon, chrono-node, vitest, @playwright/test, electron-builder and confirm DECISIONS pins exist and peer constraints hold.
4. Contradiction review against PRODUCT_PLAN/ARCHITECTURE/TEST_MATRIX: reminders while fully quit, Wayland positioning/always-on-top, notification actions, EOD/date-only defaults, Appendix B examples (recompute 2026-10-09 17:00 Asia/Dhaka = 11:00Z, 15:00 for "in 2 hours", DST examples), Common is permanent, close hides sticky, dismiss is not completion, widget has no second scheduler, startup/widget/restore-stickies default off, follow-ups default off with 15 min x 2.
5. Boundary review: no package.json/src/tests; pack, `.claude/`, `tools/finalize-docs.mjs`, CLAUDE.md unchanged (compare sha256 values recorded in progress); `.gitignore` only appended.
Acceptor: reads plan, docs, progress, QA report and logs; accepts when all checks pass, every Appendix A ID is mapped, the contract checklist is complete and nothing requires a new product-design discussion for Phase 01.

---

## 13. Risks (record in DECISIONS/ARCHITECTURE and carry forward)

- R-01 better-sqlite3 prebuild in Electron 44: N-API should load unchanged, but Electron's V8 memory cage can reject external buffers. Phase 01 must load it in Electron main (dev and packaged), create an FTS5 table, write/read a BLOB, run `db.backup()` and `PRAGMA compile_options`, on Windows and in WSL. If it fails, switch the adapter to `node:sqlite` (Electron Node 24.21; verify FTS5 and backup there) rather than rebuilding from source (Python forbidden). electron-builder must not trigger node-gyp (`npmRebuild: false`).
- R-02 WSLg has no notification server or tray host by default: native notification/tray cases may be `not_run` or `fail` in WSLg. Installing a notification daemon (e.g. `dunst`) in WSL is a validation-environment change that needs a recorded decision in Phase 05/09; without it record the cases honestly. The in-app fallbacks (5.3) keep reminders usable.
- R-03 WSLg window behavior (RAIL) differs from GNOME; positions are compositor-controlled; record actual behavior, never label as GNOME.
- R-04 TypeScript held at 6.0.3 by typescript-eslint; vite held at 7.3.7 by electron-vite 5. Do not upgrade mid-project unless a security fix requires it (record in DECISIONS).
- R-05 Electron 44 EOL 2027-03-02; acceptable for this release; a later distribution task upgrades.
- R-06 Tiptap UniqueID may keep source IDs on cross-note paste; policy strips incoming block IDs on paste (Phase 03 test).
- R-07 FTS5 tokenizer `categories` with Bangla: verify ranking/prefix behavior with Bangla fixtures in Phases 03/07; fallback is the trigram tokenizer with a recorded decision.
- R-08 Windows toast visibility in dev requires `app.setAppUserModelId`; packaged NSIS shortcut needed for reliable click activation; Phase 05 native evidence uses the packaged or properly identified build.
- R-09 Electron default ozone platform under WSLg must be logged (Wayland vs XWayland) since behavior differs; do not force X11 in production.

---

## 14. Implementation steps (order)

1. Capture environment logs (section 3) and `npm view` log (section 4). Record `sha256sum` of CLAUDE.md, `tools/finalize-docs.mjs` and `.claude/agents/*` before starting.
2. Write `docs/DECISIONS.md` (section 6 + verification log).
3. Write `docs/PRODUCT_SPEC.md` (8.1) including every Appendix A row with an acceptance criterion and Appendix B.
4. Write `docs/UX_SPEC.md` (8.2).
5. Write `docs/ARCHITECTURE.md` (8.3) carrying sections 5.3 and 7.x.
6. Write `docs/BACKLOG.md` (8.5) from Appendix A and Appendix C.
7. Append `.gitignore` block (9.2) and log checks.
8. Write `tools/check-traceability.mjs` (section 10); run positive and negative checks; fix docs until exit 0 and 0 WARN.
9. Write `docs/progress/phase-00.md` (section 11). Recompute sha256 values and confirm unchanged.
10. Return `implemented` with evidence paths. Do not commit.

---

## Appendix A: requirement IDs (canonical list)

ID scheme: `INF-<AREA>-<NN>`; areas FND foundation, SHELL shell, HOME, HIER hierarchy, TABS, KEY keyboard/commands, EDIT editor, SAVE persistence/editing, STKY stickies, DESK desktop lifecycle, REM reminders, SCHED scheduler, WIDG widget, NLP parsing, SUG suggestions, REF references, SRCH search, PORT portability, PREF preferences, A11Y accessibility, PERF performance, PKG packaging/release, SEC security. Tests: U unit, I integration, E Electron E2E, N native OS, V visual/a11y review, P performance, R review/inspection. Planned tests name the intended file and case; later phase plans may refine names and must update BACKLOG.

<!-- REQ-TABLE-START -->
| ID | Requirement | Phase | Tests | Planned tests |
| --- | --- | --- | --- | --- |
| INF-FND-01 | One offline Electron app; no backend, accounts, sync, telemetry or AI calls; no outbound network requests at runtime | 01 | E,R | e2e/smoke.spec › no network requests; dependency review |
| INF-FND-02 | Single-instance lock; a second launch focuses the existing main window | 01 | E,N | e2e/smoke.spec › second instance focuses first |
| INF-FND-03 | Secure windows: contextIsolation, no nodeIntegration, sandbox, CSP, blocked navigation/window.open, permission requests denied | 01 | E,R | e2e/security.spec › renderer has no node/require; navigation blocked |
| INF-FND-04 | Narrow typed preload bridge; Zod-validated payloads; sender validation; payload size limits; renderer cannot read files, run SQL or shell | 01 | U,I,E | unit/contracts.test; integration/ipc-validation.test; e2e/security.spec › bridge surface |
| INF-FND-05 | Main-owned SQLite adapter with WAL, foreign keys, forward-only transactional migrations, pre-migration copy; failed migration rolls back and shows recoverable error; newer schema refused | 01 | I,E | integration/migrations.test › failure rolls back; e2e/migration-failure.spec |
| INF-FND-06 | Versioned settings repository persists across relaunch with defaults and validation | 01 | I,E | integration/settings.test; e2e/smoke.spec › setting survives relaunch |
| INF-FND-07 | User data under userData/data, never install dir; INFINITY_NOTES_USER_DATA_DIR isolates tests | 01 | I,E | integration/paths.test; e2e/smoke.spec › temp userData used |
| INF-FND-08 | Restricted infinity-attachment protocol serves only registered attachment IDs; no paths or traversal | 01 | I,E | integration/protocol.test › unknown id 404, traversal rejected |
| INF-FND-09 | Standard npm scripts exist and report real status (no silent passes) | 01 | R | review package.json scripts + logs |
| INF-FND-10 | Windows and Ubuntu CI definitions (not pushed) with build, tests, native-module check and artifacts | 01 | R | review .github/workflows files |
| INF-FND-11 | Stable app identity (appId, productName, AppUserModelID, icon placeholder) | 01 | R,N | review builder config; native toast identity check |
| INF-FND-12 | Native SQLite loads in Electron main with FTS5, BLOB and backup API on Windows and WSL Ubuntu | 01 | I,E,N | integration/sqlite-capabilities.test; e2e/smoke.spec › db diagnostics |
| INF-FND-13 | Save-revision and writer-lease contracts defined in shared contracts before UI | 01 | U,I | unit/contracts.test › note:save schema; integration/revision.test |
| INF-SHELL-01 | Compact reference-inspired shell: rail (Home, Notes, Stickies, Reminders, Settings), header with search/command box, tab strip, document area, violet accent, no capture-specific labels | 02 | V,E | e2e/shell.spec › rail navigation; screenshot 1100x720 |
| INF-SHELL-02 | Collapsible, resizable tree pane 220-280 px, width persisted | 02 | E,V | e2e/shell.spec › tree toggle and width persists |
| INF-SHELL-03 | Collapsible right context panel 280-340 px with Info section; later Reminders and References sections | 02 | E,V | e2e/shell.spec › panel toggle |
| INF-SHELL-04 | Narrow windows turn tree (<960 px) and panel (<1180 px) into drawers | 02 | E,V | e2e/shell.spec › narrow 760x560 drawers; screenshot |
| INF-SHELL-05 | Compact dark theme tokens following OS theme | 02 | V | screenshot light/dark |
| INF-SHELL-06 | Native window frame and controls; visible keyboard focus | 02 | V,N | screenshot focus ring; native window check |
| INF-HOME-01 | Single reusable Home tab, always first, not closable or duplicable | 02 | E | e2e/home.spec › one Home tab after relaunch |
| INF-HOME-02 | Home shows quick actions (New note, New sticky, New project), Pinned and Recent | 02 | E | e2e/home.spec › pinned and recent reflect data |
| INF-HOME-03 | Home scope filter All/Common/Project on one dashboard, persisted; new items inherit filter scope | 02 | I,E | e2e/home.spec › filter; integration/home-summary.test |
| INF-HOME-04 | Home shows overdue and due-today reminders with link to Reminders page | 05 | E | e2e/reminders.spec › Home reminder section |
| INF-HIER-01 | Common is a permanent scope for notes, stickies and folders; cannot be renamed or deleted | 02 | I,E | integration/hierarchy.test › Common immutable |
| INF-HIER-02 | Create, rename and trash projects | 02 | I,E | integration/hierarchy.test › project CRUD; e2e/tree.spec |
| INF-HIER-03 | Nested folders up to depth 32 in projects and Common; create, rename, trash | 02 | I,E | integration/hierarchy.test › deep folders, depth limit |
| INF-HIER-04 | Notes created at scope root or inside any folder | 02 | I,E | e2e/tree.spec › create note in folder |
| INF-HIER-05 | Stickies can belong to Common or any project/folder before floating exists | 02 | I,E | integration/hierarchy.test › sticky in folder |
| INF-HIER-06 | Duplicate sibling names allowed and disambiguated by path | 02 | I | integration/hierarchy.test › duplicate names |
| INF-HIER-07 | Move notes/folders across folders, projects and Common; subtree scope updated transactionally | 02 | I,E | integration/hierarchy.test › subtree move atomic |
| INF-HIER-08 | Folder cycles rejected with clear message | 02 | I,E | integration/hierarchy.test › cycle rejected; e2e/tree.spec |
| INF-HIER-09 | Trash with batch soft delete, restore to original or nearest valid location, permanent delete with confirmation | 02 | I,E | integration/trash.test; e2e/tree.spec › trash and restore |
| INF-HIER-10 | Pin notes to Home; favorite notes, folders and projects | 02 | I,E | e2e/home.spec › pin; e2e/tree.spec › favorites |
| INF-HIER-11 | Optional small tags (<=20 per note) usable as search filter | 07 | I,E | integration/tags.test; e2e/search.spec › tag filter |
| INF-HIER-12 | Keyboard navigation of the tree (ARIA tree, F2, Delete, Enter, arrows) | 02 | E,V | e2e/a11y-keyboard.spec › tree |
| INF-TABS-01 | Multiple note tabs; one tab per note, reopening focuses it | 02 | E | e2e/tabs.spec › no duplicate tabs |
| INF-TABS-02 | Switch tabs by click and Ctrl+Tab/Ctrl+Shift+Tab | 02 | E | e2e/tabs.spec › ctrl+tab |
| INF-TABS-03 | Close via Ctrl+W, button or middle-click; never deletes the note; pending save flushed first | 02 | E | e2e/tabs.spec › close keeps note; e2e/editor.spec › flush on close |
| INF-TABS-04 | Tab overflow scrolls and offers an All tabs list | 02 | E,V | e2e/tabs.spec › overflow list |
| INF-TABS-05 | Tabs, order and active tab restored after relaunch without duplicates | 02 | I,E | e2e/tabs.spec › restore after relaunch |
| INF-TABS-06 | Trashing a note closes its tabs; restored session skips trashed/missing notes with notice | 02 | E | e2e/tabs.spec › trashed note tab closed |
| INF-TABS-07 | Only the active tab mounts an editor; inactive tabs keep lightweight state; editors disposed; image cache bounded | 03 | E,P | e2e/editor.spec › single editor instance; perf/editors |
| INF-TABS-08 | Singleton page tabs for Stickies, Reminders and Settings | 02 | E | e2e/tabs.spec › page singletons |
| INF-KEY-01 | Ctrl+N creates a note in the current scope | 02 | E | e2e/keyboard.spec › ctrl+n |
| INF-KEY-02 | Ctrl+Shift+N creates a sticky in the current scope | 02 | E | e2e/keyboard.spec › ctrl+shift+n |
| INF-KEY-03 | Ctrl+K command palette with common actions and title search | 02 | E | e2e/palette.spec › actions and titles |
| INF-KEY-04 | Ctrl+F find in the current note | 03 | E | e2e/editor.spec › find in note |
| INF-KEY-05 | Optional global quick-sticky shortcut, off by default, capability checked, failure reported | 08 | I,N | integration/shortcuts.test; native check |
| INF-KEY-06 | Keyboard help listing shortcuts | 08 | E | e2e/settings.spec › keyboard help |
| INF-EDIT-01 | One shared Tiptap editor component for tabs and stickies; no custom contentEditable engine | 03 | R,E | review; e2e/editor.spec |
| INF-EDIT-02 | Headings, bold, italic, bullet/numbered lists, checklist, links, inline code, code blocks, undo/redo | 03 | U,E | unit/editor-schema.test; e2e/editor.spec › formatting survives reload |
| INF-EDIT-03 | Title editing; empty title shows Untitled; rename flushes | 03 | E | e2e/editor.spec › rename |
| INF-EDIT-04 | Separate plain-text document format | 03 | U,I,E | integration/notes-format.test; e2e/editor.spec › plain note |
| INF-EDIT-05 | Rich to plain conversion warns about formatting/image loss and creates a recoverable version | 03 | I,E | integration/notes-format.test › version created; e2e/editor.spec › conversion warning |
| INF-EDIT-06 | Stable UUID block IDs preserved across edits; regenerated on paste and duplicate | 03 | U,E | unit/block-ids.test › paste regenerates |
| INF-EDIT-07 | Pasted HTML sanitized (scripts, handlers, iframes, objects, embeds); remote images not fetched | 03 | U,E | unit/sanitize.test; e2e/paste.spec › no script execution |
| INF-EDIT-08 | Clipboard bitmap paste stored as managed PNG attachment | 03 | I,E | integration/attachments.test; e2e/paste.spec › bitmap |
| INF-EDIT-09 | Image files pasted/dropped/imported are copied into managed storage and remain after the original is removed | 03 | I,E | e2e/paste.spec › original deleted, image still shown after restart |
| INF-EDIT-10 | Image size/type limits with friendly message; SVG/unknown rejected; editor stays responsive | 03 | U,I,E | integration/attachments.test › limits; e2e/paste.spec › oversized message |
| INF-EDIT-11 | Image display with simple size presets | 03 | E | e2e/editor.spec › image size preset |
| INF-EDIT-12 | Unicode including Bangla round-trips in title, content and extracted text | 03 | I,E | integration/notes-save.test › Bangla; e2e/editor.spec › Bangla |
| INF-EDIT-13 | Visible saving/saved/error status | 03 | E | e2e/editor.spec › save indicator |
| INF-EDIT-14 | Import local documents into managed attachments as file chips | 03 | I,E | integration/attachments.test › document import |
| INF-SAVE-01 | Debounced autosave with acknowledgments; flush on blur, tab switch/close, window close and quit | 03 | I,E | integration/notes-save.test › ack; e2e/editor.spec › flush on close |
| INF-SAVE-02 | Content, plain text, FTS and references committed in one transaction; revision broadcast | 03 | I | integration/notes-save.test › atomic commit |
| INF-SAVE-03 | Stale revision never overwrites; conflicting content kept as recoverable draft with UI | 03 | I,E | integration/revision.test › stale save -> draft; e2e/conflict.spec |
| INF-SAVE-04 | Main-managed editing lease; other views read-only with Take edit control; transfer after flush or persisted draft | 03 | I | integration/lease.test › transfer, timeout revoke |
| INF-SAVE-05 | Acknowledged saves survive renderer crash and restart; unacknowledged loss window documented | 03 | I,E | e2e/crash.spec › renderer crash keeps acked text |
| INF-SAVE-06 | Automatic throttled versions plus conversion/conflict/restore versions | 03 | I | integration/versions.test |
| INF-STKY-01 | Float opens a native window for the same note ID; one window per note | 04 | E | e2e/stickies.spec › float same id, no duplicate |
| INF-STKY-02 | Two or more stickies are independent native windows that move/resize outside the main window | 04 | E,N | e2e/stickies.spec › two windows; native move/resize |
| INF-STKY-03 | Dock/Open in app closes the window and opens the note tab with content intact | 04 | E | e2e/stickies.spec › dock |
| INF-STKY-04 | Sticky header: color, source badge, pin (capability checked), collapse, hide, menu | 04 | E,V | e2e/stickies.spec › header controls; screenshot |
| INF-STKY-05 | Closing hides the window; Delete is a separate confirmed command | 04 | E | e2e/stickies.spec › close hides, note remains |
| INF-STKY-06 | Bounds, collapsed and pin persisted; bounds clamped to connected displays; display removal recovery; Wayland restores size only | 04 | I,E,N | integration/window-state.test › clamp; native multi-display |
| INF-STKY-07 | Lease transfer between tab and sticky; read-only mirror gets revisions; no acknowledged text lost | 04 | I,E | e2e/stickies.spec › take control |
| INF-STKY-08 | Trashed note shows a recoverable trash state in its floating window | 04 | E | e2e/stickies.spec › trash overlay restore |
| INF-STKY-09 | Restore open stickies on startup, default off | 04 | I,E | e2e/stickies.spec › restore on startup setting |
| INF-STKY-10 | Stickies page lists sticky notes across scopes with Float/Open and New sticky | 04 | E | e2e/stickies.spec › stickies page |
| INF-STKY-11 | No duplicate windows or leaked listeners; clean disposal | 04 | E | e2e/stickies.spec › reopen cycles leave one window |
| INF-STKY-12 | Main window to background keeps stickies usable; explicit Quit flushes and closes all windows | 04 | E,N | e2e/lifecycle.spec › quit flushes |
| INF-STKY-13 | Unsupported pin/positioning shown as unobtrusive capability fallback; X11 not forced | 04 | U,N | unit/capabilities.test; native WSLg check |
| INF-DESK-01 | First main-window close asks keep running in background or quit; remembered and editable; states that quitting stops reminders | 04 | E | e2e/lifecycle.spec › close dialog |
| INF-DESK-02 | Tray menu (Open, New sticky, Show widget, Quit) where available; tray-less fallback: relaunch focuses running instance | 04 | E,N | e2e/lifecycle.spec › second launch shows window; native tray |
| INF-DESK-03 | Launch at login optional, default off, capability checked | 08 | I,N | integration/autostart.test; native login check |
| INF-REM-01 | Create reminder on a note or block (including stickies) with title, date, time and IANA zone | 05 | I,E | integration/reminders.test › create; e2e/reminders.spec |
| INF-REM-02 | Default zone is the OS zone, editable; never assumes UTC or a hard-coded zone | 05 | U | unit/zone-default.test |
| INF-REM-03 | Show selected-zone time and local time when they differ | 05 | U,E | unit/format-time.test; e2e/reminders.spec |
| INF-REM-04 | Reminder chip in content (decoration, text unchanged) and in side panel | 05 | E | e2e/reminders.spec › chip and panel |
| INF-REM-05 | Reminders page with Today, Upcoming, Overdue and Completed | 05 | I,E | integration/reminder-views.test; e2e/reminders.spec |
| INF-REM-06 | Native notification at due time while running, including background/tray | 05 | I,N | integration/scheduler.test › initial alert (fake adapter); native toast |
| INF-REM-07 | Notification click opens and focuses the source note | 05 | E,N | e2e/reminders.spec › simulated click opens note; native click |
| INF-REM-08 | Dismissing a notification does not complete the reminder | 05 | I | integration/scheduler.test › close is not done |
| INF-REM-09 | Done completes only the current occurrence and stops its follow-ups | 05 | I,E | integration/scheduler.test › done stops followups |
| INF-REM-10 | Snooze replaces next alert, pauses follow-ups, does not shift series, wins race with scheduler | 05 | I | integration/scheduler.test › snooze race |
| INF-REM-11 | Follow-ups off by default; 15 min x2 when enabled; presets 5/10/15/30/60 min, max 1/2/3/5 | 05 | U,I | unit/followup-settings.test; integration/scheduler.test › follow-up limit |
| INF-REM-12 | Daily/weekly recurrence keeps wall-clock time in stored zone across DST; completion affects current occurrence only | 05 | U,I | unit/recurrence.test; integration/scheduler.test › recurrence vs completion |
| INF-REM-13 | Editing a series changes future occurrences and handles the pending one explicitly | 05 | I,E | integration/reminders.test › edit series pending policy |
| INF-REM-14 | DST gap -> first valid instant after; fold -> earlier default, later selectable; previewed | 05 | U,E | unit/resolve-local.test › 2026-03-08 02:30, 2026-11-01 01:30 New York |
| INF-REM-15 | OS zone change affects display/defaults only, not stored reminder zones | 05 | U,I | integration/scheduler.test › os zone change |
| INF-REM-16 | No native action buttons; Snooze/Done/Open always available in app and widget | 05 | R,E | review adapter; e2e/widget.spec |
| INF-REM-17 | Trashed note suspends reminders; restore resumes without flood; deleted block keeps reminder note-linked with anchor-missing state | 05 | I | integration/reminders.test › trash suspend, block missing |
| INF-REM-18 | Delete reminder with undo | 05 | I,E | integration/reminders.test › delete undo |
| INF-SCHED-01 | Single main ReminderService with Clock seam, indexed next-alert query and one timer capped at 60 s | 05 | U,I | integration/scheduler.test › single timer |
| INF-SCHED-02 | Transactional delivery claim with unique key before dispatch; no duplicate dispatch across restart | 05 | I | integration/scheduler-recovery.test › restart around dispatch |
| INF-SCHED-03 | Uncertain claims recorded, not re-dispatched, occurrence stays overdue, never auto-completed | 05 | I | integration/scheduler-recovery.test › crash after claim |
| INF-SCHED-04 | Adapter failure and unsupported recorded distinctly with in-app fallback | 05 | I,E | integration/scheduler.test › adapter failure; e2e/reminders.spec › banner |
| INF-SCHED-05 | Recovery after restart/sleep/clock jump: overdue summary and at most one alert per occurrence per batch; summary notification when more than 3 | 05 | I,N | integration/scheduler-recovery.test › batch limits; native sleep/wake |
| INF-SCHED-06 | Quiet hours in an explicit zone defer alerts to the end, collapsed, still overdue | 05 | U,I | integration/scheduler.test › quiet hours |
| INF-SCHED-07 | Recurrence generation unique per reminder+instant with bounded backfill (one open overdue per series) | 05 | I | integration/scheduler-recovery.test › long downtime no flood |
| INF-SCHED-08 | Follow-up count increments at claim; recovery neither loops nor exhausts counts | 05 | I | integration/scheduler-recovery.test › followup counts |
| INF-SCHED-09 | Reminders stop when fully quit; UI states it; relaunch recovers | 05 | E,R | e2e/lifecycle.spec › relaunch overdue summary |
| INF-WIDG-01 | Optional reminder widget (default off) with Today/Upcoming/Overdue, Open, Snooze, Done | 05 | E | e2e/widget.spec › actions |
| INF-WIDG-02 | Widget movable, resizable, collapsible, hideable; optional capability-checked always-on-top, default off | 05 | E,N | e2e/widget.spec › collapse/hide; native pin |
| INF-WIDG-03 | Widget uses the main ReminderService; hiding it keeps scheduling; state shared live | 05 | I,E | e2e/widget.spec › done in widget updates app |
| INF-NLP-01 | Local English parsing with explicit reference instant and selected zone; no network or LLM | 06 | U,R | unit/nlp-parse.test; dependency review |
| INF-NLP-02 | Calendar components converted in the selected IANA zone, not a fixed offset | 06 | U | unit/nlp-parse.test › zone conversion |
| INF-NLP-03 | End of day = configurable 17:00; tomorrow EOD at 2026-10-08 13:00 Dhaka -> 2026-10-09 17:00 Dhaka (11:00Z) | 06 | U | unit/nlp-parse.test › tomorrow end of the day |
| INF-NLP-04 | Date-only phrases use 09:00 with visible disclosure | 06 | U,E | unit/nlp-parse.test › date-only; e2e/nlp.spec › disclosure |
| INF-NLP-05 | Explicit times honored (tomorrow at 8pm -> 20:00) | 06 | U | unit/nlp-parse.test › explicit time |
| INF-NLP-06 | Durations use instant arithmetic (in 2 hours -> 15:00 Dhaka) | 06 | U | unit/nlp-parse.test › duration |
| INF-NLP-07 | Weekday policy (bare/this/next/last) per D-025 | 06 | U | unit/nlp-parse.test › weekday table |
| INF-NLP-08 | Ambiguous numeric dates and bare hours require explicit choice | 06 | U,E | unit/nlp-parse.test › 03/04 at 5; e2e/nlp.spec › choice required |
| INF-NLP-09 | Zone abbreviations require choosing an IANA zone | 06 | U,E | unit/nlp-parse.test › CST |
| INF-NLP-10 | Past dates stay visibly past; year-less past dates offer explicit next year | 06 | U,E | unit/nlp-parse.test › past date |
| INF-NLP-11 | Multiple phrases in one block yield separate candidates | 06 | U | unit/nlp-parse.test › multiple phrases |
| INF-NLP-12 | Unsupported phrases give no candidate; manual entry remains available | 06 | U,E | unit/nlp-parse.test › unsupported |
| INF-NLP-13 | Calendar arithmetic uses the selected zone near midnight (New York vs Dhaka) | 06 | U | unit/nlp-parse.test › new york tomorrow |
| INF-NLP-14 | English only; no implied multilingual parsing | 06 | R | review docs/UI copy |
| INF-SUG-01 | Idle detection in notes and stickies with unobtrusive underline and Create reminder; typing never interrupted, text unchanged | 06 | U,E | unit/suggest-detect.test; e2e/nlp.spec › underline, text unchanged |
| INF-SUG-02 | Selected text -> Create reminder | 06 | E | e2e/nlp.spec › selection |
| INF-SUG-03 | Confirmation card shows title, source text, weekday date, time, zone, local conversion, repeat, follow-up, Add/Cancel, DST choices | 06 | E | e2e/nlp.spec › card fields |
| INF-SUG-04 | No reminder is persisted before Add | 06 | I,E | integration/suggestions.test › cancel creates nothing |
| INF-SUG-05 | Confirmed absolute instant and source anchor persisted | 06 | I | integration/suggestions.test › source stored |
| INF-SUG-06 | Suggestions and dismissals deduped across edits and restarts; confirmed links by reminder ID | 06 | I,E | integration/suggestions.test › dedupe after restart |
| INF-SUG-07 | Restart never reinterprets saved relative text | 06 | I | integration/suggestions.test › next-day restart same instant |
| INF-SUG-08 | Source edit requires explicit Update; no silent move | 06 | I,E | integration/suggestions.test › source changed state |
| INF-SUG-09 | Deleted source block keeps reminder note-linked with anchor unavailable | 06 | I | integration/suggestions.test › block deleted |
| INF-SUG-10 | End-to-end phrase -> preview -> confirm -> side panel -> notification opens source | 06 | E | e2e/nlp.spec › full flow |
| INF-REF-01 | Insert note link via searchable picker | 07 | E | e2e/references.spec › picker |
| INF-REF-02 | Stable block references to another note's block | 07 | I,E | integration/references.test › block ref |
| INF-REF-03 | Side panel shows outgoing references and backlinks | 07 | I,E | e2e/references.spec › backlinks |
| INF-REF-04 | Open reference in a tab and scroll to the block | 07 | E | e2e/references.spec › scroll to block |
| INF-REF-05 | Rename/move of target preserves links | 07 | I,E | integration/references.test › rename/move |
| INF-REF-06 | Missing/trashed target or block shows clear state with restore/search; no silent redirect | 07 | I,E | e2e/references.spec › trashed target |
| INF-REF-07 | Pasted/duplicated content never aliases block IDs | 07 | U,I | integration/references.test › duplicate content |
| INF-REF-08 | Attached documents opened via validated OS handoff; executables never launched | 07 | I,E | integration/handoff.test › blocked extensions |
| INF-REF-09 | Quick sticky creation inherits scope; no forced project | 07 | E | e2e/stickies.spec › quick sticky scope |
| INF-SRCH-01 | FTS5 search over titles and bodies including Bangla with prefix matching | 07 | I | integration/search.test › Bangla, prefix |
| INF-SRCH-02 | Index updates on edit, move, trash and restore | 07 | I | integration/search.test › index lifecycle |
| INF-SRCH-03 | Scope and tag filters in search | 07 | I,E | integration/search.test › scope filter |
| INF-SRCH-04 | Highlighted snippets rendered safely | 07 | U,E | unit/snippet.test › no HTML injection |
| INF-SRCH-05 | Debounced capped results (<=50); 10,000-note fixture measured | 07 | P,I | perf/search › p95 |
| INF-SRCH-06 | Ctrl+K palette opens exact note/tab without unsaved edit loss | 07 | E | e2e/palette.spec › open with pending edit |
| INF-PORT-01 | Backup: consistent snapshot including WAL data, referenced attachments, manifest with hashes | 08 | I | integration/backup.test › WAL content present |
| INF-PORT-02 | Restore with preflight, staging and rollback; failed restore leaves data usable | 08 | I,E | integration/restore.test › failure rollback |
| INF-PORT-03 | Import rejects traversal, symlinks, oversized, bombs and unsupported schema | 08 | I | integration/import-security.test |
| INF-PORT-04 | Portable import remaps note/block/attachment IDs and references | 08 | I | integration/import.test › remap |
| INF-PORT-05 | Markdown/plain-text export with documented lossy limits | 08 | I | integration/export.test |
| INF-PORT-06 | Automatic backup option, default off, configurable destination and retention | 08 | I,E | integration/backup.test › auto schedule |
| INF-PORT-07 | Configurable trash and version retention; version history with restore | 08 | I,E | integration/versions.test › retention; e2e/versions.spec |
| INF-PORT-08 | Attachment GC only after reference checks and grace period | 08 | I | integration/attachment-gc.test |
| INF-PREF-01 | Theme System/Light/Dark | 08 | E,V | e2e/settings.spec › theme |
| INF-PREF-02 | Reminder defaults: zone, end-of-day 17:00, date-only 09:00, follow-up defaults | 08 | I,E | integration/settings.test › reminder defaults |
| INF-PREF-03 | Quiet hours settings | 08 | E | e2e/settings.spec › quiet hours |
| INF-PREF-04 | Window, tray, close, widget, startup and restore-stickies settings with fully-quit explanation | 08 | E | e2e/settings.spec › lifecycle settings |
| INF-PREF-05 | Attachment size limits configurable within bounds | 08 | I | integration/settings.test › limits bounds |
| INF-A11Y-01 | Keyboard-only use of tree, tabs, dialogs, editor, widget and palette | 08 | E,V | e2e/a11y-keyboard.spec |
| INF-A11Y-02 | Focus returns to the invoking control after dialogs/menus | 08 | E | e2e/a11y-keyboard.spec › focus return |
| INF-A11Y-03 | Accessible names and roles for icon buttons and regions | 08 | E | e2e/a11y-keyboard.spec › getByRole coverage |
| INF-A11Y-04 | Text contrast >= 4.5:1 and UI boundaries >= 3:1 in both themes | 08 | U,V | unit/contrast.test › token pairs |
| INF-A11Y-05 | Reduced motion honored | 08 | U,V | unit/css-motion.test; screenshot |
| INF-A11Y-06 | High-DPI rendering (125-200%) is crisp | 08 | V,N | native scaling check |
| INF-PERF-01 | Fixtures: 10,000 notes, 100 projects, 10 tabs, 10 stickies, 1,000 reminders | 09 | P | perf/fixtures generator |
| INF-PERF-02 | Cold startup measured against <3 s target on documented machine | 09 | P | perf/startup |
| INF-PERF-03 | Search p95 measured against <300 ms target at 10,000 notes | 09 | P | perf/search |
| INF-PERF-04 | Image-heavy note responsiveness and inactive-editor memory measured | 09 | P | perf/editor-memory |
| INF-PERF-05 | Repeated sticky/widget open-close leaves no leaked windows or listeners | 09 | E,P | e2e/stickies.spec › leak check; perf/windows |
| INF-PKG-01 | Windows NSIS installer x64, unsigned and labeled | 09 | N | native install/launch Windows |
| INF-PKG-02 | Linux AppImage and .deb built from WSL ext4 copy | 09 | N | native build/install WSL |
| INF-PKG-03 | Packaged app loads native SQLite and persists data | 09 | N | native packaged launch/relaunch |
| INF-PKG-04 | Reinstall/update preserves data; uninstall behavior documented | 09 | N,R | native reinstall; docs review |
| INF-PKG-05 | Native OS matrix with host/compositor details; GNOME/X11-only cases marked outside_validation_scope | 09 | N,R | docs/NATIVE_OS_MATRIX.md review |
| INF-PKG-06 | FINAL_REPORT, NATIVE_OS_MATRIX, RELEASE_CHECKLIST and user install/use/backup docs | 09 | R | docs review |
| INF-SEC-01 | External links open only http/https via validated handoff on explicit action | 03 | U,E | unit/url-policy.test; e2e/editor.spec › link open |
| INF-SEC-02 | Production keeps Chromium sandbox; packaged security settings reviewed | 09 | R | review builder/fuses config |
| INF-SEC-03 | Dependency audit and license review before release | 09 | R | npm audit + license list log |
<!-- REQ-TABLE-END -->

Total: 187 requirement IDs.

## Appendix B: frozen-clock and DST reference examples

Reference instant 2026-10-08 13:00 Asia/Dhaka (2026-10-08T07:00:00Z, a Thursday), selected zone Asia/Dhaka unless stated. Defaults: end of day 17:00, date-only 09:00.

| Input | Result (selected zone) | UTC | Notes |
| --- | --- | --- | --- |
| tomorrow end of the day | Fri 2026-10-09 17:00 | 2026-10-09T11:00Z | EOD default disclosed |
| Have to submit this by tomorrow end of the day | Fri 2026-10-09 17:00 | 11:00Z | title "Have to submit this" (phrase removed) |
| tomorrow at 8pm | Fri 2026-10-09 20:00 | 14:00Z | explicit time |
| in 2 hours | Thu 2026-10-08 15:00 | 09:00Z | instant arithmetic |
| tomorrow | Fri 2026-10-09 09:00 | 03:00Z | date-only default disclosed |
| end of day | Thu 2026-10-08 17:00 | 11:00Z | standalone = today |
| Friday / this Friday | Fri 2026-10-09 09:00 | 03:00Z | bare weekday |
| Friday at 5pm | Fri 2026-10-09 17:00 | 11:00Z | |
| next Friday | Fri 2026-10-16 09:00 | 2026-10-16T03:00Z | following Mon-Sun week |
| Thursday | Thu 2026-10-15 09:00 | 2026-10-15T03:00Z | today's 09:00 already past |
| Thursday 5pm | Thu 2026-10-08 17:00 | 11:00Z | today, still future |
| next Thursday | Thu 2026-10-15 09:00 | 2026-10-15T03:00Z | following week |
| Monday / next Monday | Mon 2026-10-12 09:00 | 2026-10-12T03:00Z | both fall in the following week; preview shows date |
| Sunday / next Sunday | Sun 2026-10-11 09:00 / Sun 2026-10-18 09:00 | 2026-10-11T03:00Z / 2026-10-18T03:00Z | |
| last Friday | Fri 2026-10-02 09:00 | 2026-10-02T03:00Z | visibly past |
| 03/04 at 5 | choice required: Mar 4 or Apr 3; 05:00 or 17:00 | n/a until chosen | year omitted -> 2026 -> past -> "Use next year" offered |
| on Oct 1 | Thu 2026-10-01 09:00 (past) | 2026-10-01T03:00Z | never silently rolled to 2027 |
| by 5 CST | zone choice required (no default) | n/a until chosen | abbreviation ambiguous |
| tomorrow at 9am, zone America/New_York, reference 2026-10-08T03:30Z (Dhaka 09:30 Oct 8, New York 23:30 Oct 7) | Thu 2026-10-08 09:00 New York | 13:00Z | tomorrow in New York is Oct 8 |
| same input, zone Asia/Dhaka | Fri 2026-10-09 09:00 Dhaka | 03:00Z | |
| 2026-03-08 02:30, America/New_York | 03:00 EDT | 2026-03-08T07:00Z | gap: first valid instant after |
| 2026-11-01 01:30, America/New_York | 01:30 EDT (default) or 01:30 EST | 05:30Z or 06:30Z | fold: earlier default, later selectable |
| Confirm "tomorrow" on 2026-10-08, restart 2026-10-09 | still Fri 2026-10-09 09:00 | 03:00Z | stored instant never reparsed |

## Appendix C: TEST_MATRIX cross-reference (copy into BACKLOG section 3)

| TEST_MATRIX area | Requirement IDs |
| --- | --- |
| Hierarchy | INF-HIER-01..10, INF-HIER-12 |
| Tabs | INF-TABS-01..08 |
| Editor | INF-EDIT-01..14, INF-SEC-01 |
| Persistence | INF-FND-05, INF-FND-06, INF-FND-13, INF-SAVE-01..06, INF-SRCH-02 |
| Floating stickies | INF-STKY-01..13 |
| References | INF-REF-01..07, INF-EDIT-06 |
| Reminders | INF-REM-01..18, INF-HOME-04 |
| Scheduler recovery | INF-SCHED-01..09 |
| Time zones | INF-REM-02, INF-REM-03, INF-REM-12, INF-REM-14, INF-REM-15, INF-NLP-02, INF-NLP-13 |
| Parsing | INF-NLP-01..14 |
| Suggestions | INF-SUG-01..10 |
| Widget | INF-WIDG-01..03 |
| Portability | INF-PORT-01..08 |
| Packaging | INF-PKG-01..04, INF-FND-11, INF-FND-12 |
| Accessibility | INF-A11Y-01..06, INF-HIER-12, INF-SHELL-06 |
| Native OS matrix | INF-PKG-05, INF-REM-06, INF-REM-07, INF-STKY-02, INF-STKY-06, INF-STKY-13, INF-DESK-02, INF-DESK-03, INF-WIDG-02, INF-SCHED-05, INF-KEY-05, INF-A11Y-06 |

In BACKLOG, expand ranges (`..`) into explicit IDs so the traceability script can match them.

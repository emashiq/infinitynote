# Phase 02 progress: Home, projects, folders and tabs

Plan: `docs/plans/phase-02.md`. Decisions: D-044 to D-050.

## Pass A (core) - infinity-code-medium (Sonnet 5.5, medium), 2026-10-08

Status: implemented. Pass B (shell UI) and Pass C (E2E, validation, final report) are still to do. The Phase 01 foundation screen is untouched and the existing E2E suite is green.

### Scope delivered

Migration 002, shared contracts and pure models, repositories and main services, validated IPC with the narrow frozen preload bridge, `tree:changed` broadcast, the headless renderer state layer (stores, note controller, commands, shortcuts), a fake bridge for tests, unit and integration tests, and F-01-1 (CI Node 24.21.0).

### Changed and created files

Migration (D-044)
- `src/main/db/migrations/002_hierarchy_indexes.sql` (new), `migrations/index.ts` (`LATEST = 2`), `migrations/checksums.json` (regenerated; 001 unchanged `303c9fc2...`, 002 `224e179b23706f97799892d77bb85d9f1ac57db5669dcb089251735a3e88aaab`).

Main
- Repositories: `db/repositories/hierarchy-repo.ts` (new: row reads, subtree and depth CTEs, `reparentFolder`, `findInvariantViolation`), `notes-repo.ts` (location, sticky and color on create; `getOpenRow`).
- Services (new): `hierarchy-service.ts`, `trash-service.ts`, `home-service.ts`, `session-service.ts`, `palette-service.ts`, `note-reader.ts`, `dto.ts` (DTO mappers, `runTx`, exact error messages). `settings-service.ts` changed (`getInternal`, `setInternal`, public-only `get` and `set`).
- IPC handlers (new): `hierarchy-handlers.ts`, `trash-handlers.ts`, `home-handlers.ts`, `session-handlers.ts`, `palette-handlers.ts`, `note-handlers.ts` (open, save with `MAX_CONTENT_BYTES + 65536` payload limit, lease acquire and release), `need.ts`. `settings-handlers.ts` types only.
- `index.ts`: constructs the services when the database opened, registers all handlers, broadcasts `tree:changed` through the event bus. `windows/main-window.ts`: pure `mainWindowOptions()` extracted, values unchanged.

Shared
- Contracts: `hierarchy.ts`, `home.ts`, `session.ts`, `palette.ts` (new); `notes.ts`, `settings.ts`, `channel-names.ts`, `channels.ts`, `bridge.ts` (extended).
- Pure modules (new): `names.ts`, `tree/tree-model.ts`, `tree/paths.ts`, `tabs/tab-session.ts`, `text/textarea-doc.ts`, `time/relative-time.ts`.

Preload: `src/preload/index.ts` (new namespaces, still frozen at every level, no generic invoke).

Renderer state (no JSX, no CSS): `src/renderer/state/{store,use-store,app-services,tree-store,tabs-store,home-store,layout-store,ui-store,notice-store,theme-store,commands,shortcuts,current-location,palette-actions}.ts`, `src/renderer/notes/note-controller.ts`.

CI (F-01-1): `.github/workflows/ci.yml` `node-version: '24.21.0'`; `tests/unit/ci-config.test.ts` asserts it and that `24.15.0` is absent.

Tests
- Unit (new): `names`, `tree-model`, `tree-paths`, `tab-session`, `textarea-doc`, `relative-time`, `shortcuts`, `palette-actions`, `tokens`, `main-window-options`, `contracts-phase02`; renderer state: `note-controller`, `tabs-store`, `current-location`, `layout-store`, `home-store`, `tree-commands` (tree store, command runner, app services); support: `tests/unit/renderer/support/fake-bridge.ts`, `services.ts`.
- Unit (updated): `contracts.test.ts`, `migrations-checksum.test.ts`, `ci-config.test.ts`, `boundaries.test.ts` (the old "no `note:`/`lease:` in preload" guard now names the Phase 03-only channels).
- Integration (new): `hierarchy`, `trash`, `home-summary`, `session`, `palette`, `notes-open-save`, `ipc-handlers-phase02` (the new-handler part of the plan's `ipc-validation.test` update, in its own file), helper `hierarchy-helpers.ts`. Updated: `migrations.test.ts` (v2, failure injection at version 3, new populated v1 to v2 upgrade case), `ipc-validation.test.ts` (out-of-catalogue example is now `lease:take`), `settings.test.ts`.
- E2E expectation updates only: `security.spec` bridge surface (deep key set, every namespace frozen), `smoke.spec` and `packaged.spec` `schemaVersion` 2.

### Commands and results (Windows 11, Node 24.15; E2E runner Node 24.21.0 via `INFINITY_E2E_NODE`)

| Command | Exit | Log |
| --- | --- | --- |
| `npm run check` (lint, typecheck, 205 unit, 124 integration, traceability 0 fails) | 0 | `.infinity-work/logs/phase-02/passA-check.log` |
| `npm run build` | 0 | `.infinity-work/logs/phase-02/passA-build.log` |
| `npm run test:e2e` (23 passed, 1 skipped Linux-only) | 0 | `.infinity-work/logs/phase-02/passA-test-e2e.log` |

Extra check, not a gate: a temporary Electron probe (deleted afterwards) drove the real bridge through project, folder, sticky note, lease, save, open, tree, home, palette, session, trash, restore and purge with `validateResponses` on, and confirmed `tree:changed` events, `VALIDATION_FAILED` for `projectId: 'common'` and for `settings.get(['session.tabs'])`, and `user_version` 2.

### API reference for Pass B (UI wiring)

Entry: `createAppServices(bridge, deps?)` from `src/renderer/state/app-services.ts` returns `AppServices`. Provide it with `AppServicesContext.Provider` and read it with `useServices()`; subscribe to a store with `useStore(store)` (returns the whole state; there are no selectors). `services.ready` resolves when settings, tree, trash, session and Home are loaded; set `data-ready="true"` on `#app-shell` then. `services.dispose()` on unmount. Do not construct stores yourself.

`AppServices`: `{ bridge, viewId, now(), meta, theme, tree, tabs, home, layout, ui, notices, commands, ready, init(), dispose() }`. Every store object exposes `.store` (state) and methods. Actions that talk to main return `Outcome<T>` = `{ok:true,data}` or `{ok:false,code,message}`; show `message` as is.

- `meta.getState().info`: `AppInfoType | null` (version, `sqlite.version`) for Settings > About.
- `theme.store` `{value}`; `theme.set('system'|'light'|'dark')` persists and applies `data-theme` (also follows the OS while `system`).
- `tree.store` state: `{status:'loading'|'ready'|'error', snapshot, trash, model, expanded:Set<NodeKey>, selectedKey, hasFocus, error?}`. `model` is a `TreeModel` (`nodes: Map<NodeKey,TreeNode>`, `roots`); render with `flattenVisible(model, expanded)` and `treeKeyAction(rows, currentKey, key)` from `src/shared/tree/tree-model.ts`. `TreeNode`: `{key, kind:'group'|'common'|'project'|'folder'|'note'|'favorite'|'trashItem'|'empty', id?, label, sticky?, color?, pinned?, favorite?, entity?, parentKey, childKeys, location?, targetKey?, trash?}`. Methods: `select(key)`, `setHasFocus(b)`, `toggle(key)`, `setExpanded(key, open)`, `reveal(key)`, `locationFor(key)`, `reload()`, `createProject(name)`, `createFolder(target, name)`, `createNote(location, {sticky, title?})` (all create methods reveal and select the new node; projects are also expanded), `renameProject/renameFolder/renameNote`, `moveFolder(id, target)`, `moveNote(id, location)`, `moveItem(key, dest)`, `moveDestinations(key): MoveDestination[]` (`{key, path, projectId, folderId, current}`), `trashProject/trashFolder/trashNote`, `restore(batchId)` (pushes the restore notice), `purge(batchId)`, `emptyTrash()`, `setPinned(noteId, bool)`, `setFavorite(kind, id, bool)`. Rename and name validation: call `validateName`/`validateTitle` from `src/shared/names.ts` before IPC to show the friendly message. Trash methods flush the active note first and tab closing happens through `tree:changed`.
- `tabs.store` state: `{session:{version,tabs,activeTabId}, ready, controllerNoteId}`. Tabs: `{id:'home'|'note:<noteId>'|'page:stickies'|'page:reminders'|'page:settings', kind, noteId?, scrollTop?}`. Methods: `openNote(noteId)`, `openPage('stickies'|'reminders'|'settings')`, `activate(id)`, `close(id)`, `closeActive()`, `next()`, `prev()`, `setScrollTop(tabId, px)`, `activeController(): NoteController|null`, `flushActive()`. All return promises (`boolean` for navigation). Note tab labels come from `tree.store` `snapshot.notes` via `displayTitle`.
- `NoteController` (`tabs.activeController()`): `store` state `{status:'loading'|'ready'|'readOnly'|'trashed'|'missing'|'error', note, title, text, revision, save:'saved'|'saving'|'retrying'|'error', message?, titleError?, trashBatchId?}`. Methods `setText(t)`, `rename(title)`, `flush()`, `noteId`. Re-read the controller when `tabs.store` `controllerNoteId` changes.
- `home.store` `{scope, scopeValid, summary:{pinned, pinnedTotal, recent}|null, status}`; `setScope(scope)`, `refresh()`.
- `layout.store` `{viewportWidth, treeMode, panelMode, treeOpen, panelOpen, treeWidth, treeDrawerOpen, panelDrawerOpen}`; `toggleTree()`, `togglePanel()`, `setTreeWidth(px, {persist})` (clamped 220..280), `closeDrawers()`, `treeVisible()`, `panelVisible()`.
- `ui.store` `{dialog, paletteOpen, menu, focusRequest}`; `openDialog(d)`, `closeDialog()`, `openPalette()`, `closePalette()`, `openMenu(key, anchor)`, `closeMenu()`, `requestFocus(req)`, `consumeFocus()`. Dialog kinds: `newProject`, `newFolder {target}`, `move {key}`, `confirmTrash {key}`, `confirmPurge {batchId,count}`, `confirmEmptyTrash {count}`. Focus requests: `noteTitle {noteId}`, `treeRename {key}`, and `tree` (added so the Notes rail button can focus the tree).
- `notices.store` `{notices:[{id,text,tone}]}`; `push(text, tone)`, `dismiss(id)` (auto-dismiss 10 s, max 3 shown).
- `commands.run(id)` for `note.new`, `sticky.new`, `project.new`, `folder.new`, `go.home|stickies|reminders|settings`, `view.toggleTree|togglePanel`, `tab.close|next|prev`, `palette.open`; `commands.currentLocation()`.
- `matchShortcut(event)` in `shortcuts.ts` returns a `CommandId` or `null`. `PALETTE_ACTIONS` and `filterActions(actions, query)` in `palette-actions.ts`. `palette.searchTitles` is called directly on `services.bridge.palette` (debounce 150 ms in the component).
- Other pure helpers: `formatRelative(then, now)`, `displayTitle`, `COMMON_LABEL`, `buildPathIndex`/`pathOf`, `textToDoc`/`docToText`.

Bridge (`window.infinity`, frozen): `app{getInfo,quit,showDataFolder}`, `capabilities{get}`, `folder{create,move,rename,trash}`, `home{summary}`, `item{setFavorite}`, `lease{acquire,release}`, `note{create,move,open,rename,save,setPinned,trash}`, `palette{searchTitles}`, `project{create,rename,trash}`, `session{get,set}`, `settings{get,set}`, `trash{list,purge,restore}`, `tree{list}`, `subscribe('settings:changed'|'tree:changed', cb)`.

Gaps or notes for Pass B: no store gaps found. The drawer open/close and focus return, the dialog host and the menu are UI only. Components must not call `bridge.session.*`, `bridge.lease.*` or `bridge.note.save` directly; the stores and the controller own them. The foundation screen test (`tests/unit/renderer/foundation.test.tsx`) still exists and is removed by Pass B.

### Requirement coverage so far (Pass A, logic and persistence layers)

| IDs | Covered by |
| --- | --- |
| INF-HOME-01 (one Home, first) | `tab-session.test`, `session.test`, `contracts-phase02.test` |
| INF-HOME-02, INF-HOME-03 (data) | `home-summary.test`, `home-store.test`, `tree-commands.test` (command runner) |
| INF-HIER-01 to INF-HIER-09 (data) | `hierarchy.test`, `trash.test`, `contracts-phase02.test`, `ipc-handlers-phase02.test`, `tree-paths.test`, `tree-commands.test` |
| INF-HIER-10 (data) | `hierarchy.test` (pin, favorite), `tree-model.test` (Favorites group), `ipc-handlers-phase02.test` |
| INF-HIER-12 (model) | `tree-model.test` (APG key actions) |
| INF-TABS-01 to INF-TABS-06, INF-TABS-08 (state and persistence) | `tab-session.test`, `tabs-store.test`, `note-controller.test`, `session.test`, `notes-open-save.test` |
| INF-KEY-01 to INF-KEY-03 (logic) | `current-location.test`, `shortcuts.test`, `palette-actions.test`, `palette.test`, `tree-commands.test` |
| INF-SHELL-02, INF-SHELL-04 (state) | `layout-store.test` |
| INF-SHELL-05 (tokens), INF-SHELL-06 (window options) | `tokens.test`, `main-window-options.test` |
| INF-SHELL-01, INF-SHELL-03, INF-SHELL-05 (rendering), INF-HOME-* and INF-HIER-* (UI), INF-TABS-* (UI), INF-KEY-* (E2E) | Pass B and Pass C |

No BACKLOG status was changed in Pass A (Pass C owns that).

### Notes and deviations

- `ipc-validation.test.ts` kept its Phase 01 tests; the Phase 02 handler tests live in the new `ipc-handlers-phase02.test.ts`. The 4.9 MiB save, the 5 MiB + 1 and the over-limit payload cases are there.
- `tests/unit/boundaries.test.ts` and the "no Phase 03 channel" case in `contracts.test.ts` needed updating because `note:*` and `lease:acquire/release` are now real Phase 02 channels. They now assert the Phase 03-only names are absent (`lease:take`, `note:revision`, `note:lease`, `lease:release-request`, `note:convertFormat`).
- `tests/unit/renderer/support/services.ts` (helper that builds `AppServices` over the fake bridge) was added next to `fake-bridge.ts`.
- `ThemeStore` (`theme-store.ts`) was added so the theme logic moved from `theme/theme.ts` has a store owner for the Settings page.
- No dependency changes: `package.json` and `package-lock.json` untouched.
- Known limitation unchanged from the plan: text typed within 400 ms before the window closes is flushed only on a best-effort `pagehide` hook until Phase 03 (D-048).

## Pass B (shell UI) - infinity-code-low (Sonnet 5.5, low), 2026-10-08

Status: implemented. Pass C (E2E specs, existing-spec selector updates, jsdom depth tests, F-01-4, native gates, final report) is still to do. No store gaps were found, so nothing was added outside the Pass B file list.

### Components created (plan section 11 mapping)

| Section | Files | Requirement IDs |
| --- | --- | --- |
| Entry (app, startup error kept) | `src/renderer/App.tsx` (one `AppServices` per bridge via a `WeakMap`, renders `Shell`), `main.tsx` (CSS imports) | INF-SHELL-01 |
| 11.1 Layout, landmarks, drawers, splitter | `shell/Shell.tsx`, `Drawer.tsx`, `Splitter.tsx`, `styles/shell.css`, `tokens.css` additions | INF-SHELL-01 to 04, INF-SHELL-05 |
| 11.2 Header | `shell/Header.tsx` | INF-SHELL-01, INF-KEY-03 |
| 11.3 Rail | `shell/Rail.tsx` | INF-SHELL-01, INF-SHELL-03 |
| 11.4 Tab strip, all-tabs menu, tab panel | `tabs/TabStrip.tsx`, `AllTabsMenu.tsx`, `TabPanel.tsx` | INF-TABS-01 to 06, INF-TABS-08, INF-HOME-01 |
| 11.5 Home | `home/HomeView.tsx`, `ScopeFilter.tsx`, `QuickActions.tsx`, `PinnedSection.tsx`, `RecentSection.tsx` | INF-HOME-01 to 03 |
| 11.6 Tree, rename, context menu, move | `tree/TreePane.tsx`, `TreeRow.tsx`, `TreeContextMenu.tsx`, `MoveDialog.tsx`, `tree/actions.ts` (helper) | INF-HIER-01 to 10, INF-HIER-12 |
| 11.7 Dialogs | `ui/Dialog.tsx`, `ConfirmDialog.tsx`, `NameDialog.tsx`, `DialogHost.tsx` | INF-HIER-02 to 09 |
| 11.8 Context panel | `panel/ContextPanel.tsx`, `InfoSection.tsx`, `ui/Switch.tsx` | INF-HIER-10, INF-SHELL-02 |
| 11.9, 12 Note view, temporary editor | `notes/NoteView.tsx`, `TempTextEditor.tsx` | INF-TABS-03, INF-TABS-05 (UI), D-048 |
| 11.10 Notices, pages, palette | `shell/Notices.tsx`, `pages/StickiesPage.tsx`, `RemindersPage.tsx`, `SettingsPage.tsx`, `palette/CommandPalette.tsx` | INF-TABS-04, INF-TABS-06, INF-KEY-02, INF-KEY-03 |
| 11.11 Global shortcuts | `shell/GlobalShortcuts.tsx` | INF-KEY-01 to 03 |
| 11.12 Visual rules, primitives | `ui/IconButton.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `styles/components.css` | INF-SHELL-05 |
| Test | `tests/unit/renderer/shell-smoke.test.tsx` (8 cases: landmarks, new note, typing and save, New project dialog and name validation, tree keyboard and Common notices, palette and Ctrl+N, Settings theme and About, rail toggle) | smoke only |

Removed: `src/renderer/shell/FoundationScreen.tsx`, `tests/unit/renderer/foundation.test.tsx`.

### Deviations and notes

- Segmented controls use native radio inputs (visually hidden, styled labels). Arrow keys and Space work natively and `getByLabel('Dark').check()` style selectors still work. The disabled "Project" radio carries `aria-disabled` and ignores changes.
- `GlobalShortcuts` ignores events inside open modal dialogs but not inside drawers (`dialog[open]:not(.drawer)`), so Ctrl+backslash can still close a drawer.
- `App` keeps one `AppServices` per bridge instead of creating and disposing it in an effect, which the lint rule `react-hooks/set-state-in-effect` forbids and which StrictMode would break. The services' own `pagehide` hook still flushes the active note. Services are not disposed on unmount.
- Sticky colour dots use new `--note-*` tokens added to `tokens.css` (existing values unchanged; `tokens.test` still passes).
- `base.css` was not edited. Its global `[role='status']` rule is overridden for `.toasts` and `.save-status` in the new CSS.
- Not visually inspected in a running window (no screenshot taken in this pass); layout follows the plan CSS values. Pass C or the QA agent should look at it once.

### Accessibility notes (checklist, section 13)

- Landmarks: `header[role=banner]`, `nav[aria-label=Primary]`, `nav[aria-label=Notes]`, `main`, `aside[aria-label=Details]`. One `h1`. Each view has an `h2`.
- Every icon button gets `aria-label` and `title` through `IconButton`. Roving tabindex in tree and tablist, no positive tabindex (asserted in the smoke test). Dialogs, menus and drawers restore focus to the invoker on unmount. Form controls are labelled. Focus ring comes from the shared `:focus-visible` rule (offset -2px on rows and tabs).
- Not machine-verified beyond the smoke test; Pass C owns the automated pass.

### Commands (Windows 11, Node 24.15; E2E runner Node 24.21.0 via `INFINITY_E2E_NODE`)

| Command | Exit | Log |
| --- | --- | --- |
| `npm run check` (lint, typecheck, 208 unit, 124 integration, traceability 0 fails) | 0 | `.infinity-work/logs/phase-02/passB-check.log` |
| `npm run build` | 0 | `.infinity-work/logs/phase-02/passB-build.log` |
| `npm run test:e2e` (19 passed, 4 failed, 1 skipped Linux-only) | 1 | `.infinity-work/logs/phase-02/passB-test-e2e.log` |

### E2E failures caused by the intended UI replacement (Pass C must update, not weaken)

The foundation screen text and the theme radios are gone from the first screen. The theme radios now live on the Settings page, the version and SQLite text in Settings > About. All four failures are in `tests/e2e/smoke.spec.ts`:

1. `starts a real window with temp userData` line 38: `getByText('Version 0.1.0')`. Open Settings first (rail button `Settings` or `Ctrl+K` > "Open Settings"), then assert "Version 0.1.0" in the Settings page.
2. `db diagnostics` line 86: `getByText(/Storage ready \(SQLite 3\./)`. Same: open Settings first.
3. `setting survives relaunch` lines 91, 106: `getByLabel('Dark')`. Click the `Settings` rail button, then use `getByLabel('Dark')` (the radio group is `aria-label="Theme"`). After relaunch the Settings tab is restored from the session only if it was open; click `Settings` again.
4. `invalid stored setting falls back` lines 112 and 124: `getByLabel('Dark')` and `getByLabel('System')`. Same navigation.

Same selectors in `tests/e2e/packaged.spec.ts` lines 32 and 43 (`getByLabel('Dark')`) need the same navigation; that spec only runs with `npm run test:e2e:packaged` and was not run here. `security.spec` (h1, bridge keys, zero settings rows) and the other specs passed unchanged: `fixtures.launchApp` still finds the new `h1`.

Useful selectors for Pass C: `#app-shell[data-ready="true"]`, `[role=tab]#tab-<id>`, `#tabpanel`, `[role=tree][aria-label="Notes tree"]` with `#tree-<key>` items, `nav[aria-label="Primary"] button[aria-label=...]`, `dialog[open]`, `dialog[aria-label="Command palette"]`, `.toasts [role=status]`, `[aria-label="Title"]`, `[aria-label="Note text"]`.

## Pass C (E2E, repairs and validation) - infinity-code-medium (Sonnet 5.5, medium), 2026-10-08

Status: implemented. All Windows and WSL gates are green on the final tree. Native cases that need a real desktop are listed under "Not run or pending".

### Hosts

- Windows 11 Pro 10.0.26300, Node 24.15.0; Playwright runner Node 24.21.0 via `INFINITY_E2E_NODE` (no 0xC0000409 crash in any run).
- WSL: Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, npm 11.19.0, WSLg 1.0.73, Weston 2318fecaeac1f1a2d5a7a042c34d931c71dae04c, user `infinity`, copy `~/infinity-notes` (own `node_modules`, `npm ci`). Observed ozone from `main.log`: WSLg run `ozone=x11` (WAYLAND_DISPLAY set, DISPLAY=:0); Xvfb run `ozone=x11` (DISPLAY=:99, no Wayland); forced Wayland run `ozone=wayland` (informational). Not labelled GNOME.

### Files (Pass C)

E2E support: `tests/e2e/fixtures.ts` (wait for `#app-shell[data-ready]`, `setContentSize`, `setWindowSize`), `seed.ts` (bridge seeding), `ui.ts` (keyboard `activate`, tree and menu helpers), `harness.ts` (per-test userData, DB reads, relaunch).
New specs: `shell.spec.ts` (9 cases), `home.spec.ts` (5), `tree.spec.ts` (9), `a11y-keyboard.spec.ts` (4), `tabs.spec.ts` (9), `editor.spec.ts` (2), `keyboard.spec.ts` (2), `palette.spec.ts` (1), `visual.spec.ts` (6).
Updated specs: `smoke.spec.ts` and `packaged.spec.ts` (navigate to Settings, `getByRole('radio')` with keyboard activation and `toBeChecked`; no assertion weakened).
jsdom: `tests/unit/renderer/tree-pane.test.tsx` (8), `tab-strip.test.tsx` (4), `support/dom.tsx`.
Repairs in `src/`: `renderer/shell/Splitter.tsx`, `shell/Drawer.tsx`, `ui/DialogHost.tsx`, `notes/NoteView.tsx`, `styles/components.css`.
Docs: `docs/BACKLOG.md` (Status and Planned tests of the 30 Phase 02 rows), `docs/DECISIONS.md` (D-050).

### Issues found and fixed

| # | Severity | Reproduction | Expected | Actual | Regression test |
| --- | --- | --- | --- | --- | --- |
| 1 | medium | Focus the splitter, press End or Home | 280 or 220 (INF-SHELL-02) | keys ignored | `e2e/shell.spec › tree toggle and width persists`; `unit/renderer/tree-pane.test › the splitter handles Home and End` |
| 2 | medium | Narrow window, Notes rail button | focus on a treeitem inside the drawer | focus on the pane's New project button | `e2e/shell.spec › narrow 760x560 drawers` |
| 3 | high (keyboard) | Tree row, Delete, Enter | focus stays inside the tree | focus fell to `body` after the row vanished | `e2e/a11y-keyboard.spec › tree`; `unit/renderer/tree-pane.test › Delete then Enter trashes a note and hands the focus to the parent row` |
| 4 | low | Note view | every view has an `h2` (section 13) | note view had none | `e2e/a11y-keyboard.spec › accessibility structure on every view` |

No-issue checks: the Pass B concern that services are not disposed on unmount is not a leak. One `AppServices` lives per renderer realm; a reload creates a new realm (old stores and the preload listeners die with it) and main registers no per-load listeners. `e2e/shell.spec › reloading the renderer leaves no extra main-process listeners` compares `webContents` and `ipcMain` listener counts before and after 3 reloads (equal) and checks one live subscriber. Visual inspection of the screenshots found no layout defects against `docs/UX_SPEC.md` and the reference image; one benign one-frame "Untitled" placeholder flash in the title field right after a note opens is noted, not repaired.

### Commands (final tree; logs in `.infinity-work/logs/phase-02/`)

| Command | Host | Exit | Log |
| --- | --- | --- | --- |
| `npm run check` (lint, typecheck, 220 unit, 124 integration, traceability 0 fails) | Windows | 0 | `passC-final-check.log` |
| `npm run build` | Windows | 0 | `passC-final-build.log` |
| `npm run test:e2e` (70 passed, 1 skipped Linux-only) | Windows | 0 | `passC-final-win-test-e2e.log` |
| `node tools/dev-smoke.mjs` | Windows | 0 | `passC-win-dev-smoke.log` |
| `npm run package:current`, `verify:native -- --packaged`, `test:e2e:packaged` (2 passed) | Windows | 0, 0, 0 | `passC-win-package.log`, `passC-win-verify-native-packaged.log`, `passC-win-test-e2e-packaged.log` |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | `passC-final-deps-unchanged.log` |
| `node tools/check-traceability.mjs --repo .` | Windows | 0 | `passC-final-traceability.log` |
| rsync, `npm ci`, `setup:electron` | WSL | 0 | `passC-final-wsl-sync.log`, `passC-wsl-npm-ci.log` |
| `npm run check` | WSL | 0 | `passC-final-wsl-check.log` |
| `npm run build` | WSL | 0 | `passC-final-wsl-build.log` |
| `npm run test:e2e` WSLg (71 passed, incl. the Linux display-line case) | WSL | 0 | `passC-final-wsl-test-e2e-wslg.log` |
| `npm run test:e2e` Xvfb (71 passed) | WSL | 0 | `passC-final-wsl-test-e2e-xvfb.log` |
| forced Wayland `npm run test:e2e` (56 passed, 15 failed, informational) | WSL | 1 | `passC-wsl-test-e2e-wayland.log` |
| F-01-4 probes | WSL | 0, 0, 0 | `f014-probe-wslg.log`, `f014-probe-xvfb.log`, `f014-probe-wayland.log` |
| env | WSL | 0 | `passC-wsl-env.log` |

Earlier green runs of the same suites (before the last small repairs and the structure test) remain as `passC-win-test-e2e.log`, `passC-wsl-test-e2e-wslg.log`, `passC-wsl-test-e2e-xvfb.log`, `passC-check.log`, `passC-build.log`. Not run: `package:linux` and the Linux packaged E2E (nothing in packaging changed since Phase 01).

Flake record: the first final WSLg run (`passC-final-wsl-test-e2e-wslg-run1-2flakes.log`) failed 2 of 71. `home.spec › one Home tab after relaunch`: XWayland "X connection error" killed the app at launch. `home.spec › pin`: a tree row was not found after 30 s, not reproduced. `home.spec` then passed 3 of 3 alone and the whole suite passed on the immediate rerun (the log named `passC-final-wsl-test-e2e-wslg.log`), as did Xvfb. No retries were added; the second failure is unexplained and is recorded as an open flake to watch.

### F-01-4 (Wayland input under WSLg)

Probe `.infinity-work/qa/wayland-input.probe.ts` (not committed), 5 s timeouts:

| Variant | ozone | window visible at start | rAF per 1000 ms | a check() | b click() | c click force | d focus+Space | e dispatchEvent | f check() after win.focus()+show() |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WSLg default | x11 | yes (focused false) | 61 | ok | ok | ok | ok | ok | ok |
| Xvfb | x11 | yes | 61 | ok | ok | ok | ok | ok | ok |
| forced Wayland | wayland | no | 0 | timeout ("waiting for element to be visible, enabled and stable") | same timeout | ok | ok | ok | ok (rAF back to 60) |

Interpretation (section 15 rules): the compositor sends no frame callbacks to a hidden Wayland surface, so Playwright's rAF-based stability check never finishes; the app is not at fault and production never forces ozone. Keyboard activation works in every variant, so D-050 is recorded. Focusing and showing the window also fixes it, but no product hack was added.
Forced-Wayland full suite: 56 passed, 15 failed (all informational). Pointer-specific (expected): `home › Home not closable` (middle click), `tabs › ctrl+tab` (tab click), `tabs › close keeps note` (close button, middle click), `tabs › overflow list` (scroll buttons). Frame-dependent (window never shown, no rAF: resize waits, `emulateMedia`, screenshots): `shell › panel toggle`, `narrow 760x560 drawers`, `breakpoints`, `theme follows OS`, all 6 `visual.spec` cases, and the Phase 01 `migration-failure › upgrade failure screen`. These share the one cause shown by the probe; no separate defect found.

### Visual evidence (V items)

Windows: `.infinity-work/logs/phase-02/screens/win/`; WSLg (ozone x11): `screens/wslg/`; Xvfb: `screens/xvfb/`. Same file names on each host: `1100x720-light-home.png` (Home with nested folder tree, pinned card, recent list), `1100x720-light-note.png` (note tab with text), `1100x720-dark-home.png` (dark theme), `760x560-light-home.png` (no docked panes), `760x560-light-tree-drawer.png` (Notes drawer, focus in drawer), `1280x800-light-panel.png` (docked Info panel), `focus-ring.png`, `tab-overflow.png` (scroll buttons, All tabs), `context-menu.png`. Each is above 10 kB (asserted). The Windows images and one WSLg image were viewed: layout matches the reference structure (rail, header search with Ctrl K, tab strip, violet accent) and the UX spec; no clipping.

### Final requirement coverage (30 IDs)

All listed cases passed on Windows, WSLg (x11) and Xvfb in the final runs. Core logic cases come from Pass A (unit and integration, run by `npm run check` on both hosts).

| ID | Assertions run (E2E › case; unit and integration) | BACKLOG status |
| --- | --- | --- |
| INF-SHELL-01 | shell › rail navigation (5 buttons, kbd, rail 52, header 44, strip 36, aria-current, accent-soft, accent border), › no capture-specific labels; visual 1100x720 | done |
| INF-SHELL-02 | shell › tree toggle and width persists (220/280, 248, 272, End 280, Home 220, drag to 240, DB value, relaunch, closed stays closed); layout-store.test; tree-pane.test | done |
| INF-SHELL-03 | shell › panel toggle (300 wide, empty text, Info fields, switch writes `pinned_at`, toggle persists); visual panel | done |
| INF-SHELL-04 | shell › narrow 760x560 drawers, › breakpoints (959/960, 1179/1180); visual drawer | done |
| INF-SHELL-05 | shell › theme follows OS (rgb(23, 24, 29) and white, persisted dark); tokens.test; visual dark | done |
| INF-SHELL-06 | shell › visible focus (2px solid accent, offset 2 and -2); main-window-options.test; visual focus ring. N part pending | in_progress |
| INF-HOME-01 | home › one Home tab after relaunch, › Home not closable; tab-session.test; tab-strip.test | done |
| INF-HOME-02 | home › pinned and recent reflect data, › pin; home-summary.test | done |
| INF-HOME-03 | home › filter (persist, new note at project root, Ctrl+Shift+N yellow sticky in Common, trashed project resets to All); home-summary.test | done |
| INF-HIER-01 | tree › Common protected; hierarchy.test; tree-pane.test | done |
| INF-HIER-02 | tree › project CRUD; hierarchy.test | done |
| INF-HIER-03 | tree › nested folders (aria-levels 3, 4, 5); hierarchy.test depth 32/33 | done |
| INF-HIER-04 | tree › create note in folder; keyboard › ctrl+n; hierarchy.test | done |
| INF-HIER-05 | tree › sticky in folder; hierarchy.test | done |
| INF-HIER-06 | hierarchy.test duplicate names; tree-paths.test | done |
| INF-HIER-07 | tree › move persists after restart (trashed descendant moved too); hierarchy.test atomic move | done |
| INF-HIER-08 | tree › cycle rejected (alert text, focus back to row); hierarchy.test | done |
| INF-HIER-09 | tree › trash and restore (restore notice, delete forever count, empty trash); trash.test | done |
| INF-HIER-10 | home › pin; tree › favorites (relaunch, unfavorite, open from favorite) | done |
| INF-HIER-12 | a11y-keyboard › tree, › dialogs return focus, › accessibility structure on every view; tree-model.test; tree-pane.test | done |
| INF-TABS-01 | tabs › no duplicate tabs (tree twice, Recent, palette, Favorites) | done |
| INF-TABS-02 | tabs › ctrl+tab, › keyboard tablist; tab-strip.test | done |
| INF-TABS-03 | tabs › close keeps note; editor › flush on close; note-controller.test | done |
| INF-TABS-04 | tabs › overflow list (16 items, scroll buttons, bounds, Escape focus); visual tab-overflow | done |
| INF-TABS-05 | tabs › restore after relaunch (tampered duplicates); editor › text area save increments revision and survives relaunch; session.test | done |
| INF-TABS-06 | tabs › trashed note tab closed, › session skips trashed and missing (exact notices) | done |
| INF-TABS-08 | tabs › page singletons | done |
| INF-KEY-01 | keyboard › ctrl+n (cases a to d); current-location.test | done |
| INF-KEY-02 | keyboard › ctrl+shift+n (cases a, c; icons in tab and tree); shortcuts.test | done |
| INF-KEY-03 | palette › actions and titles; palette.test; palette-actions.test | done |

Deviations: visual specs use `setContentSize` (exact viewport) instead of `setWindowSize`; `setWindowSize` is provided but unused. The Favorites group is collapsed by default (UX spec and setting default), so favorites specs expand it first. Radios stay native inputs; specs activate them with focus plus Space (D-050). The All tabs entries have role `menuitemradio` (aria-checked marks the active tab) instead of the plan's `menuitem`; the spec asserts that.

### Not run or pending

- INF-SHELL-06 N (native frame and window controls on a real desktop session): Phase 09 matrix.
- Forced-Wayland failures above: informational.
- GNOME and X11 desktop sessions: `outside_validation_scope`.
- `npm run package:linux` and the Linux packaged E2E were not re-run in Phase 02.
- Open flake to watch: `home.spec › pin` once failed on WSLg (see Flake record).

### Decisions added after planning

D-050 (keyboard activation in E2E, F-01-4).

### Known limitations (unchanged)

Temporary text area (D-048) and the window-close flush gap until Phase 03; no drag and drop in the tree; no tree virtualization; the Reminders page states that reminders are unavailable.

## Repair 1

Repair cycle for QA findings QA-P02-1 to QA-P02-5 (`docs/progress/phase-02-qa.md`). Existing behavior kept; no gates lowered.

### Changes
- QA-P02-1: new `src/renderer/notes/live-note.ts` (`liveNoteFrom`, `useLiveNote`) derives title and path from the live tree snapshot (re-read on every `tree:changed` reload), falling back to the opened copy. `NoteView` (Title field, header path, hidden heading) and `InfoSection` (Title, Location) use it. Conflict rule: the Title field shows the text typed by the user while it has focus; an external rename never replaces in-progress typing, the typed title is flushed on blur (last writer wins) and the field follows later renames once it is unfocused.
- QA-P02-2: `SaveStatus` gains `pending`; `NoteController.setText` sets it immediately and the indicator reads "Editing…" until the debounced/flushed save reports "Saving…" then "Saved".
- QA-P02-3: the Title field no longer has its own copy initialised before load; its first render uses the live title, so it is never empty when a note opens.
- QA-P02-4: new migration `003_trash_reanchored.sql` (table `trash_reanchored`, checksum added, `MIGRATIONS` updated). `TrashService.purge` records the batch of every survivor it re-anchors and removes records of purged batches; `restore` reports `relocated: true` for those batches (the existing relocation notice is then shown) and clears the record. Existing relocation logic is unchanged.
- QA-P02-5: `createAppServices.init` re-reads the viewport width after settings hydrate, before `ready` resolves, so a narrow startup reading cannot leave the tree in drawer mode.

### Changed files
Source: `src/renderer/notes/live-note.ts` (new), `src/renderer/notes/NoteView.tsx`, `src/renderer/notes/note-controller.ts`, `src/renderer/panel/InfoSection.tsx`, `src/renderer/state/app-services.ts`, `src/main/services/trash-service.ts`, `src/main/db/migrations/003_trash_reanchored.sql` (new), `src/main/db/migrations/index.ts`, `src/main/db/migrations/checksums.json`.
Tests: `tests/e2e/note-live.spec.ts` (new: rename, folder rename and moves of an open note, typing conflict, pending indicator, title on open, purged-parent restore notice), `tests/integration/trash.test.ts` (relocated after purged parent; purge re-anchor expectations now `relocated: true`), `tests/integration/migrations.test.ts` and `tests/unit/migrations-checksum.test.ts` (schema 3, probe migrations moved to version 4), `tests/unit/renderer/state/tree-commands.test.ts` (viewport re-sample), `tests/unit/renderer/state/note-controller.test.ts` (pending state), `tests/e2e/smoke.spec.ts`, `tests/e2e/packaged.spec.ts`, `tests/unit/renderer/support/fake-bridge.ts` (schemaVersion 3).

### Gates
| Gate | Where | Exit | Log |
| --- | --- | --- | --- |
| `npm run check` (traceability fails=0) | Windows | 0 | `repair1-check.log` |
| `npm run build` | Windows | 0 | `repair1-build.log` |
| `npm run test:e2e` (75 passed, 1 Linux-only skipped) | Windows | 0 | `repair1-test-e2e.log` |
| rsync to `~/infinity-notes` | WSL | 0 | `repair1-wsl-sync.log` |
| `npm run check` | WSL | 0 | `repair1-wsl-check.log` |
| `npm run build` | WSL | 0 | `repair1-wsl-build.log` |
| `npm run test:e2e` WSLg, run 1: 75 passed, 1 failed (`tabs.spec close keeps note`: app process closed during launch before `data-ready`, no product assertion reached) | WSL | 1 | `repair1-wsl-test-e2e-wslg.log` |
| `npm run test:e2e` WSLg, unchanged tree, full suite again: 76 passed | WSL | 0 | `repair1-wsl-test-e2e-wslg-run2.log` |

The run 1 failure is a launch-time process exit on WSLg (the same class as the environmental launch flake in QA-P02-5); the run 2 result is a full-suite re-run of the identical tree, reported as a separate result and not a replacement of run 1. Native GNOME/X11 cases remain outside the user-selected scope. The new migration changes the schema version to 3 for the packaged E2E assertions; packaged E2E was not re-run in this repair.

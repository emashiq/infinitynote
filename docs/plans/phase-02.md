# Phase 02 plan: Home, projects, folders and tabs

Planner: infinity-planner (Opus HIGH), 2026-10-08. Status: ready for implementation.

Implementation runs in three sequential passes. Only one agent edits code at a time:

1. **Pass A, `infinity-code-medium` (core).** Migration, contracts, main services, IPC, preload, headless renderer state, shared pure models, unit and integration tests, and F-01-1.
2. **Pass B, `infinity-code-low` (shell UI).** React components and CSS only, wired to the Pass A stores.
3. **Pass C, `infinity-code-medium` (E2E, repairs, validation).** Phase 02 E2E specs, updates to existing specs, renderer jsdom tests, F-01-4, Windows and WSL gates, packaging re-check, progress report and BACKLOG.

Why core goes first: the shell UI needs real IPC, real SQLite data and tested pure models (tab reducer, tree model, keyboard navigation, new-item location rule) so that the LOW pass only renders and wires. Putting the logic in Pass A also keeps every non-trivial rule in code that the MEDIUM agent tests.

Requirement IDs (30, work package W02): INF-SHELL-01..06, INF-HOME-01..03, INF-HIER-01..10, INF-HIER-12, INF-TABS-01..06, INF-TABS-08, INF-KEY-01..03.

Decisions recorded with this plan: D-044 to D-049 in `docs/DECISIONS.md`. Doc edits made with this plan: ARCHITECTURE sections 3 and 4, BACKLOG W02/W04-W07 migration numbers, and UX_SPEC (notice copy, Ctrl+N row). `node tools/check-traceability.mjs --repo .` exits 0 after those edits.

---

## 1. Inputs read and actual repository state

- Pack: `phases/02-home-projects-folders-and-tabs.md`, `PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `TEST_MATRIX.md`, and `reference/framecapt-reference.png`.
- Repository docs: `docs/PRODUCT_SPEC.md`, `UX_SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md` (D-001..D-043), `BACKLOG.md` (W02).
- Progress: `docs/progress/phase-01.md` (including Repair 1 and 2), `phase-01-qa.md`, `phase-01-acceptance.md` (follow-ups F-01-1..6).
- Code at commit d57a0a5, which is what exists today:
  - `src/main/db/migrations/001_initial.sql` already has `projects`, `folders` and `notes` with `favorite`, `pinned_at`, `sticky_enabled`, `color`, `deleted_at`, `trash_batch_id`, external-content `notes_fts` with triggers that index live rows only, and `ON DELETE RESTRICT` foreign keys from folders and notes to their parents. `LATEST = 1`.
  - `NotesRepo` has only `createNote` and `getNoteById`.
  - `NoteWriter` (save with lease, revision and draft) and `LeaseManager` exist but are not on IPC. In `index.ts` their `emit` and `requestRelease` are no-ops.
  - Settings registry has one key, `appearance.theme`. `SettingsService.get/set`.
  - IPC: router with sender policy and a 5 MiB limit, catalogue of 6 channels, event `settings:changed`. Preload has the frozen bridge `{app, settings, capabilities, subscribe}`.
  - Renderer: `App` then `FoundationScreen` (h1 "Infinity Notes", "Version 0.1.0", "Storage ready (SQLite …)", theme radios) or `StartupErrorScreen`. `tokens.css` already matches the UX_SPEC token table.
  - `lucide-react` 1.53.0 is installed. Verified icon exports: `House`, `NotebookText`, `StickyNote`, `Bell`, `Settings`, `Search`, `PanelLeft`, `PanelRight`, `X`, `ChevronRight`, `ChevronDown`, `ChevronLeft`, `Folder`, `FolderOpen`, `FileText`, `Star`, `Pin`, `PinOff`, `Trash` (there is no `Trash2`), `Ellipsis`, `Plus`, `FolderPlus`, `FilePlus`, `Infinity`, `List`, `RotateCcw`, `FolderInput`, `Pencil`, `ListTree`, `CircleAlert`. `Home` and `MoreHorizontal` do not exist in this version.
  - Phase 01 E2E specs depend on the foundation screen: `smoke.spec` (h1, "Version 0.1.0", "Storage ready", theme radios via `getByLabel('Dark').check()`, `schemaVersion 1`), `packaged.spec` (same), `security.spec` (h1 text after blocked navigation, exact bridge key set, zero settings rows after the validation test). `fixtures.launchApp` waits for `h1, [role="alert"]`.
  - `.github/workflows/ci.yml` uses `node-version: '24.15.0'`, and `tests/unit/ci-config.test.ts` asserts that string.
  - Portable Node for the Windows E2E runner exists at `E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe`.

## 2. Follow-ups incorporated

| ID | Action in this phase | Owner and pass |
| --- | --- | --- |
| F-01-1 | `.github/workflows/ci.yml` `node-version: '24.21.0'`. `tests/unit/ci-config.test.ts` asserts `node-version: '24.21.0'` and that `'24.15.0'` is absent. The DECISIONS note is D-049 (written by the planner). `engines` stays `>=24.15.0 <25` | MEDIUM, Pass A |
| F-01-4 | Investigate Playwright input actionability under WSLg forced native Wayland with the protocol in section 15. Adopt the interaction pattern that works under both ozone backends for steps whose subject is not pointer behavior. Record the outcome (D-050 if a policy is adopted) | MEDIUM, Pass C |
| Phase 00 F-1 | Section 14.1 restates every Phase 02 ID as explicit assertions (action, expected, failure case, file › case, hosts) | Plan; MEDIUM implements |
| F-01-2, F-01-3, F-01-5, F-01-6 | Not in this phase (Phases 04, 03, 09, 09) | none |

## 3. Ownership, order and file boundaries

### 3.1 Rules for every pass

- Read this plan, the phase file, D-044..D-049 and the current code first.
- Never edit files owned by another pass unless this plan says so. If a needed change crosses the boundary, stop and report it to the coordinator as a blocker. Do not work around it.
- Never weaken an existing assertion, add retries, skip tests or add placeholder pass scripts.
- Log every gate command to `.infinity-work/logs/phase-02/<pass>-<name>.log`, starting with the command, the date and `pwd`, and ending with `EXIT=<code>` (section 16).
- Append a section for your pass to `docs/progress/phase-02.md`.

### 3.2 Pass A: MEDIUM core (exclusive owner of these paths during Pass A)

| Area | Files (create or modify) |
| --- | --- |
| Migration | `src/main/db/migrations/002_hierarchy_indexes.sql` (new), `migrations/index.ts`, `migrations/checksums.json` (regenerate with `node tools/gen-migration-checksums.mjs`) |
| Repositories | `src/main/db/repositories/hierarchy-repo.ts` (new: projects, folders, notes hierarchy SQL, subtree and ancestor CTEs, invariant queries), `notes-repo.ts` (extend: create with location and sticky, open, rename, move, pin, favorite) |
| Services | `src/main/services/hierarchy-service.ts`, `trash-service.ts`, `home-service.ts`, `session-service.ts`, `palette-service.ts`, `note-reader.ts` (all new); `settings-service.ts` (add `getInternal` and `setInternal`, enforce `public`) |
| IPC | `src/main/ipc/handlers/hierarchy-handlers.ts`, `trash-handlers.ts`, `home-handlers.ts`, `session-handlers.ts`, `palette-handlers.ts`, `note-handlers.ts` (open, save, lease acquire and release) (all new); `src/main/index.ts` (wiring and `tree:changed` broadcast); `src/main/windows/main-window.ts` (export pure `mainWindowOptions()` used by `createMainWindow`, with unchanged values) |
| Shared contracts | `src/shared/contracts/hierarchy.ts`, `home.ts`, `session.ts`, `palette.ts` (new); `notes.ts`, `settings.ts`, `channel-names.ts`, `channels.ts`, `bridge.ts` (extend) |
| Shared pure modules | `src/shared/names.ts`, `src/shared/tree/tree-model.ts`, `src/shared/tree/paths.ts`, `src/shared/tabs/tab-session.ts`, `src/shared/text/textarea-doc.ts`, `src/shared/time/relative-time.ts` (all new) |
| Preload | `src/preload/index.ts` (new bridge namespaces; still frozen; no generic invoke) |
| Headless renderer state (no JSX, no CSS) | `src/renderer/state/store.ts`, `use-store.ts`, `app-services.ts`, `tree-store.ts`, `tabs-store.ts`, `home-store.ts`, `layout-store.ts`, `ui-store.ts`, `notice-store.ts`, `commands.ts`, `shortcuts.ts`, `current-location.ts`, `palette-actions.ts`; `src/renderer/notes/note-controller.ts` (all new) |
| Tests | Section 14.2 and 14.3 files; `tests/unit/renderer/support/fake-bridge.ts`; updates to `tests/unit/contracts.test.ts`, `migrations-checksum.test.ts`, `ci-config.test.ts`, `tests/integration/migrations.test.ts`, `ipc-validation.test.ts`, `settings.test.ts`; E2E expectation updates caused by core changes only (`security.spec › bridge surface` key set, `smoke.spec › db diagnostics` and `packaged.spec` `schemaVersion 2`) |
| CI (F-01-1) | `.github/workflows/ci.yml` (node-version only) |
| Docs | `docs/progress/phase-02.md` (create, Pass A section) |

Pass A must not touch `src/renderer/App.tsx`, `src/renderer/shell/**`, any `.tsx` component or `src/renderer/styles/**`. The foundation screen stays in place and working during Pass A.

### 3.3 Pass B: LOW shell UI (exclusive owner of these paths during Pass B)

| Area | Files |
| --- | --- |
| Entry | `src/renderer/App.tsx` (use `createAppServices` and render `Shell`), `src/renderer/main.tsx` (CSS imports only) |
| Remove | `src/renderer/shell/FoundationScreen.tsx`, `tests/unit/renderer/foundation.test.tsx` |
| Shell | `src/renderer/shell/Shell.tsx`, `Rail.tsx`, `Header.tsx`, `Notices.tsx`, `Drawer.tsx`, `Splitter.tsx`, `GlobalShortcuts.tsx` |
| Tabs | `src/renderer/tabs/TabStrip.tsx`, `AllTabsMenu.tsx`, `TabPanel.tsx` |
| Tree | `src/renderer/tree/TreePane.tsx`, `TreeRow.tsx`, `TreeContextMenu.tsx`, `MoveDialog.tsx` |
| Home | `src/renderer/home/HomeView.tsx`, `ScopeFilter.tsx`, `QuickActions.tsx`, `PinnedSection.tsx`, `RecentSection.tsx` |
| Pages | `src/renderer/pages/StickiesPage.tsx`, `RemindersPage.tsx`, `SettingsPage.tsx` |
| Panel | `src/renderer/panel/ContextPanel.tsx`, `InfoSection.tsx` |
| Note view | `src/renderer/notes/NoteView.tsx`, `TempTextEditor.tsx` |
| Palette | `src/renderer/palette/CommandPalette.tsx` |
| UI primitives | `src/renderer/ui/Dialog.tsx`, `ConfirmDialog.tsx`, `NameDialog.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `IconButton.tsx`, `Switch.tsx`, `DialogHost.tsx` |
| Styles | `src/renderer/styles/shell.css`, `components.css` (new); `tokens.css` (additions only, existing values unchanged) |
| Test | `tests/unit/renderer/shell-smoke.test.tsx` (new; replaces the foundation test, uses `fake-bridge.ts` from Pass A) |
| Docs | `docs/progress/phase-02.md` (Pass B section) |

Pass B must not change `src/main`, `src/preload`, `src/shared`, `src/renderer/state/**`, `src/renderer/notes/note-controller.ts`, or any test other than the two listed. If a store lacks something the UI needs, report it. The coordinator then routes it to MEDIUM.

### 3.4 Pass C: MEDIUM E2E, repairs and validation

It owns `tests/e2e/**`, `tests/unit/renderer/*.test.tsx` (new jsdom tests), the repairs anywhere in `src/**` found by its tests, `docs/progress/phase-02.md` (final sections), the `docs/BACKLOG.md` Status and Planned tests columns, and DECISIONS D-050 if the F-01-4 investigation adopts a policy.

---

## 4. Dependencies

There are no new dependencies. Use only the pinned set: React 19.3.0, lucide-react 1.53.0, zod 4.6.5, Vitest 5.0.3 with jsdom, and Playwright 1.64.0.

Do not add the following:

- a state library (use the small store in section 10.1);
- a testing library (keep `react-dom/client` plus `act`, as in Phase 01);
- a UI kit or a virtualization library.

`package.json` and `package-lock.json` must not change in Phase 02. Pass C verifies this with `git diff --exit-code package.json package-lock.json`.

---

## 5. Migration 002 (D-044)

`src/main/db/migrations/002_hierarchy_indexes.sql`. The file is LF only, and the runner sets `user_version`, so the file does not:

```sql
CREATE INDEX notes_folder_all   ON notes(folder_id);
CREATE INDEX notes_project_all  ON notes(project_id);
CREATE INDEX notes_deleted      ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX folders_deleted    ON folders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX folders_trash      ON folders(trash_batch_id) WHERE trash_batch_id IS NOT NULL;
CREATE INDEX projects_trash     ON projects(trash_batch_id) WHERE trash_batch_id IS NOT NULL;
```

`migrations/index.ts` imports it with `?raw`, and `MIGRATIONS` becomes `[{1,'initial'}, {2,'hierarchy_indexes'}]`. `LATEST = 2`. The `001_initial.sql` file and its checksum are never edited.

Tests to adjust in Pass A:

- `migrations-checksum.test` expects `LATEST` 2.
- `migrations.test`:
  - fresh databases are v2;
  - the failure-injection and FK-violation cases inject version 3 and expect `user_version` to stay 2;
  - new case `upgrades populated v1 to v2`: open with `MIGRATIONS.slice(0,1)`, insert a project, a Common folder, a nested folder, notes (one trashed) and a settings row, close, reopen with the full set. Expect v2, all rows intact, `PRAGMA index_list(notes)` containing `notes_folder_all` and `notes_project_all`, exactly one pre-migration copy (v1, openable), FTS `integrity-check` ok.
- `smoke.spec › db diagnostics` and `packaged.spec` expect `schemaVersion` 2.
- The self-test check `migrationsToLatest` compares against `LATEST` and needs no change.

---

## 6. Contracts and IPC catalogue (D-045)

### 6.1 Shared validators (`src/shared/names.ts`)

- `normalizeName(raw)`: NFC, then trim. `validateName(s)`: 1 to 200 Unicode code points (`[...s].length`, so SQLite `length()` agrees) and no character in U+0000-U+001F, U+007F or U+2028-U+2029. On failure return the message "Names must be 1 to 200 characters without control characters.".
- `normalizeTitle` and `validateTitle`: the same, but 0 to 200 code points, and the message is "Titles can be at most 200 characters without control characters.".
- `displayTitle(title)` returns `title` or `'Untitled'` when it is empty. `COMMON_LABEL = 'Common'`.
- Zod: `NameInput = z.string().max(1000).transform(normalizeName).refine((s) => validateName(s) === null)`. `TitleInput` is analogous. The renderer uses the same functions to show the friendly message before calling IPC. The router's `VALIDATION_FAILED` message stays the generic "Invalid request: name".

### 6.2 DTOs (`src/shared/contracts/hierarchy.ts`)

All objects are `z.strictObject`. IDs are `Uuid`. Times are integer epoch milliseconds.

- `NoteColor = z.enum(['yellow','green','blue','pink','violet','gray'])`.
- `ProjectDto {id, name, favorite: boolean, createdAt, updatedAt}`.
- `FolderDto {id, projectId: Uuid|null, parentId: Uuid|null, name, favorite, createdAt, updatedAt}`.
- `NoteDto {id, projectId: Uuid|null, folderId: Uuid|null, title, sticky: boolean, color: NoteColor|null, pinnedAt: int|null, favorite, revision, createdAt, updatedAt}`.
- `NoteSummary = NoteDto + {path: string[]}`. `path` holds the scope label then the folder names, for example `['Common']` or `['Work','Specs','2026']`. Identical sibling labels get an ordinal suffix (section 9.2).
- `TreeSnapshot {projects: ProjectDto[], folders: FolderDto[], notes: NoteDto[]}`. It contains live rows only, and Common is implicit (`projectId: null`).
- `Location {projectId: Uuid|null, folderId: Uuid|null}` is used for notes. `FolderTarget {projectId: Uuid|null, parentId: Uuid|null}` is used for folders.
- `TrashResult {trashBatchId, counts: {projects, folders, notes}, trashedNoteIds: Uuid[]}`.
- `TrashItem {batchId, kind: 'project'|'folder'|'note', id, label, sticky: boolean, deletedAt, fromPath: string[], contains: {folders: int, notes: int}}`.
- `TreeChangedEvent {reason: 'create'|'rename'|'move'|'trash'|'restore'|'purge'|'pin'|'favorite', trashedNoteIds: Uuid[]}`. `trashedNoteIds` is empty unless the reason is trash.

### 6.3 Channels added in Phase 02

All channels use `invoke`, and handlers validate with Zod in main. In the "Errors" column, V = VALIDATION_FAILED, NF = NOT_FOUND and LE = LIMIT_EXCEEDED.

| Channel | Request | Response | Errors (exact messages in section 8.6) |
| --- | --- | --- | --- |
| `tree:list` | `{}` | `TreeSnapshot` | |
| `project:create` | `{name}` | `{project}` | V |
| `project:rename` | `{projectId, name}` | `{project}` | V, NF |
| `project:trash` | `{projectId}` | `TrashResult` | NF |
| `folder:create` | `{location: FolderTarget, name}` | `{folder}` | V (scope mismatch), NF, LE (depth) |
| `folder:rename` | `{folderId, name}` | `{folder}` | V, NF |
| `folder:move` | `{folderId, target: FolderTarget}` | `{folder, movedFolders, movedNotes}` | CYCLE, LE, NF, V |
| `folder:trash` | `{folderId}` | `TrashResult` | NF |
| `note:create` | `{location: Location, sticky: boolean, title?: TitleInput}` | `{note: NoteDto}` | V, NF |
| `note:rename` | `{noteId, title}` | `{note}` | V, NF |
| `note:move` | `{noteId, target: Location}` | `{note}` | V, NF |
| `note:trash` | `{noteId}` | `TrashResult` | NF |
| `note:setPinned` | `{noteId, pinned: boolean}` | `{note}` | NF |
| `item:setFavorite` | `{kind: 'project'\|'folder'\|'note', id, favorite: boolean}` | `{kind, id, favorite}` | NF |
| `trash:list` | `{}` | `{items: TrashItem[]}` (sorted by `deletedAt` desc) | |
| `trash:restore` | `{batchId}` | `{kind, id, relocated: boolean, location: {projectId, folderId}, path: string[], restoredNoteIds: Uuid[]}` | NF |
| `trash:purge` | `{target: {kind:'batch', batchId} \| {kind:'all'}, confirmed: z.literal(true)}` | `{purged: {projects, folders, notes}}` | V (no confirm), NF |
| `home:summary` | `{scope: HomeScope}` | `{scope: HomeScope, scopeValid: boolean, pinned: NoteSummary[] (≤100), pinnedTotal: int, recent: NoteSummary[] (≤10)}` | |
| `session:get` | `{}` | `{session: TabSession, dropped: {trashed, missing, duplicates}}` | |
| `session:set` | `{session: TabSession}` (refined: first tab is `home`, IDs unique, `activeTabId` present) | `{savedAt}` | V |
| `palette:searchTitles` | `{query: string ≤200, limit?: int 1..50}` | `{results: NoteSummary[]}` | V |
| `note:open` | `{noteId}` | `{note: NoteSummary, format: 'rich'\|'plain', content: RichDoc\|string, revision}` | NF (`details: {trashed: true, trashBatchId}` when trashed) |
| `note:save` | existing `NoteSaveRequest`; router `maxPayloadBytes = MAX_CONTENT_BYTES + 65536` | existing `NoteSaveAck` | existing (CONFLICT, LEASE_REQUIRED, LE, FORBIDDEN) |
| `lease:acquire` | existing `LeaseAcquireRequest` | existing response | FORBIDDEN |
| `lease:release` | existing `LeaseReleaseRequest` | existing response | FORBIDDEN |

`project:*` requests take a `Uuid` `projectId`, so Common can never be renamed or trashed through IPC. `null`, `'common'` and `''` all fail validation (INF-HIER-01).

`home.ts`: `HomeScope = z.discriminatedUnion('kind', [{kind:'all'}, {kind:'common'}, {kind:'project', projectId: Uuid}])`.

`session.ts`:

- `TabKind = 'home'|'note'|'stickies'|'reminders'|'settings'`.
- `Tab` is a discriminated union on `kind`:
  - `{id:'home', kind:'home'}`;
  - `{id: 'note:'+noteId, kind:'note', noteId, scrollTop?: int 0..10_000_000}` (a `superRefine` checks that `id` equals `'note:'+noteId`);
  - `{id:'page:stickies', kind:'stickies'}`, and the same for reminders and settings.
- `TabSession {version: z.literal(1), tabs: Tab[] (1..200), activeTabId: string ≤ 64}`.
- `DEFAULT_SESSION = {version:1, tabs:[{id:'home',kind:'home'}], activeTabId:'home'}`.

`palette.ts`: request and response as in the table.

`notes.ts`: add `NoteOpenRequest`, `NoteOpenResponse` and `NoteNotFoundDetails`.

`EVENT_CHANNELS = ['settings:changed', 'tree:changed']`. `EVENT_SCHEMAS['tree:changed'] = TreeChangedEvent`.

### 6.4 Bridge surface (`src/shared/contracts/bridge.ts`, `src/preload/index.ts`)

The bridge is frozen at every level and has no generic invoke. Its exact deep key set (the new `security.spec › bridge surface` expectation):

```
app: [getInfo, quit, showDataFolder]
capabilities: [get]
folder: [create, move, rename, trash]
home: [summary]
item: [setFavorite]
lease: [acquire, release]
note: [create, move, open, rename, save, setPinned, trash]
palette: [searchTitles]
project: [create, rename, trash]
session: [get, set]
settings: [get, set]
subscribe
trash: [list, purge, restore]
tree: [list]
```

`subscribe('note:revision')` still throws "Unknown event channel", because `note:revision` is Phase 03. `subscribe('tree:changed')` works.

### 6.5 Events

Main calls `eventBus.broadcast('tree:changed', …)` after every successful commit of a project, folder or note create, rename, move or trash, of `note:setPinned` and `item:setFavorite`, and of a trash restore or purge. Saves (`note:save`) and `session:set` do not broadcast. `NoteWriter.emit` and the `LeaseManager` callbacks stay no-ops in Phase 02, because there is only one view (Phase 03 wires `note:revision` and `note:lease`).

### 6.6 Wiring in `src/main/index.ts`

- Construct `HierarchyService`, `TrashService`, `HomeService`, `SessionService`, `PaletteService` and `NoteReader` when `opened.ok`. Keep using the existing `NoteWriter` and `LeaseManager` instances (store `NoteWriter` in a variable instead of `void new …`).
- Register all handlers. When the database failed to open, each handler throws `AppError('INTERNAL','Storage is unavailable')`, the same pattern as `settings-handlers`.
- `updated_at` and `deletedAt` come from the injected `Clock`. Random IDs come from `IdGenerator`.

---

## 7. Settings registry (D-045)

Change `SETTINGS` entries to `{version, schema, default, public: boolean}`:

| Key | Public | Schema | Default |
| --- | --- | --- | --- |
| `appearance.theme` | yes | `system\|light\|dark` | `system` |
| `layout.treeOpen` | yes | boolean | `true` |
| `layout.treeWidth` | yes | int 220..280 | `248` |
| `layout.panelOpen` | yes | boolean | `true` |
| `home.scope` | yes | `HomeScope` | `{kind:'all'}` |
| `tree.expanded` | yes | array ≤ 5000 of strings matching `^(common\|projects\|favorites\|trash\|project:<uuid>\|folder:<uuid>)$` | `['common','projects']` |
| `session.tabs` | no | `TabSession` | `DEFAULT_SESSION` |

- `SettingKeySchema` and `SettingsSetRequest` are built from the public keys only, so `settings:get({keys:['session.tabs']})` and `settings:set({key:'session.tabs',…})` give `VALIDATION_FAILED`.
- `SettingsService.getInternal(key)` and `setInternal(key, value)` validate in the same way, but do not emit `settings:changed`.
- An invalid stored value reads as the default and logs `settings: invalid stored value key=<key>`, as before.
- Writing happens only when the user changes something. A fresh launch with no interaction leaves the `settings` table empty (the existing `security.spec › validation errors` assertion stays as is).

---

## 8. Main services: hierarchy, trash, home, session, palette, open (D-046)

Every mutating method runs in one `db.transaction(…, 'immediate')`. Errors are `AppError` with the codes and messages in section 8.6. A SQLite error inside a transaction becomes `INTERNAL` "Something went wrong", with nothing changed.

### 8.1 Invariants (`hierarchy-repo.ts` `findInvariantViolation(): string|null`)

The function checks, across all rows (live and trashed):

1. a folder's `project_id IS` its parent's `project_id`;
2. a note's `project_id IS` its folder's `project_id`;
3. a live folder has a live parent folder (if any) and a live project (if any);
4. a live note has a live folder (if any) and a live project (if any);
5. there are no folder cycles: a recursive CTE from the roots reaches every folder;
6. the maximum folder depth is ≤ 32.

Each check is a separate `SELECT … LIMIT 1`. The function runs at the end of every move, restore and purge transaction. A violation throws, which rolls back the transaction, and the result is `INTERNAL`. Integration tests call it after every operation.

### 8.2 Create, rename, pin and favorite

- `project:create`: insert with `favorite 0`, `sort_order 0` and `created_at = updated_at = now`.
- `folder:create`:
  - If `projectId` is set, the project must be live, else NF "That location is in Trash." (or "That item no longer exists.").
  - If `parentId` is set, the parent must be live (NF otherwise) and must satisfy `parent.project_id IS location.projectId`, else V "That folder belongs to a different scope.".
  - Depth is parent depth + 1, or 1 at the root, and must be ≤ 32, else LE "Folders can be nested at most 32 levels deep.".
- `note:create`:
  - The folder and project are validated in the same way as for folders.
  - Insert `format 'rich'`, `content_json '{"type":"doc","content":[{"type":"paragraph"}]}'`, `plain_text ''`, `revision 0`, `sticky_enabled` from the request, `color` `'yellow'` for a sticky and `NULL` otherwise, and `title` normalized or `''`.
- Renames: names are normalized again in the service. `projects/folders.updated_at = now`. `note:rename` sets `title` and `updated_at`, and never touches `revision`. Renaming a trashed item gives NF.
- `note:setPinned`: `pinned_at = now` or `NULL`. `item:setFavorite`: `favorite 0/1`. Neither changes `updated_at` (Recent ordering must not jump) or `revision`. Both give NF for trashed or missing items.

### 8.3 Move

`folder:move(F, {projectId, parentId})`:

1. F must be live, else NF.
2. The target project (if any) must be live. The target parent (if any) must be live and in `projectId`, else V "That folder belongs to a different scope.".
3. Cycle check: `parentId === F`, or `parentId` is in `subtree(F)` (recursive CTE over all rows, depth guard 64), gives CYCLE "A folder cannot be moved into itself or one of its subfolders.". The check runs inside the same transaction.
4. Depth check: `newDepth(F) + height(subtree(F)) ≤ 32`, else LE.
5. If the parent and project are unchanged, it is a no-op: return the current state with `movedFolders 0` and `movedNotes 0`, and broadcast nothing.
6. `UPDATE folders SET parent_id, project_id, updated_at WHERE id = F`. Then `UPDATE folders SET project_id WHERE id IN subtree(F) minus F`, and `UPDATE notes SET project_id WHERE folder_id IN subtree(F)`. These two updates cover all rows, including trashed rows.
7. Invariants, commit, broadcast `move`.

`note:move(N, {projectId, folderId})` validates N and the target (as for create), then sets `folder_id` and `project_id`. Sticky state and color are kept. `updated_at` is not changed.

### 8.4 Trash, list, restore and purge

Trash. Each call creates one new `batch = ids.uuid()` and sets `deleted_at = now, trash_batch_id = batch`. Only live rows are affected.

- `note:trash`: the note only.
- `folder:trash`: F, plus the live folders in `subtree(F)`, plus the live notes whose `folder_id` is in `subtree(F)`.
- `project:trash`: P, plus the live folders with `project_id = P`, plus the live notes with `project_id = P`.
- The result carries counts and `trashedNoteIds`, and the broadcast is `{reason:'trash', trashedNoteIds}`. The FTS triggers remove trashed notes from the index.
- Trashing an already trashed or missing item gives NF.

`trash:list`:

- Load the trashed rows of the three tables.
- Each batch has exactly one root:
  - the project that carries the batch; otherwise
  - the folder in the batch whose parent is null or outside the batch; otherwise
  - the note.
- `fromPath` is the path of the root's original parent, computed through `parent_id` pointers (trashed ancestors included):
  - `[]` for projects;
  - for example `['Common']` or `['Work','Specs']`.
- `contains` counts the folders in the batch (excluding the root) and the notes in the batch.

`trash:restore(batch)`:

1. Find the root; if there is none, NF.
2. Compute the target:
   - Project root: there is no target; the project is restored in place.
   - Folder root R:
     - if `R.project_id` is non-null and that project is trashed or missing, the target is the Common root `{projectId:null, parentId:null}`;
     - otherwise walk up from `R.parent_id` to the first live ancestor folder; the target is that folder, or the scope root if there is none.
   - Note root N: the same rule, starting from `N.folder_id`.
3. `relocated` is true when the target differs from the original parent or project.
4. If relocated, reparent the root and propagate `project_id` through its whole subtree (all rows) with the same internal routine as move. Skip the cycle and depth checks: the target is an ancestor or a root, so depth cannot grow.
5. `UPDATE projects/folders/notes SET deleted_at = NULL, trash_batch_id = NULL WHERE trash_batch_id = batch`. The FTS triggers re-index the notes.
6. Invariants, commit, broadcast `restore`.
7. Return `location`, `path` (the path of the restore target) and `restoredNoteIds`.

`trash:purge`:

1. Reject a request without `confirmed: true` (V, by the schema).
2. The purge set is the rows whose batch is in the batch list: one batch, or every batch with `{kind:'all'}`. Pass the ID lists to SQL with `json_each(?)`, never as many bound variables.
3. Re-anchor survivors. Survivors are rows outside the set, which are necessarily trashed in other batches; assert that none is live.
   - A surviving folder whose parent is purged gets the nearest ancestor that is not purged, or `NULL`.
   - A surviving note whose folder is purged gets the nearest such ancestor of that folder, or `NULL`.
   - A survivor whose project is purged gets `project_id = NULL` (Common).
4. Delete:
   - `DELETE FROM notes` for the purged notes (cascades `note_versions`, `note_drafts`, `note_attachments`);
   - then the purged folders, leaves first: repeat `DELETE FROM folders WHERE id IN set AND NOT EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = folders.id)` until nothing is deleted (at most 33 rounds). `ON DELETE RESTRICT` is checked per row, so a parent cannot be deleted before its children;
   - then the purged projects.
5. `UPDATE attachments SET unreferenced_since = now WHERE unreferenced_since IS NULL AND id NOT IN (SELECT attachment_id FROM note_attachments)`. This only marks rows; GC is Phase 08.
6. Invariants, commit, broadcast `purge`.

### 8.5 Home, session, palette and open

`home:summary(scope)`:

- If `scope.kind === 'project'` and the project is not live, use `scopeValid:false` and the effective scope `{kind:'all'}`.
- The filter is `project_id IS NULL` (Common) or `project_id = ?` (Project). There is no filter for All.
- `pinned`: live notes with `pinned_at` not null, ordered by `pinned_at DESC, id`, limit 100, plus `pinnedTotal`.
- `recent`: live notes ordered by `updated_at DESC, id`, limit 10.
- Paths come from `buildPathIndex` over the live projects and folders.

`session:get`:

- Read the internal `session.tabs`.
- Look up the note states with one query: `SELECT id, deleted_at FROM notes WHERE id IN (SELECT value FROM json_each(?))`.
- Apply the shared `sanitizeSession` (section 9.3) and return the session and the `dropped` counts.
- Never write.

`session:set` validates (schema plus refinements) and calls `setInternal`.

`palette:searchTitles`:

- If `query.trim()` is empty, return `[]`.
- Otherwise load the live notes and match in JS against `displayTitle(title).toLocaleLowerCase()`: titles that start with the query first, then titles that contain it, each group ordered by `updated_at` desc. Apply the limit (default 20).
- There is no SQL `LIKE`, so `%` and `_` are literal characters.

`note:open`:

- Missing note: NF "That item no longer exists.".
- Trashed note: NF "This note is in Trash" with `details {trashed:true, trashBatchId}`.
- Otherwise return the summary with its path, the format, the parsed `content_json` (rich) or `content_text` (plain), and the revision.

### 8.6 Exact error messages

| Case | Code | Message |
| --- | --- | --- |
| Cycle | CYCLE | A folder cannot be moved into itself or one of its subfolders. |
| Depth | LIMIT_EXCEEDED | Folders can be nested at most 32 levels deep. |
| Target or item trashed | NOT_FOUND | That location is in Trash. |
| Item missing | NOT_FOUND | That item no longer exists. |
| Open trashed note | NOT_FOUND | This note is in Trash |
| Scope mismatch | VALIDATION_FAILED | That folder belongs to a different scope. |
| Unknown trash batch | NOT_FOUND | That item is no longer in Trash. |

---

## 9. Shared pure modules (Pass A, unit tested)

### 9.1 `src/shared/tree/tree-model.ts`

- `NodeKey`: `'favorites' | 'common' | 'projects' | 'trash' | 'project:<id>' | 'folder:<id>' | 'note:<id>' | 'fav:project:<id>' | 'fav:folder:<id>' | 'fav:note:<id>' | 'trash:<batchId>'`.
- `TreeNode {key, kind: 'group'|'common'|'project'|'folder'|'note'|'favorite'|'trashItem'|'empty', id?, label, sticky?, color?, pinned?, favorite?, parentKey, childKeys, location?: Location|FolderTarget, targetKey?}`. `targetKey` lets a favorite entry point at the real node.
- `buildTreeModel(snapshot, trashItems)`:
  - Roots in order: `favorites` (only when at least one favorite exists), then `common`, `projects`, `trash`.
  - Under `common` and under each project: folders first, then notes.
  - `projects` lists the projects.
  - `trash` lists `trash:<batch>` items, or one `empty` child labeled "Trash is empty".
  - Sorting uses `Intl.Collator(undefined, {sensitivity:'base', numeric:true})` on the label, with ties broken by `createdAt` and then `id`.
  - Note labels go through `displayTitle`.
- `flattenVisible(model, expanded: ReadonlySet<NodeKey>)` returns `VisibleRow[] {key, level (1-based), posInSet, setSize, hasChildren, expanded}` in display order.
- `treeKeyAction(rows, currentKey, key)` covers `ArrowDown`, `ArrowUp`, `Home`, `End`, `ArrowRight` and `ArrowLeft`, and returns `{focus?: NodeKey, expand?: NodeKey, collapse?: NodeKey}` following the APG tree rules:
  - Right on a collapsed parent expands it.
  - Right on an expanded parent moves to its first child.
  - Left on an expanded node collapses it.
  - Left on a child moves to its parent.
  - Up and Down move to the previous and next visible row.
  - Home and End move to the first and last row.
- `ancestorsOf(model, key)` is used by `reveal`. `locationOfNode(model, key)` returns the location for new items:
  - `common`: Common root.
  - Project: its root.
  - Folder: inside the folder.
  - Note: its folder.
  - Favorite: resolved through `targetKey`.
  - Groups and trash nodes: `null`.

### 9.2 `src/shared/tree/paths.ts`

`buildPathIndex(projects, folders)` returns `Map<folderId|projectId, string[]>`. The path for a note is `pathOf(location)`.

Disambiguation:

- When siblings (the same parent, or the same scope root) have the same `normalizeName(…).toLocaleLowerCase()`, the second and later ones by `createdAt` get " (2)", " (3)" appended to their segment.
- Projects with equal names are disambiguated in the same way.
- Notes with equal titles are not suffixed. Their path already distinguishes them, or they are identical siblings: in that case the palette shows both with the same path, ordered by `updated_at`, which is acceptable because opening is by ID.

### 9.3 `src/shared/tabs/tab-session.ts`

Pure functions over `TabSession`:

- `openTab(s, tab)`: returns `{session, existed}`. An existing tab is activated. A new tab is appended and activated. At 200 tabs it returns `{error:'LIMIT'}`.
- `closeTab(s, id)`:
  - `home` never closes.
  - Closing the active tab activates its right neighbor, else its left neighbor.
- `activateTab`, `nextTab` and `prevTab` follow strip order and wrap around.
- `removeNoteTabs(s, noteIds)`: returns `{session, removed}`, with the same active fallback as `closeTab`.
- `sanitizeSession(raw: unknown, noteState: (id) => 'live'|'trashed'|'missing')`:
  - If the raw value fails `TabSession`, return `DEFAULT_SESSION` and `invalid:true`.
  - Otherwise force exactly one `home` at index 0, drop duplicate IDs (counted), and drop trashed or missing note tabs (counted separately).
  - Keep `activeTabId` if it survives. Otherwise use the nearest surviving tab before it in the original order, else `home`.
  - Truncate to 200 tabs.

### 9.4 `src/shared/text/textarea-doc.ts` (D-048)

- `textToDoc(text)`: split on `\n` (CRLF normalized). Each line becomes `{type:'paragraph', content:[{type:'text', text}]}`, and an empty line becomes `{type:'paragraph'}`.
- `docToText(doc)`: paragraphs joined with `\n`. A paragraph's text is its text nodes concatenated, with `hardBreak` as `\n`.
- `isTextareaCompatible(doc)`: true when every top-level node is a paragraph whose children are only `text` without marks, or `hardBreak`.
- Round trip: `docToText(textToDoc(t)) === t` for any `t` without `\r`.

### 9.5 `src/shared/time/relative-time.ts`

`formatRelative(thenMs, nowMs)` uses `Intl.RelativeTimeFormat('en', {numeric:'auto'})`:

- under 45 s: "just now";
- otherwise minutes, hours and days;
- older than 7 days: the date `Intl.DateTimeFormat('en', {dateStyle:'medium'})`.

---

## 10. Headless renderer state (Pass A; `src/renderer/state/**`, no JSX)

### 10.1 Store primitive

`store.ts`: `createStore<S>(initial)` returns `{getState, setState(updater), subscribe}`. State objects are replaced immutably.

`use-store.ts` exports:

- `useStore(store)`, which uses `useSyncExternalStore` and returns `getState()`. Selectors are not used, which avoids unstable references.
- `AppServicesContext`.
- `useServices()`, which throws when there is no provider.

### 10.2 `app-services.ts`

`createAppServices(bridge, deps?: {now, setTimeout, clearTimeout, viewport?: {width(): number, onResize(cb): () => void}, randomUUID?})`:

- Builds every store and the `viewId` (one UUID per window).
- `init()` loads in parallel: the public settings (`appearance.theme`, `layout.*`, `home.scope`, `tree.expanded`), `tree:list`, `trash:list` and `session:get`.
- Subscribes to `settings:changed` and `tree:changed`.
- Exposes `ready: Promise<void>` and `dispose()`, which unsubscribes and disposes the active note controller after a flush.

The theme application from the existing `theme/theme.ts` moves here. While the setting is `system`, a `matchMedia('(prefers-color-scheme: dark)')` listener updates `data-theme` on `<html>`.

### 10.3 Stores

| Store | State | Methods |
| --- | --- | --- |
| `TreeStore` | `{status, snapshot, trash, model, expanded: Set<NodeKey>, selectedKey, hasFocus}` | `reload()`: coalesced, re-fetches `tree:list` and `trash:list`. `toggle(key)` and `setExpanded(key, open)`: persist `tree.expanded`, debounced 300 ms. `select(key)`, `setHasFocus(b)`, `reveal(key)`. `createProject(name)`, `renameProject`, `trashProject`, `createFolder(target, name)`, `renameFolder`, `moveFolder(id, target)`, `trashFolder`, `createNote(location, {sticky})`, `renameNote`, `moveNote`, `trashNote`, `setPinned`, `setFavorite`, `restore(batchId)`, `purge(batchId)`, `emptyTrash()`, `moveDestinations(forKey)`. Each returns `Result`. Every trash call first awaits `tabs.flushActive()`. `restore` pushes the restore notice (section 11.10) |
| `TabsStore` | `{session, ready}` | `init()`: `session:get`. If anything was dropped, push the closed-tab notice and persist the sanitized session once. `openNote(id)`, `openPage(kind)`, `activate(id)`, `close(id): Promise<boolean>`, `closeActive()`, `next()`, `prev()`, `closeNoteTabs(ids)`, `setScrollTop(tabId, px)`, `activeController()`, `flushActive()`. Every structural change calls `session:set` immediately (serialized queue, latest wins). `setScrollTop` is debounced 500 ms |
| `NoteController` (`notes/note-controller.ts`) | `{status: 'loading'\|'ready'\|'readOnly'\|'trashed'\|'missing'\|'error', note, text, revision, save: 'saved'\|'saving'\|'retrying'\|'error', message?, trashBatchId?}` | `open()`: `note:open`. If `isTextareaCompatible`, call `lease:acquire({noteId, viewId})`; if the lease is not granted, the state is `readOnly` with message "This note is being edited in another window". `setText(t)` (debounced 400 ms). `rename(title)` (debounced 400 ms, and flushed on blur). `flush()` returns `{ok:true}` or `{ok:false, code, message}`. `dispose()`: flush, then `lease:release`. Saves are sent one at a time (one in flight). On ack, the revision updates. `INTERNAL` is retried 3 times at 1 s intervals with save `retrying`, then save becomes `error`. `CONFLICT` and `LEASE_REQUIRED` set `readOnly` with message "This note changed elsewhere. Your edits were kept as a recovered draft" (the content is already stored as a draft by main) |
| `HomeStore` | `{scope, scopeValid, summary, status}` | `load()`, `setScope(scope)` (persists `home.scope`), `refresh()`. It refreshes on `tree:changed`, on Home activation and on scope change. When `scopeValid` is false it sets the scope to `{kind:'all'}` and persists it |
| `LayoutStore` | `{viewportWidth, treeMode: 'docked'\|'drawer', panelMode, treeOpen, panelOpen, treeWidth, treeDrawerOpen, panelDrawerOpen}` | `toggleTree()`: in docked mode it flips and persists `layout.treeOpen`; in drawer mode it toggles `treeDrawerOpen`. `togglePanel()` works the same way. `setTreeWidth(px, {persist})` clamps to 220..280. `closeDrawers()`. The tree is a drawer when the width is below 960; the panel is a drawer when the width is below 1180. Drawers close when the mode changes |
| `UiStore` | `{dialog: null \| {kind:'newProject'} \| {kind:'newFolder', target} \| {kind:'move', key} \| {kind:'confirmTrash', key} \| {kind:'confirmPurge', batchId, count} \| {kind:'confirmEmptyTrash', count}, paletteOpen, menu: null \| {key, anchor}, focusRequest: null \| {target:'noteTitle', noteId} \| {target:'treeRename', key}}` | `openDialog`, `closeDialog`, `openPalette`, `closePalette`, `requestFocus`, `consumeFocus` |
| `NoticeStore` | `{notices: {id, text, tone:'info'\|'error'}[]}` | `push(text, tone)`: auto-dismiss after 10 s, at most 3 shown. `dismiss(id)` |

Trashed-tab handling:

- `TreeStore` handles `tree:changed` with a non-empty `trashedNoteIds` by calling `tabs.closeNoteTabs(ids)`.
- When that removed at least one tab, it pushes the closed-tab notice.
- Responses do not trigger this a second time, so there is one notice per operation.

Tab switch and close flow (INF-TABS-03, D-048): leaving or closing the active note tab awaits `controller.flush()`.

- If the flush fails with `INTERNAL`, the tab stays and the notice "Could not save this note. The tab stays open." (error) appears.
- `CONFLICT`, `LEASE_REQUIRED` and `NOT_FOUND` proceed with the switch or close, because main has kept a draft or the note is gone.
- After a successful flush the controller is disposed (lease released), and the next note tab creates a new controller.
- Only the active note tab has a controller.

`window` `pagehide` and `visibilitychange` (hidden) call `flushActive()` on a best-effort basis.

### 10.4 Commands, shortcuts and location

- `commands.ts`: `CommandId` is one of `'note.new' | 'sticky.new' | 'project.new' | 'folder.new' | 'go.home' | 'go.stickies' | 'go.reminders' | 'go.settings' | 'view.toggleTree' | 'view.togglePanel' | 'tab.close' | 'tab.next' | 'tab.prev' | 'palette.open'`. `createCommandRunner(services).run(id)`:
  - `note.new` and `sticky.new` resolve the location (below), call `tree.createNote`, then `tabs.openNote` and `ui.requestFocus({target:'noteTitle'})`. On error they push the error message as a notice.
  - `project.new` opens the `newProject` dialog.
  - `folder.new` opens `newFolder` with the folder target derived from the location: a folder location gives `{projectId, parentId: folderId}`, and a root location gives `parentId: null`.
  - `go.*` opens or activates the Home tab or the page tabs.
  - `view.*` toggles the tree or the panel.
  - `tab.*` calls `closeActive`, `next` or `prev`.
  - `palette.open` opens the palette.
- `shortcuts.ts`: `matchShortcut({key, code, ctrlKey, shiftKey, altKey, metaKey}): CommandId | null`. Alt or Meta always gives `null`.
  - Ctrl+N: `note.new`
  - Ctrl+Shift+N: `sticky.new`
  - Ctrl+W: `tab.close`
  - Ctrl+Tab: `tab.next`
  - Ctrl+Shift+Tab: `tab.prev`
  - Ctrl+K: `palette.open`
  - Ctrl+`code==='Backslash'`: `view.toggleTree`
  - Ctrl+Shift+`Backslash`: `view.togglePanel`
  - Letters are compared case-insensitively.
- `current-location.ts`: `resolveNewItemLocation({treeHasFocus, selectedKey, model, activeTab, activeNote, homeScope}): Location` (D-047 order):
  1. If the tree has focus and a selected key with a location, use that location.
  2. Else, for an active note tab, use that note's `{projectId, folderId}`.
  3. Else, for the Home tab, use the project root for a Project scope, else the Common root.
  4. Else the Common root.
- `palette-actions.ts`: `PALETTE_ACTIONS: {id: CommandId, label, shortcut?}[]` with these labels: "New note" (Ctrl+N), "New sticky" (Ctrl+Shift+N), "New project", "New folder", "Go to Home", "Open Stickies", "Open Reminders", "Open Settings", "Toggle notes tree" (Ctrl+\), "Toggle details panel" (Ctrl+Shift+\), "Close tab" (Ctrl+W), "Next tab" (Ctrl+Tab), "Previous tab" (Ctrl+Shift+Tab). `filterActions(actions, query)` does a case-insensitive word-prefix or substring match and keeps the list order.

---

## 11. Shell UI (Pass B, LOW): layout, behavior, copy

The reference is adapted, not copied. Copy:

- a narrow icon rail with a pill selected state;
- a compact header with the product name and a centered search box showing `Ctrl` `K`;
- a horizontal tab strip whose Home tab has a top accent line;
- small uppercase section labels;
- 96x80 tiles;
- softly bordered 8 px panels;
- segmented toggles;
- the violet accent.

Do not copy: capture or record labels, "Saving to", the red badge dot, a keyboard icon at the bottom of the rail, or recording options.

### 11.1 Layout and landmarks

```
#app-shell (grid, 100vh, data-ready="true" once services.ready resolved)
 ├ header[role=banner]            grid-column: 1 / -1; height 44px; border-bottom 1px var(--border)
 ├ nav[aria-label="Primary"]      .rail 52px wide, bg var(--bg-rail), border-right
 ├ nav[aria-label="Notes"]        .tree-pane (docked only) width var(--tree-w) (220-280)
 ├ div[role=separator]            .splitter 4px (docked tree only)
 ├ main                           .doc-column: TabStrip (36px) + tabpanel (flex 1, overflow auto)
 └ aside[aria-label="Details"]    .context-panel (docked only) width 300px, border-left
```

- At widths below 960 px, the tree renders inside `Drawer side="left"`. At widths below 1180 px, the panel renders inside `Drawer side="right"`.
- Drawers are a native `<dialog>` opened with `showModal()`:
  - width 280 px (tree) or 320 px (panel), full height below the header;
  - backdrop `var(--scrim)`;
  - Escape (native `cancel`) or a backdrop click closes the drawer;
  - focus moves to the first focusable element inside (the tree's roving item);
  - on close, focus returns to the invoking control;
  - opening a note from the tree drawer closes the drawer.
- Token additions in `tokens.css`, appended without changing existing values:
  - light: `--scrim: rgba(17,18,23,0.32)`, `--shadow-popover: 0 8px 24px rgba(16,18,32,0.12)`;
  - dark: `--scrim: rgba(0,0,0,0.5)`, `--shadow-popover: 0 8px 24px rgba(0,0,0,0.45)`;
  - `:root`: `--rail-w: 52px; --header-h: 44px; --tabstrip-h: 36px; --panel-w: 300px`.

### 11.2 Header (`Header.tsx`)

- Left: the lucide `Infinity` icon (18 px, accent), then `<h1 class="app-title">Infinity Notes</h1>` (13 px, weight 600, margin 0).
- Center: `<button class="search-box" aria-label="Search notes and commands (Ctrl+K)">`:
  - width `min(480px, 40vw)`, height 30, radius 6, 1 px border, `--bg` background;
  - contents: the `Search` icon, the muted text "Search notes and commands", and at the right two `<kbd>` chips "Ctrl" and "K";
  - clicking runs `palette.open`.
- Right: icon buttons (28 px) "Toggle notes tree (Ctrl+\)" (`PanelLeft`) and "Toggle details panel (Ctrl+Shift+\)" (`PanelRight`), each with `aria-expanded` reflecting the visible state and `aria-controls`.

### 11.3 Rail (`Rail.tsx`)

- Five 36x36 icon buttons, 8 px apart, with `aria-label` and a `title` tooltip:
  - Home (`House`), Notes (`NotebookText`), Stickies (`StickyNote`) and Reminders (`Bell`) at the top;
  - Settings (`Settings`) pinned to the bottom with `margin-top: auto`.
- Icons are 20 px, stroke 1.75, `--text-muted`.
- Selected pill: `--accent-soft` background, `--accent` icon, radius 8.
  - Home, Stickies, Reminders and Settings show the pill and `aria-current="page"` when their tab is active.
  - Notes is a toggle (`aria-expanded`, `aria-controls` pointing at the tree pane or the drawer) and shows the pill while the tree is visible.
- Actions:
  - Home: `go.home`.
  - Notes: `view.toggleTree`. When it opens the tree, it also moves focus into the tree.
  - Stickies, Reminders and Settings: the `go.*` commands.

### 11.4 Tab strip (`TabStrip.tsx`, `AllTabsMenu.tsx`)

- Container row (36 px, `--bg-rail` background, bottom border):
  - `[◀ scroll button][role=tablist aria-label="Open tabs" (overflow-x auto, scrollbar hidden, wheel scrolls horizontally)][▶ scroll button][All tabs button]`.
  - The scroll buttons ("Scroll tabs left" and "Scroll tabs right") render only while `scrollWidth > clientWidth`.
  - "All tabs" (`List` icon) is always present.
- Each tab is a wrapper `div.tab` containing:
  - `role="tab"`, `id="tab-<tabId>"`, `aria-selected`, `aria-controls="tabpanel"`, and the roving `tabIndex` (0 on the focused tab, -1 otherwise);
  - an icon (14 px: `House`, `FileText` or `StickyNote` with a color dot, or the page icon) and a label with ellipsis;
  - a sibling close button `aria-label="Close <label>"`, `tabIndex=-1`, visible on hover, on the active tab and on keyboard focus within the tab. The Home tab has no close button.
- Sizes: note and page tabs `min-width 120px; max-width 220px`. The Home tab sizes to its content.
- Active tab: `--bg` background, 2 px top border `--accent`, `--text`. Inactive tabs: transparent background, `--text-muted`.
- Labels:
  - note tabs use `displayTitle` from the tree snapshot (so renames update live), falling back to "Untitled";
  - page tabs use "Stickies", "Reminders" and "Settings".
- Interactions:
  - click activates;
  - middle click (`onAuxClick` with button 1, and `onMouseDown` with button 1 `preventDefault`) closes;
  - the close button closes;
  - keyboard on a focused tab: Left and Right move focus (wrapping), Home and End go to the first and last tab, Enter and Space activate (manual activation), Delete closes (not on Home);
  - after an activation the active tab is scrolled into view (`scrollIntoView({inline:'nearest', block:'nearest'})`).
- All tabs menu: a `Menu` popover with `role="menu"` and one `menuitemradio` per tab, `aria-checked` on the active tab. It supports Up and Down, Enter to activate and close, and Escape to close and return focus to the button.
- The tab panel is a `div role="tabpanel" id="tabpanel" aria-labelledby="tab-<active>"`. It renders `HomeView`, `NoteView` (only for the active note tab), `StickiesPage`, `RemindersPage` or `SettingsPage`.

### 11.5 Home (`HomeView.tsx` and children)

- Padding 24 px 32 px. Header row:
  - left: `<h2>Home</h2>` (22 px, weight 600);
  - right: `ScopeFilter`, which is a `SegmentedControl` with `role="radiogroup"` and `aria-label="Show notes from"`, radios "All", "Common" and "Project".
    - Arrow keys move and select. Space selects.
    - "Project" is disabled (`aria-disabled`, title "Create a project first") when there are no live projects.
    - When "Project" is selected, a native `<select aria-label="Project">` follows, listing live projects alphabetically.
    - Choosing "Project" first picks the previously chosen project, else the first alphabetically.
- Sections, in this order. Section labels are `h3.section-label` (11 px uppercase).
  - "Quick actions": three 96x80 tiles with a 20 px accent icon over a 13 px label: "New note" (`FilePlus`), "New sticky" (`StickyNote`) and "New project" (`FolderPlus`). They run `note.new`, `sticky.new` and `project.new`.
  - "Pinned":
    - up to 12 cards (180x72, 1 px border, radius 8) with the title, the muted path joined by " › " and a color dot for stickies;
    - a "View all (N)" toggle button, or "Show fewer", when `pinnedTotal > 12`;
    - empty state: the muted text "Pin a note to keep it here.";
    - clicking a card opens its note.
  - "Recent": a list (`ul`) of up to 10 rows, each a button with the title, the path and `formatRelative(updatedAt, now)`. Empty state: "No notes yet. Create one with New note.".
  - No reminders section and no placeholder (Phase 05).
- `HomeStore.refresh()` runs whenever the Home tab becomes active.

### 11.6 Notes tree (`TreePane.tsx`, `TreeRow.tsx`, `TreeContextMenu.tsx`, `MoveDialog.tsx`)

Pane header (32 px):

- the label "Notes" (`section-label` style);
- an icon button "New project" (`FolderPlus`).

Body (`ul role="tree" aria-label="Notes tree"`):

- One flat list rendered from `flattenVisible`. Each row is an `li role="treeitem"` with:
  - `aria-level`, `aria-setsize`, `aria-posinset`, `aria-selected`;
  - `aria-expanded` on nodes that have children;
  - `id="tree-<key>"` and a roving `tabIndex`.
- Row layout: height 28 px; indent `(level-1)*16 + 8` px; chevron 14 px (`ChevronRight`/`ChevronDown`); icon 16 px:
  - Common and projects: `Folder`.
  - Folders: `Folder`, or `FolderOpen` when expanded.
  - Notes: `FileText`.
  - Stickies: `StickyNote` with a color dot.
  - Trash group: `Trash`.
  - Favorites group: `Star`.
- Then the label with ellipsis, plus a small `Pin` glyph for pinned notes.
- Selected row: `--accent-soft` background. Focused row: inset 2 px focus ring.

Pointer:

- Clicking a row selects it and focuses it.
- Notes: the click also opens the note (`tabs.openNote`).
- Folders, projects and groups: the click also toggles expansion.
- Favorites entries: the click selects and reveals the target (notes also open).
- Right click opens the context menu at the pointer.

Keyboard (INF-HIER-12):

- Arrows, Home and End go through `treeKeyAction`.
- Enter: open a note, toggle a parent, or open the item menu on a trash item.
- F2: inline rename (below).
- Delete: `confirmTrash` for notes, folders and projects. On a trash item it opens `confirmPurge`.
- Shift+F10 or the ContextMenu key opens the context menu for the focused row.
- Common: F2 pushes the notice "Common cannot be renamed", and Delete pushes "Common cannot be moved to Trash". No dialog opens.
- Focus in or out of the tree updates `tree.setHasFocus`.

Inline rename:

- The label becomes `<input aria-label="Rename">`, prefilled with the current text, which is selected.
- Enter commits, blur commits, and Escape cancels with focus back on the row.
- Invalid names show the `validateName` message in a `role="alert"` element under the row and keep the input open.
- On success, the tree reloads through `tree:changed` and focus stays on the renamed row.

Context menu (`Menu`, `role="menu"`; on open the first enabled item is focused; Up/Down/Home/End/Enter/Escape; focus returns to the row). Entries by node kind, in this order:

| Node | Items |
| --- | --- |
| Common | New note, New sticky, New folder |
| Project | New note, New sticky, New folder, Rename, Add to favorites/Remove from favorites, Move to Trash |
| Folder | New note, New sticky, New folder, Rename, Move to…, Add to favorites/Remove from favorites, Move to Trash |
| Note | Open, Rename, Move to…, Pin to Home/Unpin from Home, Add to favorites/Remove from favorites, Move to Trash |
| Trash item | Restore, Delete forever |
| Trash group | Empty trash (disabled when empty) |
| Projects group | New project |

The "New note" and "New sticky" items create the item in that node's location, then reveal and open it.

Move dialog (`MoveDialog`, native modal `<dialog>`):

- title "Move “<label>” to";
- a filter input `aria-label="Filter locations"`;
- `ul role="listbox" aria-label="Locations"` with one option per destination from `tree.moveDestinations(key)`, labeled by its path joined with " › ":
  - first the Common root ("Common"), then the Common folders, then each project root and its folders;
  - the item's current location is marked "(current)".
- The input owns the list via `aria-activedescendant`: Up and Down move, Enter moves.
- Buttons: "Move" (primary) and "Cancel".
- Folder moves list every live destination, including the folder itself and its descendants, so that the server rule is visible.
- Errors from main (CYCLE, LIMIT_EXCEEDED, NOT_FOUND) appear verbatim in a `role="alert"` paragraph inside the dialog. The dialog stays open.
- On success it closes, reveals the moved item and returns focus to its row.

### 11.7 Dialogs (`Dialog.tsx`, `ConfirmDialog.tsx`, `NameDialog.tsx`, `DialogHost.tsx`)

`Dialog` wraps a native `<dialog>` with `showModal()`:

- `aria-labelledby` points at its `h2`;
- Escape closes it (`cancel`);
- on close, focus returns to `document.activeElement` as captured at open time.

`DialogHost` renders the dialog that `UiStore.dialog` names.

| Dialog | Title | Body | Buttons (initial focus in bold) |
| --- | --- | --- | --- |
| newProject | New project | `label` "Name", input prefilled "New project", text selected | **Create**, Cancel |
| newFolder | New folder | `label` "Name", prefilled "New folder" | **Create**, Cancel |
| confirmTrash | Move to Trash? | "“<label>” will be moved to Trash. You can restore it from Trash." | **Move to Trash**, Cancel |
| confirmPurge | Delete forever? | "1 item will be deleted forever. This cannot be undone." or "N items …" (N = 1 + contains.folders + contains.notes) | Delete forever, **Cancel** |
| confirmEmptyTrash | Empty trash? | "N items will be deleted forever. This cannot be undone." | Empty trash, **Cancel** |

- Name dialogs validate with `validateName` before calling IPC and show errors in `role="alert"`.
- After creation the new item is revealed and selected. A new project is also expanded.

### 11.8 Context panel (`ContextPanel.tsx`, `InfoSection.tsx`)

The panel is 300 px wide, with padding 16 and a left border. It contains a collapsible section `h2` "Info" (a disclosure button with `aria-expanded`).

- Non-note active tab: the muted text "Open a note to see its details".
- Note tab, as a definition list (`dl`) of rows:
  - "Title" (`displayTitle`);
  - "Location" (the path joined by " › ");
  - "Type" ("Note" or "Sticky");
  - "Created" and "Updated" (`Intl.DateTimeFormat('en', {dateStyle:'medium', timeStyle:'short'})`);
  - "Revision" (from the controller).
- Then two `Switch` controls (`role="switch"`, `aria-checked`): "Pinned to Home" and "Favorite".

### 11.9 Note view (`NoteView.tsx`, `TempTextEditor.tsx`)

`NoteView` takes the active controller from `tabs.activeController()` and uses `useStore`.

- The content column is centered with `max-width: 760px` and padding 24 px 32 px.
- Header:
  - the title input `aria-label="Title"`, placeholder "Untitled", 22 px, weight 600, no border until hover or focus;
  - for stickies, a badge (color dot plus "Sticky");
  - the muted path;
  - at the right, the save status `role="status"`: "Saved", "Saving…", "Not saved - retrying" or "Not saved".
- The title input calls `controller.rename` on change (debounced) and flushes on blur and Enter. Enter moves focus to the text area.
- Body: `TempTextEditor`, a `<textarea aria-label="Note text">` (15 px, line height 1.55, `--font-ui`, no resize, fills the remaining height, focus ring on focus). It calls `controller.setText` on change, calls `controller.flush()` on blur, and reports `scrollTop` through `tabs.setScrollTop` (restored on mount).
- States:
  - `loading`: an `aria-busy` region.
  - `readOnly`: a banner with the message, and the text area is `readOnly`.
  - `trashed`: a centered panel "This note is in Trash" with the buttons "Restore" (`tree.restore(trashBatchId)`, which then re-opens the note) and "Close tab".
  - `missing`: "This note no longer exists" and "Close tab".
- When a `focusRequest` targets this note's title, focus the title input and consume the request.

### 11.10 Notices, pages and palette

`Notices.tsx`:

- A region `role="status" aria-live="polite"` at the bottom right of the document column, showing up to 3 stacked toasts, each with a "Dismiss" icon button.
- Copy:
  - "1 tab was closed because its note is in Trash";
  - "N tabs were closed because their notes are in Trash";
  - "N tabs were closed because their notes are in Trash or no longer exist" (when `dropped.missing > 0`);
  - "Restored to <path>" when `relocated` is false;
  - "Restored to <path> because its original location is in Trash or no longer exists" when `relocated` is true;
  - "Could not save this note. The tab stays open.";
  - "You have 200 open tabs. Close some tabs to open more.";
  - "Common cannot be renamed" and "Common cannot be moved to Trash".

Pages:

- `StickiesPage`:
  - `h2` "Stickies", a "New sticky" button (runs `sticky.new`; with the Stickies tab active and the tree unfocused, rule 4 applies and the sticky goes to the Common root);
  - a list of the sticky notes from the tree snapshot, sorted by `updatedAt` desc, each row showing a color dot, the title, the path and an "Open" button;
  - empty state: "No stickies yet.".
- `RemindersPage`: `h2` "Reminders" and the paragraph "Reminders are not available in this build yet.".
- `SettingsPage`: `h2` "Settings".
  - `h3` "Appearance" with a `SegmentedControl` radiogroup `aria-label="Theme"` of radios "System", "Light" and "Dark", bound to `appearance.theme` through `settings.set`.
  - `h3` "About" with "Version 0.1.0" and "Storage ready (SQLite <version>)" from `app:getInfo`.

`CommandPalette.tsx`:

- A modal `<dialog aria-label="Command palette">`, 560 px wide, 15 vh from the top.
- An `input role="combobox" aria-expanded="true" aria-controls="palette-list" aria-label="Type a command or note title"`, focused on open.
- `ul#palette-list role="listbox"` with two labeled groups:
  - "Notes": `palette:searchTitles` results, debounced 150 ms, shown only while the query is non-empty, each with the title and the muted path;
  - "Actions": `filterActions`, each with its label and, at the right, the shortcut in `<kbd>`.
- The active option is tracked with `aria-activedescendant`. Up and Down move through Notes then Actions, Enter runs, Escape closes.
- After running, the palette closes. Focus returns to the previously focused element unless the action moves focus itself (a new note focuses its title).
- With no matches it shows "No matches".
- Opening a note result uses `tabs.openNote`, which never creates a duplicate.

### 11.11 Global shortcuts (`GlobalShortcuts.tsx`)

- One `keydown` listener on `window` in the capture phase. It ignores events while any `dialog[open]` contains `event.target`; the palette and dialogs handle their own keys.
- For a matched command it calls `preventDefault()`, then `commands.run(id)`.
- Ctrl+W on the Home tab does nothing.
- Shortcuts work while the text area or title input has focus.

### 11.12 Visual rules

- UI text is 13 px. Section labels are 11 px uppercase with letter spacing 0.04em. Panels have radius 8 and controls radius 6.
- Use the shared focus ring `:focus-visible {outline: 2px solid var(--accent); outline-offset: 2px}`. Tree rows and tabs use `outline-offset: -2px`.
- Hover states use `--accent-soft` or `--bg-subtle`.
- No animations beyond 120 ms opacity and transform transitions; the existing `prefers-reduced-motion` rule removes them.
- Both themes come from tokens only, with no hard-coded colors except the white text on the primary button.
- Tiles and cards use a hover border of `--accent-border`.

---

## 12. Temporary editor contract (D-048)

- Content is always saved as a rich document through `note:save`, with `title` omitted.
- One `viewId` per window holds the lease while a note tab is active. The lease is released after the flush on switch or close.
- A note whose document is not compatible with the text area (for example created by a later phase or by tests) opens read-only and keeps its content intact.
- Known limitation, stated in the progress report: text typed within 400 ms before the window closes may be lost. Phase 03 adds window-close and quit flushing (INF-SAVE-01).

---

## 13. Accessibility checklist for Pass B (verified in Pass C)

- Landmarks: banner, Primary nav, Notes nav, main, Details aside.
- One `h1` (the product name). Each view has an `h2`.
- Every icon button has an `aria-label`.
- Roving tabindex in the tree and in the tablist.
- Every dialog and menu returns focus to its invoker.
- Every form control has an accessible name.
- Visible focus everywhere.
- No positive `tabindex`.

---

## 14. Tests

Hosts:

- **W**: Windows 11. Playwright runs under Node 24.21 via `INFINITY_E2E_NODE`.
- **L**: WSL Ubuntu 26.04 with WSLg as user `infinity`. Default ozone, which Phase 01 observed as x11.
- **L-xvfb**: `env -u WAYLAND_DISPLAY -u DISPLAY` (xvfb-run).
- **L-wl**: forced `--ozone-platform=wayland`. Informational only (section 15).

Seeding in E2E goes through the real bridge (`page.evaluate(() => window.infinity.…)`), never by writing rows directly, except where a test deliberately corrupts or ages stored data while the app is closed.

### 14.1 Explicit assertions per requirement ID (Phase 00 F-1)

| ID | Action or input | Expected | Failure case asserted | Test file › case | Hosts |
| --- | --- | --- | --- | --- | --- |
| INF-SHELL-01 | Launch; window content set to 1100x720; click each rail button | `nav[aria-label=Primary]` has exactly 5 buttons named Home, Notes, Stickies, Reminders, Settings. Header `h1` reads "Infinity Notes". A button named "Search notes and commands (Ctrl+K)" shows the kbd texts "Ctrl" and "K". The tablist has a Home tab. Rail box width 52±1, header height 44±1, tab strip height 36±1. Home/Stickies/Reminders/Settings clicks activate the matching tab, and that rail button gets `aria-current=page` with computed background equal to `--accent-soft`. The active tab's top border color equals `--accent` (rgb(106, 90, 224) light). A screenshot is saved | `document.body.innerText` matching `/\b(capture\|recording\|record\|screenshot\|framecapt)\b\|saving to/i` fails | e2e/shell.spec › rail navigation; › no capture-specific labels; e2e/visual.spec › 1100x720 light | W, L, L-xvfb |
| INF-SHELL-02 | 1280x800. Click "Toggle notes tree", then press Ctrl+\. Focus the splitter and press ArrowRight ×3, then End, then Home; drag the splitter +20 px with the mouse. Relaunch | The tree is hidden after the first toggle (`nav[aria-label=Notes]` absent) and visible again after Ctrl+\. The separator has `aria-valuemin=220` and `aria-valuemax=280`. Default width 248. ArrowRight ×3 gives 272. End gives 280, Home 220. A drag from 220 gives 240. After relaunch the pane is 240±1 px and the DB row `layout.treeWidth` is `{"v":1,"value":240}`. `layout.treeOpen` false persists across relaunch when the tree is left closed | Width outside 220..280 after any input fails. Unit: `setTreeWidth(500)` clamps to 280 | e2e/shell.spec › tree toggle and width persists; unit/renderer/state/layout-store.test | W, L |
| INF-SHELL-03 | 1280x800. Look at the panel on Home; open a note; toggle with the header button and Ctrl+Shift+\; relaunch | The panel is docked, 280 ≤ width ≤ 340 (300). On Home it shows "Open a note to see its details". With a note open, Info shows Title, Location (path), Type, Revision and switches. The toggle hides it, and after relaunch it stays hidden (`layout.panelOpen` false). Toggling the "Pinned to Home" switch updates `notes.pinned_at` | A panel visible while toggled off, or Info showing another note's data, fails | e2e/shell.spec › panel toggle | W, L |
| INF-SHELL-04 | Content 760x560: click the Notes rail button, choose a note, press Ctrl+Shift+\, press Escape. Then 1100x720. Then 959 vs 960 and 1179 vs 1180 | At 760: no docked tree and no docked panel. Notes opens `dialog` (open, modal) holding the tree, with focus on a treeitem. Choosing a note opens its tab and closes the drawer. Ctrl+Shift+\ opens the right drawer; Escape closes it and focus returns to the invoker. At 1100: docked tree, panel in drawer mode. At 959 the tree is a drawer and at 960 it is docked; at 1179 the panel is a drawer and at 1180 it is docked. Screenshots at 760x560 with the drawer open | A docked pane below its breakpoint, or focus lost on drawer close, fails | e2e/shell.spec › narrow 760x560 drawers; › breakpoints; e2e/visual.spec › 760x560 | W, L |
| INF-SHELL-05 | Theme `system`; emulate `prefers-color-scheme` dark then light (`page.emulateMedia`, falling back to `nativeTheme.themeSource` via `app.evaluate`); then choose Settings › Theme › Dark | Dark: `html[data-theme=dark]` and body background `rgb(23, 24, 29)`. Light: `rgb(255, 255, 255)`. Choosing Dark persists `{"v":1,"value":"dark"}`. Unit: every UX_SPEC token value is present in `tokens.css` for its theme. Light and dark screenshots at 1100x720 | A wrong token value or a theme not following the OS fails | e2e/shell.spec › theme follows OS; unit/tokens.test; e2e/visual.spec › dark | W, L |
| INF-SHELL-06 | Press Tab from the document start; inspect the main window options | The first Tab lands on a control with a computed outline of 2 px solid `--accent` and outline-offset 2 px (rail buttons) or -2 px (tree and tabs). The focus-ring screenshot is saved. Unit: `mainWindowOptions()` has no `frame:false`, no `titleBarStyle` and no `transparent`, and has `autoHideMenuBar:true`. N part (native frame and window controls on a real desktop) pending for the Phase 09 matrix | No visible outline on focus fails | e2e/shell.spec › visible focus; unit/main-window-options.test; e2e/visual.spec › focus ring | W, L |
| INF-HOME-01 | Click rail Home twice; run palette "Go to Home"; press Ctrl+W, middle-click and Delete on the Home tab; seed a session with two `home` entries and Home not first (DB write while closed); relaunch | Exactly one tab named Home, at index 0. It has no "Close Home" button. Ctrl+W, middle click and Delete leave it open. After relaunch there is still one Home, at index 0 | Two Home tabs, or Home closable, fails | e2e/home.spec › one Home tab after relaunch; › Home not closable; unit/tab-session.test | W, L |
| INF-HOME-02 | Seed notes A, B and C, pin C, save text into B, return to Home; trash A | Quick actions show three buttons named New note, New sticky and New project. Pinned shows C with its path. Recent lists B first (most recently updated), then the others, each with path and relative time. After trashing A, A is in neither Pinned nor Recent. "Pin to Home" from the tree menu adds a note to Pinned; "Unpin from Home" removes it | A trashed note shown, or wrong ordering, fails | e2e/home.spec › pinned and recent reflect data; › pin; integration/home-summary.test | W, L |
| INF-HOME-03 | Seed X (Common), Y (project P) and Z (project Q). Select All, Common, then Project with P; relaunch; with filter P click "New note"; with filter Common press Ctrl+Shift+N; trash P while filter P is active | All shows X, Y and Z. Common shows X only. P shows Y only. After relaunch the filter is still Project P (`home.scope` stored). "New note" under P creates a note with `project_id=P, folder_id NULL`; Ctrl+Shift+N under Common creates a sticky with `project_id NULL, folder_id NULL, sticky_enabled 1, color 'yellow'`. After P is trashed the filter shows All and `home.scope` is `{"kind":"all"}`. Integration: All, Common and Project return the same stored rows; a trashed project gives `scopeValid:false` | Notes from another scope in a filtered view fails | e2e/home.spec › filter; integration/home-summary.test | W, L |
| INF-HIER-01 | The tree on first run; F2 and Delete on Common; open Common's context menu. Integration: `project:rename/trash` with `projectId: null`, `'common'` or `''` | Common is the first scope node (after Favorites when favorites exist). F2 shows the notice "Common cannot be renamed" and no input. Delete shows "Common cannot be moved to Trash" and no dialog. Common's menu has no Rename, Move to… or Move to Trash. Integration: those payloads give `VALIDATION_FAILED`; notes, stickies and folders can be created at the Common root and in Common folders | Any rename or trash of Common fails | integration/hierarchy.test › Common immutable; e2e/tree.spec › Common protected | W, L |
| INF-HIER-02 | Create project "Alpha" from the Home tile and "Beta" from the tree button; F2 rename Alpha to "Alpha 2"; relaunch; trash Beta | Both appear under Projects, sorted alphabetically. The rename persists after relaunch (DB `projects.name`). Trashing Beta removes it and its contents from the tree and lists one Trash root "Beta". Integration: create, rename (trimmed, Bangla name kept), trash with counts, rename of a trashed project gives NOT_FOUND, an empty or 201-character name gives VALIDATION_FAILED | A lost rename or a partial trash fails | integration/hierarchy.test › project CRUD; e2e/tree.spec › project CRUD | W, L |
| INF-HIER-03 | Through the context menu create Alpha › L1 › L2 › L3 and Common › C1 › C2; rename L2; trash L3. Integration: a chain of 32 folders in Common and in a project, then the 33rd | The tree shows the nesting with aria-levels 3, 4 and 5 under Alpha. The rename persists. Integration: depth 32 succeeds in both scopes; depth 33 gives `LIMIT_EXCEEDED` with "Folders can be nested at most 32 levels deep." and no row is inserted | Accepting depth 33 fails | integration/hierarchy.test › deep folders, depth limit; e2e/tree.spec › nested folders | W, L |
| INF-HIER-04 | Context menu "New note" on L3; Ctrl+N with the tree focused on L2; "New note" on Common | Each note opens in a tab with the title focused. The DB rows have `folder_id = L3/L2/NULL` and a `project_id` consistent with it. The tree shows each note under its parent. Integration: create at the Common root, Common folder, project root and project folder; a folder from another scope gives VALIDATION_FAILED; a trashed folder gives NOT_FOUND | A note landing in the wrong place fails | e2e/tree.spec › create note in folder; integration/hierarchy.test › notes at root and folder | W, L |
| INF-HIER-05 | Context menu "New sticky" on L1; the Stickies page. Integration: stickies in all four location kinds, then moved | The tree row shows the sticky icon. The Stickies page lists it with path "Alpha › L1" and an Open button. Integration: `sticky_enabled 1` and `color 'yellow'`; a move keeps the sticky flag and color | Sticky state lost on move fails | integration/hierarchy.test › sticky in folder; e2e/tree.spec › sticky in folder | W, L |
| INF-HIER-06 | Integration: two sibling folders "Specs" under Work, notes titled "Plan" in two folders, two projects named "Work" | All rows are created with distinct IDs. `buildPathIndex` gives `['Work','Specs']` and `['Work','Specs (2)']` (ordered by `createdAt`) and project paths `Work` and `Work (2)`. `palette:searchTitles('plan')` returns both notes with different paths | A uniqueness error or identical labels for different siblings fails | integration/hierarchy.test › duplicate names; unit/tree-paths.test | W, L |
| INF-HIER-07 | Integration: move folder F (2 levels, 3 notes, one of them trashed) from project P into a Common folder, then to the root of project Q; move a note across scopes; inject a failing `BEFORE UPDATE ON notes` temp trigger during a move. E2E: Move to… on L1 to project Beta's root, then relaunch | After each move every folder and note in the subtree (including the trashed note) has the new `project_id`, `parent_id`/`folder_id` are correct, and the invariants hold. With the failing trigger the call gives INTERNAL and every row is unchanged. E2E: L1 and its children appear under Beta after relaunch, and the DB rows match | Any row left with the old scope, or a partial move, fails | integration/hierarchy.test › subtree move atomic; e2e/tree.spec › move persists after restart | W, L |
| INF-HIER-08 | Integration: move F into F, into its child and into its grandchild. E2E: Move to… on L1 and choose "Alpha › L1 › L2" | Each gives `CYCLE` "A folder cannot be moved into itself or one of its subfolders." and nothing changes. E2E: the dialog shows that text in `role=alert` and stays open; Cancel returns focus to the L1 row; L1 is unchanged | A cycle accepted, or the message missing, fails | integration/hierarchy.test › cycle rejected; e2e/tree.spec › cycle rejected | W, L |
| INF-HIER-09 | E2E: Delete on L2 then confirm; Trash shows one root "L2"; Restore. Trash note N, then its folder; restore N; Delete forever with confirmation; Empty trash. Integration: section 14.3 trash.test | L2 and its children leave the tree, and Trash lists exactly one root whose label is L2. Restore puts it back under L1. Restoring N while its folder is trashed shows "Restored to Alpha › L1 because its original location is in Trash or no longer exists" and N appears there. "Delete forever?" names the item count. After confirming, the rows are gone from the DB and the tree. "Empty trash?" removes everything; the Trash group shows "Trash is empty" | Restoring into a trashed folder, or a purge without the confirm dialog, fails | integration/trash.test; e2e/tree.spec › trash and restore | W, L |
| INF-HIER-10 | Pin note N, favorite N, folder L1 and project Alpha from the context menu; relaunch; unfavorite L1 | Home Pinned shows N. The Favorites group lists Alpha, L1 and N. After relaunch the group still shows them (DB `favorite=1`, `pinned_at` not null). Unfavoriting removes L1. Clicking the favorite N opens its tab | Favorites lost after relaunch fails | e2e/home.spec › pin; e2e/tree.spec › favorites | W, L |
| INF-HIER-12 | Keyboard only. Tab into the tree, then use arrows, Home, End, Right and Left, Enter on a note, F2 with "Renamed" and Enter, Delete then Enter, Delete then Escape, Shift+F10 then Down, Down, Enter ("New folder") | The focused treeitem follows the APG rules: `aria-expanded` toggles on Right and Left, `aria-selected` follows. Enter opens the note tab. The rename persists. Delete then Enter trashes the item; Delete then Escape cancels with focus back on the row. The menu creates a folder through the dialog (Enter to accept the default name). `document.activeElement` is always inside the tree or the dialog, never `body` | A focus loss to `body`, or a missing ARIA attribute, fails | e2e/a11y-keyboard.spec › tree; unit/tree-model.test › keyboard actions; unit/renderer/tree-pane.test | W, L |
| INF-TABS-01 | Open note A from the tree twice, from Home Recent, from the palette and from the Favorites entry | One tab for A, which is active each time. The session in the DB has one `note:<A>` entry | A duplicate tab fails | e2e/tabs.spec › no duplicate tabs; unit/tab-session.test | W, L |
| INF-TABS-02 | Tabs Home, A, B and Settings. Click B; press Ctrl+Tab ×4 and Ctrl+Shift+Tab ×2; focus the tablist and use Right/Left then Enter | Clicking activates B. Ctrl+Tab goes Settings → Home → A → B (wraps). Ctrl+Shift+Tab goes back in reverse. The arrow keys move focus without activating, and Enter activates | Wrong order or no wrap fails | e2e/tabs.spec › ctrl+tab; › keyboard tablist | W, L |
| INF-TABS-03 | Close A with Ctrl+W, B with its close button and C with a middle click. Type "flush me" into D's text area and press Ctrl+W within 100 ms | Each tab disappears, and the active tab moves to the right neighbor, else the left. The notes still exist (`deleted_at` NULL) and reopen with their text. For D, after close the DB `content_json` contains "flush me", the revision went up by 1, and after relaunch the text is shown | Text lost on close, or a deleted note, fails | e2e/tabs.spec › close keeps note; e2e/editor.spec › flush on close; unit/renderer/state/note-controller.test | W, L |
| INF-TABS-04 | Content 1100x720. Open 15 notes; open All tabs; choose the first note | `scrollWidth > clientWidth`, and the scroll buttons are visible and scroll the strip. All tabs lists 16 menuitems (Home and 15 notes), with the active one checked. Choosing the first note activates it and its tab is inside the strip's visible bounds. Escape closes the menu and returns focus to the All tabs button | An unreachable tab fails | e2e/tabs.spec › overflow list | W, L |
| INF-TABS-05 | Open A, B, Stickies, C; activate B; relaunch. Then, with the app closed, write a session with duplicate A entries | After relaunch the order is Home, A, B, Stickies, C, with B active and B's text area showing its text. The tampered session restores one A tab (duplicates collapse, no notice for duplicates). Integration: `session:get` sanitizes as in section 9.3 and `settings:get(['session.tabs'])` gives VALIDATION_FAILED | Reordering, a wrong active tab or a duplicate fails | e2e/tabs.spec › restore after relaunch; integration/session.test | W, L |
| INF-TABS-06 | With A and B open and B active, trash B from the tree. Trash folder L1 holding two open notes. Close the app with tab C open, set C's `deleted_at` and delete row D in the DB while the app is closed, relaunch | B's tab closes, A becomes active, and the notice reads "1 tab was closed because its note is in Trash". The folder trash closes both tabs with "2 tabs were closed because their notes are in Trash". After relaunch, C and D are absent and the notice reads "2 tabs were closed because their notes are in Trash or no longer exist". The stored session no longer contains them | A tab still showing a trashed note fails | e2e/tabs.spec › trashed note tab closed; › session skips trashed and missing | W, L |
| INF-TABS-08 | Click rail Stickies, Reminders and Settings twice each; open them from the palette; Ctrl+W on Settings; relaunch | One tab each, appended in order of opening. Ctrl+W closes Settings. After relaunch Stickies and Reminders are restored, and Settings is not | A duplicate page tab fails | e2e/tabs.spec › page singletons | W, L |
| INF-KEY-01 | Ctrl+N (a) on Home with filter Common, (b) with note tab N (in L2) active, (c) with the tree focused on folder L3, (d) on the Settings tab | A new tab is active with the "Title" input focused. The DB locations are (a) Common root, (b) L2, (c) L3 and (d) Common root. Unit: `resolveNewItemLocation` gives the same four results | A note in the wrong location fails | e2e/keyboard.spec › ctrl+n; unit/renderer/state/current-location.test | W, L |
| INF-KEY-02 | Ctrl+Shift+N in cases (a) and (c) | The same locations, with `sticky_enabled 1`, `color 'yellow'` and the sticky icon in tab and tree | A non-sticky result fails | e2e/keyboard.spec › ctrl+shift+n; unit/shortcuts.test | W, L |
| INF-KEY-03 | Ctrl+K; type "new pro" then Enter; Ctrl+K and type part of a note title ("Plan"); Down and Enter; Ctrl+K with that note already open, choose it again; Escape | A dialog named "Command palette" opens with the combobox focused. "New project" is the active option; Enter opens the New project dialog. The Notes group lists matching notes with paths, and Enter opens that note (one tab only, even when it was already open). Escape closes the palette and focus returns to the element focused before | A duplicate tab, or focus lost after Escape, fails | e2e/palette.spec › actions and titles; integration/palette.test; unit/palette-actions.test | W, L |

### 14.2 Unit tests (Vitest `unit`)

Pass A writes all of these except the two jsdom component tests, which are Pass C.

| File | Cases |
| --- | --- |
| `contracts.test.ts` (update) | Every invoke channel has schemas and vice versa. `EVENT_CHANNELS` equals `['settings:changed','tree:changed']`. Phase 03-only names (`lease:take`, `note:revision`, `note:lease`, `lease:release-request`, `note:convertFormat`) are absent. `project:rename` rejects `null`, `'common'` and uppercase UUIDs. `NameInput` trims and NFC-normalizes and rejects `''`, a 201-code-point string and `\u0007`, and accepts a 200-code-point Bangla name. `trash:purge` without `confirmed:true` fails. `session:set` rejects Home not first, duplicate IDs, a missing active ID, `id` not matching `noteId`, and 201 tabs. `settings:set` rejects the key `session.tabs`, `layout.treeWidth` 219 and 281, and a malformed `tree.expanded` key. Every registry default passes its schema |
| `names.test.ts` | The normalize and validate matrix, code points versus UTF-16 (emoji), `displayTitle` |
| `tree-model.test.ts` | Root order; folders before notes; collation (`"a10"` after `"a2"`, case-insensitive, Bangla ordering stable); `flattenVisible` levels, `posinset` and `setsize`; every `treeKeyAction` rule including edges (Up on the first row, Right on a leaf); `locationOfNode` for each kind; Favorites only when favorites exist; Trash empty row |
| `tree-paths.test.ts` | Duplicate-sibling ordinals for folders and projects; paths for Common and project roots; deep paths |
| `tab-session.test.ts` | Open dedupe; append order; 200 limit; close neighbor rules; Home not closable; next and prev wrap; `removeNoteTabs` with the active fallback; `sanitizeSession` (invalid JSON, missing Home, Home not first, duplicates, trashed and missing counts, active fallback, truncation) |
| `textarea-doc.test.ts` | Round trip including empty lines, a trailing newline and Bangla; `hardBreak` handling; `isTextareaCompatible` false for headings and marks |
| `relative-time.test.ts` | Fixed `now`: just now, 5 minutes ago, yesterday, a date after 7 days |
| `shortcuts.test.ts` | Each mapping; Alt or Meta gives null; Shift+letter case; Backslash by `code` |
| `palette-actions.test.ts` | Labels exact; filter "new pro" gives New project first; an empty query gives all actions |
| `tokens.test.ts` | Parse `tokens.css`: each UX_SPEC section 3 token has the stated light and dark value |
| `main-window-options.test.ts` | Section 14.1 INF-SHELL-06 unit assertions; `minWidth 720`, `minHeight 480`; secure `webPreferences` unchanged |
| `migrations-checksum.test.ts` (update) | Versions contiguous; `LATEST === 2`; checksums for 001 and 002 |
| `ci-config.test.ts` (update, F-01-1) | `node-version: '24.21.0'` present and `'24.15.0'` absent; the existing step-order assertions unchanged |
| `renderer/state/note-controller.test.ts` | Fake bridge and fake timers: 400 ms debounce yields one save; typing during a save queues one follow-up; `flush()` resolves after the ack; INTERNAL retries 3 times, then `error` with `flush()` returning `{ok:false}`; CONFLICT gives `readOnly` with the message; `dispose` releases the lease after the flush; a trashed `note:open` gives `trashed` with `trashBatchId`; an incompatible document gives `readOnly` without acquiring a lease |
| `renderer/state/tabs-store.test.ts` | `session:set` called on every structural change and not on render; a failed flush keeps the tab and pushes the error notice; `closeNoteTabs` notice texts (singular and plural); `init` with dropped counts pushes the right notice and persists once |
| `renderer/state/current-location.test.ts` | The 4 precedence rules plus favorites and trash selections |
| `renderer/state/layout-store.test.ts` | Breakpoints 959/960 and 1179/1180; clamping; persistence calls; drawers close on mode change |
| `renderer/state/home-store.test.ts` | An invalid scope falls back to All and persists; refresh on `tree:changed` |
| `renderer/shell-smoke.test.tsx` (Pass B, jsdom) | `App` with the fake bridge renders the h1, the Primary nav with 5 named buttons, the tablist with Home, the tree with "Common", and `#app-shell[data-ready=true]` |
| `renderer/tree-pane.test.tsx` (Pass C, jsdom) | Rendered ARIA attributes; arrow and F2 handling with the fake bridge; Common F2 notice |
| `renderer/tab-strip.test.tsx` (Pass C, jsdom) | `role=tab`, `aria-selected`, roving tabindex, no close button on Home, Delete closes a note tab |

`tests/unit/renderer/support/fake-bridge.ts` (Pass A):

- An in-memory `InfinityBridge`: settings map, session, a snapshot with simple create/rename/trash, note contents with revisions, leases always granted, and an event emitter for `subscribe`.
- Plus `failNext(channel, error)` to inject errors.
- Any test can use it. It holds no main-process logic.

### 14.3 Integration tests (Vitest `integration`, real better-sqlite3, temp DB)

All files are Pass A. Every test calls `findInvariantViolation()` after each mutation and expects `null`.

| File | Cases |
| --- | --- |
| `hierarchy.test.ts` | Common immutable; project CRUD; deep folders and depth limit (create and move, both scopes); notes at the root and in folders; sticky in folder; duplicate names; scope mismatch rejected; trashed targets give NOT_FOUND; subtree move atomic (the trashed descendant updated; failing-trigger rollback); cycle rejected (self, child, grandchild); no-op move broadcasts nothing; rename and pin do not change `revision`; pin and favorite do not change `updated_at`. A randomized sequence (seeded PRNG, 400 operations of create, move, trash, restore and purge across 3 projects) keeps the invariants and ends with FTS `integrity-check` ok |
| `trash.test.ts` | Batch counts and `trashedNoteIds`. FTS: a trashed note does not match and a restored one does. Restore to the original location. Restore to the nearest live ancestor. Restore to Common when the project is trashed, with `relocated:true` and the path. A nested earlier batch is not restored by a later batch. A trash list root and `fromPath` for each kind. Purge without confirm gives VALIDATION_FAILED. Purge of a 5-level folder batch succeeds (deepest-first). Purge re-anchors another batch's orphan note to the nearest surviving ancestor, or Common when the project is purged. Purge cascades versions and drafts (seed rows). Empty trash. Purged and trashed rows are excluded from `tree:list`, `home:summary` and `palette:searchTitles`. `unreferenced_since` is set on an orphaned attachment row |
| `home-summary.test.ts` | Scopes All, Common and Project return the expected sets; `pinned` ordering and limit 100 with `pinnedTotal`; `recent` limit 10 ordered by `updated_at`; a trashed project gives `scopeValid:false` and All; paths correct |
| `session.test.ts` | Default session; set/get round trip; sanitize with live, trashed and missing notes; corrupt stored JSON gives the default plus a log line; `session.tabs` is not reachable through the settings channels |
| `palette.test.ts` | Prefix before substring; case-insensitive including "École"/"école"; Bangla substring; `%` and `_` literal; "untitled" matches empty titles; trashed excluded; limit |
| `notes-open-save.test.ts` | `note:create` gives revision 0 and the paragraph document. `note:open` returns it. A `textToDoc` save through `NoteWriter` with an acquired lease gives revision 1 and `plain_text` set. Rename after that keeps revision 1, and the next save with base 1 succeeds and keeps the title. A trashed note gives NOT_FOUND with `details.trashed`. A `lease:release` then save gives LEASE_REQUIRED plus a draft |
| `ipc-validation.test.ts` (update) | Register all Phase 02 handlers on a fake ipcMain with a real DB. Every new channel rejects extra keys, non-UUID IDs and wrong types with VALIDATION_FAILED without calling the service (spy). The registered channel set equals `INVOKE_CHANNELS`. `note:save` accepts a 4.9 MiB document (limit override) and rejects 5 MiB + 1 with LIMIT_EXCEEDED |
| `migrations.test.ts` (update) | Section 5 |
| `settings.test.ts` (update) | New keys' defaults and validation; `getInternal`/`setInternal` do not emit `settings:changed` |

### 14.4 E2E (Pass C; Playwright `_electron`, built app, `workers: 1`, `retries: 0`)

Fixture changes (`tests/e2e/fixtures.ts`):

- `launchApp` waits for `#app-shell[data-ready="true"], [role="alert"]`.
- Add `setContentSize(app, w, h)`: calls `BrowserWindow.getAllWindows()[0].setContentSize(w,h)` through evaluate, then waits until `page.evaluate(() => innerWidth) === w`.
- Add `setWindowSize(app, w, h)` for the visual specs (window size, frame included).
- New `tests/e2e/seed.ts`: bridge helpers `createProject`, `createFolder`, `createNote`, `trash`, `pin`, `favorite` and `saveText` (`note:open` + `lease:acquire` + `note:save` + `lease:release`). Each returns IDs and waits for `tree:changed` to be reflected (poll the treeitem).
- New `tests/e2e/ui.ts`:
  - `activate(locator)`: `focus()` then `press('Enter')`, or `Space` for radios, checkboxes and switches;
  - `openContextMenu(row)`: focus, then `Shift+F10`;
  - `treeItem(page, label)`;
  - `tab(page, label)`.
  - Interaction policy (section 15): steps whose subject is not pointer behavior use keyboard activation. Pointer behaviors (middle click, splitter drag, row click, scroll buttons) use real mouse input in their own named cases.

Specs and cases (names as in section 14.1):

| Spec | Cases |
| --- | --- |
| `shell.spec.ts` | rail navigation; no capture-specific labels; tree toggle and width persists; panel toggle; narrow 760x560 drawers; breakpoints; theme follows OS; visible focus |
| `home.spec.ts` | one Home tab after relaunch; Home not closable; pinned and recent reflect data; pin; filter |
| `tree.spec.ts` | Common protected; project CRUD; nested folders; create note in folder; sticky in folder; move persists after restart; cycle rejected; trash and restore; favorites |
| `a11y-keyboard.spec.ts` | tree; dialogs return focus (New project dialog, Move dialog, confirm dialogs, palette, All tabs menu, context menu); tabs keyboard-only (open, switch and close a note without the mouse) |
| `tabs.spec.ts` | no duplicate tabs; ctrl+tab; keyboard tablist; close keeps note; overflow list; restore after relaunch; trashed note tab closed; session skips trashed and missing; page singletons |
| `editor.spec.ts` | flush on close; text area save increments revision and survives relaunch (stable note ID in DB and tab) |
| `keyboard.spec.ts` | ctrl+n; ctrl+shift+n |
| `palette.spec.ts` | actions and titles |
| `visual.spec.ts` | Screenshots into `process.env.INFINITY_SCREENSHOT_DIR ?? test-results/screens`, with a synthetic notebook (2 projects, nested folders, 6 notes, 1 pinned, 1 sticky): `1100x720-light-home.png`, `1100x720-light-note.png` (note tab with text), `1100x720-dark-home.png`, `760x560-light-home.png`, `760x560-light-tree-drawer.png`, `1280x800-light-panel.png`, `focus-ring.png`. Asserts each file exists and is larger than 10 kB. It is not a pixel comparison; the acceptor reviews the images (V) |

Existing specs updated in Pass C:

- `smoke.spec › starts a real window`: open Settings through the rail, then expect "Version 0.1.0".
- `smoke.spec › db diagnostics`: "Storage ready (SQLite 3." in Settings › About.
- `setting survives relaunch` and `invalid stored setting falls back`: open Settings, then `getByRole('radio', {name:'Dark'})` with keyboard activation, then `toBeChecked()` (aria-checked).
- `packaged.spec`: the same changes.
- `security.spec › navigation blocked`: keeps `h1` "Infinity Notes".
- `security.spec › validation errors`: zero settings rows after startup (unchanged).
- Assertion strength must not drop in any of these updates.

---

## 15. F-01-4: Playwright input under WSLg forced native Wayland (Pass C)

Goal: find out why `locator.check()` timed out under `--ozone-platform=wayland`, pick interaction patterns that work under both backends, and record the outcome. The Wayland run stays informational and is never a gate.

1. Probe: `.infinity-work/qa/wayland-input.probe.ts` with its own config `.infinity-work/qa/playwright.wayland-probe.config.ts` (`testDir` `.infinity-work/qa`; not committed; the same pattern QA used in Phase 01). It launches through `tests/e2e/fixtures.launchApp`, opens Settings, and records as JSON lines:
   - `document.visibilityState`, `document.hasFocus()`;
   - the number of `requestAnimationFrame` callbacks in 1000 ms;
   - `win.isVisible()`, `win.isFocused()`;
   - `app.commandLine` ozone;
   - then each attempt with a 5 s timeout, capturing Playwright's call log on failure: (a) `radio.check()`, (b) `radio.click()`, (c) `radio.click({force:true})`, (d) `radio.focus()` + `press('Space')`, (e) `radio.dispatchEvent('click')`, (f) after `app.evaluate(win.focus(); win.show())`, (a) again;
   - and the resulting `aria-checked` after each attempt.
2. Run it under L (default ozone), L-xvfb and L-wl. Log to `f014-probe-<variant>.log`.
3. Interpretation rules:
   - If the rAF count is 0 or near 0 under L-wl and the call log shows "waiting for element to be stable", the cause is that the compositor sends no frame callbacks to the surface, so Playwright's stability check (rAF-based) never completes. The app is not at fault. Production never forces an ozone platform.
   - If (d) works under all three variants, adopt it as D-050: "E2E steps whose subject is not pointer behavior use keyboard activation through `ui.activate`; pointer-specific cases stay pointer and are expected to be informational failures under forced Wayland."
   - If (f) fixes it, record that focusing the window fixes it, and still prefer keyboard activation. Do not add `win.focus()` hacks to product code.
   - If nothing works, record the exact call logs and keep the case pending in the Phase 09 matrix.
4. Run the full Phase 02 E2E suite under L-wl (`INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e`, log `wsl-test-e2e-wayland.log`). In the progress report, list per spec which cases pass, and classify every failure as pointer-specific (expected) or other (investigated).
5. Write the outcome to the progress report section "F-01-4", with the rAF counts, the attempt matrix and the decision. Add D-050 to DECISIONS if a policy is adopted.

---

## 16. Commands, hosts and logs

Every log goes to `.infinity-work/logs/phase-02/`. Each log starts with the command, the date and `pwd`, and ends with `EXIT=<code>`. Each pass uses its own prefix: `A-`, `B-`, `C-`, `f014-`, `wsl-`, `win-`.

### 16.1 Windows (Git Bash, repository root)

```
export INFINITY_E2E_NODE='E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe'
npm run lint; npm run typecheck; npm run test:unit; npm run test:integration    # <pass>-lint|typecheck|unit|integration.log
npm run check                                                                     # <pass>-check.log
npm run build                                                                     # <pass>-build.log
node tools/dev-smoke.mjs                                                          # B-dev-smoke.log, C-dev-smoke.log
npm run test:e2e                                                                  # A-test-e2e.log (existing suite), C-win-test-e2e.log (full)
INFINITY_SCREENSHOT_DIR="$PWD/.infinity-work/logs/phase-02/screens/win" npm run test:e2e -- tests/e2e/visual.spec.ts   # C-win-visual.log
npm run package:current; npm run verify:native -- --packaged; npm run test:e2e:packaged   # C-win-package.log, C-win-verify-native-packaged.log, C-win-test-e2e-packaged.log
node tools/check-traceability.mjs --repo .                                        # C-traceability.log
git diff --exit-code package.json package-lock.json                                # C-deps-unchanged.log
```

A Windows E2E run that crashes with the Phase 01 worker signature (0xC0000409) while `INFINITY_E2E_NODE` is set is a real failure and must be investigated. It is never a pass.

### 16.2 WSL (Pass C; user `infinity`, D-039; from Git Bash prefix `MSYS_NO_PATHCONV=1`)

```
wsl -d Ubuntu -u infinity -- bash -lc '<cmd>'
# env (wsl-env.log): lsb_release -ds; uname -r; node -v; npm -v; cat /mnt/wslg/versions.txt; echo WAYLAND_DISPLAY/DISPLAY/XDG_SESSION_TYPE
# sync (wsl-sync.log), before every Linux round:
mkdir -p ~/infinity-notes && rsync -a --delete --exclude=node_modules/ --exclude=out/ --exclude=release/ --exclude=.git/ --exclude=.infinity-work/ --exclude=test-results/ --exclude=playwright-report/ --exclude=coverage/ /mnt/e/notecapt/ ~/infinity-notes/
cd ~/infinity-notes && export WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0
npm ci && npm run setup:electron                       # wsl-npm-ci.log
npm run check                                          # wsl-check.log
npm run build                                          # wsl-build.log
npm run test:e2e                                       # wsl-test-e2e-wslg.log (record ozone from main.log)
env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e     # wsl-test-e2e-xvfb.log
INFINITY_SCREENSHOT_DIR=/mnt/e/notecapt/.infinity-work/logs/phase-02/screens/wslg npm run test:e2e -- tests/e2e/visual.spec.ts   # wsl-visual.log
INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e   # wsl-test-e2e-wayland.log (informational, F-01-4)
npm run package:linux && npm run test:e2e:packaged     # wsl-package-linux.log, wsl-test-e2e-packaged.log
```

Rules:

- Never share `node_modules` between the hosts.
- Never run as root, and never pass `--no-sandbox`.
- Install no apt packages.
- Label results "WSLg 1.0.73 (Weston), ozone <value>", never GNOME or X11 session.
- GNOME and X11 desktops are `outside_validation_scope`.
- A Linux failure caused by the environment is recorded as `pending` with the exact error. A code defect is fixed.

---

## 17. Work order and gates

### 17.1 Pass A (MEDIUM): stay green after each step

1. F-01-1: `ci.yml` and `ci-config.test`. Run `npm run test:unit`.
2. Migration 002 and checksums, plus the `migrations.test` and `migrations-checksum.test` updates. Run `npm run test:integration`.
3. `names.ts` and the contracts (hierarchy, home, session, palette, notes, settings registry with `public`), `channel-names`, `channels`, `bridge`. Unit `contracts.test`.
4. `hierarchy-repo` and `HierarchyService` (create, rename, move, pin, favorite, invariants), with `hierarchy.test` written alongside.
5. `TrashService` with `trash.test`.
6. `HomeService`, `SessionService`, `PaletteService`, `NoteReader`, plus `tree-model`, `paths`, `tab-session`, `textarea-doc` and `relative-time`, with their unit and integration tests.
7. IPC handlers, `index.ts` wiring, `tree:changed`, preload bridge, the `mainWindowOptions()` extraction, and `ipc-validation.test`.
8. Headless renderer state, `note-controller` and `fake-bridge`, with the state unit tests.
9. Existing E2E expectation updates caused by core changes: bridge key set and `schemaVersion 2`.
10. Gates:
    - `npm run check` exit 0;
    - `npm run build` exit 0;
    - the Windows `npm run test:e2e` (with `INFINITY_E2E_NODE`) green with the foundation screen still in place;
    - write the Pass A section of `docs/progress/phase-02.md`.

### 17.2 Pass B (LOW)

1. `App.tsx` to `createAppServices`, then `<AppServicesContext.Provider>`, then `Shell`. The startup error branch is unchanged. Remove `FoundationScreen` and its test.
2. Primitives: `Dialog`, `DialogHost`, `Menu`, `SegmentedControl`, `IconButton`, `Switch`.
3. Shell layout, rail, header, notices, drawers, splitter, global shortcuts.
4. Tab strip, All tabs, tab panel.
5. Tree pane, rows, context menu, Move dialog, inline rename.
6. Home view, pages, context panel, note view and temporary editor, palette.
7. CSS (`shell.css`, `components.css`) in light and dark, then `shell-smoke.test.tsx`.
8. Gates:
    - `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build` and `node tools/dev-smoke.mjs`, all exit 0;
    - `npm run test:e2e -- tests/e2e/security.spec.ts tests/e2e/migration-failure.spec.ts tests/e2e/native.spec.ts` green. The smoke and packaged specs are updated in Pass C; their expected failures are listed in the Pass B progress section;
    - write the Pass B progress section listing the components and any store gaps reported.

### 17.3 Pass C (MEDIUM)

1. Fixtures, `seed.ts`, `ui.ts`, and the existing-spec updates.
2. The Phase 02 E2E specs in the order shell, tabs, editor, tree, home, keyboard, palette, a11y-keyboard, visual. Repair defects as they appear, with a regression test for each, and list them in the progress report.
3. The jsdom tests `tree-pane` and `tab-strip`.
4. The Windows full gates (section 16.1), including packaging and packaged E2E.
5. The WSL leg (section 16.2) and F-01-4 (section 15).
6. BACKLOG updates (section 18.2), traceability, the deps-unchanged check, and the final progress report.

---

## 18. Progress report and BACKLOG

### 18.1 `docs/progress/phase-02.md` must contain

1. A summary, the date, and per pass the agent role and model.
2. Hosts:
   - Windows OS and Node, plus the E2E runner Node 24.21;
   - WSL: Ubuntu, kernel, Node, WSLg version, Weston hash, and the observed ozone for the WSLg, Xvfb and forced-Wayland runs.
3. Changed, created and deleted files grouped by pass and area, one line each.
4. Migration 002: the checksum, and evidence of the v1 to v2 upgrade test.
5. IPC catalogue as implemented. It must match section 6.3; any difference needs a decision entry.
6. A command table: command, host, exit code, duration, log path, covering every log in section 16.
7. Requirement coverage: one row per ID (30 rows), with the assertions run, the test file › case names, the W, L and L-xvfb results, the screenshot paths for V items, and the BACKLOG status set.
8. Visual evidence: a list of screenshot files per host with a one-line description of each.
9. F-01-1 (files changed), F-01-4 (the section 15 outcome) and Phase 00 F-1 (the section 14.1 table implemented).
10. Decisions added after planning (D-050 onward) or "none".
11. Deviations from this plan, with reasons.
12. Issues found and fixed: severity, reproduction, expected, actual and the regression test.
13. Not run or pending:
    - INF-SHELL-06 N (native frame and controls on a real desktop session, Phase 09 matrix);
    - the forced-Wayland informational failures;
    - GNOME and X11 outside scope;
    - any Linux step left pending.
14. Known limitations:
    - the temporary text area (D-048) and the window-close flush gap until Phase 03;
    - no drag and drop in the tree;
    - no tree virtualization (measured in Phase 09);
    - the Reminders page states that reminders are unavailable.

### 18.2 BACKLOG (Status and Planned tests columns only; the Tests column never changes)

- Set `done` for the 29 Phase 02 IDs other than INF-SHELL-06, when all their non-N assertions pass on W and L and the V items have screenshots from both hosts.
- INF-SHELL-06: `in_progress`, because the N part is pending.
- Update Planned tests to the final case names, for example add `e2e/a11y-keyboard.spec › tree; unit/tree-model.test` to INF-HIER-12.
- `node tools/check-traceability.mjs --repo .` must exit 0.

---

## 19. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R2-01 | `ON DELETE RESTRICT` is immediate per row, so a single bulk `DELETE` of nested folders fails | Leaves-first loop (section 8.4); integration purge of a 5-level batch |
| R2-02 | Moving a subtree leaves trashed descendants with a stale scope, so a later restore breaks the invariants | Moves and restores update all rows regardless of `deleted_at`; invariant query in every transaction; randomized sequence test |
| R2-03 | The full `tree:list` snapshot grows with 10,000 notes (about 2 MB) and is reloaded on every `tree:changed` | Coalesced reloads; acceptable for Phase 02; Phase 09 measures it (INF-PERF); lazy children are a recorded option |
| R2-04 | No tree virtualization: expanding a folder with thousands of notes is slow | Folders start collapsed; measured in Phase 09 |
| R2-05 | A global Ctrl+Tab or Ctrl+W intercepted by Chromium or the OS | Phase 01 menu has no such accelerators; E2E covers them on W and L |
| R2-06 | Playwright actionability under forced Wayland | Section 15; informational only |
| R2-07 | `<dialog>` focus return differs between Chromium versions | `Dialog` restores focus explicitly; a11y-keyboard spec |
| R2-08 | Window resize under WSLg or Xvfb is not applied synchronously | `setContentSize` followed by polling `innerWidth` |
| R2-09 | React StrictMode (development only) double-invokes effects, causing a double lease acquire or open | Controllers are owned by stores, not effects; `acquire` is idempotent for the same view |
| R2-10 | The LOW pass needs store APIs that are missing | Pass B reports the gap and the coordinator routes it to MEDIUM; no cross-boundary edits |
| R2-11 | Text typed within 400 ms of closing the window is lost (Phase 02 only) | D-048; Phase 03 INF-SAVE-01 |
| R2-12 | Screenshot fonts differ between hosts | Visual review only, no pixel diffs |
| R2-13 | The Windows Playwright worker crash under Node 24.15 | `INFINITY_E2E_NODE` set to Node 24.21 for every Windows E2E gate (D-049) |

## 20. Out of scope for Phase 02

The following belong to later phases:

- Tiptap editor, formatting, find in note, images and attachments, versions UI, conflict UI and Take edit control: Phase 03.
- Floating stickies and Float buttons, the close dialog and tray, `window_state`: Phase 04.
- Reminders data, the Home reminders section and the widget: Phase 05.
- Full-text search in the palette, references and tags: Phase 07.
- Keyboard help, Settings beyond Appearance and About, contrast numeric checks and global shortcuts: Phase 08.

The following are not in V1 at all:

- tree drag and drop;
- manual sort order (`sort_order` stays reserved).

Never, in any phase: publishing, pushing, signing, apt installs, running as root, or `--no-sandbox`.

## 21. Planner status

```json
{"status":"ready","evidence":["docs/plans/phase-02.md","docs/DECISIONS.md (D-044..D-049)","docs/ARCHITECTURE.md (section 3 migration allocation and tab session; section 4 catalogue rows 02/03)","docs/BACKLOG.md (W02, W04-W07 migration numbers)","docs/UX_SPEC.md (section 6 notices, section 7 Ctrl+N)"],"blockers":[]}
```

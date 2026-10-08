# Phase 04 plan: Real floating sticky windows

Planner: infinity-planner (Opus 5.5, high), 2026-10-09. Implementer: infinity-code-opus (Opus 5.5, high; CLAUDE.md "Opus implementation"), one agent at a time, resumable at every checkpoint in section 14. QA: infinity-qa. Acceptance: infinity-acceptor.

Phase contract: `infinity-notes-claude-pack/phases/04-real-floating-sticky-windows.md`. Requirement IDs (15): INF-STKY-01 to INF-STKY-13, INF-DESK-01, INF-DESK-02. Decisions added by this plan: D-062 to D-071 (`docs/DECISIONS.md`).

Acceptance to demonstrate (phase file): two independent stickies open outside the main window, are moved, resized and edited, and each maps to its original note; switching edit control cannot lose acknowledged text; hide, reopen and dock preserve content; project membership stays visible; app, tray and quit behavior are distinct; the current native environment is verified and pending Windows, Wayland and X11 cases are logged.

---

## 1. Inputs read and actual repository state

Read: root `CLAUDE.md`; pack `PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `TEST_MATRIX.md` (Floating stickies row, native OS matrix), phase 04 file; `docs/PRODUCT_SPEC.md`, `UX_SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md` (to D-061), `BACKLOG.md`; `docs/progress/phase-03.md`, `phase-03-qa.md`, `phase-03-acceptance.md`, `cleanup-01-02*.md`; `docs/plans/phase-03.md`; the code listed below.

Actual state at commit `3e1d357` (Phase 03 accepted):

- Main: `src/main/index.ts` is the composition root. It creates one main window through `createMainWindow`, registers it in `WindowRegistry` (role `'main'` only), and calls `app.quit()` on `window-all-closed`. `window-lifecycle.ts` flushes every registered window on `before-quit` and the closing window on close (`FlushCoordinator`, 2000 ms per window), reloads a crashed renderer (one global crash list) and resets leases on navigation and renderer exit. `single-instance.ts` focuses `registry.main()` and does nothing when it is missing. `menu.ts` has File > Quit and Edit roles.
- IPC: `createSenderPolicy` returns a boolean from `registry.has(id)`, the top frame and the renderer origin. The router validates the payload with Zod and passes `{webContentsId}` to handlers. Every window has the full channel surface. The event bus broadcasts to every registered window or `sendTo` one. The catalogue has 41 invoke channels and 6 events. `boundaries.test`, `contracts.test`, `ipc-validation.test` and `security.spec › bridge surface` assert that the Phase 04 names (`sticky:float`, `window:getState`, `note:trashed`, `sticky:state`) are absent.
- Services: `LeaseManager` (acquire, release, take with a 3000 ms release request, `webContentsReset`), `NoteWriter` (drafts for stale, trashed and lease-lost saves), `HierarchyService.createNote(location, sticky)` sets `sticky_enabled` and color `yellow`, `TrashService` emits `tree:changed {reason, trashedNoteIds}` and deletes purged note rows. `capabilities.ts` is pure: Windows reports positioning and always-on-top `supported`; WSL or Wayland reports both `unsupported` (`wayland-or-wslg`); the tray is `unknown` (`detected-in-later-phase`).
- Data: migrations 001 to 003, `LATEST = 3`. `notes.sticky_enabled` and `notes.color` exist in 001 (`NoteColor` enum yellow, green, blue, pink, violet, gray). There is no `window_state` table.
- Renderer: `App.tsx` always renders the main `Shell`. `createAppServices` routes note events to `tabs.activeController()`. `NoteController` opens with `lease:acquire` (read-only mirror when not granted), takes control on request, flushes on release requests and reloads on `note:revision` while read-only. `NoteEditor` already accepts `variant: 'tab' | 'sticky'`. `StickiesPage` lists sticky notes with Open and New sticky only. "New sticky" (Ctrl+Shift+N, Home tile, tree menu) creates a sticky note and opens it in a tab. `NoteView` is tied to tabs (`tabs.close`, `tabs.setScrollTop`).
- Tests that depend on today's behavior: `editor.spec › flush on window close` (closing the main window must exit the process), `keyboard.spec › ctrl+shift+n` and `tree.spec › sticky in folder` (a tab opens for a new sticky), several E2E helpers use `BrowserWindow.getAllWindows()[0]` as "the main window" (`fixtures.setContentSize`, `setWindowSize`, `rendererSandbox`, `crash.spec`, `security.spec`, `smoke.spec`, `shell.spec`, `packaged.spec`).
- Host: no leftover `electron` processes on Windows or WSL. The planner probes below rebuilt `out/` on Windows and rsynced and rebuilt the WSL mirror `~/infinity-notes` on the current tree. Both are generated outputs.

### 1.1 Planner probes (logs in `.infinity-work/logs/phase-04/`, sources in `.infinity-work/probes/phase-04/`)

| Probe | Result |
| --- | --- |
| `planner-probe-windows-{win,wslg,xvfb,wayland}.log` (`win/main.js`: three sandboxed windows with a preload) | `BrowserWindow.getAllWindows()` is **not** in creation order on any host (the order was `[sticky b, sticky a, main]`). Every window's invoke reaches main with its own `sender.id`, and the frame URL keeps its hash. `setAlwaysOnTop(true)` makes `isAlwaysOnTop()` true everywhere, including forced Wayland, so `isAlwaysOnTop()` is no capability signal. `setBounds` is honored exactly on Windows and Xvfb. WSLg (ozone x11, XWayland) shifts by the window-manager frame (+6, +27). Forced Wayland reports whatever was set. Off-screen `setPosition(50000, 50000)` gives `32767` (Windows), is pulled back on screen (WSLg) or wraps to `-15536` (Xvfb). Displays: Windows 2560x1440 (work area 2560x1392); WSLg x11 reports **640x480**, WSLg Wayland 2560x1440; Xvfb 1280x1024. Collapse by `setMinimumSize(220, 36)` + `setContentSize(w, 36)` works on every host (outer height 101 Windows, 63 WSLg and Xvfb). `close` with `preventDefault()` + `hide()` keeps the window. A forced-Wayland `showInactive()` window stayed invisible. `new Tray()` does not throw on WSLg even with no tray host. Without a `window-all-closed` quit, the process stays alive with zero windows. |
| `planner-probe-tray-detect-wsl.log` | `gdbus`, `dbus-send` and `busctl` exist for user `infinity`; the session bus is `unix:path=/run/user/1001/bus`; `NameHasOwner org.kde.StatusNotifierWatcher` answers `(false,)` (gdbus) and `boolean false` (dbus-send): WSLg has no StatusNotifier tray host. |
| `planner-probe-events-{win,wsl}.log` (`ev/main.js`) | Programmatic `setBounds`, `setSize` and `setPosition` emit `move`/`resize` on Windows, WSLg and Xvfb; `moved`/`resized` are not emitted for them. `showInactive()` leaves focus on the main window (Windows, Xvfb). |
| `planner-probe-multiwin-{win,wsl}.log` (`pw/p04-probe-multiwin.spec.ts`, Playwright 1.64 against the built app plus a second window) | Playwright `focus()`, `keyboard.insertText`, `keyboard.type`, `press` and `click` work in both the OS-focused and the unfocused window on Windows, WSLg, Xvfb and forced Wayland. `document.hasFocus()` is true in both pages (Playwright focus emulation). `app.waitForEvent('window')` returns the new window's page. |

These results are recorded in D-064, D-066, D-067 and D-068.

## 2. Follow-ups and defects incorporated

No QA defect is open against Phase 04. Phase 03 follow-ups F-03-1, F-03-2 and F-03-3 belong to Phase 09 and F-03-4 to Phase 08. They are not touched here. F-01-6 stays with Phase 09.

| Item | Where in this plan |
| --- | --- |
| D-052: `note:trashed` was deferred to Phase 04 | Replaced by the trash state inside `sticky:state` (D-063, section 6). There is one source of sticky state, and the IPC surface stays narrower. |
| Phase 05 event `app:openNote` | Moved into Phase 04 (D-063). Dock and Remove from stickies need it. Phase 05 notification clicks reuse it. |
| ARCHITECTURE section 5 "Float is an implicit take request" | Activation counter in `sticky:state` (section 8.5) |
| Pack: "A deleted note ... shows a recoverable trash state to any floating window" | Section 8.5 trash flow, INF-STKY-08 |
| Phase 03 lease protocol (INF-SAVE-04) reused, plus auto-acquire when the holder goes away | D-065, section 9.5 |
| Phase 00 F-1: explicit assertions per ID | Section 12.1 |
| Boundary guards that name Phase 04 channels | Retargeted to Phase 05 names (`reminder:create`, `widget:show`, `reminder:changed`), section 12.5 |

## 3. Ownership, order and file boundaries

### 3.1 Rules

- One implementer (infinity-code-opus) owns every path below for the whole phase. Work strictly in the step order of section 14. Every step ends green (its gate) and with a checkpoint line in `docs/progress/phase-04.md`, so a resumed agent starts at the first step that has no checkpoint.
- No dependency changes: `package.json` and `package-lock.json` stay byte-identical (gate `git diff --exit-code`).
- Never weaken an existing assertion. Specs whose behavior changes on purpose (the close dialog, New sticky floating) are updated with equal or stronger checks (section 12.5). `retries: 0` stays. No `.only`. No new `.skip` except an explicit platform condition with a recorded reason.
- Accepted migrations 001 to 003 are never edited. The only new migration is `004_window_state.sql`.
- Product code never forces an ozone platform, never adds X11 switches, never calls `win.focus()`/`show()` as a test workaround (it calls them only for the user actions in section 8), and never disables the sandbox.
- Main-process modules with logic (`sticky-manager`, `main-window-controller`, `display-clamp`, `sticky-service`, `window-state-repo`, `tray-probe`, close-dialog options) do not import `electron` at runtime (type imports only), so the Node integration tests run them with fakes. Electron adapters live in `src/main/windows/electron-*.ts`, `sticky-window.ts`, `tray.ts`.

### 3.2 Files created (C), modified (M), deleted (D)

Shared (pure; importable by main, preload-free code and renderer):

| File | Change |
| --- | --- |
| `src/shared/contracts/stickies.ts` | C: `StickyNoteRequest`, `StickyFloatResponse`, `StickySetColorRequest`, `StickySetPinnedRequest`, `StickySetCollapsedRequest`, `StickyState`, `StoredBounds`, constants (`STICKY_HEADER_PX = 36`, `STICKY_DEFAULT = {width:320,height:300}`, `STICKY_MIN = {width:220,height:120}`, `MAX_OPEN_STICKIES = 50`) |
| `src/shared/contracts/windows.ts` | C: `WindowRole` (`'main' \| 'sticky'`), `WindowGetStateResponse`, `AppOpenNoteEvent`, `CloseBehavior` enum |
| `src/shared/contracts/channel-roles.ts` | C: `STICKY_ALLOWED_CHANNELS` (section 6.4) and `isChannelAllowed(role, channel)` |
| `src/shared/contracts/channel-names.ts` | M: 9 invoke channels and 2 events appended (section 6.2) |
| `src/shared/contracts/channels.ts` | M: schemas for the new channels and events |
| `src/shared/contracts/bridge.ts` | M: `sticky` and `window` namespaces |
| `src/shared/contracts/hierarchy.ts` | M: `TreeChangedReasons` gains `'sticky'` |
| `src/shared/contracts/settings.ts` | M: `app.closeBehavior`, `stickies.restoreOnStartup` (section 7) |
| `src/shared/sticky-colors.ts` | C: the six colors with light and dark hex from UX_SPEC section 10 (used by the renderer CSS test and by main for `backgroundColor` to avoid a white flash) |
| `src/shared/routes.ts` | C: `parseRoute(hash)` returns `{kind:'main'}`, `{kind:'sticky', noteId}` or `{kind:'invalid'}` (lowercase UUID only, exactly `#/sticky/<uuid>`) |

Main:

| File | Change |
| --- | --- |
| `src/main/db/migrations/004_window_state.sql` | C (section 5) |
| `src/main/db/migrations/index.ts`, `checksums.json` | M: version 4 (regenerate with `node tools/gen-migration-checksums.mjs`) |
| `src/main/db/repositories/window-state-repo.ts` | C: `get(key)`, `upsertSticky(noteId, patch, now)`, `setOpen`, `listOpenStickies()`, `closeAllStickies()`, `delete(key)`; `bounds` parsed with `StoredBounds`, and invalid JSON reads as null with one warning |
| `src/main/services/sticky-service.ts` | C: DB side of stickies (section 8.4) |
| `src/main/services/capabilities.ts` | M: tray input and test override (section 8.9) |
| `src/main/services/tray-probe.ts` | C: `detectStatusNotifierHost(exec)` and the pure `parseNameHasOwner(stdout)` |
| `src/main/services/close-dialog.ts` | C: pure `closeDialogOptions({platform, trayStatus})` and the `CloseChoice` type |
| `src/main/services/dialog-adapter.ts` | M: `showCloseChoice(parent, options)` in the adapter (Electron `dialog.showMessageBox` with checkbox) |
| `src/main/windows/window-registry.ts` | M: roles `'main' \| 'sticky'`, `noteId` for stickies, `info(id): SenderInfo \| undefined`, `stickyFor(noteId)` |
| `src/main/windows/secure-window.ts` | C: `secureWebPreferences(preloadPath)` (moved out of `mainWindowOptions`), `rendererUrl(devUrl, hash)` |
| `src/main/windows/main-window.ts` | M: uses `secureWebPreferences`; created through `MainWindowController` |
| `src/main/windows/main-window-controller.ts` | C: section 8.7 (electron-free) |
| `src/main/windows/sticky-manager.ts` | C: section 8.5 (electron-free) |
| `src/main/windows/sticky-window.ts` | C: pure `stickyWindowOptions(...)` and the Electron `StickyWindowFactory` |
| `src/main/windows/display-clamp.ts` | C: section 8.6 (pure) |
| `src/main/windows/display-provider.ts` | C: `DisplayProvider` interface, `createElectronDisplayProvider(screen)`, `createFakeDisplayProvider(initial)` |
| `src/main/tray.ts` | C: `TrayController` (section 8.8) |
| `src/main/window-lifecycle.ts` | M: section 8.10 |
| `src/main/desktop.ts` | C: wires the main window controller, sticky manager, tray, display provider and lifecycle hooks so `index.ts` stays a short composition root |
| `src/main/index.ts` | M: capability probe before windows, `desktop.ts`, no quit on `window-all-closed` when storage is up, `session-end` |
| `src/main/single-instance.ts` | M: `second-instance` calls `mainWindow.show()` (creates the window when it is missing) |
| `src/main/ipc/sender-policy.ts` | M: returns `SenderInfo \| null` |
| `src/main/ipc/router.ts` | M: role allowlist and the sticky note-ownership rule (section 6.4); `HandlerContext` gains `sender` |
| `src/main/ipc/event-bus.ts` | M: none beyond new catalogue entries |
| `src/main/ipc/handlers/sticky-handlers.ts`, `window-handlers.ts` | C |
| `src/main/ipc/register-handlers.ts` | M: `desktop` dependency (null when storage failed; the channels then answer INTERNAL "Storage is unavailable") |
| `src/main/main-services.ts` | M: `stickies: StickyService` |
| `src/main/test-hooks.ts` | M: section 8.12 |

Renderer:

| File | Change |
| --- | --- |
| `src/renderer/App.tsx` | M: route by `parseRoute(location.hash)`: main shell, `StickyApp`, or an invalid-route screen |
| `src/renderer/state/core-services.ts` | C: theme, notices, attachment limits, editor services, settings subscription; shared by main and sticky windows |
| `src/renderer/state/app-services.ts` | M: built on core services; `window.getState()` handshake; `app:openNote` |
| `src/renderer/state/commands.ts`, `palette-actions.ts` | M: `note.float`; `sticky.new` floats |
| `src/renderer/tree/actions.ts`, `TreeContextMenu.tsx` | M: "Float as sticky" for notes; tree "New sticky" floats |
| `src/renderer/state/tree-store.ts`, `notice-store.ts` | M: `restoreNotice(res)` moved to `notice-store.ts` and reused by the sticky |
| `src/renderer/state/tabs-store.ts` | M: `openNote(noteId, {takeEdit})` |
| `src/renderer/notes/note-controller.ts` | M: section 9.5 |
| `src/renderer/notes/NoteView.tsx` | M: "Float as sticky" header button |
| `src/renderer/shell/Notices.tsx` | M: `NoticeList({notices})` used by both window kinds |
| `src/renderer/pages/StickiesPage.tsx` | M: Float per row; New sticky floats |
| `src/renderer/pages/SettingsPage.tsx` | M: "Windows and tray" section |
| `src/renderer/stickies/sticky-services.ts` | C: section 9.3 |
| `src/renderer/stickies/StickyApp.tsx`, `StickyHeader.tsx`, `StickyView.tsx`, `StickyTrashState.tsx`, `ColorMenu.tsx` | C: section 9.4 |
| `src/renderer/styles/stickies.css` | C; imported in `main.tsx` |

Tests (section 12): new `tests/unit/{routes,display-clamp,tray-probe,close-dialog,sticky-window-options,contracts-phase04,sticky-colors}.test.ts`, `tests/unit/renderer/state/sticky-services.test.ts`, `tests/unit/renderer/sticky-header.test.tsx`; new `tests/integration/{window-state,sticky-service,sticky-manager,main-window-controller,ipc-handlers-phase04}.test.ts`; new `tests/e2e/{stickies,lifecycle}.spec.ts` and `tests/e2e/sticky-ui.ts`; updates listed in 12.5.

Docs: this plan; `docs/DECISIONS.md` (D-062 to D-071), `docs/ARCHITECTURE.md` (sections 3, 4, 5, 14, 15), `docs/UX_SPEC.md` (sections 5, 6, 7), `docs/BACKLOG.md` (Phase 04 Planned tests, W04 items). These planning edits were made by the planner. The implementer later updates BACKLOG status and writes `docs/progress/phase-04.md`.

## 4. Dependencies

None. Electron 44.7.0 provides `BrowserWindow`, `Tray`, `Menu`, `screen`, `dialog.showMessageBox` (with `checkboxLabel`) and `nativeImage`. Linux tray detection runs the system `gdbus` (fallback `dbus-send`) with `execFile` (no shell). If neither exists, the result is `unknown` (section 8.8). No apt package is installed anywhere.

## 5. Migration 004 (D-062)

`src/main/db/migrations/004_window_state.sql` (LF line endings, no `user_version`):

```sql
-- Presentation state of floating sticky windows (Phase 04, D-062); keys 'main' and 'widget' are reserved for later phases.
CREATE TABLE window_state (
  key           TEXT PRIMARY KEY NOT NULL,
  note_id       TEXT REFERENCES notes(id) ON DELETE CASCADE,
  bounds        TEXT CHECK (bounds IS NULL OR json_valid(bounds)),
  display_id    INTEGER,
  open          INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1)),
  collapsed     INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  always_on_top INTEGER NOT NULL DEFAULT 0 CHECK (always_on_top IN (0, 1)),
  updated_at    INTEGER NOT NULL,
  CHECK ((note_id IS NOT NULL AND key = 'sticky:' || note_id) OR (note_id IS NULL AND key IN ('main', 'widget')))
) STRICT;
CREATE UNIQUE INDEX window_state_note ON window_state(note_id);
```

- `bounds` JSON is `StoredBounds = {x: int|null, y: int|null, width: int 100..20000, height: int 36..20000}`. These are the outer window bounds of the **expanded** window. `x`/`y` are null where programmatic positioning is unsupported (Wayland, WSLg).
- Trash (soft delete) keeps the row, so restore brings back color, size, collapse and pin. Purge deletes the note row, and `ON DELETE CASCADE` removes the window state in the same transaction.
- `LATEST` becomes 4. A populated v3 database upgrades with a pre-migration copy (integration). Tests that hard-code 3 change to 4: `unit/migrations-checksum.test`, `integration/migrations.test`, `e2e/smoke.spec` (`schemaVersion`), `e2e/packaged.spec`.

## 6. Contracts and IPC (D-063, D-064)

### 6.1 Schemas (Zod 4 strict objects; `Uuid` from `ids.ts`, `NoteColor` from `hierarchy.ts`)

```ts
StickyNoteRequest      = { noteId: Uuid }
StickyFloatResponse    = { noteId: Uuid, created: boolean }
StickySetColorRequest  = { noteId: Uuid, color: NoteColor }
StickySetPinnedRequest = { noteId: Uuid, pinned: boolean }
StickySetCollapsedRequest = { noteId: Uuid, collapsed: boolean }
StickyState = {
  noteId: Uuid, title: string (max 200), color: NoteColor, path: string[] (max 66 segments),
  trashed: { batchId: Uuid | null } | null,      // null while the note is live
  collapsed: boolean, alwaysOnTop: boolean,
  activation: int >= 0                            // explicit user activations since this window was created
}
WindowGetStateResponse = discriminatedUnion('role', [
  { role: 'main',   openNotes: Array<{ noteId: Uuid, takeEdit: boolean }> (max 50) },
  { role: 'sticky', sticky: StickyState },
])
AppOpenNoteEvent = { noteId: Uuid, takeEdit: boolean }
StoredBounds = { x: int | null, y: int | null, width: int 100..20000, height: int 36..20000 }
```

### 6.2 Channels added (appended to `INVOKE_CHANNELS` in this order)

| Channel | Request | Response | Allowed senders |
| --- | --- | --- | --- |
| `sticky:float` | `StickyNoteRequest` | `StickyFloatResponse` | main |
| `sticky:dock` | `StickyNoteRequest` | `{}` | main, own sticky |
| `sticky:hide` | `StickyNoteRequest` | `{}` | main, own sticky |
| `sticky:setColor` | `StickySetColorRequest` | `StickyState` (when floating) or `null` | main, own sticky |
| `sticky:setPinned` | `StickySetPinnedRequest` | `StickyState` | main, own sticky |
| `sticky:setCollapsed` | `StickySetCollapsedRequest` | `StickyState` | main, own sticky |
| `sticky:remove` | `StickyNoteRequest` | `{}` | main, own sticky |
| `sticky:restore` | `StickyNoteRequest` | `TrashRestoreResponse` | main, own sticky |
| `window:getState` | `{}` | `WindowGetStateResponse` | main, sticky |

Events appended to `EVENT_CHANNELS`: `sticky:state` (`StickyState`, `sendTo` the sticky window of that note only) and `app:openNote` (`AppOpenNoteEvent`, `sendTo` the main window only). `note:trashed` is not added (D-063). The catalogue name `removeSticky` from ARCHITECTURE becomes `sticky:remove`, and `sticky:restore` is new.

Error codes: an unknown note gives `NOT_FOUND` "This note no longer exists"; a trashed note on float gives `NOT_FOUND` with the existing in-Trash message and `{trashed:true, trashBatchId}`; pin where `capabilities.alwaysOnTop.status === 'unsupported'` gives `UNSUPPORTED` "Not supported by this desktop" and nothing is stored; the 51st open sticky gives `LIMIT_EXCEEDED` "You have 50 open stickies. Hide some to open more."; `sticky:setColor` on a note with `sticky_enabled = 0` gives `VALIDATION_FAILED` "This note is not a sticky"; `sticky:restore` on a live note gives `VALIDATION_FAILED` "This note is not in Trash".

### 6.3 Bridge (`window.infinity`, frozen)

```
sticky: { float, dock, hide, setColor, setPinned, setCollapsed, remove, restore }   // Call<...>
window: { getState }                                                                // Query<'window:getState'>
```

`subscribe` accepts `sticky:state` and `app:openNote`. `security.spec › bridge surface` asserts the new exact key set. The `subscribeError` probe there changes to `'reminder:changed'` (Phase 05).

### 6.4 Window roles, channel allowlist and note ownership (D-064)

- `WindowRegistry` entries carry `role` and, for stickies, `noteId`. The sender policy returns `SenderInfo = {role:'main'} | {role:'sticky', noteId}` or null. The existing checks stay unchanged (top-level frame, registered `webContents`, renderer origin or dev origin).
- The router refuses with `FORBIDDEN` "Not allowed" (and logs `ipc: channel not allowed for role=sticky channel=<c>`) any channel that the sender's role does not allow. Main windows may call every channel. Sticky windows may call only `STICKY_ALLOWED_CHANNELS`:
  `app:getInfo`, `app:quit`, `app:flushed`, `capabilities:get`, `settings:get`, `note:open`, `note:save`, `note:rename`, `note:trash`, `note:convertFormat`, `lease:acquire`, `lease:release`, `lease:take`, `versions:list`, `versions:restore`, `drafts:list`, `drafts:resolve`, `attachment:importBytes`, `attachment:importFromDialog`, `shell:openExternal`, `window:getState`, `sticky:dock`, `sticky:hide`, `sticky:setColor`, `sticky:setPinned`, `sticky:setCollapsed`, `sticky:remove`, `sticky:restore`.
  Everything else is main-only, notably `session:set`, `settings:set`, `tree:list`, `trash:restore`, `trash:purge`, every `project:`, `folder:` and `item:` channel, `note:create`, `note:move`, `sticky:float` and `app:showDataFolder`.
- Ownership: after Zod parsing, a request from a sticky that has a `noteId` field must name that sticky's own note, otherwise `FORBIDDEN`. The window hash is never trusted; the registry `noteId` is the authority.
- `HandlerContext` becomes `{webContentsId, sender: SenderInfo}`. The test hooks' fake view (`FAKE_WEB_CONTENTS_ID`) calls services directly and is unaffected.

## 7. Settings registry (D-066)

| Key | Schema | Default | Public |
| --- | --- | --- | --- |
| `app.closeBehavior` | `'ask' \| 'background' \| 'quit'` | `'ask'` | yes (Settings page) |
| `stickies.restoreOnStartup` | boolean | `false` | yes (Settings page) |

A fresh launch without user interaction still writes no settings row.

## 8. Main process design

### 8.1 Registry and sender info

`RegisteredWindow` gains `role: 'main' | 'sticky'` and `noteId?: string`. Methods: `add`, `remove`, `has`, `get`, `all`, `main()`, `info(id): SenderInfo | undefined`, `stickyFor(noteId)`. Sticky entries are added synchronously when the `BrowserWindow` is constructed (before `loadURL`), so the first IPC call of the new renderer passes the policy. They are removed on `closed`.

### 8.2 Secure windows (INF-FND-03 for every window)

`secureWebPreferences(preloadPath)` returns exactly the Phase 01 set (`contextIsolation`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false`, `experimentalFeatures:false`, `webviewTag:false`, `navigateOnDragDrop:false`, `spellcheck:false`, `safeDialogs:true`). Both `mainWindowOptions` and `stickyWindowOptions` use it (unit test: deep-equal). Sticky windows load `infinity-app://renderer/index.html#/sticky/<noteId>` (dev: `<devUrl>#/sticky/<noteId>`). `installWebSecurity` already applies to every `webContents` (navigation guard, window-open deny, webview deny, permission deny). The network guard is per session and covers sticky windows too. The CSP is in the same `index.html`.

`stickyWindowOptions({bounds, alwaysOnTop, color, theme, title, preloadPath, iconPath, platform})`: `width/height` from bounds (default 320x300 outer), `x/y` only when given, `minWidth: 220`, `minHeight: 120`, `show: false`, `title: "<title or Untitled> - Infinity Notes"`, `autoHideMenuBar: true`, `fullscreenable: false`, `alwaysOnTop` (only when the capability allows), `backgroundColor` = the sticky color for the current theme, Linux `icon`. After construction: `win.removeMenu()` (the application menu stays on the main window; Chromium handles copy/paste/undo keys itself on Windows and Linux).

### 8.3 Sender validation with several windows

Section 6.4 covers it. `lease:release-request` and `app:flush-request` already use `sendTo`, so they reach a sticky `webContents` when it holds the lease or is flushed. `note:revision`, `note:lease`, `tree:changed` and `settings:changed` are broadcast to every registered window, stickies included.

### 8.4 `StickyService` (DB side; electron-free; `src/main/services/sticky-service.ts`)

- `enable(noteId)`: in one transaction, require a live note (`NOT_FOUND` with trash details as in 6.2), set `sticky_enabled = 1`, set `color = COALESCE(color, 'yellow')`, and upsert `window_state` `open = 1`. Emits `tree:changed {reason:'sticky'}` only when the flag or color changed. It never changes `revision` or `updated_at` (D-046 rule extended).
- `disable(noteId)`: `sticky_enabled = 0` and delete the window-state row, in one transaction. Emits `'sticky'`.
- `setColor(noteId, color)`: requires `sticky_enabled = 1`. Emits `'sticky'`. Leaves `revision` and `updated_at` unchanged.
- `meta(noteId)`: `{title, color, path, trashed}` from `HierarchyRepo.getNoteMeta` plus `livePathIndex` (one index per call; `metaMany(ids)` builds the index once for a refresh), or null when the row is gone (purged).
- Window state: `state(noteId)`, `saveBounds(noteId, bounds, displayId)`, `setOpen`, `setCollapsed`, `setAlwaysOnTop`, `openStickyIds()` (rows with `open = 1` whose note is live and sticky), `closeAll()` (sets every sticky row to `open = 0`).

### 8.5 `StickyManager` (`src/main/windows/sticky-manager.ts`; INF-STKY-01..12)

Deps: `service`, `factory: StickyWindowFactory`, `displays: DisplayProvider`, `caps()`, `flush(wcIds)` (FlushCoordinator), `resetLeases(wcId)`, `sendState(wcId, state)`, `registry`, `trash: TrashService`, `mainWindow: {openNote(noteId, takeEdit)}`, `theme()`, `logger`, `boundsDebounceMs = 500`, `maxOpen = 50`. State: `Map<noteId, {handle, activation, quitting?}>`.

- **float(noteId)** (from main only): `service.enable`. If an entry exists: `activation += 1`, `show()` + `focus()`, send state, and return `{created:false}`. Otherwise refuse when `maxOpen` windows are open. Compute bounds (8.6), create the window, register it, set `activation = 1`, apply collapse before the first show, and on `ready-to-show` call `show()` (the user asked for it, so it gets focus). Log `sticky: open note=<id> created=<bool>`. A second float of the same note never creates a second window (INF-STKY-01, INF-STKY-11).
- **Implicit take**: the renderer reads `activation` from `window:getState`. A value above 0 at start means "open by taking edit control". A later increase means "take edit control and focus the editor". Restored windows start at 0 and only acquire (section 9.3).
- **hide(noteId)** (OS close button, `sticky:hide`, Ctrl+W, the trash state's Close window): `await flush([wcId])`, save bounds, `setOpen(false)`, `resetLeases(wcId)`, `handle.destroy()`, then drop the entry. A hidden sticky is a destroyed window with `open = 0`. Reopening (Float on the Stickies page, tree, tab, palette) creates a fresh window from the stored state. The note and its sticky flag are untouched (INF-STKY-05). Reason: no hidden renderer keeps holding a lease or memory (D-065).
- **OS close event**: the handle's `close` listener calls `manager.onClose(noteId, event)`. While quitting it saves bounds, keeps `open = 1` and allows the close. Otherwise it calls `event.preventDefault()` and `hide(noteId)`. A repeated close during a hide is ignored.
- **dock(noteId)**: if floating, run the hide sequence but also `mainWindow.openNote(noteId, true)` after the destroy. If not floating, it only opens the note. Order: flush is acknowledged, then leases reset, then the window is destroyed, then the tab opens. The tab therefore never races the sticky for the lease (INF-STKY-03).
- **remove(noteId)**: dock sequence plus `service.disable(noteId)` (clears the flag and deletes the window state); the note opens in the app.
- **Tree changes**: `onTreeChanged(event)` is called from `index.ts` after each committed hierarchy, trash or sticky change. It recomputes `metaMany` for the open stickies and sends `sticky:state` to each window whose snapshot changed (title, path, color, trashed). It also updates the OS window title. If the meta is null (purged), it destroys the window without flushing (the trash state has no editor) and drops the entry. Renames and moves from the main window therefore show up live (INF-STKY-04 "project membership remains visible"), and trash and restore switch the sticky between the editor and the trash state (INF-STKY-08).
- **restore(noteId)**: requires `meta.trashed`, then calls `trash.restore(batchId)` and returns its response. The tree-change path then sends the live snapshot.
- **setColor**: `service.setColor`, `setBackgroundColor`, send state. **setPinned**: refuse `UNSUPPORTED` when the capability is `unsupported`; otherwise `setAlwaysOnTop(pinned)` on the window when open, then `service.setAlwaysOnTop`. **setCollapsed**: when collapsing, save the expanded bounds first, then `setMinimumSize(220, 0)`, `setContentSize(width, 36)`, `setResizable(false)`; when expanding, `setBounds({width, height})` from the stored expanded bounds (keeping the current position), then `setMinimumSize(220, 120)`, `setResizable(true)`; persist (INF-STKY-04, INF-STKY-06).
- **Bounds persistence**: `move` and `resize` events are debounced 500 ms, then `getBounds()` is saved. While collapsed only `x/y` update. Where positioning is unsupported, `x`/`y` are stored as null. `display_id` is `displays.matching(bounds)`. Bounds are also saved at hide, dock, remove and quit.
- **Displays**: subscribe once to `displays.onChanged` (one listener for the app lifetime). Where positioning is supported, every open sticky whose current bounds no longer pass the 8.6 reachability rule gets clamped bounds, which are applied and persisted. Windows that are still reachable are not touched.
- **restoreOnStartup()** (called once after the main window's first `did-finish-load`): if `stickies.restoreOnStartup` is true, create a window for each `openStickyIds()` entry with `activation = 0`, shown with `showInactive()`, or `show()` when `caps().sessionType === 'wayland'` (probe: forced-Wayland `showInactive` stays invisible). If the setting is false, call `service.closeAll()` so a later opt-in never resurrects an old session. Rows for trashed or missing notes are set to `open = 0` (INF-STKY-09).
- **prepareQuit()** (called first in `before-quit`): mark quitting and save the bounds of every open sticky. The quit flush itself is the existing lifecycle flush of `registry.all()`, which now includes stickies (INF-STKY-12).
- **Crash**: sticky windows get the same lifecycle hooks as the main window (lease reset on `did-navigate` and `render-process-gone`, reload after a crash), but with a crash counter per window (8.10).

### 8.6 Display clamping (`display-clamp.ts`, pure; D-068; INF-STKY-06)

```
computeStickyBounds({ stored: StoredBounds | null, displayHint: number | null, displays: Display[], primaryId,
                      positioning: 'supported'|'unsupported'|'unknown', cascadeIndex }) -> { x?, y?, width, height, displayId? }
```

1. Size: `width = clamp(stored?.width ?? 320, 220, targetWorkArea.width)`, `height = clamp(stored?.height ?? 300, 120, targetWorkArea.height)`, where the target is the display chosen in step 3, or the primary display when positions are not used.
2. If positioning is `unsupported`, or `stored.x`/`stored.y` is null: return the size only. With no stored position and positioning supported, place at `wa.x + wa.width - width - 32 - 24*k`, `wa.y + 32 + 24*k` on the primary display, where `k = cascadeIndex mod 8`.
3. Reachable: the rectangle's top strip (`y .. y+36`) intersects some display work area by at least 80 px horizontally. If it is reachable, choose the display with the largest intersection; otherwise the hint display if it is still connected; otherwise the primary display.
4. If it was reachable, shift the rectangle so that it lies fully inside the chosen work area (shrinking to the work area if it is larger). If it was not reachable, center it in the chosen work area, offset by `24*k`.
5. Return integers and `displayId`.

`positioning === 'unknown'` (Linux desktop sessions outside scope) is treated like supported. A test seam replaces the provider: `createFakeDisplayProvider` with `set(displays, primaryId)`, which emits a change.

### 8.7 `MainWindowController` and close policy (`main-window-controller.ts`; D-066; INF-DESK-01, INF-STKY-12)

- `ensure()` returns the existing main window or creates one (registers role `main`, attaches lifecycle hooks, loads `#/`). `show()` calls `ensure()`, then `restore()` if minimized, then `show()` and `focus()`.
- `openNote(noteId, takeEdit)`: `show()`; if the renderer is ready (it has called `window:getState`), `sendTo(main, 'app:openNote', ...)`; otherwise queue (de-duplicated by note, at most 50). `rendererReady(wcId)` marks it ready and drains the queue into the `window:getState` answer. A recreated window starts not ready.
- `onClose(event)`: if quitting, or a close is already allowed, let it close. Otherwise `preventDefault()` and read `app.closeBehavior`:
  - `quit` calls `app.quit()` (the lifecycle flushes all windows).
  - `background` flushes the main window (acknowledged, 2000 ms), then lets it close (destroyed). Stickies and the process keep running. Log `window: main closed to background`.
  - `ask` shows the close dialog (at most one at a time). The result `{choice: 'background'|'quit'|'cancel', remember}`: when `remember` is set and the choice is not cancel, `app.closeBehavior` is saved first; then the choice runs as above. `cancel` keeps the window.
- `closeDialogOptions({platform, trayStatus})` (pure): `type: 'question'`, `title: 'Infinity Notes'`, `message: 'Keep Infinity Notes running in the background?'`, `detail: 'Reminders and stickies only work while the app is running.'`, plus `'\n\nIf no tray icon appears, launching Infinity Notes again brings this window back.'` when the platform is Linux or the tray is not `supported`. `buttons: ['Keep running in background', 'Quit', 'Cancel']`, `defaultId: 0`, `cancelId: 2`, `checkboxLabel: 'Remember my choice'`, `checkboxChecked: true`, `noLink: true`.
- `window-all-closed` no longer quits when storage is up (background mode keeps the process). When storage failed (startup error screen), closing the window still quits. `second-instance`, the tray's Open and `openNote` recreate the main window. Session restore then brings back the tabs.

### 8.8 Tray (`tray.ts`, `tray-probe.ts`; D-067; INF-DESK-02)

- Detection runs once at startup, before any window, with an overall timeout of 2000 ms. On Windows the tray is `supported` (`native-windows`). On Linux the probe runs `gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner org.kde.StatusNotifierWatcher` through `execFile` (no shell). If `gdbus` is missing, it runs the `dbus-send` equivalent. `(true,)` or `boolean true` gives `supported('status-notifier-host')`. `(false,)` or `boolean false` gives `unsupported('no-status-notifier-host')`. A missing tool, a timeout or unparsable output gives `unknown('status-notifier-host-unknown')`.
- `TrayController.start()` creates a `Tray` only when the capability is `supported`, so there is never an invisible tray on WSLg. Icon: `resources/icon.png` resized to 16 px (Windows) or 22 px (Linux). Tooltip: "Infinity Notes". Left click: `mainWindow.show()`. Context menu: "Open Infinity Notes" (`mainWindow.show()`), "New sticky" (creates a note at the Common root with `sticky:true` and floats it), separator, "Quit Infinity Notes" (`app.quit()`). "Show widget" is added with the widget in Phase 05 (W05-03). The tray is destroyed on `will-quit`.
- Fallback where the tray is unsupported or unknown: no tray. The close dialog adds the relaunch sentence. Settings shows the no-tray note (section 10). A second launch shows or recreates the main window. The sticky menu has "Quit Infinity Notes", so a tray-less background session can always be ended.

### 8.9 Capabilities (INF-STKY-13)

- `CapabilityInputs` gains `statusNotifierHost: 'present' | 'absent' | 'unknown' | null` (null on Windows). Tray results are as in 8.8. Positioning and always-on-top keep today's rules (WSLg and Wayland `unsupported`; X11 `unknown` for always-on-top; Windows `supported`). The capability object is computed once at startup after the probe. `capabilities:get` returns it.
- Test override (only when `testHooksEnabled`): `INFINITY_NOTES_TEST_CAPS` is a JSON object mapping `windowPositioning`, `alwaysOnTop` and `tray` to a status. `applyCapabilityOverride(caps, raw)` is pure. Invalid JSON is ignored with a warning. The reason becomes `test-override`. A packaged build ignores the variable (`packaged.spec` asserts it).
- Startup log line: `capabilities positioning=<s> alwaysOnTop=<s> tray=<s>(<reason>) session=<t> ozone=<o>`. No code path adds an `ozone-platform` switch (boundaries test).

### 8.10 Window lifecycle changes (`window-lifecycle.ts`)

- `before-quit`: first `onQuitStarting()` (calls `stickies.prepareQuit()`), then flush `registry.all()` as today, then quit. Every window's close handler checks `isQuitting()` and allows the close.
- `windowHooks(role)` returns `onCloseRequest` (main: delegates to `MainWindowController.onClose`; sticky: `StickyManager.onClose`), `onRendererGone`, `onNavigated`. Crash reload counting is per window (at most 3 reloads per minute each).
- Windows `session-end` and Linux `powerMonitor` `shutdown`: mark quitting and save sticky bounds synchronously (no dialog, no flush wait), so a logoff is never blocked by the close dialog.

### 8.11 Wiring (`index.ts`, `desktop.ts`)

Order in `start()`: logger and display log, then the tray-host probe (bounded) and the capabilities computation, then web security and the network guard, then the protocols and the database, then the event bus and the flush coordinator, then the services (with `onTreeChanged` broadcasting and calling `desktop.stickies.onTreeChanged`), then the router (`createSenderPolicy({registry, devOrigin})` returning `SenderInfo`), then `registerIpcHandlers(router, {app, services, desktop})`, then `createDesktop(...)` (main window controller, sticky manager, display provider, tray), then `mainWindow.ensure()` and `show`, then after the first `did-finish-load`, `stickies.restoreOnStartup()`. `second-instance` calls `desktop.mainWindow.show()`.

### 8.12 Test hooks and seams (only `!app.isPackaged && INFINITY_NOTES_E2E === '1'`)

`TestState` additions on `globalThis.__infinityTest`:

- `closeChoices: Array<{choice, remember}>`. The hooked dialog adapter takes the next entry, and an empty queue means `cancel`. It never shows a real dialog. `closeDialogs: CloseDialogOptions[]` records what would have been shown.
- `windows(): {main: {webContentsId, visible} | null, stickies: Array<{noteId, webContentsId, visible, bounds, contentSize, alwaysOnTop, collapsed, resizable, activation}>}`.
- `stickyLog: Array<{noteId, op: 'create'|'clamp', bounds: {x?, y?, width, height}}>` with the app-computed bounds of each creation and re-clamp.
- `listenerCounts(): Record<string, number>` covering `app` `web-contents-created`, `app` `second-instance`, `app` `before-quit`, `screen` or the fake provider `changed`, `nativeTheme` `updated`, `webContents.getAllWebContents().length`, `BrowserWindow.getAllWindows().length` and registry size.
- `displays: {set(displays, primaryId)} | null`, present when `INFINITY_NOTES_TEST_DISPLAYS` (JSON `{displays:[{id, bounds, workArea}], primaryId}`) was given at launch. The fake provider then replaces `screen`.
- `tray: {present: boolean, items(): string[], click(label): void}`. `click` runs the real menu item handler.
- `INFINITY_NOTES_TEST_CAPS` as in 8.9.

E2E helpers must find windows by URL, never by `getAllWindows()[0]` (probe: the order is not the creation order).

### 8.13 Logging

`sticky: open note=<id> created=<bool>`, `sticky: hide note=<id>`, `sticky: dock note=<id>`, `sticky: restore-on-startup count=<n>`, `sticky: clamp note=<id>`, `window: main closed to background`, `window: main recreated`, `tray: created|not created reason=<r>`. Logs never contain titles or content.

## 9. Renderer

### 9.1 Routes and `App`

`parseRoute(location.hash)` is evaluated once at startup. `#/` and the empty hash give the main shell. `#/sticky/<uuid>` gives `StickyApp`. Anything else shows "This window could not be opened." with a Close button (`window.close()`). `StickyApp` also shows that message if `window:getState` answers a different role or note ID than the route.

### 9.2 `core-services.ts`

The pieces both window kinds need: `ThemeStore` (hydrated from `settings:get` and following `settings:changed`), `NoticeStore`, the attachment limits store, `EditorServices` and the subscription bookkeeping (`dispose` runs every unsubscribe). `createAppServices` is rebuilt on top of it without behavior change, plus:

- after `tabs.init()`, `bridge.window.getState()`; for each `openNotes` entry it calls `tabs.openNote(noteId, {takeEdit})`;
- `subscribe('app:openNote', ...)` does the same;
- `tabs.openNote(noteId, {takeEdit:true})` activates or opens the tab, then calls `controller.ensureEditing()`.

### 9.3 `sticky-services.ts`

`createStickyServices(bridge, noteId, deps)` returns `{core, controller, sticky: Store<StickyState|null>, caps: Store<CapabilitiesType|null>, actions, ready, dispose}`, cached per bridge like `AppServices`.

- `init`: `window.getState()`, then check role and noteId; load `settings:get` (theme, limits) and `capabilities:get`; `controller.open(activation > 0 ? 'take' : 'acquire')`; remember `lastActivation`.
- Subscriptions: `settings:changed` (via core); `note:revision` and `note:lease` go to the controller; `lease:release-request` for this note calls `controller.onReleaseRequest()`; `app:flush-request` runs `controller.flush()` then `app.flushed`; `sticky:state` updates the store, and then:
  - `activation > lastActivation` calls `controller.ensureEditing()` and focuses the editor;
  - `trashed` changing from null to set calls `controller.handleTrashed(batchId)`; when that flush ends with a trashed `CONFLICT`, the sticky shows `trashedDraftNotice(title)`;
  - `trashed` changing from set to null calls `controller.reopen()`.
- `pagehide` and `visibilitychange` hidden flush the controller.
- `actions`: `setColor`, `togglePinned`, `toggleCollapsed`, `hide`, `dock` (flushes first), `remove` (flushes first), `trash` (after the confirm dialog), `restore` (shows `restoreNotice(res)`), `quit`. Each failure shows a notice with the error message.

### 9.4 Sticky UI (UX_SPEC sections 5, 6 and 10; D-070)

- `StickyApp` provides a sticky services context and renders `StickyView`. The window background is the sticky color (`data-sticky-color`, light/dark palette tokens in `stickies.css`).
- `StickyHeader` (36 px, `role="toolbar"`, label "Sticky"), left to right:
  - color button "Sticky color", which opens `ColorMenu` (`menuitemradio` Yellow, Green, Blue, Pink, Violet, Gray, checked = current);
  - title input "Title" (placeholder "Untitled", read-only while the note is read-only, rename through `controller.rename` and flush on blur and Enter, following live title changes unless focused, the same pattern as `NoteView`);
  - source badge with the path joined by " › " ("Common" at the Common root), ellipsized, with the full path in `title`;
  - pin toggle "Keep on top" (`aria-pressed`). When the capability is `unsupported` it has `aria-disabled="true"`, the tooltip "Not supported by this desktop", and activating it does nothing;
  - collapse toggle "Collapse sticky" / "Expand sticky" (`aria-expanded`);
  - menu button "Sticky actions" with the items "Open in app", "Change color", "Hide", "Remove from stickies", "Move to Trash", separator, "Quit Infinity Notes".
- Body (`hidden` while collapsed, editor kept mounted): `NoteBanners`, then `NoteEditor variant="sticky"` (same component, same paste, attachments, find, links and conversions), then `NoticeList`. Ctrl+W hides, Ctrl+F opens the find bar, Escape closes popovers.
- Move to Trash shows `ConfirmDialog` with title "Move to Trash?", body `“<title>” will be moved to Trash. You can restore it from Trash.` and confirm "Move to Trash" (the tree's copy).
- `StickyTrashState` (live note trashed): heading "This note is in Trash", buttons "Restore" and "Close window" (Close calls hide). No editor is mounted (INF-STKY-08).
- The header stays usable at 220 px. The toolbar wraps in the sticky variant (CSS only).

### 9.5 `NoteController` additions (INF-STKY-07; D-065)

- `open(mode: 'acquire' | 'take' = 'acquire')`: the existing open, then for `take`, when the lease was not granted, `takeEditControl()`.
- `ensureEditing()`: if read-only and not busy, `takeEditControl()`.
- Auto-acquire: `onLease({holderViewId: null})` while `status === 'readOnly'`, `readOnlyReason === 'lease'` and `busy === null` calls `lease:acquire`. When granted it stores the token, reloads and becomes `ready` (the banner disappears). Not for `leaseLost`, whose recovered-draft banner must stay. Not while a take is in flight: `busy` is set synchronously before the take request, so a take never races its own acquire.
- `handleTrashed(batchId)`: flush (a pending edit becomes a trashed `CONFLICT` draft in main), release, then `status: 'trashed', trashBatchId`.
- `reopen()`: reset to `loading`, then `open('acquire')`.

### 9.6 Main window changes

- `NoteView` header: an icon button "Float as sticky" (a lucide icon already in the installed `lucide-react`, for example `PictureInPicture2` or `StickyNote`). It runs `controller.flush()` and then `bridge.sticky.float({noteId})`; failures show a notice.
- Commands: `note.float` (active note tab; palette "Float current note"). `sticky.new` (Ctrl+Shift+N, Home tile, palette) creates the sticky at `currentLocation()` (D-047) and floats it; no tab opens (D-069). The tree menu's "New sticky" does the same at the menu location, and note rows get "Float as sticky".
- `StickiesPage`: each row has a "Float" button (`aria-label="Float <title>"`) and the existing "Open"; New sticky floats.
- `SettingsPage` "Windows and tray" section: segmented control "When the main window closes" (Ask / Keep running / Quit) bound to `app.closeBehavior`; the text "Reminders and stickies only work while the app is running."; when the tray is not `supported`, "No tray icon is available on this desktop. Launch Infinity Notes again to bring the main window back."; a switch "Restore open stickies on startup" bound to `stickies.restoreOnStartup`.

### 9.7 CSS (`stickies.css`)

Sticky color variables per theme (UX_SPEC section 10), header layout and focus rings, a compact toolbar (wrapping, 24 px buttons), the collapsed state, the trash state, and narrow widths (220 px). There are no `-webkit-app-region` drag regions (D-028 native frame stays).

## 10. UX copy (exact; added to UX_SPEC)

- Float: button and palette "Float as sticky" (tab header, tree menu), palette "Float current note", Stickies page "Float".
- Sticky header and menu: as in 9.4. Trash state: "This note is in Trash", "Restore", "Close window". Restore notice: the existing "Restored to <path>" or "Restored to <path> because its original location is in Trash or no longer exists".
- Close dialog: as in 8.7 (adds a Cancel button and the remember checkbox, checked by default).
- Settings, Windows and tray: as in 9.6.
- Tray: tooltip "Infinity Notes"; items "Open Infinity Notes", "New sticky", "Quit Infinity Notes".
- Limits and errors: "You have 50 open stickies. Hide some to open more."; "Not supported by this desktop"; "This note is not a sticky"; "This note is not in Trash"; invalid route "This window could not be opened."

## 11. Security summary for this phase

Every window uses one `secureWebPreferences`. Sticky windows load only the bundled renderer origin, with the route carrying a validated UUID. Main validates the note before creating a window, and the renderer re-validates through `window:getState`. The IPC surface for sticky windows is an allowlist with note ownership (6.4), so a compromised sticky cannot rewrite the tab session, purge trash or reach other notes. Navigation, `window.open`, webviews and permissions stay blocked for all `webContents`. The network guard covers every window. The test seams exist only in unpackaged E2E runs. Tray detection uses `execFile` with fixed arguments and no shell. Nothing new reaches the network.

## 12. Tests

### 12.1 Explicit assertions per requirement ID (Phase 00 F-1)

W = Windows 11; L = WSLg (ozone x11) and Xvfb. "Hooks" means `__infinityTest`. Visual evidence goes under `.infinity-work/logs/phase-04/screens/{win,wslg}/`.

| ID | Test (file › case) and assertions |
| --- | --- |
| INF-STKY-01 | E `stickies.spec › float opens one native window for the same note id`: a note "Groceries" with text "milk" open in a tab; activate "Float as sticky". A new window opens whose URL is exactly `infinity-app://renderer/index.html#/sticky/<id>`; `hooks.windows().stickies` is `[{noteId:id, visible:true}]`; the sticky's Title is "Groceries" and its editor text is "milk"; DB `sticky_enabled=1`, `color='yellow'`, `revision` unchanged; the note count is unchanged; `window_state` `sticky:<id>` has `open=1`. Float again from the tab, the tree menu and the palette: still 2 `BrowserWindow`s, one sticky entry, `activation` 4. Float through the bridge with an unknown UUID gives `NOT_FOUND`, with `'abc'` gives `VALIDATION_FAILED`, and with a trashed note gives `NOT_FOUND` with `trashed:true`; no window is created. I `sticky-manager.test › float twice creates once`, `› trashed and missing notes create nothing`, `› 51st open sticky is refused`. U `routes.test`. |
| INF-STKY-02 | E `stickies.spec › two stickies are independent windows`: float A and B. Each sticky page shows its own note's text; the renderer OS process IDs and native window handles differ. Type "A1" in A and "B1" in B: DB A is "A1…" without "B1", and B the reverse. Set A's bounds (simulated user move and resize) to a rectangle outside the main window: W and Xvfb `getBounds()` equal it and do not intersect the main window; B's bounds are unchanged; after the debounce `window_state` A has the new size (`x/y` stored on W, null on L), and B's row is unchanged. WSLg OS bounds are logged, not asserted (window manager offsets). N: user-driven move and resize on Windows and WSLg are pending (Phase 09 matrix). |
| INF-STKY-03 | E `stickies.spec › dock preserves content and edit control`: in the sticky type " docked" and immediately choose "Open in app". The sticky window is gone (`stickies` empty, 1 `BrowserWindow`), `open=0`, `sticky_enabled` still 1; the main window's active tab is the note; the editor text ends with " docked"; there is no read-only banner and the editor is not `aria-readonly`; DB `plain_text` is equal; `note_drafts` count is 0. Variant with the main window closed to background first: dock recreates the main window and opens the tab. |
| INF-STKY-04 | E `stickies.spec › header controls`: the color menu has exactly 6 radio items, and choosing Blue gives DB `color='blue'`, the sticky `data-sticky-color="blue"`, and the main Stickies page dot `dot-blue`. The badge reads "Common"; `note:move` to project "Alpha" folder "Plans" from the main window makes it "Alpha › Plans" without reopening. Pin (W real): `aria-pressed=true`, `isAlwaysOnTop()` true, DB `always_on_top=1`, unpin reverts all three. Collapse: `aria-expanded=false`, editor hidden, content height 36 (W and Xvfb `getContentSize()[1]`; L `hooks.windows` and the log), `resizable=false`, DB `collapsed=1`; expand restores the previous content height and `resizable=true`. The menu items are exactly the 9.4 list. Hide from the menu: window gone, `open=0`. V screenshots `sticky-light`, `sticky-dark`, `sticky-collapsed`, `sticky-color-menu`. U `sticky-header.test` (accessible names, pin disabled state). |
| INF-STKY-05 | E `stickies.spec › close hides; delete is separate`: type " kept" and close the window through the OS close path (`BrowserWindow.close()`). The window is destroyed; main log `flush: requested=1 acked=1`; the note row is unchanged apart from the text (`deleted_at` null, `sticky_enabled=1`, `plain_text` ends with " kept"); `open=0`. Float from the Stickies page reopens it with that text. Delete: "Move to Trash" opens "Move to Trash?"; Cancel leaves `deleted_at` null; Confirm sets `deleted_at` and the sticky shows the trash state. |
| INF-STKY-06 | U `display-clamp.test`: inside unchanged; partly off the right edge shifted inside; on a removed display with the hint gone, centered on the primary with cascade; hint present but unreachable, moved onto the hint; larger than the work area, shrunk; minimum 220x120; negative coordinates of a left monitor kept; positioning unsupported or null x/y gives size only; the top-strip reachability threshold of 80 px. I `window-state.test`: migration 004 on a populated v3 database with a pre-migration copy; CHECK rejects `sticky:` keys without `note_id`; invalid `bounds` JSON reads as null and logs once; purge cascades the row away. I `sticky-manager.test`: restore clamps; a display change re-clamps only unreachable windows and persists; Wayland mode stores `x/y` null. E `stickies.spec › bounds persist and are clamped to connected displays` (launched with `INFINITY_NOTES_TEST_CAPS={"windowPositioning":"supported"}` and `INFINITY_NOTES_TEST_DISPLAYS` with displays 1 at x 0..1920 and 2 at x 1920..3840): float; move onto display 2; the row has `display_id=2` and `x>=1920`; `displays.set([display1])`; the `stickyLog` clamp entry lies inside display 1's work area, W and Xvfb `getBounds()` equal it, and the row is updated. Quit; write an off-screen row (`x=9000`) while closed; relaunch with restore on: the created bounds lie inside display 1. Collapsed and pinned (W) restored. E `stickies.spec › size only where positioning is unsupported` (L real capabilities; W with the override `unsupported`): stored `x/y` null; the re-float `create` log entry has no `x/y` and the stored size. N: real monitor removal on Windows and restored positions on X11 are pending (Phase 09; X11 outside scope). |
| INF-STKY-07 | E `stickies.spec › edit control moves between tab and sticky without losing text`: tab types "one" (no wait) and Float. The sticky shows "one" and is editable; the tab shows "This note is being edited in another window" with an `aria-readonly` editor. The sticky types " two" and the tab mirror polls to "one two". The tab chooses "Take edit control": the sticky shows the banner and becomes read-only, the tab types " three", the sticky mirror shows "one two three". Hide the sticky: the tab stays editable. Float again (take), type " four", Dock: the tab text is "one two three four". The DB matches after every step, revisions strictly increase, and `note_drafts` count is 0. `› a mirror becomes editable when the editing sticky closes`: the sticky holds the lease and the tab is a mirror; hide the sticky; within 2 s the tab banner is gone and typing saves. U `note-controller.test`: `open('take')`, `ensureEditing`, auto-acquire only for reason `lease` and not while busy, `handleTrashed`, `reopen`. I `ipc-handlers-phase04.test › release request reaches a sticky holder`. |
| INF-STKY-08 | E `stickies.spec › trashing a floating note shows a recoverable trash state`: type " pending" in the sticky, then immediately trash the note from the main tree (Delete, confirm). The sticky shows "This note is in Trash" with Restore and Close window and no `role=textbox`; `note_drafts` has 1 row (`reason='conflict'`) whose content holds " pending"; the sticky shows the recovered-draft notice. Restore: `deleted_at` null, the editor is back with the stored text, and the notice is "Restored to Common". Trash again, then Close window: the window is gone and `open=0`. Purge (Empty trash in the main window) removes the `window_state` row. A second case: purge while the sticky shows the trash state destroys the window. |
| INF-STKY-09 | E `stickies.spec › restore open stickies on startup`: a fresh profile has no settings row and floats nothing on relaunch. Turn on "Restore open stickies on startup" (DB setting true), float A and B, collapse B, quit: both rows have `open=1`. Relaunch: two sticky windows for A and B, B collapsed, the content equals the DB, and the main window is the focused one (W) or the first page. Turn the setting off and relaunch: no sticky windows, and every row has `open=0`. I `sticky-manager.test › restoreOnStartup only when enabled; trashed rows closed`. |
| INF-STKY-10 | E `stickies.spec › stickies page`: stickies in Common and in "Alpha › Plans" are listed with color dots and paths; "Float <title>" opens that note's window; "Open <title>" opens a tab; New sticky on the page creates a sticky at the Common root (D-047), opens its window and opens no tab. |
| INF-STKY-11 | E `stickies.spec › reopen cycles leave one window and no extra listeners`: record the baseline `hooks.listenerCounts()`; float and hide the same note 5 times, float 3 times without hiding, and close the main window to background and recreate it 3 times (second launch). After each cycle: exactly one sticky per floated note, one main window, `getAllWebContents()` back to baseline, every listener count equal to the baseline. U `sticky-services.test › dispose unsubscribes everything` (fake bridge subscription count 0). |
| INF-STKY-12 | E `lifecycle.spec › main window to background keeps stickies usable`: float A; close the main window with queued `{background, remember:false}`. The main window is gone, the process is alive, and A is visible; typing in A saves to the DB. E `lifecycle.spec › quit flushes every window`: the main window and two stickies have unsaved typing; Quit (sticky menu "Quit Infinity Notes"; on W also the tray item); the log has `flush: requested=3 acked=3 timedOut=0`; the process exits; all three texts are in the DB; both rows keep `open=1`. N: background running from the real tray on Windows is pending (Phase 09). |
| INF-STKY-13 | U `capabilities.test`: WSLg gives positioning and always-on-top `unsupported`; tray `present`, `absent` and `unknown` map to supported, unsupported and unknown; Windows tray is supported; the override parser (valid, invalid JSON, unknown keys ignored). U `boundaries.test › no code forces an ozone platform` (no `appendSwitch('ozone-platform'`, `--ozone-platform` or `enable-features=UseOzonePlatform` in `src/`). E `stickies.spec › unsupported pin is shown as unavailable` (L real; W with the override): `aria-disabled=true`, title "Not supported by this desktop", activation changes nothing, a bridge `setPinned` call gives `UNSUPPORTED`, DB `always_on_top=0`. E: main.log has the `capabilities ...` line. N: WSLg native observation of the fallback is recorded in this phase's report as observed behavior, not as a native-matrix pass. GNOME and X11 are `outside_validation_scope`. |
| INF-DESK-01 | U `close-dialog.test`: exact message, detail, buttons, `defaultId`, `cancelId`, checkbox; the Linux or no-tray sentence present only then. E `lifecycle.spec › first close asks; choice is remembered and editable`: on a fresh profile, closing the main window records one dialog with the exact copy. Cancel keeps the window. `{background, remember:false}` closes the window, keeps the process and writes no settings row; a second launch recreates the window and the next close asks again. `{background, remember:true}` stores `app.closeBehavior='background'`; the next close shows no dialog. In Settings choose "Ask" and the value becomes `'ask'`. `{quit, remember:true}` makes the process exit; relaunch and close: no dialog, the process exits. On L (and on W with the tray override `unsupported`) the detail contains "If no tray icon appears, launching Infinity Notes again brings this window back." |
| INF-DESK-02 | U `tray-probe.test`: `(true,)`, `(false,)`, `boolean true`, `boolean false`, an empty string and an error give the expected statuses. E `lifecycle.spec › tray menu` (W, tray supported): `hooks.tray.present` is true and `items()` are exactly ["Open Infinity Notes", "New sticky", "Quit Infinity Notes"]; "New sticky" creates a yellow sticky at the Common root and opens its window; close to background, then "Open Infinity Notes" recreates and shows the main window; "Quit Infinity Notes" ends the process after the flush. E `lifecycle.spec › without a tray host a second launch brings the window back` (L real; W with the override `unsupported`): `tray.present` is false, capability tray `unsupported` (`no-status-notifier-host` on L); close to background; a second launch exits 0 and recreates the main window (2 windows with the sticky, 1 without). N: real tray clicks on Windows are pending (Phase 09). "Show widget" is planned with W05-03 (Phase 05). |

Security additions (INF-FND-03 and INF-FND-04 remain `done` and gain cases): E `security.spec › sticky windows are hardened`: the sticky's `getLastWebPreferences()` equals the main window's hardened set; the sticky renderer is OS-sandboxed (`rendererSandbox` by URL); from the sticky page `window.infinity.session.set`, `tree.list`, `trash.purge` and `sticky.float` answer `FORBIDDEN`; `note.open` of another note answers `FORBIDDEN`; its own note is ok. I `ipc-validation.test › role allowlist and note ownership` covers every main-only channel group, both drafts union variants and the ownership rule.

### 12.2 Unit tests (Vitest `unit`; renderer tests use `// @vitest-environment jsdom`)

New: `routes`, `display-clamp`, `tray-probe`, `close-dialog`, `sticky-window-options` (`secureWebPreferences` deep-equal with the main window, removeMenu flag, min size, no x/y when absent, alwaysOnTop only when allowed), `contracts-phase04` (every new schema: valid, invalid, strict extra keys, `StickyState` limits, drafts ownership shape), `sticky-colors` (six colors, hex from UX_SPEC section 10), `renderer/state/sticky-services` (init take versus acquire, activation, trashed and restored transitions, flush-request ack, dispose), `renderer/sticky-header` (names, pin disabled with tooltip, collapse `aria-expanded`, menu items). Updated: `capabilities`, `contracts` and `contracts-phase02`/`03` (catalogue counts, `TreeChangedReasons`), `boundaries` (Phase 05 names; no forced ozone; sticky modules import no `electron` at runtime), `main-window-options`, `migrations-checksum` (LATEST 4), `renderer/state/note-controller` (9.5 cases), `renderer/state/tabs-store` (`openNote takeEdit`), `renderer/state/app-events` (`app:openNote`, getState handshake), `palette-actions`, `shortcuts`, `renderer/shell-smoke` (fake bridge gains `sticky`, `window`), `renderer/support/fake-bridge.ts`.

### 12.3 Integration tests (Vitest `integration`, real better-sqlite3, temporary DB)

New: `window-state` (as in the INF-STKY-06 row), `sticky-service` (enable is idempotent and does not touch revision or `updated_at`; color requires sticky; disable deletes the row; meta of a trashed note; `metaMany` path index), `sticky-manager` (fake factory and fake displays: float, focus, hide sequence order flush → reset → destroy → `open=0`, dock order before `openNote`, remove, trash, restore and purge via `onTreeChanged`, collapse and expand calls, pin unsupported, bounds debounce, Wayland nulls, display change, restore on startup, quit keeps `open=1`, the 50 limit, one display listener), `main-window-controller` (queue and drain, recreation, close policy for each setting value and dialog answer, remember semantics, quitting bypass), `ipc-handlers-phase04` (every new channel through `catalogueRouter` with sender roles; FORBIDDEN cases; response schemas validated). Updated: `migrations` (version 4), `ipc-validation` (sender info and roles), `ipc-helpers.ts` (`catalogueRouter` with role-aware registry: window 1 main, window 2 main, window 3 sticky for a given note), `trash` (purge cascades window state).

### 12.4 E2E (Playwright `_electron`, built app, `workers: 1`, `retries: 0`)

New `tests/e2e/sticky-ui.ts`: `mainPageOf(app)`, `stickyPage(app, noteId)` (waits for the window whose URL ends with `#/sticky/<id>`), `hooks(app)`, `floatFromTab(page)`, `stickyMenu(page, item)`, `queueClose(app, choice, remember)`, `browserWindowByUrl(app, suffix)` used inside `app.evaluate`. New `tests/e2e/stickies.spec.ts` (INF-STKY-01..11, 13) and `tests/e2e/lifecycle.spec.ts` (INF-STKY-12, INF-DESK-01, INF-DESK-02). Every step uses keyboard activation (D-050) unless pointer behavior is the subject. Every check of OS-reported geometry is limited to the hosts named in 12.1.

### 12.5 Existing specs to update (no assertion weakened)

- `fixtures.ts`: `setContentSize`, `setWindowSize` and `rendererSandbox(app, urlSuffix = '#/')` select the window by URL. `crash.spec`, `security.spec`, `smoke.spec`, `shell.spec` and `packaged.spec` replace `getAllWindows()[0]` with the URL-based helper (equal assertions).
- `editor.spec › flush on window close`: queue `{choice:'quit', remember:false}` before closing; additionally assert one recorded close dialog. Exit, flush log and text assertions unchanged.
- `keyboard.spec › ctrl+shift+n` and `tree.spec › sticky in folder`: instead of the tab icon, assert that the sticky window for the new note ID opened (`hooks.windows`) and that no tab opened. The DB scope, sticky and color assertions are unchanged. The tree and Stickies page assertions remain.
- `smoke.spec`: `schemaVersion` 4; new case `second instance recreates a main window closed to background`.
- `packaged.spec` (`@packaged`): `schemaVersion` 4; new case `packaged sticky window is sandboxed and test seams are ignored`. Launch with `INFINITY_NOTES_TEST_CAPS={"tray":"unsupported"}`; `capabilities.get` shows no `test-override` reason; float a sticky through the bridge; its URL is the renderer origin; its preferences are hardened; its renderer is OS-sandboxed; `__infinityTest` is absent.
- `security.spec › bridge surface`: the new namespaces `sticky` and `window`; the subscribe probe uses `reminder:changed`.
- `boundaries.test`, `contracts.test`, `ipc-validation.test`: Phase 05 names instead of Phase 04 names.
- `visual.spec`: new cases (12.6).

### 12.6 Visual (V evidence for review, no pixel diffs)

`INFINITY_SCREENSHOT_DIR` cases: `sticky-light`, `sticky-dark`, `sticky-collapsed`, `sticky-color-menu`, `sticky-read-only-banner`, `sticky-trash-state`, `sticky-pin-unsupported` (override), `stickies-page`, `settings-windows-and-tray`, `tab-float-button`. Windows to `screens/win`, WSLg to `screens/wslg`. The Phase 03 set is regenerated in the same run.

### 12.7 Native cases (recorded, not run as passes in this phase)

Pending for the Phase 09 native matrix:
- Windows 11: user-dragged move and resize of two stickies; real always-on-top over other applications; tray icon click and menu from the notification area; restored positions on a second physical monitor and monitor removal.
- WSLg: user-dragged move and resize under Weston; what the compositor does with pinned and collapsed windows (recorded observation only).

`outside_validation_scope`: GNOME Wayland pin and positioning behavior, X11 restored bounds and always-on-top, and a StatusNotifier tray on GNOME.

## 13. Commands, hosts and logs

Every log goes to `.infinity-work/logs/phase-04/`, starts with the command, date and `pwd`, and ends with `EXIT=<code>`. Prefix by step: `S1-` … `S8-`, `wsl-`, `final-`.

### 13.1 Windows (Git Bash, repository root)

```
export INFINITY_E2E_NODE='E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe'
node tools/gen-migration-checksums.mjs                 # S1 only, after writing 004 (S1-checksums.log)
npm run check                                          # S<n>-check.log
npm run build                                          # S<n>-build.log
npm run test:e2e                                       # S<n>-test-e2e.log
npm run test:e2e -- tests/e2e/<spec>.ts                # focused runs while repairing (never a gate alone)
INFINITY_SCREENSHOT_DIR="$PWD/.infinity-work/logs/phase-04/screens/win" npm run test:e2e -- tests/e2e/visual.spec.ts
node tools/dev-smoke.mjs                               # S6-dev-smoke.log
npm run package:current; npm run verify:native -- --packaged; npm run test:e2e:packaged
git diff --exit-code package.json package-lock.json    # S6-deps-unchanged.log
node tools/check-traceability.mjs --repo .             # S8-traceability.log
```

Windows E2E shows a tray icon briefly per launch; this is expected. A 0xC0000409 worker crash while `INFINITY_E2E_NODE` is set is a real failure.

### 13.2 WSL (user `infinity`, D-039; `MSYS_NO_PATHCONV=1`; multi-command runs in a script file, as `.infinity-work/wsl-leg.sh` did for Phase 03 with `L=.../phase-04`)

```
wsl -d Ubuntu -u infinity -- bash -lc '<cmd>'
# env: lsb_release -ds; uname -r; node -v; npm -v; cat /mnt/wslg/versions.txt; WAYLAND_DISPLAY/DISPLAY/XDG_SESSION_TYPE; gdbus NameHasOwner result   (wsl-env.log)
rsync -a --delete --exclude=node_modules/ --exclude=out/ --exclude=release/ --exclude=.git/ --exclude=.infinity-work/ --exclude=test-results/ --exclude=playwright-report/ --exclude=coverage/ /mnt/e/notecapt/ ~/infinity-notes/ ; diff -rq (MIRROR_IDENTICAL)   # wsl-sync.log
cd ~/infinity-notes && export WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0
npm ci && npm run setup:electron                       # only if dependencies changed (they must not)
npm run check; npm run build                           # wsl-check.log, wsl-build.log
npm run test:e2e                                       # wsl-test-e2e-wslg.log (record ozone and the capabilities line)
env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e     # wsl-test-e2e-xvfb.log
INFINITY_SCREENSHOT_DIR=/mnt/e/notecapt/.infinity-work/logs/phase-04/screens/wslg npm run test:e2e -- tests/e2e/visual.spec.ts
INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e   # wsl-test-e2e-wayland.log (informational, D-050)
npm run package:linux && npm run test:e2e:packaged     # wsl-package-linux.log, wsl-test-e2e-packaged.log
```

Rules: never share `node_modules`; never root; never `--no-sandbox`; no apt installs; no tray or notification daemon is installed; label results "WSLg 1.0.73 (Weston), ozone <value>" or "Xvfb", never GNOME or an X11 session. A WSLg launch or XWayland flake is recorded as its own run with the error, never retried away. An environment failure is recorded as pending with the exact error; a code defect is fixed.

## 14. Work order, gates and checkpoints

After each step: run the gate, save the logs, and append `Checkpoint S<n> done <date> — gates: <log names>` plus a short file list to `docs/progress/phase-04.md`. A resumed implementer reads that file, re-reads the files of the last checkpoint and continues at the first missing checkpoint.

| Step | Work | Gate |
| --- | --- | --- |
| S1 Data and pure modules | Migration 004 + checksums + LATEST 4 (all hard-coded version tests, including E2E smoke and packaged); `window-state-repo`, `sticky-service` (+ `main-services`), `display-clamp`, `tray-probe`, `close-dialog` options, `capabilities` (tray input, override), settings keys, `shared/sticky-colors`, `shared/routes`; unit and integration tests of 12.2 and 12.3 for these | `npm run check`; `npm run build`; `npm run test:e2e -- tests/e2e/smoke.spec.ts tests/e2e/migration-failure.spec.ts` |
| S2 Electron-free cores | Registry roles, `SenderInfo` policy, router allowlist and ownership, `channel-roles` (existing channel names only; the `sticky:*` and `window:getState` entries are added in S3 together with their catalogue names), `StickyManager` and `MainWindowController` (events sent through injected callbacks until S3 adds the event names), display provider interface and fake; tests `sticky-manager`, `main-window-controller`, `ipc-validation` roles, `ipc-helpers` | `npm run check` |
| S3 IPC and Electron wiring | Channel names, schemas, bridge, preload, handlers, register-handlers, event bus; `secure-window`, `sticky-window` factory, Electron display provider, `tray`, dialog adapter, `window-lifecycle`, `desktop.ts`, `index.ts`, `single-instance`, test hooks and env seams; `contracts-phase04`, `boundaries`, `sticky-window-options`, `ipc-handlers-phase04`; fixture window selection; `security.spec` surface; `editor.spec` close-dialog queue. The renderer ignores the new events for now | `npm run check`; `npm run build`; full `npm run test:e2e` green |
| S4 Renderer | Routes, `core-services`, `app-services` handshake and `app:openNote`, `tabs-store takeEdit`, `NoteController` additions, sticky services and components, `NoteView` Float, commands, palette, tree, Stickies page, Settings section, `Notices` refactor, `stickies.css`; unit tests; `keyboard.spec` and `tree.spec` updates | `npm run check`; `npm run build`; full `npm run test:e2e` green |
| S5 New E2E and visual | `sticky-ui.ts`, `stickies.spec`, `lifecycle.spec`, `security.spec` sticky cases, `smoke.spec` second-instance case, visual cases; repairs with regression tests | Full `npm run test:e2e` green on Windows; Windows screenshots |
| S6 Windows release gates | dev smoke, package, verify native, packaged E2E (including the new `@packaged` case), deps unchanged | All exit 0 |
| S7 WSL leg | Section 13.2 | check, build, WSLg and Xvfb E2E green; visual WSLg; forced Wayland informational; packaged Linux E2E |
| S8 Report | BACKLOG and the progress report (section 15), traceability | `node tools/check-traceability.mjs --repo .` exit 0 |

## 15. Progress report and BACKLOG

### 15.1 `docs/progress/phase-04.md` must contain

1. Summary, date, agent role and model, and the checkpoint lines S1 to S8.
2. Hosts: Windows OS, Node, E2E runner Node 24.21; WSL Ubuntu, kernel, Node, WSLg version, Weston hash; the observed ozone and the capabilities line for WSLg, Xvfb and forced Wayland; the tray-host probe result.
3. Changed, created and deleted files by area, one line each.
4. IPC catalogue as implemented (channels, events, role allowlist). Any difference from section 6 needs a decision entry.
5. Command table: command, host, exit code, duration and log path for every log in section 13.
6. Requirement coverage: one row per ID (15 rows) with the assertions run (file › case), W and L results, screenshot paths for visual evidence and the BACKLOG status set.
7. Lease-transfer evidence: revisions per step and `note_drafts` counts from the INF-STKY-07 case.
8. Native observations on this host and WSLg: what was seen (independent windows, collapse sizes, pin capability, tray host absent), labeled as observations, and the 12.7 pending list.
9. Decisions added after planning (D-072 onward) or "none"; deviations with reasons.
10. Issues found and fixed: severity, reproduction, expected, actual, regression test.
11. Not run or pending: 12.7; forced-Wayland informational failures with counts; GNOME and X11 outside scope.
12. Known limitations: positions are not restored under Wayland or WSLg (size, collapse and pin only); the process keeps running invisibly in background mode on desktops without a tray host until relaunch or Quit from a sticky; hidden stickies are closed windows, so reopening takes a window start; at most 50 open stickies.

### 15.2 BACKLOG (Status and Planned tests columns only)

Set `done` for INF-STKY-01, 03, 04, 05, 07, 08, 09, 10, 11 and INF-DESK-01 when every assertion in their 12.1 rows passed on W and L. INF-STKY-02, 06, 12, 13 and INF-DESK-02 have an N part: set them to `in_progress` with the E/I/U parts passing and the native part named as pending for Phase 09 (the same pattern as INF-FND-02). Keep the Planned tests text in sync with the final case names. Traceability must exit 0.

## 16. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R4-01 | Tests pick the wrong window (`getAllWindows()` is not in creation order) | URL-based helpers everywhere (12.5); hooks report windows by role |
| R4-02 | A native close dialog blocks an E2E run | The hooked adapter never shows a dialog, and an empty queue means cancel. `app.close()` uses `app.quit()`, which bypasses the dialog |
| R4-03 | Tray detection is slow or the tools are missing | 2000 ms bound; `unknown` creates no tray; fallback copy; the probe shows `gdbus` answers instantly on WSLg |
| R4-04 | Lease races between auto-acquire, take and dock | `busy` guard; dock destroys the sticky (leases reset) before opening the tab; unit and E2E cases in 12.1 |
| R4-05 | X11 window managers shift restored positions by the frame (probe: +6, +27 under WSLg XWayland) | Positioning is unsupported under WSLg; X11 desktops are outside scope; recorded |
| R4-06 | A Windows `display-removed` during monitor sleep moves stickies | Only unreachable windows are re-clamped (8.6 step 3) |
| R4-07 | A background process without a tray is invisible | Dialog and Settings copy; relaunch recreates the window; the sticky menu has Quit |
| R4-08 | Each sticky is a renderer process (memory) | Hidden stickies are destroyed; 50-window limit; Phase 09 measures 10 stickies (INF-PERF-05) |
| R4-09 | Test seams leak into production | Gated by `testHooksEnabled`; the packaged case asserts the overrides are ignored and the hooks are absent |
| R4-10 | Forced-Wayland informational run fails more (new windows, no frame callbacks) | Informational only (D-050); counts recorded |
| R4-11 | Close or logoff ordering loses the final bounds | `prepareQuit` saves before the flush; `session-end`/`shutdown` save synchronously |
| R4-12 | A WSLg XWayland launch flake with several windows | Separate run records, no retries |

## 17. Out of scope for Phase 04

- The reminder widget, its tray item "Show widget", notifications and `app:openNote` from notification clicks (Phase 05).
- Launch at login, the global quick-sticky shortcut, keyboard help and the full Settings screens (Phase 08).
- Main-window bounds persistence (the `main` key is reserved; nothing writes it in Phase 04).
- Custom frameless sticky windows and drag regions (D-028 stays).
- Native matrix runs and performance measurement with 10 stickies (Phase 09).

Never, in any phase: publishing, pushing, signing, apt installs, running as root, `--no-sandbox`, forcing an ozone platform.

## 18. Planner status

```json
{"status":"ready","evidence":["docs/plans/phase-04.md","docs/DECISIONS.md (D-062..D-071)","docs/ARCHITECTURE.md (sections 3, 4, 5, 14, 15)","docs/UX_SPEC.md (sections 5, 6, 7)","docs/BACKLOG.md (Phase 04 planned tests, W04-01, W04-02, W05-03)",".infinity-work/logs/phase-04/planner-probe-windows-win.log",".infinity-work/logs/phase-04/planner-probe-windows-wslg.log",".infinity-work/logs/phase-04/planner-probe-windows-xvfb.log",".infinity-work/logs/phase-04/planner-probe-windows-wayland.log",".infinity-work/logs/phase-04/planner-probe-tray-detect-wsl.log",".infinity-work/logs/phase-04/planner-probe-events-win.log",".infinity-work/logs/phase-04/planner-probe-events-wsl.log",".infinity-work/logs/phase-04/planner-probe-multiwin-win.log",".infinity-work/logs/phase-04/planner-probe-multiwin-wsl.log"],"blockers":[]}
```

# Phase 04 progress: Real floating sticky windows

Implementer: infinity-code-opus (Opus 5.5, high). Plan: `docs/plans/phase-04.md`. Logs: `.infinity-work/logs/phase-04/`.

## Checkpoints

- Checkpoint S1 done 2026-10-09 — gates: S1-checksums.log, S1-check.log, S1-build.log, S1-test-e2e.log (all EXIT=0). Files: migration 004 + index/checksums; `window-state-repo.ts`; `sticky-service.ts` (+ `main-services.ts`, `hierarchy-repo.ts` setSticky/setColor); `display-clamp.ts`; `tray-probe.ts`; `close-dialog.ts`; `capabilities.ts` (tray, override) + `index.ts` probe/once-computed capabilities; shared `contracts/stickies.ts`, `contracts/windows.ts`, `settings.ts` keys, `hierarchy.ts` reason `sticky`, `sticky-colors.ts`, `routes.ts`; tests `unit/{routes,sticky-colors,tray-probe,close-dialog,display-clamp,capabilities,migrations-checksum,contracts-phase02}`, `integration/{window-state,sticky-service,migrations}`, E2E schemaVersion 4.
- Checkpoint S2 done 2026-10-09 — gate: S2-check.log (EXIT=0). Files: `window-registry.ts` (roles, `info`, `stickyFor`), `sender-policy.ts` (returns `SenderInfo`), `router.ts` (role allowlist, sticky note ownership, `HandlerContext.sender`), shared `contracts/channel-roles.ts`, `display-provider.ts`, `sticky-manager.ts`, `main-window-controller.ts`; interim registry adaptation in `main-window.ts`/`single-instance.ts` (rewritten in S3); tests `integration/{sticky-fakes,sticky-manager,main-window-controller,ipc-validation,ipc-helpers,hierarchy-helpers}`.
- Checkpoint S3 done 2026-10-09 — gates: S3-check.log, S3-build.log, S3-test-e2e.log (114 passed, 1 Linux-only skip; all EXIT=0). Files: shared `channel-names.ts` (+9 invoke, +2 events), `channels.ts`, `bridge.ts`, `channel-roles.ts` (sticky entries), preload; `ipc/handlers/{sticky,window}-handlers.ts`, `register-handlers.ts` (`desktop` dep); `windows/{secure-window,sticky-window,main-window,electron-inspector}.ts`, `tray.ts`, `dialog-adapter.ts` (close choice), `window-lifecycle.ts` (per-window hooks, session end), `desktop.ts`, `index.ts`, `single-instance.ts`, `test-hooks.ts` (close queue, windows, stickyLog, listener counts, fake displays, tray), `attachment-service.ts`/`main-services.ts` (dialog `Pick`); tests `unit/{contracts,contracts-phase04,boundaries,sticky-window-options,main-window-options}`, `integration/{ipc-handlers-phase04,ipc-helpers,ipc-validation,main-window-controller}`, renderer fake bridge, E2E fixtures/specs select windows by URL, `security.spec` surface, `editor.spec` close-dialog queue.
- Checkpoint S4 done 2026-10-09 — gates: S4-check.log, S4-build.log, S4-test-e2e.log (114 passed, 1 Linux-only skip; all EXIT=0). Files: `App.tsx` (routes), `state/core-services.ts`, `state/app-services.ts` (core, `window:getState` handshake, `app:openNote`), `state/window-settings-store.ts`, `state/tabs-store.ts` (`openNote takeEdit`), `state/commands.ts` (`note.float`, floating `sticky.new`, `float`/`newSticky`), `state/palette-actions.ts`, `state/notice-store.ts` (`restoreNotice`), `state/tree-store.ts`, `notes/note-controller.ts` (open mode, `ensureEditing`, auto-acquire, `handleTrashed`, `reopen`), `notes/{NoteDialogs,NoteTitleInput}.tsx` (extracted from `NoteView`), `notes/NoteView.tsx` (Float button), `tree/{actions.ts,TreeContextMenu.tsx}`, `pages/{StickiesPage,SettingsPage}.tsx`, `shell/Notices.tsx` (`NoticeList`), `ui/{Menu,ConfirmDialog,DialogHost}.tsx`, `stickies/{sticky-services.ts,sticky-context.ts,StickyApp,StickyView,StickyHeader,ColorMenu,StickyTrashState}.tsx`, `styles/{stickies,components}.css`, `main.tsx`; tests `unit/renderer/{sticky-header.test.tsx,state/sticky-services,state/note-controller,state/tabs-store,state/app-events,state/tree-commands}`, `unit/palette-actions`, fake bridge, E2E `keyboard.spec`/`tree.spec` (sticky window instead of tab), `tests/e2e/sticky-ui.ts`.
- Checkpoint S5 done 2026-10-09 — gates: S5-test-e2e.log (143 passed, 1 Linux-only skip; EXIT=0), S5-visual-win.log (16 passed; screenshots in `.infinity-work/logs/phase-04/screens/win/`). Files: new `tests/e2e/{stickies,lifecycle}.spec.ts`; `sticky-ui.ts` (`pressClosing`); `security.spec` (sticky hardening), `smoke.spec` (second instance recreates the main window), `packaged.spec` (packaged sticky case), `visual.spec` (10 Phase 04 screenshots); `SettingsPage.tsx` visible caption.
- Checkpoint S6 done 2026-10-09 — gates: S6-dev-smoke.log, S6-package-current.log (NSIS sha256 09c9c40e…327d), S6-verify-native.log, S6-test-e2e-packaged.log (3 passed, sticky renderer `sandboxed=true integrity=untrusted`), S6-deps-unchanged.log (all EXIT=0). Defect found by the dev smoke and fixed: the main window's `did-start-loading` fired synchronously inside `loadURL()` during window creation, before the controller stored the window state (uncaught `ReferenceError`). Window creation and loading are now separate (`MainWindowHandle.load()`); `tests/e2e/harness.ts` gains `failOnMainErrors` (used by `stickies.spec`/`lifecycle.spec`).
- Checkpoint S7 done 2026-10-09 — gates: wsl-env.log, wsl-sync.log (MIRROR_IDENTICAL), wsl-check.log, wsl-build.log, wsl-test-e2e-wslg.log (142 passed, 2 Windows-only skips), then the full final WSL leg `final-wsl-*.log` (section 5). Script: `.infinity-work/wsl-leg-p04.sh`.
- Checkpoint S8 done 2026-10-09 — BACKLOG statuses and planned tests updated (section 6); traceability in `final-check.log` (fails=0). Final gates in section 5.

## 1. Summary

Phase 04 adds real floating sticky windows, the main-window close policy and the tray, following `docs/plans/phase-04.md` (steps S1–S8, decisions D-062 to D-071) without dependency changes.

- Each sticky is a native, sandboxed `BrowserWindow` keyed by note ID (`StickyManager`), loading `#/sticky/<id>` with the shared `NoteEditor`. A second Float focuses the existing window and takes edit control (activation counter).
- Hide (OS close, Hide, Ctrl+W) flushes with acknowledgment, stores `open = 0`, resets leases and destroys the window; Dock and Remove do the same and then open the note in a tab with edit control; a read-only mirror acquires the lease by itself when the holder goes away.
- Trash shows a recoverable trash state (pending edits become a trashed-conflict draft); Restore brings the editor back; purge closes the window.
- Header: color (6 presets, light/dark palettes), title, source badge (live path), pin (always-on-top, inert with "Not supported by this desktop" where unsupported), collapse (36 px content, not resizable), actions menu.
- Bounds are debounced 500 ms into `window_state` (migration 004); restore and display changes go through the pure `computeStickyBounds`; positions are stored as null where positioning is unsupported (Wayland/WSLg).
- Main window close asks Keep running / Quit / Cancel (remembered, editable in Settings > Windows and tray); background mode keeps stickies and the process alive; a second launch, the tray and Dock recreate the main window. Windows always has a tray; Linux creates one only when `gdbus` finds a StatusNotifier host.
- IPC: 9 invoke channels and 2 events; a sticky window may call only its allowlist and only about its own note (registry, not URL, is the authority).

Intentional behavior changes from the plan: New sticky floats instead of opening a tab (D-069; `keyboard.spec`, `tree.spec` assert the sticky window and no tab, same scope/sticky/color checks); closing the main window asks first (D-066; `editor.spec › flush on window close` queues Quit and additionally asserts the dialog and that no setting row was written).

## 2. Hosts

| Host | Details |
| --- | --- |
| Windows | Windows 11 Pro 10.0.26300.9457; Node 24.15.0 (tools); Playwright runner/workers Node 24.21.0 via `INFINITY_E2E_NODE`; Electron 44.7.0 (Chrome 152.0.7977.130); display 2560x1440. Capabilities line: `positioning=supported alwaysOnTop=supported tray=supported(native-windows) session=windows ozone=unset`. |
| WSL | Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, npm 11.19.0, WSLg 1.0.73 (Weston 2318fecaeac1f1a2d5a7a042c34d931c71dae04c), user `infinity`, mirror `~/infinity-notes` (`MIRROR_IDENTICAL`), own `node_modules`, sandbox on. |
| WSLg run | `WAYLAND_DISPLAY` and `DISPLAY=:0` set, `XDG_SESSION_TYPE` unset; observed ozone x11 (XWayland). Capabilities line: `positioning=unsupported alwaysOnTop=unsupported tray=unsupported(no-status-notifier-host) session=x11 ozone=x11`. |
| Xvfb run | `env -u WAYLAND_DISPLAY -u DISPLAY` + `xvfb-run`; same capabilities line (WSL environment). |
| Forced Wayland | `--ozone-platform=wayland` via `INFINITY_NOTES_E2E_ELECTRON_ARGS` only (informational, D-050). |
| Tray-host probe | `gdbus ... NameHasOwner org.kde.StatusNotifierWatcher` on `unix:path=/run/user/1001/bus` answers `(false,)`: no StatusNotifier host in WSLg (`final-wsl-env.log`). |

These results are WSLg/Weston and Xvfb, not GNOME or an X11 desktop session.

## 3. Changed files

Shared: `contracts/stickies.ts` (C), `contracts/windows.ts` (C), `contracts/channel-roles.ts` (C), `contracts/channel-names.ts`, `contracts/channels.ts`, `contracts/bridge.ts`, `contracts/settings.ts` (`app.closeBehavior`, `stickies.restoreOnStartup`), `contracts/hierarchy.ts` (reason `sticky`), `sticky-colors.ts` (C), `routes.ts` (C).

Main: `db/migrations/004_window_state.sql` (C), `db/migrations/index.ts`, `checksums.json`, `db/repositories/window-state-repo.ts` (C), `db/repositories/hierarchy-repo.ts` (sticky flag/color writes), `services/sticky-service.ts` (C), `services/tray-probe.ts` (C), `services/close-dialog.ts` (C), `services/capabilities.ts` (tray input, test override), `services/dialog-adapter.ts` (close choice), `services/attachment-service.ts` (dialog `Pick`), `main-services.ts`, `windows/window-registry.ts` (roles), `windows/secure-window.ts` (C), `windows/main-window.ts` (factory), `windows/main-window-controller.ts` (C), `windows/sticky-manager.ts` (C), `windows/sticky-window.ts` (C), `windows/display-clamp.ts` (C), `windows/display-provider.ts` (C), `windows/electron-inspector.ts` (C, E2E hooks only), `tray.ts` (C), `desktop.ts` (C), `window-lifecycle.ts`, `index.ts`, `single-instance.ts`, `test-hooks.ts`, `ipc/sender-policy.ts`, `ipc/router.ts`, `ipc/register-handlers.ts`, `ipc/handlers/sticky-handlers.ts` (C), `ipc/handlers/window-handlers.ts` (C).

Preload: `preload/index.ts` (`sticky`, `window` namespaces).

Renderer: `App.tsx` (routes), `main.tsx`, `state/core-services.ts` (C), `state/app-services.ts`, `state/window-settings-store.ts` (C), `state/commands.ts`, `state/palette-actions.ts`, `state/tabs-store.ts`, `state/tree-store.ts`, `state/notice-store.ts`, `notes/note-controller.ts`, `notes/NoteView.tsx`, `notes/NoteDialogs.tsx` (C, extracted), `notes/NoteTitleInput.tsx` (C, extracted), `tree/actions.ts`, `tree/TreeContextMenu.tsx`, `pages/StickiesPage.tsx`, `pages/SettingsPage.tsx`, `shell/Notices.tsx`, `ui/Menu.tsx` (separators), `ui/ConfirmDialog.tsx` (`ConfirmRunner`, trash copy), `ui/DialogHost.tsx`, `stickies/{sticky-services.ts,sticky-context.ts,StickyApp.tsx,StickyView.tsx,StickyHeader.tsx,ColorMenu.tsx,StickyTrashState.tsx}` (C), `styles/stickies.css` (C), `styles/components.css`.

Tests (C = new): unit `routes`, `sticky-colors`, `tray-probe`, `close-dialog`, `display-clamp`, `contracts-phase04`, `sticky-window-options`, `window-lifecycle` (C); `capabilities`, `contracts`, `contracts-phase02`, `boundaries`, `main-window-options`, `migrations-checksum`, `palette-actions`; renderer `sticky-header.test.tsx`, `state/sticky-services` (C), `state/note-controller`, `state/tabs-store`, `state/app-events`, `state/tree-commands`, `support/fake-bridge.ts`. Integration `window-state`, `sticky-service`, `sticky-manager`, `main-window-controller`, `ipc-handlers-phase04`, `sticky-fakes.ts` (C); `migrations`, `ipc-validation`, `ipc-helpers.ts`, `hierarchy-helpers.ts`. E2E `stickies.spec`, `lifecycle.spec`, `sticky-ui.ts` (C); `fixtures.ts`, `harness.ts` (`failOnMainErrors`), `crash`, `security`, `smoke`, `shell`, `packaged`, `editor`, `keyboard`, `tree`, `visual` specs.

Docs: this report, `docs/BACKLOG.md` (Phase 04 statuses and planned tests; INF-FND-03/04 gain the sticky cases). No deleted files. `package.json`/`package-lock.json` unchanged.

## 4. IPC catalogue as implemented

Invoke (appended in plan order, 50 total): `sticky:float`, `sticky:dock`, `sticky:hide`, `sticky:setColor`, `sticky:setPinned`, `sticky:setCollapsed`, `sticky:remove`, `sticky:restore`, `window:getState`. Events (8 total): `sticky:state` (sent to that sticky window only), `app:openNote` (main window only). `note:trashed` was not added. Sticky allowlist = plan 6.4 exactly (28 channels, asserted in `integration/ipc-validation.test`); `sticky:float` and every tree/trash/session/settings-write/creation/move channel are main-only; a sticky request with `noteId` must name its own note. No difference from plan section 6.

## 5. Commands, exit codes and logs

All logs are in `.infinity-work/logs/phase-04/`; each starts with the command, date and directory and ends with `DURATION` and `EXIT`. Step logs S1–S6 and `wsl-*` are listed in the checkpoints. Final gates postdate the last source and test change (WSL mirror `MIRROR_IDENTICAL` before its run).

| Command | Host | Exit | Duration | Result | Log |
| --- | --- | --- | --- | --- | --- |
| `npm run check` | Windows | 0 | 21 s | lint, typecheck, 441 unit, 239 integration + 1 skip (Windows file symlink), traceability ids=187 fails=0 | final-check.log |
| `npm run build` | Windows | 0 | 4 s | | final-build.log |
| `npm run test:e2e` | Windows | 0 | 224 s | 143 passed, 1 Linux-only skip | final-test-e2e.log |
| `npm run package:current` | Windows | 0 | 29 s | `Infinity-Notes-Setup-0.1.0-x64-unsigned.exe` sha256 dc8cd9c8…a2bcb | final-package-current.log |
| `npm run verify:native -- --packaged` | Windows | 0 | 1 s | | final-verify-native.log |
| `npm run test:e2e:packaged` | Windows | 0 | 4 s | 3 passed; sticky renderer `sandboxed=true integrity=untrusted` | final-test-e2e-packaged.log |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | | unchanged | final-deps-unchanged.log |
| env probe | WSL | 0 | | section 2 | final-wsl-env.log |
| rsync + `diff -rq` | WSL | 0 | 1 s | MIRROR_IDENTICAL | final-wsl-sync.log |
| `npm run check` | WSL | 0 | 19 s | 441 unit, 240 integration, traceability fails=0 | final-wsl-check.log |
| `npm run build` | WSL | 0 | 4 s | | final-wsl-build.log |
| `npm run test:e2e` (WSLg, ozone x11) | WSL | 0 | 207 s | 142 passed, 2 Windows-only skips (tray cases) | final-wsl-test-e2e-wslg.log |
| `env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e` (Xvfb) | WSL | 0 | 203 s | 142 passed, 2 Windows-only skips | final-wsl-test-e2e-xvfb.log |
| visual (WSLg) | WSL | 0 | 22 s | 16 passed; `screens/wslg/` | final-wsl-visual-wslg.log |
| forced Wayland (informational, D-050) | WSL | 1 | 1912 s | 78 passed, 64 failed, 2 skipped; failures are `locator.click` (41), `page.screenshot` (22) and visibility timeouts from missing frame callbacks under WSLg, spread over editor 16, visual 16, paste 10, shell 4, conflict 4, note-live 3, tabs 3, crash 2, stickies 1, lifecycle 1, and one each in editor-flow, home, smoke, migration-failure | final-wsl-test-e2e-wayland.log |
| `npm run package:linux` | WSL | 0 | 26 s | `.deb` sha256 64261bc1…08f4, AppImage sha256 e571a88d…1b88 | final-wsl-package-linux.log |
| `npm run test:e2e:packaged` | WSL | 0 | 3 s | 3 passed; packaged sticky renderer `ownUserNamespace=true ownPidNamespace=true Seccomp=2` | final-wsl-test-e2e-packaged.log |

No electron process was left on either host after the runs (Windows `tasklist`: 0; WSL `pgrep -c electron`: 0).

## 6. Requirement coverage

W = Windows 11; L = WSLg (ozone x11) and Xvfb. All E cases below passed on W (`final-test-e2e.log`) and on both L runs (`final-wsl-test-e2e-wslg.log`, `final-wsl-test-e2e-xvfb.log`) unless marked W-only.

| ID | Assertions run (file › case) | W | L | BACKLOG |
| --- | --- | --- | --- | --- |
| INF-STKY-01 | E stickies.spec › float opens one native window for the same note id (URL `#/sticky/<id>`, one visible sticky entry, title/text, `sticky_enabled=1`, yellow, revision unchanged, `open=1`; Float again from tab, tree menu, palette → activation 4, 2 windows; NOT_FOUND / VALIDATION_FAILED / trashed NOT_FOUND create nothing). I sticky-manager.test › float twice creates once; › trashed and missing notes create nothing; › the 51st open sticky is refused. U routes.test | pass | pass | done |
| INF-STKY-02 | E stickies.spec › two stickies are independent windows (own text, different renderer PIDs and native handles, A1/B1 isolation in DB; A moved/resized outside the main window: W and Xvfb `getBounds()` exact and non-intersecting; stored size, x/y null on L; B unchanged). WSLg logged: set `{800,40,340,280}` → reported `{806,67,340,280}` | pass | pass | in_progress (N: user-dragged move/resize, Phase 09) |
| INF-STKY-03 | E stickies.spec › dock preserves content and edit control (window gone, `open=0`, flag kept, active tab editable ending " docked", no banner, drafts 0; variant with the main window closed to background recreates it). I sticky-manager.test › dock hides the window first and only then opens the tab | pass | pass | done |
| INF-STKY-04 | E stickies.spec › header controls (6 color radios; Blue → DB, `data-sticky-color`, Stickies page dot; badge Common → Alpha › Plans live in the same webContents; pin on W: `aria-pressed`, `isAlwaysOnTop()`, DB, unpin; collapse: `aria-expanded=false`, editor hidden, content height 36 on W/Xvfb, not resizable, DB; expand restores the height; exact menu items; Hide). U renderer/sticky-header.test, sticky-colors.test. V `screens/{win,wslg}/sticky-{light,dark,collapsed,color-menu}.png` | pass | pass (pin part W-only; WSLg collapsed contentSize `[320,36]` logged) | done |
| INF-STKY-05 | E stickies.spec › close hides; delete is separate (OS close → `flush: requested=1 acked=1`, note unchanged except the text, `open=0`; Float from the Stickies page reopens it with the text; Move to Trash Cancel/Confirm; trash state) | pass | pass | done |
| INF-STKY-06 | U display-clamp.test (inside, partly off, removed display + cascade, hint display, shrink, minimum, left monitor, size-only, 80 px strip rule). I window-state.test (v3→v4 with copy, CHECKs, invalid bounds warn once, purge cascade); sticky-manager.test › bounds debounce, null positions, display change re-clamps only unreachable windows, restored windows clamped/collapsed/pinned. E stickies.spec › bounds persist and are clamped to connected displays (W/Xvfb: display 2 row, clamp after removal inside display 1, applied and stored; all hosts: relaunch with display 2 removed → created bounds inside display 1, collapsed, pinned on W); › size only where positioning is unsupported | pass | pass (display-move part W/Xvfb only; logged on WSLg) | in_progress (N: real monitor removal, Phase 09) |
| INF-STKY-07 | E stickies.spec › edit control moves between tab and sticky without losing text; › a mirror becomes editable when the editing sticky closes. U note-controller.test (open take/acquire, ensureEditing, auto-acquire only for `lease` and not while busy, handleTrashed, reopen); tabs-store and app-events takeEdit. I ipc-handlers-phase04.test › a lease release request reaches a sticky holder | pass | pass | done |
| INF-STKY-08 | E stickies.spec › trashing a floating note shows a recoverable trash state (trashed from the tree while " pending" was unsaved: trash state without editor, 1 conflict draft holding " pending", recovered-draft notice; Restore → stored text and "Restored to Common"; Close window → `open=0`; Empty trash removes the row); › purging a note while its sticky shows the trash state closes the window. U sticky-services.test | pass | pass | done |
| INF-STKY-09 | E stickies.spec › restore open stickies on startup (fresh profile: no setting row, nothing restored, rows closed; switch on → both rows `open=1` at quit; relaunch → A and B, B collapsed, activation 0, main focused on W / first page on L; switch off → none, all rows `open=0`). I sticky-manager.test › restoreOnStartup only when enabled | pass | pass | done |
| INF-STKY-10 | E stickies.spec › stickies page (both scopes with dots and paths; Float opens the window; Open opens a tab; New sticky at the Common root floats without a tab) | pass | pass | done |
| INF-STKY-11 | E stickies.spec › reopen cycles leave one window and no extra listeners (5 float/hide, 3 floats, 3 background + second-launch cycles; listener counts and webContents back to baseline). U sticky-services.test › dispose; app-events › dispose. I sticky-manager.test › one display listener | pass | pass | done |
| INF-STKY-12 | E lifecycle.spec › main window to background keeps stickies usable; › quit flushes every window (`flush: requested=3 acked=3 timedOut=0`, all texts saved, rows `open=1`); › quit from the tray flushes every window (W). U window-lifecycle.test | pass | pass (tray case W-only) | in_progress (N: real tray background, Phase 09) |
| INF-STKY-13 | U capabilities.test; boundaries.test › no code forces an ozone platform. E stickies.spec › unsupported pin is shown as unavailable (L real capabilities, W override: `aria-disabled`, tooltip, no effect, bridge UNSUPPORTED, DB 0, capabilities line in main.log). V `sticky-pin-unsupported.png` | pass | pass | in_progress (N: WSLg observation in section 8) |
| INF-DESK-01 | U close-dialog.test. I main-window-controller.test. E lifecycle.spec › first close asks; choice is remembered and editable (exact copy, Cancel keeps the window, background without remember writes nothing and asks again, remember stores `background`, Settings "Ask", remembered quit exits and the next close quits); › the close question names the relaunch path where no tray is supported | pass | pass | done |
| INF-DESK-02 | U tray-probe.test. E lifecycle.spec › tray menu (W: present, exact items, New sticky at the Common root floats, Open recreates the main window, Quit flushes and exits); › without a tray host a second launch brings the window back (L real `no-status-notifier-host`, W override); smoke.spec › second instance recreates a main window closed to background | pass | pass (tray menu W-only) | in_progress (N: real tray clicks, Phase 09; Show widget with W05-03) |

Security (INF-FND-03/04 stay done and gain cases): security.spec › sticky windows are hardened (preferences equal to the main window's; OS-sandboxed renderer, W `sandboxed=true integrity=untrusted`, L `ownUserNamespace=true ownPidNamespace=true Seccomp=2`; `session.set`, `tree.list`, `trash.purge`, `sticky.float` and another note's `note.open` answer FORBIDDEN, the own note is ok); › bridge surface (`sticky`, `window` namespaces; `reminder:changed` refused); integration/ipc-validation.test › role allowlist and note ownership; packaged.spec › packaged sticky window is sandboxed and test seams are ignored.

## 7. Lease-transfer evidence (INF-STKY-07)

Steps: the tab types "one" and floats (the sticky takes control) → the sticky types " two" (the tab mirror reloads) → the tab takes control and types " three" (the sticky mirror reloads) → hide → float again, the sticky types " four", Open in app. DB revisions after each step: 1 < 2 < 3 < 4 on Windows, WSLg and Xvfb (`INF-STKY-07 revisions per step` lines in the E2E logs); `note_drafts` count 0 at the end on every host.

## 8. Native observations (observations, not native-matrix passes)

- Windows 11: two stickies are separate top-level windows with separate sandboxed renderer processes and native handles; programmatic bounds are honored exactly; collapse gives content height 36; always-on-top toggles; a tray icon appears during each E2E launch (expected).
- WSLg 1.0.73 (Weston, XWayland): windows are independent; `setBounds({800,40,340,280})` is reported as `{806,67,340,280}` (frame offset), so positions are not restored (capability `unsupported`, stored x/y null); collapse reports contentSize `[320,36]`; always-on-top is shown as unsupported; no StatusNotifier host (`(false,)`), so no tray is created and the close question and Settings name the relaunch path.
- Xvfb: geometry is honored exactly (positions are still stored as null because the WSL environment reports positioning unsupported).
- Pending for the Phase 09 native matrix (plan 12.7): Windows 11 user-dragged move/resize of two stickies, real always-on-top over other applications, tray icon click and menu from the notification area, restored positions on a second physical monitor and monitor removal; WSLg user-dragged move/resize under Weston and compositor behavior with pinned and collapsed windows.
- `outside_validation_scope`: GNOME Wayland pin and positioning, X11 restored bounds and always-on-top, a StatusNotifier tray on GNOME.

## 9. Decisions and deviations

No new decisions (D-072 onward). Deviations, within the plan's intent:
- `StickyManager` takes no `registry` dependency: the Electron sticky window factory registers the window before `loadURL` and unregisters it on `closed`, as the main window factory does.
- `MainWindowHandle` has a separate `load()` (section 10).
- `restoreOnStartup()` runs after the first `did-finish-load` of the main window through `MainWindowController.onFirstLoad` (once per run).
- The hooks read native window state through a small adapter (`windows/electron-inspector.ts`), so `test-hooks.ts` stays electron-free.
- The display-move part of `› bounds persist and are clamped to connected displays` runs on Windows and Xvfb; on WSLg the window manager keeps windows on its own 640x480 screen, so that part is logged, not asserted (plan 12.4 limits OS geometry checks to the named hosts). The app-computed restore placement is asserted on every host.
- `NoteView`'s dialogs and title field were extracted into `NoteDialogs`/`NoteTitleInput` so tabs and stickies share them (no behavior change).

## 10. Issues found and fixed

| Severity | Issue | Reproduction | Expected | Actual | Regression test |
| --- | --- | --- | --- | --- | --- |
| Medium | The main window's `did-start-loading` fired synchronously inside `loadURL()` during window creation, before the controller stored the window state | `node tools/dev-smoke.mjs` (dev-server URL) | no main-process error | `uncaughtException ReferenceError: Cannot access 'state' before initialization` in main.log | creation and loading separated (`MainWindowHandle.load()` after the state exists); integration/main-window-controller.test fake emits `onLoadStarted` from `load()`; `S6-dev-smoke.log` clean; `harness.ts` `failOnMainErrors` fails stickies/lifecycle tests on any logged uncaught exception or unhandled rejection |
| Low (test) | Playwright `press` threw "Target page ... closed" when the action closed its own window (Hide, Open in app, Close window) | first stickies.spec run | the test continues to its assertions | test error | `sticky-ui.ts › pressClosing` |
| Low (test) | The relaunch part of the clamp case kept display 2 connected, so the off-screen row correctly went to display 2 | first stickies.spec run | relaunch with display 2 removed | wrong scenario | the case relaunches with display 1 only |

## 11. Not run or pending

- The native cases in section 8 (Phase 09 matrix).
- Forced Wayland (informational, D-050): see section 5.
- GNOME and X11 desktop sessions: outside the user-selected validation scope.

## 12. Known limitations

- Positions are not restored under Wayland or WSLg (size, collapse and pin only; pin is unsupported there).
- In background mode on desktops without a tray host the process keeps running invisibly until a relaunch or Quit from a sticky's menu.
- Hidden stickies are closed windows, so reopening takes a window start.
- At most 50 open stickies.

## Repair 1 (QA-1, QA-2; 2026-10-09)

Input: `docs/progress/phase-04-qa.md` (FAIL: QA-1 medium, QA-2 low) and QA's specs `.infinity-work/qa/p04-*.spec.ts` (not edited). Decision added: D-072 (`docs/DECISIONS.md`); copy added to `docs/UX_SPEC.md` section 6; `docs/ARCHITECTURE.md` section 6 updated (flush wait).

### QA-1: a sticky was destroyed after a failed or unfinished save

Cause: `StickyManager.hideEntry` ignored the flush outcome, the renderer acknowledged `app:flush-request` whatever its flush returned, the renderer's Dock/Remove continued after a failed flush, and main's 2000 ms wait was shorter than the renderer's own save retries (3 × 1 s), so 3 transient failures also lost the text.

Fix (D-072):
- `app:flush-request {flushId, reason: 'close'|'quit'}` and `app:flushed {flushId, saved}`. The renderer answers `saved` with the tab's existing rule (`textIsSafe`: saved, or main kept a draft on `CONFLICT`/`LEASE_REQUIRED`, or `NOT_FOUND`), now shared by `tabs-store` and the sticky. `FlushCoordinator` reports `unsaved` per window; the log line is `flush: requested=… acked=… timedOut=… unsaved=…`. The wait is 5000 ms per window (`SAVE_RETRIES × SAVE_RETRY_DELAY_MS + 2000`, shared constants), so a save that succeeds on a retry is not cut off.
- Single-window closes close only when the renderer answered `saved`: sticky Hide, Open in app, Remove from stickies and the OS close button (`StickyManager.hideEntry` keeps the window, logs `sticky: kept open note=<id> (text not saved)`; `sticky:hide|dock|remove` answer INTERNAL "Could not save this note. The window stays open."; Dock opens no tab, Remove keeps the flag), and the main window's "Keep running in background" (`window: main kept open (text not saved)`).
- The sticky renderer saves first for Hide (also Ctrl+W), Open in app, Remove and Move to Trash, and stops with the notice when the text is not safe. Ctrl+W hides when the W key is released (the key press is never split across a closing window; QA-02 showed that race).
- Quit: if a window answers that its text is not saved, the first Quit is canceled (`quit: canceled, unsaved windows=<n>`; `StickyManager.cancelQuit()` makes closes hide again) and the window shows "Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it."; a repeated Quit goes ahead. A renderer that does not answer within the wait does not block quitting; the session end never waits.
- Test harness: `closeApp` quits like a user (via `app.quit()`), waits for the exit, and quits once more when the first Quit was canceled, before closing Playwright's connection (Playwright's `close()` issues one quit and waited forever on Windows; probe `.infinity-work/probes/phase-04-repair1/r1-teardown.spec.ts`: teardown with a persistent fault exits with code 0 in about 11 s, no process left).

### QA-2: a sticky document could render the main shell

`App` asks main once at startup (`app:getInfo` and `window:getState`, cached per bridge so StrictMode cannot drain the D-071 queue twice) and renders the main shell only for the main role and a sticky only for its own note; a URL hash that names anything else shows "This window could not be opened." The main shell receives the queued note opens from that answer (`createAppServices({initialOpens})`).

### Regression tests

- E2E `tests/e2e/save-failure.spec.ts` (all with `failSaves`): › a sticky whose save keeps failing stays open on Hide, Open in app, Remove and the OS close (window kept with the notice and text, no tab, flag kept, DB unchanged, 0 drafts; succeeds once saving works); › a sticky whose save fails a few times closes once the retried save succeeded, on every close path (Hide, Open in app, Remove, OS close: text stored); › Quit is canceled once while a window cannot save; Quit again quits (both windows show the quit notice, process alive; second Quit saves both and exits); › Quit waits for a save that succeeds after retries; › closing the main window to the background keeps it open while its note cannot be saved. `stickies.spec` › Ctrl+W hides the sticky once the key is released, keeping the typed text.
- Unit `window-lifecycle.test` › the first quit is canceled when a window could not save; a repeated quit goes ahead; `renderer/sticky-header.test` › a sticky whose URL was changed to the main route shows the invalid-window message, not the main shell (QA-2); › the main window opens the notes main queued while it loaded, asking main once; `renderer/state/app-events` and `sticky-services` (answers `saved` true/false with the close and quit notices; hide/dock/remove/trash stop on an unsafe flush); `contracts-phase03` (new fields).
- Integration `flush-coordinator` (unsaved answers, 5000 ms wait), `sticky-manager` › a window whose text is not saved stays open on hide, OS close, dock and remove; › a canceled quit makes the OS close hide again; `main-window-controller` › background keeps the window open when its text is not saved; `ipc-handlers-phase03` (`app:flushed` requires `saved`).

### Gates after the last change

Logs in `.infinity-work/logs/phase-04/`. The Windows and WSL legs ran one after the other: a first Windows E2E run made while the WSLg E2E ran at the same time failed once on the Windows-only "main window is focused" check in › restore open stickies on startup. WSLg windows appear on the same Windows desktop and can take the OS foreground; the case passed 3 of 3 alone and in the sequential runs below. That first run is superseded and not counted.

| Command | Host | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| `npm run check` | Windows | 0 | 445 unit, 243 integration + 1 skip (Windows file symlink), traceability fails=0 | repair1-win-check.log |
| `npm run build` | Windows | 0 | | repair1-win-build.log |
| `npm run test:e2e` | Windows | 0 | 149 passed, 1 Linux-only skip | repair1-win-test-e2e.log |
| `npm run package:current` | Windows | 0 | NSIS sha256 8532d4e5…5e2b | repair1-win-package-current.log |
| `npm run test:e2e:packaged` | Windows | 0 | 3 passed; sticky renderer `sandboxed=true integrity=untrusted` | repair1-win-test-e2e-packaged.log |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | unchanged | repair1-deps-unchanged.log |
| QA specs `p04-{multiwin,hardening,probe-failsave,paste}` (unedited) | Windows | 1 | 15 passed, 2 failed (below) | repair1-qa-specs-win.log |
| env, rsync + `diff -rq` | WSL | 0 | MIRROR_IDENTICAL | repair1-wsl-env.log, repair1-wsl-sync.log |
| `npm run check` | WSL | 0 | 445 unit, 244 integration, traceability fails=0 | repair1-wsl-check.log |
| `npm run build` | WSL | 0 | | repair1-wsl-build.log |
| `npm run test:e2e` (WSLg, ozone x11) | WSL | 0 | 148 passed, 2 Windows-only skips | repair1-wsl-test-e2e-wslg.log |
| Xvfb `npm run test:e2e` | WSL | 0 | 148 passed, 2 Windows-only skips | repair1-wsl-test-e2e-xvfb.log |
| QA specs `p04-{multiwin,hardening,probe-failsave}` via `wsl-p04-qa.sh` | WSL (WSLg) | 1 | 13 passed, 1 skipped (QA-06, Windows only by design), 2 failed (below) | repair1-qa-specs-wslg.log |

No Electron process was left on either host after these runs.

QA spec results:
- FS-hide with 1, 2 and 3 transient failures: `db="safe TYPED" drafts=0`, with `flush: … timedOut=0 unsaved=0` on both hosts. With 3 failures the text was previously lost.
- FS-tab: `tabsOpen=2 db="safe"`, unchanged (D-055).
- P04-QA-14 and FS-dock fail on both hosts, by design. Each is an exploratory probe that polls up to 20 s for the sticky to be destroyed while every save fails (`stickyNoteIds(app) == []`); that is the QA-1 loss path. After the repair the window correctly stays open with its text and the notice (asserted in `save-failure.spec`), so the poll times out. Teardown then completes (about 31 s per case, no process left).
- P04-QA-02 (type then Ctrl+W) now passes: 5 of 5 in focused runs, and in both full runs. Before the Ctrl+W keyup change it failed intermittently (2 of 3) with "Target page closed".

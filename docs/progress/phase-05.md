# Phase 05 progress: Time-zone reminders, notifications and widget

Implementer: infinity-code-opus (Opus 5.5, high). Plan: `docs/plans/phase-05.md`. Logs: `.infinity-work/logs/phase-05/`.

## Checkpoints

- Checkpoint S1 done 2026-10-09 — gates: S1-check.log (EXIT=0). Files: shared `time/{resolve,zones,format,quiet-hours,snooze,recurrence}.ts`, `contracts/{reminders,widget}.ts`, `contracts/settings.ts` (three `reminders.*` keys, `settingValueProblem`), `editor/doc-schema.ts` (`collectBlockIds`, shared `eachNode` traversal); `services/settings-service.ts` (zone membership on read and write); tests `unit/{resolve-local,recurrence,zone-default,format-time,quiet-hours,snooze-target,followup-settings,contracts-phase05}`, `unit/boundaries` (no hard-coded zone), `unit/contracts-phase02` (registry key list), `integration/settings` (reminder keys).
- Checkpoint S2 done 2026-10-09 — gates: S2-check.log, S2-build.log, S2-test-e2e.log (150 passed, 1 Linux-only skip; all EXIT=0). Files: `window-lifecycle.ts` (F04-A1: `QUIT_ESCAPE_MS`, escape armed by a canceled Quit, consumed by every Quit, D-085); `test-hooks.ts` (F04-A2: `onFreshTask`, async `windows()`); tests `unit/window-lifecycle` (4 F04-A1 cases), `unit/test-hooks`, `e2e/stickies.spec › windows hook stays safe while windows close` (15 QA2-01 cycles, 38,302 background polls, 0 errors), `e2e/sticky-ui.ts` (hook rule note).
- Checkpoint S3 done 2026-10-09 — gates: S3-checksums.log, S3-check.log, S3-build.log, S3-test-e2e.log (smoke, migration-failure, editor: 28 passed, 1 Linux-only skip; all EXIT=0). Files: migration `005_reminders.sql` + `migrations/index.ts` + `checksums.json` (LATEST 5; 001–004 checksums unchanged); `db/repositories/reminders-repo.ts`; `services/{reminder-service,reminder-model,reminder-anchors,system-zone}.ts`; `services/content-indexer.ts` (anchor sync inside content transactions); `main-services.ts` (reminders, anchors, `reminder:changed {anchor}` after the revision event, reminder clock and zone seams); `index.ts` (zone provider; reminder events wired in S5); tests `integration/{reminder-helpers,reminders,reminder-views}`, `integration/{migrations,trash,window-state,hierarchy-helpers}`, `unit/migrations-checksum`, E2E `smoke`/`packaged` schemaVersion 5.
- Checkpoint S4 done 2026-10-09 — gate: S4-check.log (EXIT=0). Files: `services/{notification-adapter,electron-notifications,power-events,reminder-scheduler,timers}.ts`, `services/clock.ts` (`createFakeClock`: wall and monotonic separable), `reminder-service.ts` (`itemsOf`, `occurrenceSource`), `reminders-repo.ts` (delivery reads and marks; due order by next alert, then due); tests `integration/{scheduler,scheduler-recovery}` (30 cases), `integration/reminders` (trash suspend, block missing still alerts, delete undo with the scheduler), `integration/{reminder-helpers,hierarchy-helpers}` (scheduler harness: monotonic manual timers, fake adapter, fake power), `unit/notification-adapter`, `unit/boundaries` (one scheduler timer, no OS-level scheduling, electron-free reminder modules).
- Checkpoint S5 done 2026-10-09 — gates: S5-check.log, S5-build.log, S5-test-e2e.log (150 passed, 1 Linux-only skip; all EXIT=0). Files: shared `contracts/{channel-names,channels,bridge,channel-roles,windows}.ts` (11 invoke channels, 3 events, sticky additions, `blockId`, `openReminders`), `preload/index.ts`; main `ipc/handlers/{reminder-handlers,window-handlers}.ts`, `ipc/register-handlers.ts`, `windows/{main-window-controller,main-window}.ts` (`openNote` with block, `openReminders`, `requestAttention`, focus clears flashing), `services/{notification-probe,tray-probe,capabilities,electron-power}.ts` (bus-name probe shared, notifications capability, override keys, log line), `desktop.ts` (`afterFirstLoad`), `index.ts` (parallel probes, scheduler creation/start after first load/stop at will-quit, settings and trash wakes, `reminder:changed`/`reminder:alert` events), `test-hooks.ts` (reminder seams: clock, zone, notifications, power, scheduler, reminders); tests `integration/ipc-handlers-phase05`, `unit/{contracts,contracts-phase04,contracts-phase05,capabilities,boundaries,test-hooks}`, `integration/{main-window-controller,ipc-handlers-phase04,ipc-validation,ipc-helpers,sticky-fakes,reminders}`, renderer fake bridge (reminder backend), `e2e/security.spec › bridge surface`.
- Checkpoint S6 done 2026-10-09 — gates: S6-check.log, S6-build.log, S6-test-e2e.log (150 passed, 1 Linux-only skip; all EXIT=0; a first S6 E2E run failed only on `security.spec › bridge surface`, which had not yet listed the new `widget` and `autostart` groups; the spec was updated and the full suite rerun). Files: shared `contracts/{channel-names,channels,bridge,channel-roles,windows,widget}.ts` (6 invoke channels, `widget:state`, `WIDGET_ALLOWED_CHANNELS`, three-role `isChannelAllowed`, widget state variant), `routes.ts` (`#/widget`), preload; main `windows/{widget-manager,widget-window,window-registry,display-clamp}.ts` (geometry parameter), `db/repositories/window-state-repo.ts` (widget row), `services/{widget-state,autostart,electron-autostart,capabilities}.ts` (launch-at-login capability), `ipc/handlers/{widget-handlers,window-handlers}.ts`, `ipc/register-handlers.ts`, `tray.ts` ("Show widget"), `desktop.ts` (widget manager, restore once, background start for `--launched-at-login`), `main-services.ts`, `index.ts` (autostart control, alert to widget), `test-hooks.ts` (widget, fake autostart); renderer `App.tsx` (widget role routing; widget UI in S8); tests `unit/{widget-window-options,autostart,capabilities,boundaries,contracts,contracts-phase05}`, `integration/{widget-manager,autostart,ipc-handlers-phase05,ipc-validation,ipc-helpers,ipc-handlers-phase04,sticky-fakes}`, `e2e/lifecycle.spec › tray menu` (four items, Show widget), `e2e/security.spec › bridge surface`.
- Checkpoint S7 done 2026-10-09 — gates: S7-check.log (EXIT=0), S7-build.log (EXIT=0), S7-test-e2e.log (EXIT=1: 148 passed, 2 failed — `tabs.spec › page singletons` and `visual.spec › … settings windows and tray` used `getByRole('combobox')`, which became ambiguous once Settings gained selects; the palette locators now name the combobox; the two specs plus `palette.spec` rerun 26 passed; the full suite runs again at the S8 gate). Files: renderer `reminders/{reminders-store,note-reminders,reminder-form,ReminderDialog,ReminderRow,SnoozeMenu,DueTime,AlertBanner,ReminderChipBar}.ts(x)`, `editor/{reminder-chips,extensions,NoteEditor,Toolbar,content}.ts(x)` (chips and reveal highlight as decorations, chip click as a DOM event, More "Add reminder…"), `notes/{note-controller,NoteView}.ts(x)` (cursor block, reveal, persist block IDs), `panel/{ContextPanel,RemindersSection}.tsx`, `home/{HomeView,RemindersSection}.tsx`, `pages/{RemindersPage,ReminderSettings,SettingsPage}.tsx`, `state/{app-services,tabs-store,window-settings-store,notice-store,ui-store}.ts` (notice action), `ui/{DialogHost,Switch}.tsx`, `shell/{Shell,Notices}.tsx`, `stickies/StickyView.tsx`, `App.tsx`, `styles/reminders.css`, `main.tsx`; shared `contracts/reminders.ts` (`overdueText`, `repeat`), `contracts/windows.ts` (main state `widget`, D-086); tests `unit/renderer/{reminder-dialog.test.tsx,editor/reminder-chips,state/reminders-store}`, renderer fake bridge, E2E palette locators.
- Checkpoint S8 done 2026-10-09 — gates: S8-check.log, S8-build.log, S8-test-e2e.log (150 passed, 1 Linux-only skip; all EXIT=0). Files: renderer `widget/{WidgetApp,WidgetHeader,WidgetList}.tsx`, `widget/widget-services.ts` (Overdue first when non-empty, `reminder:changed` reload, `widget:state`, flush answered at once), `App.tsx` (widget role renders the widget), `styles/widget.css`, `main.tsx`; tests `unit/renderer/widget-header.test.tsx`.
- Checkpoint S9 done 2026-10-09 — gates: S9-check.log, S9-build.log, S9-test-e2e.log (168 passed, 1 Linux-only skip), S9-visual-win.log (screens in `screens/win/`), S9-dev-smoke.log, S9-package-current.log, S9-verify-native.log, S9-test-e2e-packaged.log (4 passed; packaged delivery `dispatched`, autostart read only: `login-items` supported, disabled), S9-deps-unchanged.log, S9-native-toast-win.log (Windows notification platform holds a `toast` row for our AUMID with "Packaged reminder"; copy removed); all EXIT=0. A first S9 E2E run had 1 failure (`save-failure.spec › Quit is canceled once…`: the sticky lost one typed character); defect and fix in the issues section; the affected specs then passed 66/66 over two repeats and the full suite passed. Files: E2E `reminder-ui.ts`, `reminders.spec.ts` (11), `widget.spec.ts` (3), `lifecycle.spec` (relaunch overdue summary), `security.spec` (widget hardening), `packaged.spec` (reminder dispatch, seams ignored, autostart read), `visual.spec` (15 Phase 05 screenshots), `harness.ts` (`restart(extraEnv)`); `renderer/editor/NoteEditor.tsx` (chips dispatched only on change), `styles/widget.css` (narrow tabs); probe `.infinity-work/probes/phase-05/toast-record.cjs`.
- Checkpoint S10 (first WSL leg) 2026-10-09 — logs `wsl-env.log`, `wsl-sync.log` (MIRROR_IDENTICAL), `wsl-npm-ci.log`, `wsl-check.log`, `wsl-build.log`, `wsl-visual-wslg.log` (18 passed, `screens/wslg/`), `wsl-package-linux.log`, `wsl-test-e2e-packaged.log` (4 passed; delivery `unsupported`/`no-notification-server`) all EXIT=0; `wsl-test-e2e-wslg.log` and `wsl-test-e2e-xvfb.log` EXIT=1 with the same 3 failures (164 passed): the relaunch, notification-click and one-scheduler specs drive the fake notification adapter, but WSLg's real capability is `unsupported` (D-077), so the capability gate never called it. Those specs now declare `nativeNotifications: supported` through the test seam (`reminderEnv({ notifications: true })`); the specs about the real capability keep it. The final WSL leg (`final-wsl-*.log`) reran everything after this change.
- Checkpoint S10 done 2026-10-09 — final WSL leg: `final-wsl-env.log`, `final-wsl-sync.log` (MIRROR_IDENTICAL), `final-wsl-check.log`, `final-wsl-build.log`, `final-wsl-test-e2e-xvfb.log` (167 passed, 2 Windows-only skips), `final-wsl-visual-wslg.log`, `final-wsl-package-linux.log`, `final-wsl-test-e2e-packaged.log` (4 passed) all EXIT=0. `final-wsl-test-e2e-wslg.log` EXIT=1: 166 passed, 1 failed — `visual.spec › 760x560 light: editor toolbar` timed out after 30 s waiting for the palette's "Editor tour" option. That is a Phase 03 palette path that this phase did not change apart from naming the palette combobox in the locator, and it passed in the two earlier WSLg runs, in Xvfb and on Windows. It is recorded as a WSLg flake and not retried away: a separate, recorded second run `final-wsl-run2-test-e2e-wslg.log` passed 167 with 2 Windows-only skips, EXIT=0. `final-wsl-test-e2e-wayland.log` is informational (D-050). `electron left: 0` after every stage.
- Checkpoint S11 done 2026-10-09 — gates: final Windows logs (table below), `final-traceability.log` and `S11-traceability.log` (EXIT=0); BACKLOG statuses and planned tests updated (plan section 15.2).

## Commands, exit codes and logs

All logs are in `.infinity-work/logs/phase-05/`. Each starts with the command, the date and the directory, and ends with `DURATION` and `EXIT`. The final gates ran after the last source and test change. The WSL mirror was `MIRROR_IDENTICAL` at the final sync; only documents changed after it.

| Command | Host | Exit | Duration | Result | Log |
| --- | --- | --- | --- | --- | --- |
| `npm run check` | Windows | 0 | 70 s | lint, typecheck, unit (77 files), integration (34 files, 1 Windows platform skip), traceability | final-check.log |
| `npm run build` | Windows | 0 | 8 s | | final-build.log |
| `npm run test:e2e` | Windows | 0 | 392 s | 168 passed, 1 Linux-only skip | final-test-e2e.log |
| visual (Windows) | Windows | 0 | 29 s | screenshots in `screens/win/` | S9-visual-win.log |
| `node tools/dev-smoke.mjs` | Windows | 0 | 5 s | | S9-dev-smoke.log |
| `npm run package:current` | Windows | 0 | 55 s | NSIS build | final-package-current.log |
| `npm run verify:native -- --packaged` | Windows | 0 | 1 s | | final-verify-native.log |
| `npm run test:e2e:packaged` | Windows | 0 | 34 s | 4 passed; reminder delivery `dispatched` | final-test-e2e-packaged.log |
| notification platform record | Windows | 0 | 0 s | `toast` row for our AUMID | S9-native-toast-win.log |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | 0 s | dependencies unchanged | final-deps-unchanged.log |
| `node tools/check-traceability.mjs --repo .` | Windows | 0 | 0 s | fails=0 warns=0 | final-traceability.log |
| env and probes | WSL | 0 | 0 s | versions, D-Bus names | final-wsl-env.log |
| sync | WSL | 0 | 1 s | MIRROR_IDENTICAL | final-wsl-sync.log |
| `npm run check` | WSL | 0 | 23 s | | final-wsl-check.log |
| `npm run build` | WSL | 0 | 4 s | | final-wsl-build.log |
| `npm run test:e2e` (WSLg, ozone x11) | WSL | 1 | 382 s | 166 passed, 1 failed (palette option timeout, flake above), 2 skipped | final-wsl-test-e2e-wslg.log |
| `npm run test:e2e` (WSLg, second recorded run) | WSL | 0 | 371 s | 167 passed, 2 Windows-only skips | final-wsl-run2-test-e2e-wslg.log |
| `env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e` (Xvfb) | WSL | 0 | 359 s | 167 passed, 2 Windows-only skips | final-wsl-test-e2e-xvfb.log |
| visual (WSLg) | WSL | 0 | 29 s | screenshots in `screens/wslg/` | final-wsl-visual-wslg.log |
| forced Wayland (informational, D-050) | WSL | 1 | 2275 s | 96 passed, 71 failed, 2 skipped. Failures are timeouts without compositor frame callbacks (`locator.click`, `page.keyboard`, `page.screenshot`, visibility) spread over visual 18, editor 16, paste 10, reminders 5, shell 4, conflict 4, tabs 3, note-live 3, crash 2 and one each in stickies, smoke, migration-failure, lifecycle, home and editor-flow. Phase 04: 78 passed, 64 failed | final-wsl-test-e2e-wayland.log |
| `npm run package:linux` | WSL | 0 | 27 s | AppImage and .deb | final-wsl-package-linux.log |
| `npm run test:e2e:packaged` | WSL | 0 | 62 s | 4 passed; delivery `unsupported` (`no-notification-server`) | final-wsl-test-e2e-packaged.log |

Step logs S1 to S9 and the first WSL leg are listed in the checkpoints.

## Summary

Phase 05 adds time-zone reminders to Infinity Notes. Reminders are stored as series, occurrences and alert deliveries (migration 005). Main resolves every local date, time and IANA zone with an app-owned DST resolver. One scheduler in main runs a single timer, claims each alert in a transaction before dispatching it, groups more than 3 alerts into one summary and recovers after a restart, sleep or clock change without a storm. Notifications go through Electron behind a capability gate. On Linux the gate is a session-bus check, because Electron's `isSupported()` reports true without a server. When a notification is not shown, the alert appears in the window and the taskbar flashes. In the main window there are chips in the text, a chip bar, a panel section, the Reminders page, a Home section, alert and startup banners and the reminder dialog with DST notices. Settings gain the reminder defaults, quiet hours and an explanation that reminders stop when the app is fully quit. There is an optional reminder widget window, a tray "Show widget" item and a launch-at-login mechanism (D-082). Follow-ups F04-A1 (D-085) and F04-A2 are fixed.

Date 2026-10-09. Agent role: infinity-code-opus (Opus 5.5, high). No dependency changed (`S9-deps-unchanged.log`, `final-deps-unchanged.log`). Accepted migrations 001 to 004 are unchanged (checksums).

## Hosts

- Windows 11 Pro 10.0.26300, Node 24.15.0 (repository commands); E2E runner Node 24.21.0 (`INFINITY_E2E_NODE`); Electron 44.7.0. Capabilities line (E2E): `positioning=supported alwaysOnTop=supported tray=supported(native-windows) session=windows ozone=unset notifications=supported(native-windows) autostart=unsupported` (development build). Packaged: notifications `supported(native-windows)`, autostart `supported(login-items)`.
- WSL2 Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, npm 11.19.0, WSLg 1.0.73 (Weston 2318fecaeac1f1a2d5a7a042c34d931c71dae04c), user `infinity`, mirror `~/infinity-notes` (`MIRROR_IDENTICAL`, own `npm ci`). Session bus: `org.kde.StatusNotifierWatcher (false,)` and `org.freedesktop.Notifications (false,)` (`final-wsl-env.log`). WSLg runs with ozone x11 (the Electron default; nothing forces it). There, notifications are `unsupported(no-notification-server)`, autostart is `unsupported` (development build; packaged: `wsl-no-session-autostart`) and the tray is `unsupported(no-status-notifier-host)`. Xvfb reports the same values with session x11. Forced Wayland is informational only (D-050); see the command table.

## Changed and created files

- Shared: `time/{resolve,zones,format,recurrence,quiet-hours,snooze}.ts`; `contracts/{reminders,widget}.ts` (new), `contracts/{channel-names,channels,bridge,channel-roles,windows,settings}.ts`; `routes.ts` (`#/widget`); `editor/doc-schema.ts` (`collectBlockIds`, shared traversal).
- Main: `db/migrations/005_reminders.sql`, `migrations/index.ts`, `checksums.json`; `db/repositories/reminders-repo.ts` (new), `window-state-repo.ts` (widget row); `services/{reminder-service,reminder-model,reminder-anchors,reminder-scheduler,notification-adapter,electron-notifications,notification-probe,power-events,electron-power,system-zone,timers,autostart,electron-autostart,widget-state}.ts` (new), `services/{tray-probe,clock,capabilities,content-indexer,settings-service}.ts`; `windows/{widget-manager,widget-window}.ts` (new), `windows/{main-window-controller,main-window,window-registry,display-clamp}.ts`; `ipc/handlers/{reminder,widget}-handlers.ts` (new), `ipc/handlers/window-handlers.ts`, `ipc/register-handlers.ts`; `tray.ts`, `desktop.ts`, `window-lifecycle.ts`, `main-services.ts`, `index.ts`, `test-hooks.ts`. Preload `index.ts`.
- Renderer: `reminders/*` (store, per-note model, form logic, dialog, rows, snooze menu, due time, alert banner, chip bar), `editor/reminder-chips.ts` (new), `editor/{extensions,content}.ts`, `editor/{NoteEditor,Toolbar}.tsx`; `notes/{note-controller.ts,NoteView.tsx}`; `panel/{ContextPanel,RemindersSection}.tsx`; `home/{HomeView,RemindersSection}.tsx`; `pages/{RemindersPage,ReminderSettings,SettingsPage}.tsx`; `widget/*` (new); `state/{app-services,tabs-store,window-settings-store,notice-store,ui-store}.ts`; `ui/{DialogHost,Switch}.tsx`; `shell/{Shell,Notices}.tsx`; `stickies/StickyView.tsx`; `App.tsx`; `main.tsx`; `styles/{reminders,widget}.css`.
- Tests: unit (new) `resolve-local`, `recurrence`, `zone-default`, `format-time`, `quiet-hours`, `snooze-target`, `followup-settings`, `contracts-phase05`, `notification-adapter`, `autostart`, `widget-window-options`, `test-hooks`, `renderer/{reminder-dialog,widget-header}`, `renderer/editor/reminder-chips`, `renderer/state/reminders-store`; unit (updated) `boundaries`, `contracts`, `contracts-phase02`, `contracts-phase04`, `capabilities`, `migrations-checksum`, `window-lifecycle`, renderer fake bridge and editor support. Integration (new) `reminders`, `reminder-views`, `scheduler`, `scheduler-recovery`, `widget-manager`, `autostart`, `ipc-handlers-phase05`, `reminder-helpers`; (updated) `migrations`, `settings`, `trash`, `window-state`, `main-window-controller`, `ipc-handlers-phase04`, `ipc-validation`, `ipc-helpers`, `hierarchy-helpers`, `sticky-fakes`. E2E (new) `reminder-ui.ts`, `reminders.spec`, `widget.spec`; (updated) `lifecycle`, `security`, `stickies`, `packaged`, `visual`, `smoke`, `tabs`, palette locators in `palette`, `home`, `editor-ui`, `ui`, `sticky-ui.ts`, `harness.ts`.
- Docs: `docs/DECISIONS.md` (D-086), `docs/ARCHITECTURE.md` (catalogue row), `docs/BACKLOG.md` (status and planned tests), this report.

## IPC catalogue as implemented

67 invoke channels and 12 events (`unit/contracts-phase05 › the Phase 05 channels are appended in order`): the 17 channels of plan section 6.2 in that order, and the events `reminder:changed`, `reminder:alert`, `widget:state`, `app:openReminders` after `app:openNote`. Roles: main (every channel); sticky (Phase 04 set plus `reminder:listForNote` and `reminder:open`, own note only); widget (`WIDGET_ALLOWED_CHANNELS`, the 13 channels of plan section 6.4). Tests: `integration/ipc-validation`, `integration/ipc-handlers-phase05`, `e2e/security.spec › the widget window is hardened`. Differences from plan section 6, recorded in D-086: `OccurrenceItem.repeat` (`daily`, `weekly` or null) replaces `recurring`; the main window's `window:getState` answer also carries `widget: WidgetState`.

## Requirement coverage

W = Windows 11 (`final-test-e2e.log`, unit and integration in `final-check.log`); L = WSLg ozone x11 and Xvfb (`final-wsl-*.log`). Every row's assertions passed on W and L unless a part is named as pending.

| ID | Assertions run (file › case) | Status |
| --- | --- | --- |
| INF-REM-01 | integration/reminders › create (zone, due 11:00Z, anchor, note untouched; refusals: Mars/Base, CST, trashed, missing note, unsaved block, plain-note block, past, allowPast, 201st, sticky note); e2e/reminders › add a reminder to a paragraph | done |
| INF-REM-02 | unit/zone-default; unit/boundaries › no hard-coded reminder zone; integration/reminders › zones; e2e/reminders › default zone follows the computer and the setting | done |
| INF-REM-03 | unit/format-time; unit/renderer/reminder-dialog › local line; e2e/reminders › selected zone and local time (dialog, panel, Reminders row) | done |
| INF-REM-04 | unit/renderer/editor/reminder-chips (meta-only, positions, mapping); e2e/reminders › add a reminder to a paragraph (chip name, contenteditable, content and revision unchanged, typing, copy and paste, sticky chip, block removed, Keep note-level) | done |
| INF-REM-05 | integration/reminder-views (fixtures A to I, New York boundary, scope, summary); e2e/reminders › reminders page, done and empty texts | done |
| INF-REM-06 | integration/scheduler › initial alert; e2e/reminders › notification click … in the background; e2e/packaged › packaged reminder (W `dispatched` plus notification platform row; L `unsupported`) | in_progress (WSLg toast not_run, D-077) |
| INF-REM-07 | e2e/reminders › notification click opens the source note (block selected and highlighted, `clicked_at`, background recreate, summary opens Overdue); integration/scheduler › clicking opens the source note | in_progress (real toast click: manual, pending) |
| INF-REM-08 | integration/scheduler › close is not done | done |
| INF-REM-09 | integration/scheduler › done stops follow-ups; integration/reminders › done and snooze rules; e2e/reminders › reminders page, done; e2e/widget › actions | done |
| INF-REM-10 | integration/scheduler › snooze race (a) to (e); integration/reminders › done and snooze rules (f); unit/snooze-target | done |
| INF-REM-11 | unit/followup-settings; unit/renderer/reminder-dialog; integration/scheduler › follow-up limit; e2e/reminders › settings … follow-ups | done |
| INF-REM-12 | unit/recurrence; integration/scheduler › recurrence vs completion | done |
| INF-REM-13 | integration/reminders › edit series pending policy; unit/renderer/reminder-dialog › pending-policy choice; e2e/reminders › edit a series with an overdue occurrence | done |
| INF-REM-14 | unit/resolve-local; unit/renderer/reminder-dialog; e2e/reminders › DST gap and fold previews | done |
| INF-REM-15 | integration/scheduler › os zone change; integration/reminder-views › display zone; e2e/reminders › os zone change | done |
| INF-REM-16 | unit/notification-adapter (no actions, reply or toast XML); review of `electron-notifications.ts`; e2e/widget › actions; e2e/reminders › banner when notifications fail or are unsupported | done |
| INF-REM-17 | integration/reminders › trash, block missing, trash suspend (2 singles, 5 → one summary); integration/trash › purge removes reminders | done |
| INF-REM-18 | integration/reminders › delete with undo (with and without the scheduler); e2e/reminders › delete with undo | done |
| INF-HOME-04 | integration/reminder-views › summary; e2e/reminders › Home reminder section (groups, Common filter, 5 of 6, link, empty text) | done |
| INF-SCHED-01 | integration/scheduler › single timer (1,000 reminders, partial index, trashed note, backoff); unit/boundaries › one scheduler timer | done |
| INF-SCHED-02 | integration/scheduler-recovery › restart around dispatch; integration/migrations › migration 005 constraints | done |
| INF-SCHED-03 | integration/scheduler-recovery › crash after claim | done |
| INF-SCHED-04 | integration/scheduler › adapter failure; unit/notification-adapter; e2e/reminders › banner when notifications fail or are unsupported (W override, L real); › a failed notification shows the banner | done |
| INF-SCHED-05 | integration/scheduler-recovery › batch limits (startup 3 and 4, resume, forward and backward jumps); e2e/lifecycle › relaunch overdue summary | in_progress (real sleep and wake: Phase 09) |
| INF-SCHED-06 | unit/quiet-hours; integration/scheduler › quiet hours; e2e/reminders › settings … quiet hours | done |
| INF-SCHED-07 | integration/scheduler-recovery › long downtime no flood (daily and weekly) | done |
| INF-SCHED-08 | integration/scheduler-recovery › follow-up counts; › an uncertain claim adds no count | done |
| INF-SCHED-09 | e2e/lifecycle › relaunch overdue summary (nothing claimed while quit; one `startup` delivery); e2e/reminders › settings explain the lifecycle; unit/boundaries › no OS-level timers | done |
| INF-WIDG-01 | e2e/widget › actions; integration/ipc-handlers-phase05 › widget | done |
| INF-WIDG-02 | e2e/widget › collapse, hide and pin (W real pin, L unsupported); integration/widget-manager | in_progress (user drag and resize, pin over other apps: Phase 09) |
| INF-WIDG-03 | integration/widget-manager; e2e/widget › one scheduler for both windows | done |
| INF-DESK-02 | e2e/lifecycle › tray menu (four items, Show widget) (W) | in_progress (native tray: Phase 09) |
| INF-DESK-03 | unit/autostart; integration/autostart; integration/ipc-handlers-phase05 › autostart; e2e/reminders › settings explain the lifecycle; e2e/packaged (read only) | in_progress (Settings completion Phase 08; native login check Phase 09) |
| F04-A1 | unit/window-lifecycle (4 cases); e2e/save-failure (D-072 cases) | fixed |
| F04-A2 | unit/test-hooks; e2e/stickies › windows hook stays safe while windows close | fixed |

Screenshots: `.infinity-work/logs/phase-05/screens/win/` and `screens/wslg/` (Phase 04 set plus the 15 Phase 05 images).

## Scheduler evidence (frozen clock, `integration/scheduler*.test.ts`)

| Case | Instants (UTC) |
| --- | --- |
| Daily 09:00 New York | 03-07 14:00, 03-08 13:00, 03-09 13:00, 10-31 13:00, 11-01 14:00, 11-02 14:00 (`unit/recurrence`) |
| Daily 02:30 New York | 03-07 07:30, 03-08 07:00 (gap: 03:00 EDT), 03-09 06:30 |
| 01:30 New York 2026-11-01 | earlier 05:30, later 06:30; a daily series yields one instant per day (05:30, then 11-02 06:30) |
| Lord Howe 2026-10-04 02:15; Kathmandu 09:00 | gap: 2026-10-03 15:30; 03:15 |
| Quiet hours 22:00 to 07:00 Dhaka | alerts due 16:30 and 17:00 deferred to 2026-10-09 01:00; at 01:00 two `initial` deliveries, reason `quiet_end`; follow-ups 01:15, 01:30 |
| Follow-ups 15 min x 2 | alerts T, T+15, T+30 (sequences 0, 1, 2: initial, followup, followup); none after |
| Snooze race (c), 5 min x 2 | initial T; snooze 15 at T+1; deliveries `initial`, `snooze` (T+16), `followup` (T+21); `followups_sent 1` |

Delivery rows asserted: restart around dispatch (sequence 0 `uncertain` `claimed-before-restart`, then sequence 1 `followup` `dispatched`; a late answer from the dropped run never overwrites `uncertain`); crash before the claim commits (no row, then sequence 0 `startup` `dispatched`); batch limits (3 due: 3 `single`; 4 due: 4 rows, one `batch_id`, `summary`, "4 reminders are overdue"); trash restore (2: two singles; 5: one summary; reason `restore`); 400-day downtime (at most 2 new rows, older open rows `missed`, one alert). Timer: one live timer through every kind of write and with 1,000 reminders; delay capped at 60 000 ms and 30 000 ms when the next alert is 30 s away; the next-alert query uses `occurrences_next_alert`; a trashed note's due alert does not drive the timer; a stuck claim backs off 1, 2, 4, 8, 16, 32, 60, 60 s with one log line.

## Native observations

- Windows packaged build (`S9-test-e2e-packaged.log`, `final-test-e2e-packaged.log`): a reminder due at the next minute went through the real scheduler and Electron adapter with outcome `dispatched`. The Windows notification platform database holds a `toast` row for it: "Packaged reminder" / "Due Fri 9 Oct, 02:38 · Packaged reminder" (`S9-native-toast-win.log`; temporary copy, our AUMID rows only, copy deleted). `autostart.get`: `{enabled: false, capability: supported (login-items)}`; never set.
- WSLg packaged build (`final-wsl-test-e2e-packaged.log`): capability `unsupported (no-notification-server)`, delivery `unsupported`, adapter not called; autostart `unsupported (wsl-no-session-autostart)`. The in-app fallback (banner, Reminders lists, widget) is the WSLg behavior, E2E-tested with the real capability.

### Manual native check (pending, needs a person)

Real toast click on Windows (INF-REM-07, native part):
1. Install the NSIS build in `release/` from `npm run package:current` and start it.
2. Create a note "Click test" with the paragraph "Open me"; put the cursor in it.
3. More → Add reminder…, set a time 2 minutes ahead in the computer's zone, Save.
4. Close the main window and choose "Keep running".
5. Wait for the toast and click it. Expected: the main window comes back with "Click test" active and "Open me" selected and highlighted.

Status: pending (not run by a person).

## Decisions after planning

- D-086: `OccurrenceItem.repeat` replaces `recurring`; the main window state carries the widget state.
- D-087 (Repair 1): follow-up edits re-target pending follow-ups; a claim overtaken before its notification is recorded `skipped`; one batch and one summary total per tick; quiet hours keep the required zone of D-083.

## Issues found and fixed

| Severity | Issue | Reproduction, expected, actual | Fix and regression |
| --- | --- | --- | --- |
| Medium | A typed character could be lost in a sticky (or a tab) right after it opened | `save-failure.spec › Quit is canceled once…` (S9 run): typed " sticky text" after "safe"; expected "safe sticky text"; stored "saf sticky text". The new chips effect dispatched a meta-only transaction when the reminder list first loaded (empty to empty) while keyboard input was being applied | Chips are dispatched only when they change (`NoteEditor.tsx`); the affected specs passed 66/66 over two repeats; full suites passed on W, WSLg and Xvfb |
| Low (test) | Palette locators became ambiguous | `getByRole('combobox')` also matched the new Settings selects | Palette locators name the combobox |
| Low (test) | Fake-notification specs failed on WSLg | The real capability there is `unsupported`, so the gate skipped the fake adapter | Those specs declare the capability through the seam; real-capability specs keep it |
| Low | Widget tabs overflowed 300 px | `widget-light.png` showed a horizontal scroll bar | Narrower tabs, no horizontal overflow |
| Low (design) | A series completed ahead of time could get a second future occurrence | Found while writing `reminders.test › done and snooze rules` | Series generation skips a series with an open future occurrence |

## Not run or pending

- Windows: real toast click (manual, above); sleep and wake (Phase 09); live OS zone change (main may need a restart; tested through the zone seam); setting launch at login for real (tests never change login items); widget always-on-top over other apps and user drag and resize (Phase 09).
- WSLg: native Linux toast and click `not_run` (no notification server, D-077; nothing installed); launch at login `unsupported` under WSL.
- `outside_validation_scope`: GNOME notifications and their click, XDG autostart in a GNOME session, X11 always-on-top of the widget.

## Known limitations

- Reminders fire only while Infinity Notes runs (a window open, in the background or in the tray). After a full quit nothing is sent until the next start, which shows the overdue reminders.
- A live OS zone change may need an app restart before main sees it.
- No native action buttons; Open, Snooze and Done are in the app, the banner and the widget.
- A notification whose `show` is not confirmed within 3 s is recorded `uncertain` and stays overdue.
- The widget position is not restored under Wayland or WSLg.
- Launch at login is unavailable in development builds and under WSL.

## Repair 1 (QA5-01..04)

Input: `docs/progress/phase-05-qa.md` and the QA probes `.infinity-work/qa/p05-adversarial.test.ts` (Q1, Q4, Q5) and `p05-more.test.ts` (Q8b). Decision D-087 records the choices below.

| QA ID | Severity | Cause | Fix | Regression |
| --- | --- | --- | --- | --- |
| QA5-01 | Medium | `ReminderService.update` kept `next_alert_at_utc`; the claim only computes the alert after the stored one, so a follow-up stored under the old settings still fired | When an edit changes the follow-up interval or maximum, `RemindersRepo.retargetFollowups` runs in the edit's transaction: every pending occurrence that already alerted gets no follow-up (off, or `followups_sent` reached the new maximum) or last alert plus the new interval; snoozed occurrences keep their snooze alert; every open occurrence of the reminder takes a new revision, so a claim read under the old settings loses | `integration/scheduler.test.ts › editing follow-ups after an alert`: off after the first alert (Q4), maximum lowered below the sent count (Q5), new interval counted from the last alert, raised maximum and switching back on, snoozed keeps its snooze, edit between read and claim loses |
| QA5-02 | Low | `dispatch` showed every claimed single in turn; Done or Snooze landing while an earlier notification of the batch awaited its show confirmation did not stop a later one | Right before each notification the scheduler re-reads its occurrences (`RemindersRepo.stillAlerting`: pending, reminder and note live). One that is no longer alerting is not shown; its delivery is recorded `skipped` with detail `superseded-before-dispatch` (new outcome in the migration 005 CHECK, D-087), raises no in-app alert and reports no outcome in views. Same-instant alerts now go out in creation order (`rowid` as the last sort key) instead of random id order | `scheduler.test.ts › user action while a batch is being shown`: A hangs, B Done and C snoozed meanwhile; only A shown; B and C `skipped`; no in-app alert or attention; C alerts once at its snooze time (Q1) |
| QA5-03 | Low | The tick read at most `DUE_CHUNK` (500) rows; the next tick made a second summary, each saying "500 reminders are overdue" | One tick claims every due alert, reading pages of 500 with a cursor on (next alert, due, rowid), into one batch; the first page decides the presentation; the summary names the number still current at dispatch | `scheduler.test.ts › 1,000 overdue at a resume`: exactly one notification "1000 reminders are overdue", 1,000 deliveries in one batch, all `summary`/`dispatched`/`resume` (Q8b) |
| QA5-04 | Info | `quietWindowAt` ignores a window without a zone | Kept D-083 (zone stored explicitly when quiet hours are on): the setting schema already refuses `enabled: true` with `zoneId: null`, and a stored value without a zone reads as the default (off) with a warning. No read-time fallback to the computer zone, so quiet hours never move with travel. Settings > Reminders fills the zone when quiet hours are switched on | `integration/settings.test.ts › quiet hours switched on need a zone`: write refused (nothing stored, no event), hand-written stored value reads as off and logs `settings: invalid stored value key=reminders.quietHours` |

Changed files: `src/main/services/reminder-service.ts` (follow-up re-target on edit), `src/main/services/reminder-scheduler.ts` (`claimDue` paging into one batch, re-check before each notification, `skipped` outcome), `src/main/db/repositories/reminders-repo.ts` (`retargetFollowups`, `stillAlerting`, cursor and creation order in `dueForAlert`, `DeliveryRecordOutcome`), `src/main/services/reminder-model.ts` (`skipped` reports no outcome), `src/main/db/migrations/005_reminders.sql` and `checksums.json` (outcome `skipped`; 001–004 checksums unchanged; 005 has never been committed or released), `tests/integration/scheduler.test.ts` (7 cases), `tests/integration/settings.test.ts` (1 case), `docs/ARCHITECTURE.md` (scheduler section), `docs/DECISIONS.md` (D-087).

Note on migration 005: a development profile created before this repair keeps the old CHECK at schema version 5; recording a `skipped` delivery there would fail the dispatch transaction. Test profiles are fresh per run and no release contains version 5.

### Repair 1 commands, exit codes and logs

All after the last source and test change; logs in `.infinity-work/logs/phase-05/`.

| Command | Host | Exit | Duration | Result | Log |
| --- | --- | --- | --- | --- | --- |
| `npm run check` | Windows | 0 | 25 s | lint, typecheck, unit 527 passed, integration 328 passed and 1 Windows platform skip, traceability fails=0 warns=0 | repair1-check.log |
| `npm run build` | Windows | 0 | 4 s | | repair1-build.log |
| `npm run test:e2e` | Windows | 0 | 357 s | 168 passed, 1 Linux-only skip | repair1-test-e2e.log |
| `npm run package:current` | Windows | 0 | 29 s | NSIS build | repair1-package-current.log |
| `npm run test:e2e:packaged` | Windows | 0 | 61 s | 4 passed; packaged delivery `dispatched` | repair1-test-e2e-packaged.log |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | 0 s | dependencies unchanged | repair1-deps-unchanged.log |
| QA probes `npx vitest run --config .infinity-work/qa/p05.vitest.config.ts` (config unedited) | Windows | 1 | 18 s | 19 passed, 1 failed: Q19, the probe error QA recorded (`getInternal('reminders.followups')`, an unknown key, throws in the probe itself). Q1, Q4, Q5 now pass | repair1-qa-vitest.log |
| same, `--reporter=verbose --silent=false` to show the probes' output | Windows | 1 | 15 s | Q1 shown `['A']`; Q4 1 notification `['initial']`; Q5 3 before and after; Q8b `["1000 reminders are overdue"]`, 1,000 deliveries, no in-app alert, overdue 1,000; Q19 as above | repair1-qa-vitest-verbose.log |
| QA Playwright `node node_modules/@playwright/test/cli.js test -c .infinity-work/qa/p05.config.ts` (Node 24.21 portable, config unedited) | Windows | 0 | 9 s | 5 passed | repair1-qa-e2e-win.log |
| sync | WSL | 0 | 2 s | MIRROR_IDENTICAL | repair1-wsl-sync.log |
| `npm run check` | WSL | 0 | 24 s | unit 527 passed, integration 329 passed | repair1-wsl-check.log |
| `npm run build` | WSL | 0 | 5 s | | repair1-wsl-build.log |
| `npm run test:e2e` (WSLg) | WSL | 0 | 347 s | 167 passed, 2 Windows-only skips | repair1-wsl-test-e2e-wslg.log |
| `env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e` (Xvfb) | WSL | 0 | 342 s | 167 passed, 2 Windows-only skips | repair1-wsl-test-e2e-xvfb.log |
| QA `wsl-p05-qa.sh` (WSLg, Ubuntu 26.04.1, Node 24.21.0, user infinity) | WSL | 0 | 9 s | MIRROR_IDENTICAL, 5 passed, `electron left: 0` | repair1-qa-e2e-wslg.log |

The WSL leg printed `electron left: 0` after every stage; `tasklist` on Windows showed no Electron process after the runs. Not rerun in this repair: Windows visual, WSL visual, forced Wayland (informational), Linux packaging and packaged E2E (no packaging or Linux-specific code changed; their Phase 05 final logs stand).


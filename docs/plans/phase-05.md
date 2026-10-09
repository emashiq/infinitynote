# Phase 05 plan: Time-zone reminders, notifications and widget

Planner: infinity-planner (Opus 5.5, high), 2026-10-09. Implementer: infinity-code-opus (Opus 5.5, high), one agent at a time, resumable at every checkpoint in section 14. QA: infinity-qa. Acceptance: infinity-acceptor.

Phase contract: `infinity-notes-claude-pack/phases/05-time-zone-reminders-notifications-and-widget.md`. Requirement IDs (31): INF-REM-01 to INF-REM-18, INF-SCHED-01 to INF-SCHED-09, INF-WIDG-01 to INF-WIDG-03, INF-HOME-04. Also touched: INF-DESK-02 (tray "Show widget", W05-03) and INF-DESK-03 (launch at login mechanism, row stays Phase 08, D-082). Decisions added by this plan: D-073 to D-085 (`docs/DECISIONS.md`).

Acceptance to demonstrate (phase file): frozen-clock tests cover initial, follow-up, complete and snooze races, recurrence/DST, quiet hours, crash around dispatch, recovery and duplicate suppression; widget and main stay consistent; a real native notification opens the correct note on an available desktop; unsupported native action buttons degrade to app and widget actions.

---

## 1. Inputs read and actual repository state

Read: root `CLAUDE.md`; pack `PRODUCT_PLAN.md` (Reminders), `ARCHITECTURE.md` (Reminders and clocks), `TEST_MATRIX.md` (Reminders, Scheduler recovery, Time zones, Widget, frozen-clock examples, native matrix), phase 05 file; `docs/PRODUCT_SPEC.md`, `UX_SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md` (to D-072), `BACKLOG.md`; `docs/progress/phase-00-acceptance.md` (F-1, F-8), `phase-03-acceptance.md`, `phase-04.md`, `phase-04-acceptance.md` (F04-A1, F04-A2); `docs/plans/phase-04.md`; the code below.

Actual state at commit `a44d883` (Phase 04 accepted):

- Main: `index.ts` is the composition root (logger, bounded tray-host probe, capabilities computed once, web security, protocols, DB, event bus, `FlushCoordinator`, `createMainServices`, router, `createDesktop`, `registerIpcHandlers`, test hooks). `desktop.ts` wires `MainWindowController` (queue of `app:openNote` until `window:getState`), `StickyManager`, `TrayController` (items Open, New sticky, Quit) and `createWindowLifecycle`. `services/clock.ts` already defines `Clock {now(), monotonicNow()}` and `systemClock`; every service receives `systemClock`. `capabilities.ts` reports `nativeNotifications` and `launchAtLogin` as `unknown('detected-in-later-phase')` and `notificationActions` as `unsupported`. `app.setAppUserModelId('com.infinitynotes.desktop')` runs on Windows.
- `window-lifecycle.ts`: `quitCanceled` is set on the first canceled Quit and never reset (F04-A1).
- `test-hooks.ts`: `windows()` reads the DB synchronously (`StickyService.state`), which can run inside an interrupted better-sqlite3 statement under the Playwright inspector (F04-A2).
- Data: migrations 001 to 004, `LATEST = 4`; `window_state` CHECK already allows the key `widget` with `note_id NULL`. No reminder tables.
- IPC: 50 invoke channels, 8 events. Roles `main` and `sticky` (`STICKY_ALLOWED_CHANNELS`, note ownership in the router). Boundary tests (`boundaries.test`, `contracts.test`, `ipc-validation.test`, `security.spec › bridge surface`) assert that the Phase 05 names `reminder:create`, `widget:show`, `reminder:changed` are absent.
- Save path: `NoteContent.write` → `ContentIndexer.index` runs inside every content transaction (save, conversion, version and draft restore). Block IDs are `data-id` attributes on paragraph, heading, codeBlock, blockquote, listItem, taskItem, image and fileAttachment (D-053); IDs assigned at load are persisted only with the next real edit.
- Renderer: `pages/RemindersPage.tsx` says "Reminders are not available in this build yet." `ContextPanel` has only `InfoSection`. Home has Quick actions, Pinned, Recent. `App.tsx` routes `#/` and `#/sticky/<id>` and checks the route against `window:getState`. Luxon 3.7.2 is a dependency but unused.

### 1.1 Planner probes (logs in `.infinity-work/logs/phase-05/`, sources in `.infinity-work/probes/phase-05/`)

| Probe | Result |
| --- | --- |
| `planner-probe-notify-win.log` (`notify/main.js`, unpackaged Electron 44.7.0 on Windows 11 with AUMID `com.infinitynotes.desktop`) | `Notification.isSupported()` true; `show` event 7 ms after `show()`; no `failed`. With the toast left open, the Windows notification platform database holds a `toast` row for our AUMID with the title and body, so a development build does reach the OS notification platform. A UI Automation search for the toast popup by its text found nothing: clicking a real toast cannot be automated reliably, so the native click stays a manual case. `Intl.supportedValuesOf('timeZone')` has 418 zones, contains `Asia/Dhaka` and `America/New_York`, uses `Asia/Calcutta` (not `Asia/Kolkata`) and has no `UTC`. Main and renderer report the same zone (`Asia/Dhaka`). `app.getLoginItemSettings()` reads without side effects. |
| `planner-probe-notify-wsl.log` (same probe, user `infinity`, WSLg 1.0.73 and Xvfb) | `gdbus ... NameHasOwner org.freedesktop.Notifications` answers `(false,)`. `Notification.isSupported()` is still **true**, and `show()` emits `failed` synchronously (libnotify `ServiceUnknown`) before `show()` returns; no `show` event. So `isSupported()` is no capability signal on Linux; the D-Bus name check is. |
| `planner-probe-resolve.log` (`resolve-probe.cjs`, Node + Luxon 3.7.2) | App-owned resolver: 2026-03-08 02:30 New York = gap → 03:00 EDT = `2026-03-08T07:00Z`; 2026-11-01 01:30 New York = fold, earlier `05:30Z`, later `06:30Z`; Luxon's default gives 03:30 for the gap (D-006 confirmed). Daily 09:00 New York: `03-07 14:00Z`, `03-08 13:00Z`, `03-09 13:00Z`, `10-31 13:00Z`, `11-01 14:00Z`, `11-02 14:00Z`. Daily 02:30 New York: `03-07 07:30Z`, `03-08 07:00Z` (gap), `03-09 06:30Z`. Lord Howe 2026-10-04 02:15 (30-minute gap) → 02:30 +11:00 = `2026-10-03T15:30Z`; Kathmandu 09:00 = `03:15Z`. Reference `2026-10-08T03:30Z`: "tomorrow" is 2026-10-08 in New York (09:00 = `13:00Z`) and 2026-10-09 in Dhaka (09:00 = `03:00Z`). Dhaka 2026-10-09 17:00 = `11:00Z`. `IANAZone.isValidZone` accepts `EST` and `CST`, so zone validation must use the app's zone list, not Luxon validity. |

These results are recorded in D-076, D-077 and D-079.

## 2. Follow-ups and defects incorporated

| Item | Where |
| --- | --- |
| F04-A1 `quitCanceled` never reset | Section 8.12 and D-085: a canceled Quit arms the "quit again" escape for one following Quit only, and only within 2 minutes; unit regressions in `window-lifecycle.test`. D-072 status line refers to D-085. |
| F04-A2 DB-reading hooks under inspector interrupts | Section 8.13: every hook that touches the database resolves on a fresh macrotask (`onFreshTask`), `windows()` included; unit test and an E2E stress regression in the QA2-01 shape. Harness note in `tests/e2e/sticky-ui.ts`. |
| Phase 00 F-1 explicit assertions per ID | Section 12.1 (31 rows plus INF-DESK-02, INF-DESK-03, F04-A1, F04-A2). |
| Phase 00 F-8 / R-02 WSLg has no notification server or tray host | D-077: no daemon is installed in WSL. The capability is detected (`no-notification-server`), the in-app fallback is the WSLg behavior and is E2E-tested there with the real capability; native Linux toast and click cases are `not_run` for WSLg with the probe as reason; GNOME stays `outside_validation_scope`. |
| D-067 "Show widget arrives with the widget in Phase 05" | Tray item, section 8.9; `lifecycle.spec › tray menu` asserts four items. |
| D-063 "notification clicks reuse `app:openNote`" | Kept; the event gains an optional `blockId` (D-074). |
| Boundary guards naming Phase 05 channels | Retargeted to Phase 06 names (`reminder:createFromSuggestion`, `suggestion:dismiss`, `reminder:updateFromSource`), section 12.5. |

Phase 03 follow-ups F-03-1..3 (Phase 09), F-03-4 (Phase 08) and F04-A3 (Phase 09) are not touched.

## 3. Ownership, order and file boundaries

### 3.1 Rules

- One implementer (infinity-code-opus) owns every path below for the whole phase. Work in the step order of section 14. Every step ends green and with a checkpoint line in `docs/progress/phase-05.md`; a resumed agent starts at the first step without a checkpoint, after re-reading the files of the last checkpoint.
- No dependency changes: `package.json` and `package-lock.json` stay byte-identical (gate `git diff --exit-code`). Luxon (already a dependency) is now used in main and renderer.
- Never weaken an existing assertion. Specs whose behavior changes on purpose (tray items, `windows()` becoming async, schema version 5, the Reminders placeholder text) are updated with equal or stronger checks (section 12.5). `retries: 0` stays. No `.only`. No new `.skip` except an explicit platform condition with a reason.
- Accepted migrations 001 to 004 are never edited. The only new migration is `005_reminders.sql`.
- Main-process modules with logic (`reminder-service`, `reminder-scheduler`, `reminder-anchors`, `notification-adapter`, `system-zone`, `widget-manager`, `autostart` builders, `reminders-repo`) import no `electron` at runtime (type imports only), so Node integration tests run them with fakes. Electron adapters: `electron-notifications.ts`, `electron-power.ts`, `electron-autostart.ts`, `widget-window.ts`.
- No per-reminder timers anywhere (`setTimeout` appears once in the scheduler; a boundary test greps for it).
- The E2E suite never shows a real OS notification unless `INFINITY_NOTES_TEST_NOTIFY=real` is set (only the packaged native case does, section 12.4).

### 3.2 Files created (C) and modified (M)

Shared (pure; main and renderer):

| File | Change |
| --- | --- |
| `src/shared/time/resolve.ts` | C: `resolveLocal({date,time}, zoneId, fold)` → `{status:'ok'\|'gap'\|'fold', instantUtc, alternatives?}` (section 9.1); `localParts(instant, zone)`; `isValidLocalDate`, `isValidLocalTime` |
| `src/shared/time/recurrence.ts` | C: `firstOnOrAfter(rule, startDate, fromDate)`, `nextAfter(rule, date)`, `latestAtOrBefore(rule, startDate, time, zone, fold, instant)`, `occurrenceInstant(date, time, zone, fold)` (section 9.2) |
| `src/shared/time/zones.ts` | C: `zoneList()` (sorted `Intl.supportedValuesOf('timeZone')` + `UTC` + the system zone when missing), `isKnownZone(z)`, `currentSystemZone()` (`Intl...resolvedOptions().timeZone`, null when unknown), `defaultZoneFor({setting, system})`, `zoneCity(z)` ("New York" from `America/New_York`) |
| `src/shared/time/format.ts` | C: `formatInZone(instant, zone)` ("Fri 9 Oct 2026, 17:00"), `formatShort` ("Fri 9 Oct, 17:00"), `dueLines(instant, zone, displayZone)` → `{primary, local|null}`, `gapNotice`, `foldNotice` (exact copy section 10) |
| `src/shared/time/quiet-hours.ts` | C: `quietWindowAt(instant, q)` → `null \| {endUtc}` (section 9.4) |
| `src/shared/time/snooze.ts` | C: `SNOOZE_PRESETS`, `snoozeTarget(preset, now, zone)` (minutes: instant arithmetic; `tomorrow`: calendar tomorrow 09:00 in the reminder zone, fold earlier) |
| `src/shared/contracts/reminders.ts` | C: schemas of section 6.1, constants (`MAX_REMINDERS_PER_NOTE = 200`, `UNDO_DELETE_MS = 10_000`, `VIEW_LIMIT = 200`, `COMPLETED_VIEW_DAYS = 30`, `HOME_REMINDER_LIMIT = 5`), `REMINDER_MESSAGES` (section 10) |
| `src/shared/contracts/widget.ts` | C: `WidgetState`, `WIDGET_DEFAULT = {width:300,height:420}`, `WIDGET_MIN = {width:240,height:160}`, `WIDGET_HEADER_PX = 36`, `AutostartState` |
| `src/shared/contracts/windows.ts` | M: `WindowRole` gains `widget`; `AppOpenNoteEvent` gains `blockId: Uuid \| null` (optional on input, default null); `WindowGetStateResponse` main variant gains `openReminders: ReminderView \| null`, new variant `{role:'widget', widget: WidgetState}`; `AppOpenRemindersEvent` |
| `src/shared/contracts/app.ts` | M: none to shapes; capability reasons documented (section 8.10) |
| `src/shared/contracts/channel-names.ts`, `channels.ts`, `bridge.ts` | M: 17 invoke channels and 4 events (section 6.2) |
| `src/shared/contracts/channel-roles.ts` | M: sticky additions, `WIDGET_ALLOWED_CHANNELS`, `isChannelAllowed(role, channel)` for three roles |
| `src/shared/contracts/settings.ts` | M: `reminders.defaultZone`, `reminders.followupDefault`, `reminders.quietHours` (section 7) |
| `src/shared/routes.ts` | M: `#/widget` → `{kind:'widget'}`; `WIDGET_HASH` |
| `src/shared/editor/doc-schema.ts` | M: `collectBlockIds(doc): Set<string>` (same traversal as `collectAttachmentRefs`) |

Main:

| File | Change |
| --- | --- |
| `src/main/db/migrations/005_reminders.sql` | C (section 5) |
| `src/main/db/migrations/index.ts`, `checksums.json` | M: version 5 (`node tools/gen-migration-checksums.mjs`) |
| `src/main/db/repositories/reminders-repo.ts` | C: all reminder, occurrence and delivery SQL (prepared statements; the next-alert and due queries of section 9.5) |
| `src/main/services/reminder-service.ts` | C: CRUD, views, summary, complete, snooze, delete and undo, series generation (`ensureSeries`), zones list (section 8.2) |
| `src/main/services/reminder-anchors.ts` | C: in-transaction anchor sync called by `ContentIndexer` (section 8.3) |
| `src/main/services/content-indexer.ts` | M: optional `anchors` dependency; `index()` calls `anchors.sync(noteId, format, content)` |
| `src/main/services/reminder-scheduler.ts` | C: section 9.5 (tick, claim, dispatch, timer, recovery, jump detection, quiet deferral) |
| `src/main/services/notification-adapter.ts` | C: `NotificationAdapter` interface, `NotificationPayload`, `DeliveryOutcome`, `capabilityGate(adapter, caps)`, `createFakeNotificationAdapter()` (also used by the E2E hooks) |
| `src/main/services/electron-notifications.ts` | C: Electron `Notification` adapter (section 8.5) |
| `src/main/services/system-zone.ts` | C: `SystemZoneProvider {current(): string \| null}`, Intl provider, fixed/fake provider |
| `src/main/services/power-events.ts` | C: `PowerEvents {on(event: 'resume'\|'suspend'\|'unlock-screen', cb): () => void}` interface and fake; `electron-power.ts` C: binding over `powerMonitor` |
| `src/main/services/notification-probe.ts` | C: `detectNotificationServer(exec)` and pure `parseNameHasOwner` reuse from `tray-probe.ts` (both probes run in parallel inside the existing 2000 ms budget) |
| `src/main/services/autostart.ts` | C: pure `desktopEntry({exec, name})`, `autostartCapability({platform, isPackaged, wsl, appImage})`, `AutostartAdapter` interface; `electron-autostart.ts` C: Windows login items and the Linux XDG file (section 8.11) |
| `src/main/services/capabilities.ts` | M: `nativeNotifications` from the platform and the D-Bus probe; `launchAtLogin` from `autostartCapability`; override keys `nativeNotifications`, `launchAtLogin` |
| `src/main/services/messages.ts` | M: reminder error copy (or re-export `REMINDER_MESSAGES`) |
| `src/main/main-services.ts` | M: `reminders: ReminderService`, `anchors` passed to the `ContentIndexer`; `clock` for reminders injectable separately (`reminderClock`) |
| `src/main/windows/window-registry.ts` | M: `SenderInfo` gains `{role:'widget'}`; `widget()` lookup |
| `src/main/windows/widget-manager.ts` | C: section 8.8 (electron-free) |
| `src/main/windows/widget-window.ts` | C: pure `widgetWindowOptions(...)` and the Electron factory |
| `src/main/windows/main-window-controller.ts` | M: `openNote(noteId, takeEdit, blockId)`, `openReminders(view)` (queued like notes), `requestAttention()`; `MainWindowHandle` gains `flashFrame(on)`, `isFocused()`; `MainWindowEvents.onFocus` |
| `src/main/windows/main-window.ts` | M: handle methods and the focus event |
| `src/main/tray.ts` | M: item "Show widget" (between New sticky and Quit) |
| `src/main/window-lifecycle.ts` | M: F04-A1 (section 8.12) |
| `src/main/desktop.ts` | M: widget manager, scheduler start after the main window's first load, background start for `--launched-at-login` |
| `src/main/index.ts` | M: notification-server probe, reminder clock and zone provider (test seams), scheduler creation, settings and tree hooks calling `scheduler.wake`, `will-quit` stops the scheduler |
| `src/main/ipc/handlers/reminder-handlers.ts`, `widget-handlers.ts`, `autostart-handlers.ts` | C |
| `src/main/ipc/handlers/window-handlers.ts` | M: widget variant of `window:getState`; main variant returns `openReminders` |
| `src/main/ipc/register-handlers.ts` | M: new handler groups; `DesktopHandlerDeps` gains `widget`, `autostart` |
| `src/main/ipc/router.ts` | M: none beyond roles (ownership stays sticky-only; `reminder:open` checks sticky ownership in its handler) |
| `src/main/test-hooks.ts` | M: section 8.13 |

Renderer:

| File | Change |
| --- | --- |
| `src/renderer/App.tsx` | M: widget route → `WidgetApp`; `routeMatches` for `widget` |
| `src/renderer/reminders/reminders-store.ts` | C: views, counts, summary, actions, `reminder:changed` and `reminder:alert` handling (section 9.6) |
| `src/renderer/reminders/note-reminders.ts` | C: per-note list for chips and the panel; anchored versus note-level split |
| `src/renderer/reminders/ReminderDialog.tsx` | C: add and edit (section 9.7) |
| `src/renderer/reminders/ReminderRow.tsx`, `SnoozeMenu.tsx`, `DueTime.tsx`, `AlertBanner.tsx`, `ReminderChipBar.tsx` | C |
| `src/renderer/editor/reminder-chips.ts` | C: Tiptap extension with chip decorations (section 9.8) |
| `src/renderer/editor/extensions.ts`, `NoteEditor.tsx`, `Toolbar.tsx` | M: chips extension (rich), `reminderChips` prop, More menu "Add reminder…", `revealBlock` request |
| `src/renderer/notes/note-controller.ts`, `NoteView.tsx` | M: reveal request, persist-IDs flush for block anchoring, chip bar above the editor |
| `src/renderer/panel/ContextPanel.tsx`, `panel/RemindersSection.tsx` | M, C |
| `src/renderer/home/HomeView.tsx`, `home/RemindersSection.tsx` | M, C |
| `src/renderer/pages/RemindersPage.tsx` | M: replaced by the real page |
| `src/renderer/pages/SettingsPage.tsx` | M: Reminders section and Windows and tray additions (section 9.10) |
| `src/renderer/state/app-services.ts`, `tabs-store.ts`, `window-settings-store.ts` | M: reminders store, `app:openReminders`, `openNote({blockId})`, widget state, autostart state |
| `src/renderer/shell/Shell.tsx` (or `Notices.tsx`) | M: alert banner region and the startup overdue banner |
| `src/renderer/stickies/sticky-services.ts`, `StickyView.tsx` | M: chips for the sticky's note (read-only list; chip click calls `reminder:open`) |
| `src/renderer/widget/WidgetApp.tsx`, `widget-services.ts`, `WidgetHeader.tsx`, `WidgetList.tsx` | C (section 9.9) |
| `src/renderer/styles/reminders.css`, `widget.css` | C; imported in `main.tsx` |

Tests: section 12. Docs: this plan; `docs/DECISIONS.md` (D-073 to D-085, D-072 status), `docs/ARCHITECTURE.md` (sections 3, 4, 5, 8, 9, 15), `docs/UX_SPEC.md` (sections 5, 6), `docs/BACKLOG.md` (Phase 05 planned tests, W05 items, INF-DESK-02/03 notes). The implementer later updates BACKLOG status and writes `docs/progress/phase-05.md`.

## 4. Dependencies

None added. Luxon 3.7.2 (IANA zone arithmetic over the runtime ICU) is used by `src/shared/time/*` in main and renderer. Electron 44.7.0 provides `Notification`, `powerMonitor`, `app.setLoginItemSettings`/`getLoginItemSettings`, `BrowserWindow.flashFrame`. The Linux notification-server check runs the system `gdbus` (fallback `dbus-send`) with `execFile`, no shell, as the tray probe does. No apt package is installed anywhere (D-077).

## 5. Migration 005 (D-073)

`src/main/db/migrations/005_reminders.sql` (LF, no `user_version`):

```sql
-- Reminder series, their occurrences and alert delivery claims (Phase 05, D-073).
CREATE TABLE reminders (
  id                        TEXT PRIMARY KEY NOT NULL,
  note_id                   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id                  TEXT,
  anchor_state              TEXT NOT NULL DEFAULT 'ok' CHECK (anchor_state IN ('ok', 'block_missing')),
  title                     TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  zone_id                   TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 64),
  start_local_date          TEXT NOT NULL CHECK (start_local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  local_time                TEXT NOT NULL CHECK (local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  recurrence                TEXT CHECK (recurrence IS NULL OR json_valid(recurrence)),
  fold_preference           TEXT NOT NULL DEFAULT 'earlier' CHECK (fold_preference IN ('earlier', 'later')),
  followup_interval_minutes INTEGER CHECK (followup_interval_minutes IS NULL OR followup_interval_minutes IN (5, 10, 15, 30, 60)),
  max_followups             INTEGER NOT NULL DEFAULT 2 CHECK (max_followups IN (1, 2, 3, 5)),
  enabled                   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision                  INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  deleted_at                INTEGER,
  CHECK (block_id IS NOT NULL OR anchor_state = 'ok')
) STRICT;
CREATE INDEX reminders_note ON reminders(note_id);

CREATE TABLE occurrences (
  id                        TEXT PRIMARY KEY NOT NULL,
  reminder_id               TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  due_at_utc                INTEGER NOT NULL,
  original_local_date_time  TEXT NOT NULL,            -- 'YYYY-MM-DDTHH:mm' in the reminder zone
  state                     TEXT NOT NULL CHECK (state IN ('pending', 'snoozed', 'completed', 'missed', 'cancelled')),
  snoozed_until_utc         INTEGER,
  next_alert_at_utc         INTEGER,
  alert_sequence            INTEGER NOT NULL DEFAULT 0 CHECK (alert_sequence >= 0),   -- next sequence to claim
  followups_sent            INTEGER NOT NULL DEFAULT 0 CHECK (followups_sent >= 0),
  last_alert_at_utc         INTEGER,
  revision                  INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  completed_at              INTEGER,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  UNIQUE (reminder_id, due_at_utc),
  CHECK (state IN ('pending', 'snoozed') OR next_alert_at_utc IS NULL),
  CHECK (state <> 'snoozed' OR snoozed_until_utc IS NOT NULL),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
) STRICT;
CREATE INDEX occurrences_next_alert ON occurrences(next_alert_at_utc) WHERE next_alert_at_utc IS NOT NULL;
CREATE INDEX occurrences_reminder_due ON occurrences(reminder_id, due_at_utc);
CREATE INDEX occurrences_due ON occurrences(due_at_utc);

CREATE TABLE alert_deliveries (
  id              TEXT PRIMARY KEY NOT NULL,
  occurrence_id   TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  alert_sequence  INTEGER NOT NULL CHECK (alert_sequence >= 0),
  kind            TEXT NOT NULL CHECK (kind IN ('initial', 'followup', 'snooze')),
  presentation    TEXT NOT NULL CHECK (presentation IN ('single', 'summary')),
  batch_id        TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('timer', 'startup', 'resume', 'clock_jump', 'quiet_end', 'restore', 'write', 'settings', 'test')),
  claimed_at      INTEGER NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('claimed', 'dispatched', 'failed', 'unsupported', 'uncertain')),
  dispatched_at   INTEGER,
  detail          TEXT CHECK (detail IS NULL OR length(detail) <= 200),
  closed_at       INTEGER,
  clicked_at      INTEGER,
  UNIQUE (occurrence_id, alert_sequence)
) STRICT;
CREATE INDEX alert_deliveries_claimed ON alert_deliveries(outcome) WHERE outcome = 'claimed';
CREATE INDEX alert_deliveries_batch ON alert_deliveries(batch_id);
```

- The unique delivery key is `(occurrence_id, alert_sequence)`. A claim takes the occurrence's `alert_sequence` and increments it in the same transaction, so a sequence is never claimed twice, even across crashes or backward clock jumps.
- Suspension is derived, not stored: every scheduler and view query joins `notes` with `deleted_at IS NULL` and `reminders.deleted_at IS NULL` (D-073). Purging a note cascades reminders, occurrences and deliveries in the purge transaction.
- `enabled` is always 1 in Phase 05 (pack data model; no UI to disable); queries still require `enabled = 1`.
- `LATEST` becomes 5. A populated v4 database upgrades with a pre-migration copy (integration). Tests that hard-code 4 change to 5: `unit/migrations-checksum.test`, `integration/migrations.test`, `e2e/smoke.spec` (`schemaVersion`), `e2e/packaged.spec`.

## 6. Contracts and IPC (D-074)

### 6.1 Schemas (Zod 4 strict objects; `Uuid` from `ids.ts`, `HomeScope` from `home.ts`)

```ts
ZoneId        = string 1..64, /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/   // membership checked in main (isKnownZone)
LocalDate     = /^\d{4}-\d{2}-\d{2}$/ refined to a real calendar date, years 2000..2100
LocalTime     = /^([01]\d|2[0-3]):[0-5]\d$/
Recurrence    = null | {freq:'daily'} | {freq:'weekly', byWeekday: int 1..7 [] (1..7 items, unique; stored sorted)}
Followup      = null | {intervalMinutes: 5|10|15|30|60, maxFollowups: 1|2|3|5}
FoldPreference = 'earlier' | 'later'
ReminderTitle = trimmed string 1..200 without control characters
ReminderInput = { blockId: Uuid|null, title, zoneId, date: LocalDate, time: LocalTime, recurrence, foldPreference (default 'earlier'),
                  followup, allowPast: boolean (default false) }
ReminderCreateRequest  = { noteId: Uuid } & ReminderInput
ReminderUpdateRequest  = { reminderId: Uuid, expectedRevision: int>=1, pendingPolicy: 'keep'|'complete' (default 'keep') } & ReminderInput
ReminderIdRequest      = { reminderId: Uuid }
ReminderListForNoteRequest = { noteId: Uuid }
ReminderView           = 'today' | 'upcoming' | 'overdue' | 'completed'
RemindersListViewRequest = { view: ReminderView, scope: HomeScope (default {kind:'all'}) }
RemindersSummaryRequest  = { scope: HomeScope }
OccurrenceIdRequest      = { occurrenceId: Uuid }
SnoozePreset             = 5 | 10 | 15 | 30 | 60 | 'tomorrow'
OccurrenceSnoozeRequest  = { occurrenceId: Uuid, preset: SnoozePreset }
OccurrenceItem = { occurrenceId, reminderId, noteId, blockId: Uuid|null, anchorState, noteTitle: string, notePath: string[] (max 66),
                   title, zoneId, dueAtUtc: int, localDateTime: string, state: 'pending'|'snoozed'|'completed'|'missed'|'cancelled',
                   snoozedUntilUtc: int|null, effectiveAtUtc: int, overdue: boolean, alertsSent: int, followupsSent: int,
                   recurring: boolean, lastOutcome: 'dispatched'|'failed'|'unsupported'|'uncertain'|null, completedAt: int|null }
ReminderDto = { id, noteId, blockId, anchorState: 'ok'|'block_missing', title, zoneId, date, time, recurrence, foldPreference, followup,
                revision, createdAt, updatedAt, resolution: {status:'ok'|'gap'|'fold'}, current: OccurrenceItem|null }
ReminderListResponse     = { reminders: ReminderDto[] (max 200), asOf: int, displayZone: ZoneId|null }
ReminderViewResponse     = { view, asOf, displayZone: ZoneId|null, items: OccurrenceItem[] (max 200), counts: {today, upcoming, overdue} }
RemindersSummaryResponse = { asOf, displayZone, overdue: OccurrenceItem[] (max 5), overdueTotal, today: OccurrenceItem[] (max 5), todayTotal }
ZonesListResponse        = { zones: ZoneId[] (max 700), systemZone: ZoneId|null, defaultZone: ZoneId|null, asOf: int }
ReminderDeleteResponse   = { reminderId, undoUntil: int }
WidgetState              = { open: boolean, collapsed: boolean, alwaysOnTop: boolean }
AutostartState           = { enabled: boolean, capability: CapabilityStatus }
ReminderChangedEvent     = { reason: 'created'|'updated'|'deleted'|'restored'|'completed'|'snoozed'|'alerted'|'anchor'|'suspended'|'zone'|'settings',
                             noteIds: Uuid[] (max 1000) }
ReminderAlertEvent       = { batchId: Uuid, outcome: 'dispatched'|'failed'|'unsupported'|'uncertain', presentation: 'single'|'summary',
                             total: int>=1, items: OccurrenceItem[] (max 3) }
AppOpenRemindersEvent    = { view: ReminderView }
```

### 6.2 Channels added (appended in this order)

| Channel | Request | Response | Senders |
| --- | --- | --- | --- |
| `zones:list` | `{}` | `ZonesListResponse` | main |
| `reminder:create` | `ReminderCreateRequest` | `ReminderDto` | main |
| `reminder:update` | `ReminderUpdateRequest` | `ReminderDto` | main |
| `reminder:delete` | `ReminderIdRequest` | `ReminderDeleteResponse` | main |
| `reminder:undoDelete` | `ReminderIdRequest` | `ReminderDto` | main |
| `reminder:listForNote` | `ReminderListForNoteRequest` | `ReminderListResponse` | main, own sticky |
| `reminder:open` | `ReminderIdRequest` | `{}` | main, widget, own sticky (handler checks the reminder's note) |
| `reminders:listView` | `RemindersListViewRequest` | `ReminderViewResponse` | main, widget |
| `reminders:summary` | `RemindersSummaryRequest` | `RemindersSummaryResponse` | main |
| `occurrence:complete` | `OccurrenceIdRequest` | `OccurrenceItem` | main, widget |
| `occurrence:snooze` | `OccurrenceSnoozeRequest` | `OccurrenceItem` | main, widget |
| `widget:show` | `{}` | `WidgetState` | main |
| `widget:hide` | `{}` | `WidgetState` | main, widget |
| `widget:setPinned` | `{pinned: boolean}` | `WidgetState` | main, widget |
| `widget:setCollapsed` | `{collapsed: boolean}` | `WidgetState` | main, widget |
| `autostart:get` | `{}` | `AutostartState` | main |
| `autostart:set` | `{enabled: boolean}` | `AutostartState` | main |

Events appended: `reminder:changed` (broadcast), `reminder:alert` (main window and widget), `widget:state` (`WidgetState`; main window and widget), `app:openReminders` (main window only, queued like `app:openNote`). `app:openNote` gains `blockId`. `autostart:get|set` move from the Phase 08 row of the catalogue (D-082). Totals: 67 invoke channels, 12 events.

Error codes and copy (section 10): `NOT_FOUND` "This note no longer exists" (missing or trashed note; trashed carries `{trashed:true, trashBatchId}`), `NOT_FOUND` "This reminder no longer exists"; `VALIDATION_FAILED` "Choose a time zone from the list", "This time has already passed" (`details {past:true, dueAtUtc}`), "This part of the note is not saved yet" (`details {blockMissing:true}`), "Plain-text notes can only have note-level reminders", "This reminder is not due yet" (snooze before due), "This reminder can no longer be snoozed" (snooze of a missed or completed occurrence), "This reminder was replaced by an edit" (complete or snooze of a cancelled occurrence), "Undo is no longer available"; `CONFLICT` "This reminder changed elsewhere. Reopen it to edit." (`details {currentRevision}`); `LIMIT_EXCEEDED` "A note can have at most 200 reminders."; `UNSUPPORTED` "Not supported by this desktop" (pin without always-on-top; autostart where unsupported); `FORBIDDEN` for role and ownership violations.

### 6.3 Bridge (`window.infinity`, frozen)

```
zones:     { list }
reminder:  { create, update, delete, undoDelete, listForNote, open }
reminders: { listView, summary }
occurrence:{ complete, snooze }
widget:    { show, hide, setPinned, setCollapsed }
autostart: { get, set }
```

`subscribe` accepts the four new events. `security.spec › bridge surface` asserts the new exact key set; its subscribe probe uses `'suggestion:dismiss'` (Phase 06).

### 6.4 Roles and allowlists (D-074)

- `WindowRole` = `main | sticky | widget`; the registry records the widget window with `{role:'widget'}`.
- Sticky additions to `STICKY_ALLOWED_CHANNELS`: `reminder:listForNote` (router ownership by `noteId`) and `reminder:open` (handler: when the sender is a sticky, the reminder's `note_id` must equal the sticky's note, else `FORBIDDEN`).
- `WIDGET_ALLOWED_CHANNELS`: `app:getInfo`, `app:quit`, `app:flushed`, `capabilities:get`, `settings:get`, `window:getState`, `reminders:listView`, `occurrence:complete`, `occurrence:snooze`, `reminder:open`, `widget:hide`, `widget:setPinned`, `widget:setCollapsed`. Everything else answers `FORBIDDEN` for the widget, notably every `note:`, `lease:`, `session:`, `tree:`, `trash:` channel, `reminder:create|update|delete` and `widget:show`.
- `isChannelAllowed(role, channel)`: main → all; sticky → sticky set; widget → widget set.

## 7. Settings registry (D-083)

| Key | Schema | Default | Public |
| --- | --- | --- | --- |
| `reminders.defaultZone` | `ZoneId \| null` (null = follow the computer's zone) | `null` | yes |
| `reminders.followupDefault` | `{enabled: boolean, intervalMinutes: 5\|10\|15\|30\|60, maxFollowups: 1\|2\|3\|5}` | `{enabled:false, intervalMinutes:15, maxFollowups:2}` | yes |
| `reminders.quietHours` | `{enabled: boolean, start: LocalTime, end: LocalTime, zoneId: ZoneId \| null}` refined: `start != end`; `enabled` requires `zoneId` | `{enabled:false, start:'22:00', end:'07:00', zoneId:null}` | yes |

`settings:set` validates the schema; `SettingsService` additionally rejects an unknown zone (`isKnownZone`) with `VALIDATION_FAILED` "Choose a time zone from the list" (a registry `refine` using `isKnownZone`, which is shared and pure). A fresh launch still writes no settings row. `reminders.endOfDayTime` and `reminders.dateOnlyTime` arrive with Phase 06.

## 8. Main process design

### 8.1 Composition

`index.ts` creates, only when storage is up: `reminderClock` (`systemClock`, or the frozen `FakeClock` from `INFINITY_NOTES_TEST_CLOCK` under test hooks), `zones` (`IntlZoneProvider`, or `FixedZoneProvider` from `INFINITY_NOTES_TEST_ZONE` under hooks), the notification adapter (`capabilityGate(electronAdapter or hooks.fakeNotifications, caps)`), `powerEvents` (`electron-power.ts`), then `ReminderScheduler`. Settings changes on `reminders.*` and `tree:changed` with reason `trash`, `restore` or `purge` call `scheduler.wake(...)` and broadcast `reminder:changed` (`settings` / `suspended`). `desktop.start()` starts the scheduler after the main window's first load (or immediately in a background start), so the startup recovery alert has a main window to fall back to. `will-quit` calls `scheduler.stop()` (clears its single timer and power listeners). Without storage there is no scheduler and every reminder channel answers INTERNAL "Storage is unavailable".

### 8.2 `ReminderService` (`reminder-service.ts`; INF-REM-01, 05, 09, 10, 13, 17, 18; INF-HOME-04)

All writes run in `db.transaction(..., 'immediate')`; after commit they emit `reminder:changed` and call `onWrite()` (the scheduler's `wake('write')`).

- `zones()`: `{zones: zoneList(), systemZone, defaultZone: setting ?? systemZone (when known) ?? null, asOf: clock.now()}`. `defaultZoneFor` never returns a hard-coded zone; with an unknown system zone and no setting the dialog requires a choice.
- `create(req)`: note exists and is live (`NOT_FOUND` otherwise); `isKnownZone(zoneId)`; plain note with `blockId` → error; `blockId` must be in `collectBlockIds(stored content_json)` (`blockMissing`); at most 200 live reminders per note. Resolve the first occurrence: one-time → `resolveLocal(date, time, zone, fold)`; recurring → `firstOnOrAfter(rule, date, todayIn(zone))` whose instant is after now (past dates of a series are skipped, never alerted). One-time with instant `<= now` needs `allowPast` (`past` error otherwise) and is stored `pending` with `next_alert_at_utc = NULL` (overdue, no notification). Otherwise `next_alert_at_utc = due_at_utc`. Returns the DTO with `resolution.status`.
- `update(req)`: revision check (`CONFLICT`). Schedule fields are zone, date, time, recurrence, fold. Non-schedule changes (title, follow-up, block) update the series only; occurrence rows and their IDs are unchanged (a follow-up change takes effect at the next claim). A schedule change: (a) open occurrences not yet due (`due_at_utc > now`) are deleted (they have no deliveries by construction, asserted by a test); (b) a recurring series' open overdue occurrence follows `pendingPolicy`: `keep` leaves it unchanged, `complete` completes it; (c) a one-time reminder's open overdue occurrence is replaced: deleted when it has no deliveries, else marked `cancelled` with `next_alert_at_utc = NULL`; (d) the first new occurrence is generated as in create (one-time past still needs `allowPast`). `revision + 1`.
- `delete(id)`: sets `deleted_at = now`, returns `undoUntil = now + 10 s`. `undoDelete(id)`: clears it when `now <= deleted_at + 10 s`, else "Undo is no longer available". Deleted reminders are excluded from every view, summary, chip list and scheduler query.
- `listForNote(noteId)`: live reminders of the note (including note-level and `block_missing`) with their `current` occurrence (the open one with the smallest effective time, else the latest completed).
- Views (section 9.3): `listView(view, scope)` and `summary(scope)` in the display zone `zones.current()`.
- `complete(occurrenceId)`: `UPDATE ... SET state='completed', completed_at=now, next_alert_at_utc=NULL, snoozed_until_utc=NULL, revision=revision+1 WHERE id=? AND state IN ('pending','snoozed','missed')`; already completed → returns the item unchanged (idempotent); cancelled → "This reminder was replaced by an edit". For a recurring series `ensureSeries(reminderId, now)` runs in the same transaction, so a series always keeps one future open occurrence (Done ahead of time completes only that occurrence).
- `snooze(occurrenceId, preset)`: requires state `pending` or `snoozed` ("This reminder can no longer be snoozed" for missed or completed, "This reminder was replaced by an edit" for cancelled) and `due_at_utc <= now` ("This reminder is not due yet" otherwise). `target = snoozeTarget(preset, now, reminder.zone)`; `state='snoozed', snoozed_until_utc=target, next_alert_at_utc=target, revision+1`. The series is not touched.
- `ensureSeries(reminderId?, now)` (also called by the scheduler each tick for every live recurring series without a future open occurrence): let `L = latestAtOrBefore(rule, start, time, zone, fold, now)`; insert `L` (pending, `next_alert_at_utc = due`) with `INSERT ... ON CONFLICT(reminder_id, due_at_utc) DO NOTHING` when it is newer than the newest existing occurrence; mark every older open occurrence of the series `missed` (`next_alert_at_utc = NULL`); then insert the first instant after `max(now, newest due)` the same way. An existing row at an instant (for example one completed early) counts as that occurrence; generation then continues to the next instant. Intermediate instants are never created (D-078). Bounded: `latestAtOrBefore` steps back at most 7 local days.

### 8.3 `ReminderAnchors` (INF-REM-04, INF-REM-17)

`ContentIndexer.index()` calls `anchors.sync(noteId, format, content)` inside the content transaction. It reads `SELECT id, block_id, anchor_state FROM reminders WHERE note_id=? AND block_id IS NOT NULL AND deleted_at IS NULL` and returns at once when empty. Otherwise it collects the document's block IDs (plain format: none) and sets `anchor_state` to `ok` or `block_missing` for rows whose state changes, remembering the note ID. `main-services` wraps `onNoteRevision`: after the revision event, a note with changed anchors also broadcasts `reminder:changed {reason:'anchor'}` (an extra event after a rolled-back transaction is harmless; the renderer re-reads). Reminders with `block_missing` stay note-linked and keep alerting. Keep note-level = `reminder:update` with `blockId: null`; Re-anchor = `reminder:update` with the block at the cursor.

### 8.4 Display zone and OS zone changes (INF-REM-02, 03, 15; D-079)

`SystemZoneProvider.current()` is read on every scheduler wake, every view or summary query and every `zones:list`. When it differs from the last value the scheduler logs `reminders: system zone <old> -> <new>` and broadcasts `reminder:changed {reason:'zone'}`. Stored reminder zones and due instants never change. Electron's main process may only see an OS zone change after a restart; that limitation is stated in the report, and the live change is tested through the provider seam (no test changes the host's zone).

### 8.5 Notification adapter (INF-REM-06, 07, 08, 16; INF-SCHED-04; D-076)

```ts
interface NotificationPayload { ref: string /* delivery batch id */; title: string; body: string }
type DeliveryOutcome = { outcome: 'dispatched' | 'failed' | 'unsupported' | 'uncertain'; detail?: string }
interface NotificationAdapter {
  show(p: NotificationPayload): Promise<DeliveryOutcome>;
  onClick(cb: (ref: string) => void): () => void;
  onClose(cb: (ref: string) => void): () => void;
}
```

- `capabilityGate(adapter, caps)`: when `caps.nativeNotifications.status === 'unsupported'` it returns `{outcome:'unsupported', detail: reason}` without calling the adapter.
- Electron adapter: `new Notification({title, body, silent:false, ...(linux ? {icon} : {})})` with no `actions`, no `toastXml`, no `hasReply` (D-026). Listeners for `failed`, `show`, `click`, `close` are attached before `show()` (Linux fires `failed` synchronously, probe). First of: `show` → `dispatched`; `failed` or a throw → `failed` with the error text (200 characters); neither within 3000 ms → `uncertain` (`no-show-event`). Shown notifications are kept in a map (at most 50, oldest released) so click events survive garbage collection.
- Fake adapter (integration tests and E2E hooks): records `{id, ref, title, body, at}`; modes `ok`, `fail`, `hang`, `throw`; `click(id)`, `close(id)`.
- Content: single → title = reminder title, body = `Due <formatShort in reminder zone> · <note title>`; summary → title "Infinity Notes", body "N reminders are overdue". Click: single → `openSource(occurrenceId)` (record `clicked_at`, `mainWindow.openNote(noteId, false, blockId)`, which shows and focuses or recreates the main window); summary → `mainWindow.openReminders('overdue')`. Close → `closed_at` only; never a state change.
- In-app fallback: when the outcome is not `dispatched`, the scheduler emits `reminder:alert` (main window banner, section 9.6) and calls `mainWindow.requestAttention()` (`flashFrame(true)` when the main window exists and is not focused; cleared on focus).

### 8.6 Scheduler (INF-SCHED-01 to 09; D-075): see section 9.5 for the algorithm.

### 8.7 `MainWindowController` changes

`openNote(noteId, takeEdit, blockId = null)` (queue entries keep the latest `blockId` per note), `openReminders(view)` (one pending view, delivered in `window:getState` as `openReminders` or sent as `app:openReminders` when ready), `requestAttention()`.

### 8.8 `WidgetManager` (`widget-manager.ts`; INF-WIDG-01..03; D-081)

Electron-free, the same pattern as `StickyManager`, one window, key `widget` in `window_state` (no migration needed; the 004 CHECK allows it).

- `show()`: create or focus the window (`widgetWindowOptions`: 300x420 default, minimum 240x160, native frame, title "Reminders - Infinity Notes", `secureWebPreferences`, `removeMenu()`, URL `#/widget`, position only where `windowPositioning` is supported, bounds from `computeStickyBounds` with the stored bounds). Stores `open = 1`, broadcasts `widget:state`.
- `hide()` (Hide button, OS close button): save bounds, `open = 0`, destroy the window (no hidden renderer). No flush is needed (the widget has no editor), but on Quit the widget renderer answers `app:flush-request` with `saved: true`.
- `setCollapsed(c)`: collapsed → `setMinimumSize(240, 36)`, `setContentSize(w, 36)`, not resizable; expanded → stored size, resizable. `setPinned(p)`: `UNSUPPORTED` "Not supported by this desktop" when `alwaysOnTop` is `unsupported` (nothing stored), else `setAlwaysOnTop` and store.
- Bounds saved 500 ms after move or resize, and at hide and quit (`prepareQuit` keeps `open = 1`). `restoreOnStartup()`: if the row has `open = 1`, show it inactive after the main window's first load (default off: no row means no widget).
- `state(): WidgetState`; `onClose` from the OS calls `hide()`.

### 8.9 Tray (D-067 completed)

`TRAY_LABELS` gains `showWidget: 'Show widget'`; menu order "Open Infinity Notes", "New sticky", "Show widget", separator, "Quit Infinity Notes". "Show widget" calls `widget.show()`.

### 8.10 Capabilities

- `nativeNotifications`: Windows `supported('native-windows')`; Linux from `detectNotificationServer` (`NameHasOwner org.freedesktop.Notifications`): `supported('notification-server')`, `unsupported('no-notification-server')`, or `unknown('notification-server-unknown')` (unknown still tries the adapter and records the outcome). Probe runs in parallel with the tray probe within the same 2000 ms bound.
- `notificationActions`: stays `unsupported('not-promised-on-all-desktops')` (D-026).
- `launchAtLogin`: `autostartCapability`: unpackaged → `unsupported('development-build')`; Windows packaged → `supported('login-items')`; Linux packaged under WSL → `unsupported('wsl-no-session-autostart')`; other Linux packaged → `supported('xdg-autostart')` (outside the validation scope).
- Override keys (hooks only): `nativeNotifications`, `launchAtLogin`. Startup log line gains `notifications=<s>(<reason>) autostart=<s>`.

### 8.11 Launch at login (D-082; INF-DESK-03 mechanism)

- `autostart:get` reads the OS state: Windows `app.getLoginItemSettings({args:['--launched-at-login']}).openAtLogin`; Linux the presence of `$XDG_CONFIG_HOME/autostart/infinity-notes.desktop` (default `~/.config`) whose `Exec` names this executable.
- `autostart:set {enabled}`: `UNSUPPORTED` unless the capability is `supported`. Windows `app.setLoginItemSettings({openAtLogin, path: process.execPath, args:['--launched-at-login']})`. Linux writes or removes the file atomically: `[Desktop Entry]`, `Type=Application`, `Name=Infinity Notes`, `Exec=<quoted executable> --launched-at-login` (AppImage path from `APPIMAGE`, else `process.execPath`; quoting per the Desktop Entry spec: double quotes, escaping `"`, `` ` ``, `$`, `\`), `X-GNOME-Autostart-enabled=true`, `NoDisplay=true`. A failure answers INTERNAL "Could not change the startup setting" and leaves the previous state.
- Started with `--launched-at-login`: when the tray is `supported`, the app starts in the background (no main window; the widget is restored if it was open); otherwise the main window opens as usual.
- Tests never change the real login items or the user's autostart folder: unit tests cover the pure builders; integration tests write into a temporary `XDG_CONFIG_HOME`; the packaged E2E only reads `autostart:get`.

### 8.12 Window lifecycle (F04-A1; D-085)

Replace `quitCanceled: boolean` with `quitEscapeArmedAt: number | null`. A Quit whose flush reports unsaved windows proceeds only when the escape is armed and `now - armedAt <= 120_000`; otherwise it is canceled and arms the escape (`armedAt = now`). Every Quit attempt consumes the escape (sets it to null before deciding), so it covers exactly one following Quit. A Quit whose flush reports every window saved exits and leaves the escape cleared. The renderer copy stays "Quit again to quit without saving it."

### 8.13 Test hooks and seams (only `!app.isPackaged && INFINITY_NOTES_E2E === '1'`; D-084)

- F04-A2: `onFreshTask<T>(fn: () => T): Promise<T>` resolves `fn()` inside `setImmediate`. Every hook that reads or writes the database uses it: `windows()`, `reminders()`, `deliveries()`, `widget()`, and the clock and notification actions that trigger a scheduler tick. A hook therefore never runs SQL inside a statement that a Playwright inspector interrupt paused. Helpers in `sticky-ui.ts` await the promise; a comment there states the rule.
- Environment: `INFINITY_NOTES_TEST_CLOCK` (ISO instant; frozen `FakeClock` for the reminder subsystem only, wall and monotonic both frozen), `INFINITY_NOTES_TEST_ZONE` (IANA zone for the system zone provider), `INFINITY_NOTES_TEST_NOTIFY` (`fake`, the default under hooks, or `real`), `INFINITY_NOTES_TEST_CAPS` gains `nativeNotifications` and `launchAtLogin`. Packaged builds ignore all of them (`packaged.spec` asserts it).
- `__infinityTest` additions: `clock: {now(), set(iso), advance(ms), jump(ms)}` (advance moves wall and monotonic, jump moves wall only; each returns after the triggered tick finished: `await scheduler.idle()`); `notifications: {mode, shown(), click(id), close(id)}`; `zone: {set(zone)}`; `power: {emit('resume'|'suspend'|'unlock-screen')}`; `scheduler: {timer(): {armed, delayMs}, ticks(): number, idle(): Promise<void>}`; `reminders(): Promise<{reminders, occurrences, deliveries}>` (raw rows, fresh task); `widget(): Promise<{webContentsId, visible, bounds, contentSize, alwaysOnTop, resizable} | null>`; `autostart` (fake adapter recording calls, used only in unpackaged E2E).

### 8.14 Logging

`reminders: tick reason=<r> due=<n> claimed=<n> deferred=<n> presentation=<single|summary> batch=<id>`, `reminders: dispatch delivery=<id> outcome=<o>`, `reminders: timer delay=<ms>`, `reminders: clock jump delta=<ms> direction=<forward|backward>`, `reminders: stale claims marked uncertain count=<n>`, `reminders: system zone <a> -> <b>`, `widget: show|hide|restore`, `autostart: set enabled=<b> result=<ok|error>`. Logs never contain titles or note text.

## 9. Algorithms and renderer

### 9.1 `resolveLocal` (D-079; INF-REM-14)

1. `naive = Date.UTC(y, m-1, d, hh, mm)`. Candidates: `naive - offset(zone, naive - 12 h)` and `naive - offset(zone, naive + 12 h)` (Luxon `IANAZone.offset`). Keep candidates whose local rendering (`yyyy-MM-dd'T'HH:mm` in the zone) equals the request; dedupe and sort.
2. One candidate → `ok`. Two → `fold`; `instantUtc` = earlier or later per preference; `alternatives` = both.
3. None → `gap`: binary search on whole minutes in `[naive - 14 h, naive + 14 h]` for the first instant whose local rendering is `>=` the request (string comparison of the fixed-width format) → the first valid instant after the gap.
4. Invalid date, time or zone → throws `RangeError` (callers validate first).

### 9.2 Recurrence (INF-REM-12)

Rules work on local dates in the reminder zone. Daily: every date. Weekly: dates whose ISO weekday is in `byWeekday`. `occurrenceInstant(date)` = `resolveLocal(date, time, zone, foldPreference).instantUtc` (gap rule for that day only; fold → one instant by preference, never two). `latestAtOrBefore(instant)`: local date of `instant` in the zone, step back over at most 7 dates to the newest matching date `>= start` whose instant `<= instant`. Snooze durations and follow-up intervals are instant arithmetic; the series stays on wall-clock time.

### 9.3 Views (INF-REM-05; INF-HOME-04)

`effectiveAt = state === 'snoozed' ? snoozed_until_utc : due_at_utc`. Display zone `Z = zones.current()`; when the computer's zone is unknown, `Z` is the `reminders.defaultZone` setting; when both are unknown, day boundaries use `FALLBACK_DAY_ZONE = 'UTC'` from `zones.ts` and the Reminders page and Home say "Your computer's time zone is unknown; days are shown in UTC." (disclosed, never stored on a reminder). `endOfToday = start of tomorrow in Z`.

- overdue: open (`pending`, `snoozed`) with `effectiveAt <= now`, ordered by `effectiveAt` ascending;
- today: open with `now < effectiveAt < endOfToday`, ascending;
- upcoming: open with `effectiveAt >= endOfToday`, ascending, at most 200;
- completed: `completed` (by `completed_at`) and `missed` (by `due_at_utc`) within the last 30 days, descending, at most 200.

All views exclude deleted reminders, trashed notes and `cancelled`. `scope` filters by the note's project (`all`, `common` = project null, `project`). `counts` covers today, upcoming and overdue. `summary(scope)` = the first 5 of overdue and today plus totals.

### 9.4 Quiet hours (INF-SCHED-06)

Setting `{enabled, start, end, zoneId}`. For an instant `t`, local time `l` of `t` in `zoneId`. Same-day window (`start < end`): quiet when `start <= l < end`, end = today's `end`. Overnight window (`start > end`): quiet when `l >= start` (end = tomorrow's `end`) or `l < end` (end = today's `end`). End instants use `resolveLocal(..., 'earlier')` (a gap end moves to the first valid instant).

### 9.5 Scheduler (`reminder-scheduler.ts`; D-075)

Constants: `TIMER_CAP_MS = 60_000`, `CLOCK_JUMP_MS = 120_000`, `MAX_SINGLE_PER_BATCH = 3`, `NOTIFY_CONFIRM_MS = 3_000` (in the adapter), `DUE_CHUNK = 500`, no-progress backoff 1 s doubling to 60 s.

```
start():
  tx: UPDATE alert_deliveries SET outcome='uncertain', detail='claimed-before-restart' WHERE outcome='claimed'   (log count)
  subscribe power resume/unlock-screen -> wake('resume'); record last = {wall, mono}
  wake('startup')

wake(reason): remember the strongest pending reason; if no tick is running schedule tick on setImmediate; else rerun=true

tick(reason):
  now = clock.now(); mono = clock.monotonicNow()
  if last: drift = (now - last.wall) - (mono - last.mono)
     drift >  120 s -> reason = 'clock_jump' (forward: recovery);  drift < -120 s -> log backward, no special dispatch
  last = {now, mono}; zone check (8.4)
  tx: ensureSeries for every live recurring series without an open occurrence after now
  if quiet(now): tx: UPDATE occurrences SET next_alert_at_utc = quietEnd, revision = revision+1
                     WHERE next_alert_at_utc <= now AND state IN ('pending','snoozed') AND <live>    -> deferred count; remember quietEnd
                 due = []
  else: due = repo.dueForAlert(now)       -- next_alert_at_utc <= now, open, enabled, reminder and note live; ordered; chunked by 500
        if reason == 'timer' and a remembered quietEnd <= now: reason = 'quiet_end'
  presentation = due.length > 3 ? 'summary' : 'single'; batchId = uuid
  claimed = []
  for occ in due:
     hooks.beforeClaim?.(occ)                       -- test seam for races (integration only)
     kind = occ.state == 'snoozed' ? 'snooze' : occ.alert_sequence == 0 ? 'initial' : 'followup'
     sent = occ.followups_sent + (kind == 'followup' ? 1 : 0)
     next = interval != null && sent < max ? now + interval*60_000 : null
     tx: UPDATE occurrences SET alert_sequence=alert_sequence+1, followups_sent=sent, state='pending', snoozed_until_utc=NULL,
                                last_alert_at_utc=now, next_alert_at_utc=next, revision=revision+1, updated_at=now
         WHERE id=? AND revision=? AND state IN ('pending','snoozed') AND next_alert_at_utc IS NOT NULL AND next_alert_at_utc <= now
         changes == 0 -> skip (Done, Snooze or an edit won; nothing dispatched)
         INSERT alert_deliveries(id, occ.id, occ.alert_sequence, kind, presentation, batchId, reason, now, 'claimed')
     claimed.push(...)
  if claimed: emit reminder:changed {alerted}
  dispatch (after every claim committed):
     single: for each claimed: outcome = await adapter.show(single payload)   (the tick does not hold a transaction while awaiting)
     summary: outcome = await adapter.show(summary payload with total = claimed.length), applied to every claim of the batch
     tx: UPDATE alert_deliveries SET outcome=?, dispatched_at=(outcome=='dispatched' ? now : NULL), detail=? WHERE id IN (...) AND outcome='claimed'
     outcome != 'dispatched' -> emit reminder:alert (items: up to 3 claimed items, total) and requestAttention()
  arm timer:
     next = repo.minNextAlert()   -- live occurrences only (same joins as dueForAlert) using occurrences_next_alert
     delay = next == null ? 60 s : clamp(next - clock.now(), 0, 60 s)
     if delay == 0 and this tick claimed and deferred nothing -> delay = backoff (1 s, 2 s, ... 60 s), log once
     clearTimeout(previous); timer = setTimeout(() => wake('timer'), delay)     -- the only timer
  if rerun: rerun=false; tick(pendingReason)
```

- Done and Snooze always win: they bump `revision` without requiring the caller's revision, so a claim prepared earlier matches 0 rows and nothing is dispatched. A user action that lands while a dispatch is awaited changes the occurrence (for example snoozed, follow-ups replaced by the snooze target); the delivery outcome update touches only the delivery row.
- Follow-ups that fell into downtime, sleep or quiet hours are not replayed: the occurrence has one `next_alert_at_utc`; when it is reached late, it is claimed once (kind by the rule above, counted once) and the cadence restarts from the claim time.
- A delivery attempt never completes an occurrence. `uncertain` and `failed` occurrences stay overdue in every view.
- Recovery reasons (`startup`, `resume`, `clock_jump`, `quiet_end`, `restore`) follow the same batch rule; the rule applies to every tick, so a minute with many due reminders also produces one summary (D-075). The main window additionally shows the startup overdue banner (section 9.6).
- Trash restore: `tree:changed {restore}` → `wake('restore')`; occurrences that fell due while trashed are due now and follow the batch rule (no flood).

### 9.6 Renderer state (main window)

- `RemindersStore` (`reminders-store.ts`): `{view, items, counts, displayZone, asOf, loading, error}`, `summary` for Home, `widgetState`, `alerts: AlertEntry[]` (at most 3 single entries; a 4th or a summary event collapses them into one summary entry), `startupOverdue: number | null`. Subscribes `reminder:changed` (reload the visible view, counts, Home summary and the active note's reminders), `reminder:alert` (push banner), `widget:state`, `app:openReminders` (open the Reminders tab on that view). On init: `reminders:summary` → `startupOverdue = overdueTotal` when > 0 (banner "N reminders are overdue" / "1 reminder is overdue" with "Show overdue").
- Actions: `complete`, `snooze(preset)`, `open(item)` (`tabs.openNote(noteId, {takeEdit:false, blockId})`), `edit(reminderId)`, `delete` (notice "Reminder deleted" with Undo for 10 s → `reminder:undoDelete`), `showWidget`/`hideWidget`. Failures show the error message as a notice.
- `tabs.openNote(noteId, {blockId})` passes `revealBlockId` to the note controller; on editor mount the editor selects the start of `[data-id=blockId]`, scrolls it into view and adds the class `reveal-block` for 2 s; an unknown block shows the notice "The linked paragraph is no longer in this note."

### 9.7 Reminder dialog (`ReminderDialog.tsx`; INF-REM-01, 02, 03, 11, 13, 14)

Opened from the note (Toolbar More "Add reminder…", side panel "Add reminder", the panel row Edit, Reminders page Edit). Fields in order: Title (prefill: the anchored block's text, first 80 characters, else the note title), date shortcuts "Today" and "Tomorrow" (calendar dates computed in the selected zone from `asOf`), Date (`input type=date`), Time (`input type=time`, default 09:00), Time zone (`select` of `zones`, default `defaultZone`; when null the select starts empty and Save is disabled with "Choose a time zone"), Repeat (`None`, `Daily`, `Weekly` with weekday toggle buttons Mon to Sun, `aria-pressed`, at least one), Follow-up (switch "Follow up if not done", then "Every" 5/10/15/30/60 minutes and "At most" 1/2/3/5 times; initial values from `reminders.followupDefault`, which is off by default).

Live preview (shared `resolveLocal` + `dueLines`): primary "Fri 9 Oct 2026, 17:00 · Asia/Dhaka"; local line "Your time: Fri 9 Oct 2026, 07:00 · America/New_York" only when the wall-clock text differs; gap notice; fold notice with a checkbox "Use the later one (<abbr>)" bound to `foldPreference`. Save: create or update. On `past` the dialog shows "This time has already passed. It will be added as overdue, without a notification." with "Add anyway" (resends with `allowPast: true`). On `blockMissing` the dialog asks the note controller to persist block IDs (mark dirty and flush) and retries once; if the note is read-only it offers "Attach to the note instead" (`blockId: null`). Edit of a recurring series whose current occurrence is overdue shows, when a schedule field changed, the radio "Keep the current overdue reminder" (default) / "Mark it done". `CONFLICT` shows its message and reloads the reminder.

### 9.8 Chips (INF-REM-04; D-080)

- `ReminderChips` Tiptap extension (rich notes): plugin state `Map<blockId, ChipInfo[]>` set by a transaction with `setMeta(chipsKey, chips)` and `addToHistory: false` and no document change, so `isUserEdit` is false (no save, no revision). Decorations: for a textblock, a widget at the end of its content; for a container (blockquote, listItem, taskItem), at the end of its first textblock; for an atom (image, fileAttachment), a widget right after the node. The chip DOM is a `<button contenteditable="false" class="reminder-chip" data-reminder-id>` with a bell icon, `formatShort` of the effective time in the reminder zone and a state class (`overdue`, `snoozed`, `done`); `aria-label` "Reminder: <title>, <primary due line>". `ignoreMutation` and `stopEvent` for the chip; click opens the edit dialog (main window) or calls `reminder:open` (sticky). Copy and paste never include chips (decorations are not content).
- `ReminderChipBar` above the editor (rich and plain notes): note-level reminders and `block_missing` ones ("Original text was removed").
- `NoteReminders` per active note: `reminder:listForNote` on open and on `reminder:changed`; the editor receives chips through a prop and dispatches the meta transaction on change.

### 9.9 Widget renderer (`#/widget`; INF-WIDG-01..03; D-081)

`WidgetApp` (route check against `window:getState` role `widget`), `widget-services.ts`: core services (theme), `reminders:listView` for the selected view plus counts, subscriptions `reminder:changed` (reload), `widget:state`, `settings:changed` (theme), `app:flush-request` → `app.flushed({saved:true})`. `WidgetHeader` (36 px, `role="toolbar"`, label "Reminder widget"): heading "Reminders", pin "Keep on top" (`aria-pressed`; `aria-disabled` with tooltip "Not supported by this desktop" where unsupported), collapse "Collapse widget"/"Expand widget" (`aria-expanded`), "Hide widget". Body (hidden while collapsed): segmented `Today`, `Upcoming`, `Overdue` with counts (initial view Overdue when it has items, else Today); rows with title, source path, `DueTime` lines, state badge, buttons "Open" (`reminder:open`), "Snooze" (menu, only when overdue), "Done". Empty texts as the page. Keyboard: tab order header → segments → rows; Escape closes the snooze menu.

### 9.10 Pages and settings

- Reminders page: header with the title "Reminders" and the button "Show widget"/"Hide widget"; `role="tablist"` tabs Today, Upcoming, Overdue, Completed with counts in the accessible name ("Overdue, 2"); rows (`ReminderRow`): title, source path, due lines, badges (Overdue, Snoozed until …, Missed, Done, Recurring icon with "Repeats daily"/"Repeats weekly"), actions Open, Snooze (overdue only), Done (open only), Edit, Delete (menu). Empty texts (section 10).
- Home: `RemindersSection` after Recent: label "Reminders", subsections "Overdue" and "Due today" (up to 5 each, scope = Home filter), link "Open Reminders"; empty "Nothing overdue or due today."
- Context panel: `RemindersSection` (heading "Reminders", button "Add reminder", rows with due lines and actions Done, Snooze, Edit, Delete; anchor-missing rows with "Original text was removed", "Attach to current paragraph" (enabled when the editor selection is inside a block with an ID) and "Keep note-level").
- Alert banner region (`role="status"`, above the tab content): single "Reminder: <title>" + "Due <primary>" with Open, Snooze, Done, Dismiss; summary "N reminders are overdue" with "Show overdue" and Dismiss; the startup banner uses the summary form.
- Settings: new section "Reminders" (before "Windows and tray"): select "Default time zone for new reminders" (first option "Computer time zone (<zone>)", value null); switch "Follow up on new reminders" with "Every" and "At most"; switch "Quiet hours" with "From", "To" and "Time zone" (prefilled with the computer zone and stored explicitly); the text "Reminders only fire while Infinity Notes is running: with a window open, in the background or in the tray. After you quit, nothing is sent until you start the app again, and then overdue reminders are shown."; when `nativeNotifications` is not supported, "This desktop has no notification service. Reminders appear inside Infinity Notes and in the reminder widget instead." Windows and tray gains the switch "Show reminder widget" (live `widget:state`) and the switch "Start Infinity Notes when you sign in" (`autostart:get|set`; disabled with tooltip "Not supported by this desktop", or "Available in the installed app" for `development-build`).

## 10. UX copy (exact; added to UX_SPEC)

- Dialog: titles "Add reminder", "Edit reminder"; labels "Title", "Today", "Tomorrow", "Date", "Time", "Time zone", "Repeat", "None", "Daily", "Weekly", weekday toggles "Mon".."Sun" (accessible names "Monday".."Sunday"), "Follow up if not done", "Every", "At most", "minutes", "times"; "Your time:"; gap "02:30 does not exist on this date in New York; the reminder will use 03:00"; fold "01:30 happens twice on this date; using the earlier one" and "Use the later one (EST)"; past "This time has already passed. It will be added as overdue, without a notification." with "Add anyway"; pending policy "This reminder has an overdue occurrence." with "Keep the current overdue reminder" and "Mark it done"; "Attach to the note instead"; buttons "Save", "Cancel"; "Choose a time zone".
- Errors: "Choose a time zone from the list", "This time has already passed", "This part of the note is not saved yet", "Plain-text notes can only have note-level reminders", "This reminder is not due yet", "This reminder can no longer be snoozed", "This reminder was replaced by an edit", "Undo is no longer available", "This reminder changed elsewhere. Reopen it to edit.", "A note can have at most 200 reminders.", "This reminder no longer exists", "Could not change the startup setting", "The linked paragraph is no longer in this note."
- Lists: tabs "Today", "Upcoming", "Overdue", "Completed"; empty "Nothing due today.", "No upcoming reminders.", "Nothing is overdue.", "No completed reminders in the last 30 days."; actions "Open", "Snooze", "Done", "Edit", "Delete"; snooze menu "5 minutes", "10 minutes", "15 minutes", "30 minutes", "1 hour", "Tomorrow 09:00"; badges "Overdue", "Snoozed until <time>", "Missed", "Done"; "Repeats daily", "Repeats weekly"; "Show widget", "Hide widget"; notice "Reminder deleted" with "Undo".
- Home: "Reminders", "Overdue", "Due today", "Open Reminders", "Nothing overdue or due today."
- Unknown computer zone (views only): "Your computer's time zone is unknown; days are shown in UTC."
- Panel: "Reminders", "Add reminder", "Original text was removed", "Attach to current paragraph", "Keep note-level"; toolbar More item "Add reminder…".
- Banners: "Reminder: <title>", "Due <time>", "Dismiss", "1 reminder is overdue" / "N reminders are overdue", "Show overdue".
- Notification: title = reminder title, body "Due <short time> · <note title>"; summary title "Infinity Notes", body "N reminders are overdue" ("1 reminder is overdue" never occurs because a summary needs more than 3).
- Widget: window title "Reminders - Infinity Notes"; header "Reminders"; "Keep on top", "Collapse widget", "Expand widget", "Hide widget".
- Settings: as in 9.10. Tray: "Show widget".

## 11. Security summary for this phase

The widget window uses the shared `secureWebPreferences`, loads only the bundled renderer origin, has no application menu and gets its own channel allowlist (6.4), so a compromised widget cannot read note content, edit reminders or touch the tab session. Sticky windows gain only `reminder:listForNote` for their own note and `reminder:open` with a handler ownership check. Main re-resolves every reminder from local date, time and zone and never trusts a renderer instant. Zone IDs are validated against the app's zone list. Notifications carry no actions and no HTML (Windows toast XML is generated by Electron from plain strings). The autostart writer uses fixed paths, atomic writes and no shell; Windows login items use Electron's API. The Linux notification-server probe uses `execFile` with fixed arguments. Test seams are inert in packaged builds. Nothing reaches the network.

## 12. Tests

### 12.1 Explicit assertions per requirement ID (Phase 00 F-1)

W = Windows 11; L = WSLg (ozone x11) and Xvfb. "Hooks" = `__infinityTest`. I tests use a temporary DB, a `FakeClock`, a fake adapter, a fixed zone provider and fake timers. The reference instant is `T0 = 2026-10-08T07:00:00Z` (13:00 Asia/Dhaka) unless stated. Visual evidence: `.infinity-work/logs/phase-05/screens/{win,wslg}/`.

| ID | Tests (file › case) and assertions |
| --- | --- |
| INF-REM-01 | I `reminders.test › create`: rich note with a saved paragraph B; `create({noteId, blockId:B, title:'Submit report', zoneId:'Asia/Dhaka', date:'2026-10-09', time:'17:00', recurrence:null, followup:null})` at T0 → DTO `zoneId 'Asia/Dhaka'`, `current.dueAtUtc = Date.parse('2026-10-09T11:00:00Z')`, `state 'pending'`, `anchorState 'ok'`, `resolution.status 'ok'`; DB 1 reminder, 1 occurrence with `next_alert_at_utc = due`, `original_local_date_time '2026-10-09T17:00'`; note `revision` and `updated_at` unchanged. Failures, each storing nothing: zone `'Mars/Base'` and `'CST'` → VALIDATION_FAILED "Choose a time zone from the list"; trashed note → NOT_FOUND with `trashed:true`; unknown note → NOT_FOUND; `blockId` absent from stored content → VALIDATION_FAILED with `details.blockMissing`; plain note with `blockId` → VALIDATION_FAILED; `date '2026-10-08', time '12:00'` (past) → VALIDATION_FAILED `details.past`; the same with `allowPast:true` → pending, `next_alert_at_utc NULL`, listed as overdue; 201st reminder on a note → LIMIT_EXCEEDED. A sticky note (`sticky_enabled=1`) accepts reminders. E `reminders.spec › add a reminder to a paragraph` (`INFINITY_NOTES_TEST_CLOCK=2026-10-08T07:00:00Z`, `INFINITY_NOTES_TEST_ZONE=Asia/Dhaka`): type "Pay rent" in a note; cursor in the paragraph; More → "Add reminder…"; the dialog title field is "Pay rent", zone `Asia/Dhaka`; fill date 2026-10-09 and time 17:00; Save. DB `block_id` equals the paragraph's `data-id`, `due_at_utc` 11:00Z; the chip is visible inside that paragraph; the panel lists "Pay rent". Float the note: the sticky shows the same chip (read-only). |
| INF-REM-02 | U `zone-default.test`: `defaultZoneFor({setting:null, system:'America/New_York'})` → NY; `setting:'Asia/Dhaka'` → Dhaka; `system:null, setting:null` → null (never `'UTC'`); `zoneList()` contains the system zone even when ICU lists it under an alias, contains `UTC`, is sorted and unique; `isKnownZone('Asia/Calcutta')` true, `'EST'` and `'Mars/Base'` false. U `boundaries.test › no hard-coded reminder zone`: `src/` contains no `'Asia/Dhaka'` literal and no `'UTC'` literal outside `src/shared/time/zones.ts` (zone list entry and the disclosed `FALLBACK_DAY_ZONE`). E `reminders.spec › default zone follows the computer and the setting` (`INFINITY_NOTES_TEST_ZONE=America/Chicago`): a new dialog's zone is `America/Chicago`; set "Default time zone for new reminders" to `Asia/Dhaka` (DB setting `reminders.defaultZone`); a new dialog shows `Asia/Dhaka`; set back to the computer option → `null` stored. |
| INF-REM-03 | U `format-time.test`: `dueLines(Date.parse('2026-10-09T11:00Z'), 'Asia/Dhaka', 'America/New_York')` → primary "Fri 9 Oct 2026, 17:00 · Asia/Dhaka", local "Your time: Fri 9 Oct 2026, 07:00 · America/New_York"; display `Asia/Dhaka` → local null; display `Asia/Thimphu` (same wall time) → local null; a display zone across midnight (`Pacific/Honolulu`) shows the previous date. E `reminders.spec › selected zone and local time` (display zone `Asia/Dhaka`): a reminder in `America/New_York` 2026-10-09 09:00 shows "Fri 9 Oct 2026, 09:00 · America/New_York" and "Your time: Fri 9 Oct 2026, 19:00 · Asia/Dhaka" in the dialog preview, the panel and the Reminders row; a Dhaka reminder shows no "Your time" line. |
| INF-REM-04 | E `reminders.spec › chip and panel`: after creating the reminder on "Pay rent": `.reminder-chip` is inside `[data-id=B]`, has `contenteditable="false"` and the name "Reminder: Pay rent, Fri 9 Oct 2026, 17:00 · Asia/Dhaka"; the stored `content_json`, `plain_text` and `revision` equal their values before; typing " now" after the paragraph saves "Pay rent now" with no chip text; select all + copy + paste into a new note pastes no chip text. Delete the paragraph and wait for the save: DB `anchor_state 'block_missing'`, the chip bar shows "Original text was removed", the panel offers "Attach to current paragraph" and "Keep note-level"; Keep note-level → `block_id NULL`, `anchor_state 'ok'`, chip in the chip bar. U `reminder-chips.test`: the chips meta transaction leaves `doc` identical and `isUserEdit` false; decoration positions for paragraph, listItem and image; chips for an unknown block are dropped; a document change maps decorations. I `reminders.test › block missing` (INF-REM-17 row). |
| INF-REM-05 | I `reminder-views.test` at T0, display `Asia/Dhaka`: fixtures A overdue (due 06:00Z), B today (15:00Z = 21:00 Dhaka), C snoozed until 08:00Z, D tomorrow (2026-10-09T03:00Z), E completed at 06:30Z, F missed (yesterday), G on a trashed note (due 06:30Z), H deleted reminder (due 06:30Z), I cancelled → `overdue = [A]`, `today = [C, B]`, `upcoming = [D]`, `completed = [E, F]`, counts `{today:2, upcoming:1, overdue:1}`; G, H, I absent everywhere; display zone `America/New_York` (end of today = 2026-10-09T04:00Z) moves D into today; scope `common` excludes a project note's reminder; summary limits 5 with totals. E `reminders.spec › reminders page`: tab names "Today, 2" etc.; Done on a Today row moves it to Completed (DB `completed`); empty texts appear on empty tabs. |
| INF-REM-06 | I `scheduler.test › initial alert`: reminder due 11:00Z; advance to 10:59:59.999Z → `shown` 0; advance to 11:00Z → 1 notification, title "Submit report", body "Due Fri 9 Oct, 17:00 · <note title>"; delivery `alert_sequence 0, kind 'initial', presentation 'single', reason 'timer', outcome 'dispatched', dispatched_at 11:00Z`; occurrence `alert_sequence 1`, `next_alert_at_utc NULL` (follow-ups off), `state 'pending'`, listed overdue. E `reminders.spec › alert while the main window is in the background`: close the main window with the queued choice background; `hooks.clock.advance` past due → fake adapter `shown` has 1; no main window exists; the process is alive. Packaged E (`packaged.spec › packaged reminder reaches the OS notification layer`, `INFINITY_NOTES_TEST_NOTIFY` ignored, real clock): create a reminder due in 5 s through the bridge; within 20 s the delivery row has outcome `dispatched` on W, `unsupported` (`no-notification-server`) on WSLg. N: W toast presence additionally checked in the Windows notification platform record (section 13.1); a real click is a manual native case. |
| INF-REM-07 | E `reminders.spec › notification click opens the source note`: notes A and B; reminder on B's second paragraph P; alert; active tab is A; `hooks.notifications.click(id)` → active tab is B, the selection is inside `[data-id=P]`, P has `reveal-block`, delivery `clicked_at` set. Repeat after closing the main window to the background: the click recreates the main window and opens B. A summary click (4 due) opens the Reminders tab on Overdue. N: real toast click on W is pending (manual, section 12.7). |
| INF-REM-08 | I `scheduler.test › close is not done`: after the alert, `fake.close(id)` → delivery `closed_at` set; occurrence `state 'pending'`, `completed_at NULL`, still in overdue; no `reminder:changed` with `completed`. |
| INF-REM-09 | I `scheduler.test › done stops followups`: follow-up 5 min × 3; alert at T; `complete` at T+1 min → `state 'completed'`, `next_alert_at_utc NULL`; advance 30 min → `shown` stays 1. Recurring daily: completing today's occurrence leaves tomorrow's pending occurrence with its own `due_at_utc`. E `reminders.spec › done from the page and the panel`: Done → row in Completed, chip class `done`. |
| INF-REM-10 | I `scheduler.test › snooze race`: (a) due occurrence selected by the tick; `beforeClaim` runs `snooze(10)` → no delivery row, `shown` 0, occurrence `snoozed`, `next_alert_at_utc = now+10 min`; at +10 min one alert with `kind 'snooze'`; (b) snooze while the adapter's `show` is pending (mode `hang` released later) → the delivery records the outcome, the occurrence stays `snoozed` with the snooze target; (c) follow-ups 5 min × 2: initial at T, snooze 15 at T+1 → no follow-up at T+5 or T+10, snooze alert at T+16, then `followup` at T+21 (`followups_sent 1`); (d) daily 09:00 New York: snoozing today's occurrence by 60 min leaves tomorrow's `due_at_utc` unchanged; (e) preset `tomorrow` for a New York reminder with display zone Dhaka → 09:00 New York next calendar day there; (f) snooze before due → "This reminder is not due yet"; on a missed occurrence → "This reminder can no longer be snoozed". U `snooze-target.test`: minutes presets are instant arithmetic across the fold (01:30 EDT + 60 min = 06:30Z); `tomorrow` uses the reminder zone. |
| INF-REM-11 | U `followup-settings.test`: `Followup` accepts intervals 5/10/15/30/60 and max 1/2/3/5, rejects 7, 0, 4, 6; the setting default is `{enabled:false, intervalMinutes:15, maxFollowups:2}`; the dialog's initial follow-up is off. I `scheduler.test › follow-up limit`: 15 × 2: alerts at T, T+15, T+30 (sequences 0, 1, 2; kinds initial, followup, followup), none at T+45 or T+60; `followups_sent 2`, `next_alert_at_utc NULL`. E: enabling "Follow up if not done" shows Every 15 minutes, At most 2 times; saved values in DB. |
| INF-REM-12 | U `recurrence.test`: daily 09:00 New York gives the probe instants (03-07 14:00Z, 03-08 13:00Z, 03-09 13:00Z, 10-31 13:00Z, 11-01 14:00Z, 11-02 14:00Z); daily 02:30 New York gives 03-08 07:00Z (gap) between 07:30Z and 06:30Z; daily 01:30 New York on 11-01 gives exactly one instant (05:30Z earlier, 06:30Z later); weekly Mon/Wed/Fri from Thu 2026-10-08 → Fri 9, Mon 12, Wed 14; `latestAtOrBefore` after 400 days steps back at most 7 dates. I `scheduler.test › recurrence vs completion`: completing the 03-07 occurrence leaves the 03-08 pending at 13:00Z; a weekly series keeps one future open occurrence after each completion. |
| INF-REM-13 | I `reminders.test › edit series pending policy`: daily 09:00 Dhaka; at 2026-10-08T04:00Z today's occurrence (03:00Z) is open and overdue; update time to 10:00 with `keep` → the overdue occurrence row is unchanged, the old future (2026-10-09T03:00Z) row is deleted, a new future at 2026-10-09T04:00Z exists; with `complete` → the overdue one is completed; a title-only update keeps occurrence IDs; stale `expectedRevision` → CONFLICT with `currentRevision`; a one-time reminder that already alerted and is moved to tomorrow → old occurrence `cancelled` (deliveries kept), new pending; one that never alerted → old row deleted. Deleted not-yet-due rows have no deliveries (assert). E `reminders.spec › edit a series with an overdue occurrence`: the radio appears only after changing the time, defaults to "Keep the current overdue reminder"; saving keeps the Overdue row and shows the new time in Upcoming. |
| INF-REM-14 | U `resolve-local.test`: 2026-03-08 02:30 New York → `gap`, `2026-03-08T07:00:00Z`, `gapNotice` = "02:30 does not exist on this date in New York; the reminder will use 03:00"; 2026-11-01 01:30 New York → `fold`, earlier `05:30Z`, later `06:30Z`, alternatives both, `foldNotice` = "01:30 happens twice on this date; using the earlier one"; Dhaka 2026-10-09 17:00 → `ok` `11:00Z`; Lord Howe 2026-10-04 02:15 → gap `2026-10-03T15:30Z`; Kathmandu 09:00 → `03:15Z`; the result differs from Luxon's default for the gap (03:30) by test. E `reminders.spec › DST preview`: zone New York, date 2026-03-08, time 02:30 → the gap notice is visible; save → DB `due_at_utc` 07:00Z; date 2026-11-01, time 01:30 → fold notice; check "Use the later one (EST)" → DB `fold_preference 'later'`, `due_at_utc` 06:30Z. |
| INF-REM-15 | I `scheduler.test › os zone change`: zone provider `Asia/Dhaka`; create a `America/New_York` reminder; `zone.set('Europe/London')` then wake → reminder `zone_id` and `due_at_utc` unchanged; `listView.displayZone` London; `zones().defaultZone` London (setting null) and still `Asia/Dhaka` when the setting is Dhaka; one `reminder:changed {zone}` event. E `reminders.spec › os zone change`: `hooks.zone.set('Europe/London')` → the row's "Your time" line shows London; DB unchanged; a new dialog defaults to London. |
| INF-REM-16 | U `notification-adapter.test`: the options passed to the fake Electron `Notification` class contain no `actions`, `toastXml` or `hasReply`; `capabilities.notificationActions` is `unsupported`. R: adapter source reviewed in the progress report. E `widget.spec › actions` and `reminders.spec › banner`: Open, Snooze and Done exist in the widget, the Reminders page and the alert banner and work there. |
| INF-REM-17 | I `reminders.test › trash suspend`: 2 reminders on note N due at 11:00Z; trash N at 10:00Z; advance to 12:00Z → `shown` 0, views exclude them; restore at 12:00Z → one tick, 2 single alerts (reason `restore`); a later tick sends nothing more. With 5 reminders: restore → one summary notification "5 reminders are overdue", 5 deliveries with one `batch_id` and `presentation 'summary'`. Purge → reminder, occurrence and delivery rows gone (cascade). I `reminders.test › block missing`: saving content without block B sets `block_missing` (one `reminder:changed {anchor}`), the reminder still alerts; restoring a version with B sets `ok`; a plain-text conversion sets `block_missing`. |
| INF-REM-18 | I `reminders.test › delete undo`: delete → `deleted_at` set, `undoUntil = now + 10 s`; views and `listForNote` exclude it; advance past due → no alert; `undoDelete` at +9 s → visible and the next tick alerts once; `undoDelete` at +11 s → "Undo is no longer available". E `reminders.spec › delete with undo`: panel Delete → notice "Reminder deleted"; Undo → the row and the chip are back. |
| INF-HOME-04 | E `reminders.spec › Home reminder section`: with one overdue and one due-today reminder the Home section "Reminders" lists them under "Overdue" and "Due today"; 6 overdue → 5 shown; "Open Reminders" opens the Reminders tab; Home filter Common hides a project note's reminder; with none: "Nothing overdue or due today." |
| INF-SCHED-01 | I `scheduler.test › single timer`: injected fake timers count live timers; with due times T+5 min, T+2 h, T+3 h → exactly one timer, delay 60 000 (cap); at T+4.5 min → delay 30 000; after a create, complete, snooze, settings change and tree change → still exactly one timer; with no reminders → 60 000; 1,000 reminders (generated) → one timer and `EXPLAIN QUERY PLAN` of `minNextAlert` uses `occurrences_next_alert`; earliest occurrence on a trashed note → the delay targets the next live one and 10 ticks with no progress use backoff (no 0 ms loop). U `boundaries.test › one scheduler timer`: `setTimeout(` occurs in `src/main/services/reminder-*.ts` only in `reminder-scheduler.ts`, once. |
| INF-SCHED-02 | I `scheduler-recovery.test › restart around dispatch`: scheduler A on DB D claims and its adapter hangs (simulated crash: A is dropped); scheduler B starts on D → the delivery becomes `uncertain`; B's adapter is never called for that occurrence; with follow-ups on, B's next alert uses sequence 1. Crash before the claim commit (transaction throws via a fault hook) → no delivery row and B alerts once (sequence 0). Two `wake()` calls in one task → one tick and one claim. Direct SQL: inserting a second delivery with the same `(occurrence_id, alert_sequence)` fails with a UNIQUE error. |
| INF-SCHED-03 | I `scheduler-recovery.test › crash after claim`: after B's start the occurrence is `pending`, `completed_at NULL`, in overdue, `lastOutcome 'uncertain'`; B never dispatches sequence 0 again; no extra `followups_sent`. |
| INF-SCHED-04 | I `scheduler.test › adapter failure`: mode `fail` → outcome `failed` with detail, one `reminder:alert {outcome:'failed'}`, attention requested; capability `unsupported` → outcome `unsupported`, adapter `show` not called; mode `hang` → `uncertain` after 3000 ms (fake timers); mode `throw` → `failed`. E `reminders.spec › banner when notifications fail`: `hooks.notifications.mode='fail'`; due → banner "Reminder: Pay rent" with Open, Snooze, Done, Dismiss; DB outcome `failed`; Done in the banner completes it. L (real capability `unsupported`) and W with `INFINITY_NOTES_TEST_CAPS={"nativeNotifications":"unsupported"}`: outcome `unsupported`, banner shown, `shown()` empty, Settings shows "This desktop has no notification service…". |
| INF-SCHED-05 | I `scheduler-recovery.test › batch limits`: 3 due at startup → 3 single alerts (reason `startup`); 4 due → 1 summary "4 reminders are overdue" and 4 deliveries with one batch; the next tick sends nothing; `power.emit('resume')` with 2 due → reason `resume`; forward jump (`clock.jump(+2 h)`) → reason `clock_jump`, one alert per occurrence; backward jump (−2 h) → no dispatch, sequences never reused (a later alert takes the next sequence). E `lifecycle.spec › relaunch overdue summary` (INF-SCHED-09 row). N: real sleep and wake on W pending (Phase 09). |
| INF-SCHED-06 | U `quiet-hours.test` (22:00–07:00 Asia/Dhaka): 23:00 Dhaka → quiet, end 2026-10-09T01:00Z; 06:59 → quiet; 07:00 → not; 21:59 → not; same-day 13:00–14:00; New York window ending 01:30 on 2026-11-01 ends at the earlier instant; disabled → never. I `scheduler.test › quiet hours`: due 22:30 Dhaka with follow-ups 15 × 2 → no dispatch during the window, one `next_alert_at_utc` = 07:00 Dhaka, overdue in views; at 07:00 one alert (`kind 'initial'`, reason `quiet_end`), follow-ups at 07:15 and 07:30; a second occurrence due during quiet hours → 2 alerts at 07:00 (not 4). E `reminders.spec › quiet hours`: Settings quiet hours on, zone stored explicitly in `reminders.quietHours.zoneId`. |
| INF-SCHED-07 | I `scheduler-recovery.test › long downtime no flood`: daily series created at T0; scheduler stopped; clock +400 days; new scheduler starts → occurrences = previous + at most 2 (latest due and next future); older open ones `missed`; one alert (latest); running `ensureSeries` twice adds nothing; weekly series the same. |
| INF-SCHED-08 | I `scheduler-recovery.test › followup counts`: 15 × 2; initial at T; down from T+1 min to T+2 h; restart → one alert `kind 'followup'`, `followups_sent 1`, next at restart+15 min → second follow-up → `followups_sent 2` → none after; an `uncertain` claim at startup adds no count; 5 further ticks dispatch nothing. |
| INF-SCHED-09 | E `lifecycle.spec › relaunch overdue summary`: clock T0, reminder due T0+10 min; Quit; relaunch with clock T0+30 min → banner "1 reminder is overdue" with "Show overdue" (opens Overdue); exactly one recovery notification (reason `startup`) for that occurrence; no delivery has `claimed_at` between the quit and the relaunch instants. Settings > Reminders shows the fully-quit text; the close dialog keeps "Reminders and stickies only work while the app is running." R: no code registers OS-level timers or scheduled tasks (review, plus a `boundaries.test` grep of `src/` for `schtasks`, `systemd-run`, `crontab` and `powerSaveBlocker`). |
| INF-WIDG-01 | E `widget.spec › actions`: fresh profile → no widget window and no `widget` row (default off); Reminders page "Show widget" opens a window with URL `#/widget`; tabs Today, Upcoming, Overdue with counts; an overdue row: Snooze → 10 minutes → DB `snoozed`; Done → DB `completed` and the main Reminders page updates without reload; Open → main window active tab is the note. |
| INF-WIDG-02 | E `widget.spec › collapse, hide and pin`: collapse → body hidden, content height 36 (W and Xvfb `getContentSize`; WSLg from hooks), not resizable, DB `collapsed 1`; expand restores; Hide → window destroyed, DB `open 0`; tray (W) "Show widget" brings it back with the stored size; Quit with the widget open and relaunch → widget restored. Pin (W real): `aria-pressed` true, `isAlwaysOnTop()` true, DB `always_on_top 1`; L real and W with override `unsupported` → `aria-disabled`, tooltip "Not supported by this desktop", bridge `setPinned` → UNSUPPORTED. N: user-dragged move and resize, and real always-on-top over other apps on W, pending (Phase 09). |
| INF-WIDG-03 | E `widget.spec › one scheduler for both windows`: hide the widget; advance past a due time → fake adapter `shown` 1 (scheduling continues); show the widget → the item is in Overdue; Done in the main page → the widget row moves within 2 s; `hooks.scheduler.ticks()` grows by one per wake and `timer().armed` is a single timer with or without the widget. I `widget-manager.test`: show twice creates one window; hide order save bounds → `open=0` → destroy; collapse and pin calls; unsupported pin; restore on startup only when `open=1`; quit keeps `open=1`. |
| INF-DESK-02 (W05-03 part) | E `lifecycle.spec › tray menu` (W): items exactly ["Open Infinity Notes", "New sticky", "Show widget", "Quit Infinity Notes"]; "Show widget" opens the widget window. Status stays `in_progress` (native tray click, Phase 09). |
| INF-DESK-03 (mechanism; Phase 08 row) | U `autostart.test`: desktop entry text (quoting of a path with spaces and `$`), capability matrix (unpackaged unsupported, WSL unsupported, Windows packaged supported). I `autostart.test`: Linux adapter writes and removes `infinity-notes.desktop` in a temporary `XDG_CONFIG_HOME` atomically and reads it back. E `reminders.spec › settings explain lifecycle`: the startup switch is disabled with "Available in the installed app" in E2E; packaged E reads `autostart.get` (W: capability supported, `enabled` false; never set). Status `in_progress` (Settings completion Phase 08; native login check Phase 09). |
| F04-A1 | U `window-lifecycle.test`: (a) cancel, Quit again within 2 min → exits; (b) cancel, then a Quit that saves everything → exits, a later Quit with unsaved text is canceled again (the acceptor's scenario); (c) cancel, Quit after 121 s with unsaved text → canceled again, an immediate further Quit exits; (d) a session end never waits. Existing D-072 E2E cases (`save-failure.spec`) stay green. |
| F04-A2 | U `test-hooks.test › db hooks run on a fresh macrotask`: a hook called inside a synchronous section (a flag set and cleared in the same task) observes the flag cleared. E `stickies.spec › windows hook stays safe while windows close`: 15 cycles of the QA2-01 shape (saves fail, close kept open, recovery, close) while polling `hooks.windows()` → 0 errors. |

### 12.2 Unit tests (Vitest `unit`)

New: `resolve-local`, `recurrence`, `zone-default`, `format-time`, `followup-settings`, `quiet-hours`, `snooze-target`, `contracts-phase05` (every new schema: valid, invalid, strict extra keys, limits; widget role variant; `AppOpenNoteEvent` with and without `blockId`), `notification-adapter` (gate, outcome mapping with a fake `Notification` class: `show`, synchronous `failed`, throw, timeout; no actions), `autostart`, `widget-window-options` (`secureWebPreferences` deep-equal, size, min size, removeMenu), `test-hooks`, `renderer/reminder-chips`, `renderer/reminder-dialog.test.tsx` (gap and fold notices, later choice, local line only when different, Today and Tomorrow in the selected zone: with `asOf = 2026-10-08T03:30Z` and zone New York "Tomorrow" sets 2026-10-08, with Dhaka 2026-10-09; past flow; pending-policy radio only for schedule changes on an overdue series; zone required when no default), `renderer/state/reminders-store` (reload on events, alert collapse to summary after 3, startup banner, open with blockId), `renderer/widget-header.test.tsx` (names, pin disabled, collapse). Updated: `capabilities` (notifications, launch at login, override keys), `contracts` and `contracts-phase04` (catalogue counts 67/12, roles), `boundaries` (Phase 06 names; widget modules import no `electron` at runtime; one scheduler timer; no hard-coded zone), `migrations-checksum` (LATEST 5), `routes` (`#/widget`), `window-lifecycle` (F04-A1), `tray`-related expectations, `renderer/support/fake-bridge.ts`, `renderer/shell-smoke`, `renderer/state/app-events` (`app:openReminders`, `blockId`), `palette-actions` if a palette action "Add reminder to current note" is added (optional; if added, it opens the dialog).

### 12.3 Integration tests (Vitest `integration`, real better-sqlite3, temporary DB)

New: `reminders` (create, edit series pending policy, trash suspend, block missing, delete undo, limits), `reminder-views`, `scheduler` (initial alert, close is not done, done stops followups, snooze race, follow-up limit, recurrence vs completion, os zone change, adapter failure, quiet hours, single timer), `scheduler-recovery` (restart around dispatch, crash after claim, batch limits, long downtime no flood, followup counts, clock jumps), `widget-manager`, `autostart`, `ipc-handlers-phase05` (every new channel through `catalogueRouter` with main, sticky and widget senders; FORBIDDEN cases including a sticky opening another note's reminder; response schemas). Updated: `migrations` (version 5, v4 → v5 with a pre-migration copy, CHECK constraints reject `snoozed` without `snoozed_until_utc` and `completed` without `completed_at`), `ipc-helpers.ts` (`catalogueRouter` registry gains a widget window), `ipc-validation` (three roles), `trash` (purge cascades reminders), `main-window-controller` (`blockId`, `openReminders`, attention), `settings` (reminder keys, unknown zone refused).

### 12.4 E2E (Playwright `_electron`, built app, `workers: 1`, `retries: 0`)

New `tests/e2e/reminder-ui.ts`: `withClock(iso)`, `withZone(zone)` (env helpers), `hooks(app)`, `advance(app, ms)`, `shownNotifications(app)`, `openReminderDialog(page)`, `fillReminder(page, {...})`, `reminderRows(page, tab)`, `widgetPage(app)`. `harness.restart(extraEnv?)` gains the env parameter. New `tests/e2e/reminders.spec.ts` (INF-REM-01..05, 07, 09, 13, 14, 15, 18, INF-HOME-04, INF-SCHED-04, 06 setting, INF-DESK-03 settings), `tests/e2e/widget.spec.ts` (INF-WIDG-01..03, INF-REM-16), additions to `lifecycle.spec` (relaunch overdue summary, tray Show widget), `security.spec › widget window is hardened` (preferences, OS sandbox, FORBIDDEN for `note.open`, `session.set`, `reminder.create`, `widget.show`; sticky `reminder.open` of another note's reminder FORBIDDEN), `stickies.spec` F04-A2 stress case, `packaged.spec` cases (schema 5, test seams ignored: `INFINITY_NOTES_TEST_CLOCK`, `_ZONE`, `_NOTIFY` have no effect; real notification dispatch outcome; `autostart.get` read only). Keyboard activation (D-050) unless pointer behavior is the subject.

### 12.5 Existing specs to update (no assertion weakened)

- `smoke.spec` and `packaged.spec`: `schemaVersion` 5. `lifecycle.spec › tray menu`: four items, plus the Show widget action.
- `boundaries.test`, `contracts.test`, `ipc-validation.test`, `security.spec › bridge surface`: guards move to Phase 06 names; the bridge surface gains `zones`, `reminder`, `reminders`, `occurrence`, `widget`, `autostart`.
- `sticky-ui.ts` and every caller of `windowsOf`/`stickyNoteIds`: await the now-async hook (same assertions).
- `shell.spec`/`visual.spec` cases that showed the Reminders placeholder text assert the real page instead; Home visual baselines regenerate with the Reminders section.
- `window-lifecycle.test`: the existing D-072 case remains; new F04-A1 cases.

### 12.6 Visual (V evidence, no pixel diffs)

`reminders-today`, `reminders-overdue`, `reminder-dialog`, `reminder-dialog-gap`, `reminder-dialog-fold`, `note-with-chip-light`, `note-with-chip-dark`, `panel-reminders`, `home-reminders`, `alert-banner`, `widget-light`, `widget-dark`, `widget-collapsed`, `settings-reminders`, `sticky-with-chip`. Windows to `screens/win`, WSLg to `screens/wslg`. The Phase 04 set is regenerated in the same run.

### 12.7 Native cases (recorded, not counted as passes unless run)

- Windows 11, this phase: packaged native dispatch (packaged E2E, outcome `dispatched`) and the notification platform record for our AUMID (13.1) are run and reported as observations for INF-REM-06. A real click on a real toast opening the note (INF-REM-07 N) needs a person: the implementer prepares a packaged build and a one-line procedure in the report (`docs/progress/phase-05.md` section "Manual native check"), and records it `pending` unless a human ran it. Sleep and wake, live OS zone change, launch at login and always-on-top of the widget over other apps: Phase 09.
- WSLg: no notification server (probe) → native toast and click `not_run` with that reason (D-077); the fallback is E2E-tested; launch at login `unsupported` under WSL.
- `outside_validation_scope`: GNOME notifications and their click, XDG autostart in a GNOME session, X11 always-on-top of the widget.

## 13. Commands, hosts and logs

Every log goes to `.infinity-work/logs/phase-05/`, starts with the command, date and `pwd`, and ends with `EXIT=<code>`. Prefix by step `S1-` … `S11-`, `wsl-`, `final-`.

### 13.1 Windows (Git Bash, repository root)

```
export INFINITY_E2E_NODE='E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe'
node tools/gen-migration-checksums.mjs                 # S3 only (S3-checksums.log)
npm run check                                          # S<n>-check.log
npm run build                                          # S<n>-build.log
npm run test:e2e                                       # S<n>-test-e2e.log
npm run test:e2e -- tests/e2e/<spec>.ts                # focused runs while repairing (never a gate alone)
INFINITY_SCREENSHOT_DIR="$PWD/.infinity-work/logs/phase-05/screens/win" npm run test:e2e -- tests/e2e/visual.spec.ts
node tools/dev-smoke.mjs                               # S9-dev-smoke.log
npm run package:current; npm run verify:native -- --packaged; npm run test:e2e:packaged
git diff --exit-code package.json package-lock.json    # S9-deps-unchanged.log
node tools/check-traceability.mjs --repo .             # S11-traceability.log
```

Windows notification platform observation (S9, `S9-native-toast-win.log`): after the packaged E2E dispatch case, copy `%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db*` to a temporary folder, open the copy read-only with better-sqlite3 and query only rows whose handler `PrimaryId` is `com.infinitynotes.desktop` (`Notification.Type`, `ArrivalTime`, the toast text); delete the copy afterwards. Never enumerate other applications' rows or windows.

### 13.2 WSL (user `infinity`, D-039; `MSYS_NO_PATHCONV=1`; a script `.infinity-work/wsl-leg-p05.sh` with `L=/mnt/e/notecapt/.infinity-work/logs/phase-05`)

```
wsl -d Ubuntu -u infinity -- bash -lc '<cmd>'
# env: lsb_release -ds; uname -r; node -v; npm -v; cat /mnt/wslg/versions.txt; WAYLAND_DISPLAY/DISPLAY/XDG_SESSION_TYPE;
#      gdbus NameHasOwner org.kde.StatusNotifierWatcher and org.freedesktop.Notifications       (wsl-env.log)
rsync -a --delete --exclude=node_modules/ --exclude=out/ --exclude=release/ --exclude=.git/ --exclude=.infinity-work/ --exclude=test-results/ --exclude=playwright-report/ --exclude=coverage/ /mnt/e/notecapt/ ~/infinity-notes/ ; diff -rq (MIRROR_IDENTICAL)   # wsl-sync.log
cd ~/infinity-notes && export WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0
npm run check; npm run build                           # wsl-check.log, wsl-build.log
npm run test:e2e                                       # wsl-test-e2e-wslg.log (record ozone and the capabilities line incl. notifications)
env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e     # wsl-test-e2e-xvfb.log
INFINITY_SCREENSHOT_DIR=/mnt/e/notecapt/.infinity-work/logs/phase-05/screens/wslg npm run test:e2e -- tests/e2e/visual.spec.ts
INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e   # wsl-test-e2e-wayland.log (informational, D-050)
npm run package:linux && npm run test:e2e:packaged     # wsl-package-linux.log, wsl-test-e2e-packaged.log (dispatch outcome 'unsupported')
```

Rules: never share `node_modules`; never root; never `--no-sandbox`; no apt installs; no notification daemon or tray host is installed (D-077); label results "WSLg 1.0.73 (Weston), ozone <value>" or "Xvfb", never GNOME or an X11 session. A WSLg launch or XWayland flake is recorded as its own run with the error, never retried away. An environment failure is recorded as pending with the exact error; a code defect is fixed.

## 14. Work order, gates and checkpoints

After each step: run the gate, save the logs, and append `Checkpoint S<n> done <date> — gates: <log names>` plus a short file list to `docs/progress/phase-05.md`. A resumed implementer reads that file, re-reads the files of the last checkpoint and continues at the first missing checkpoint. Each step leaves the app working (the renderer ignores new events until S7).

| Step | Work | Gate |
| --- | --- | --- |
| S1 Pure time and contracts | `shared/time/{resolve,recurrence,zones,format,quiet-hours,snooze}.ts`; `contracts/{reminders,widget}.ts` schemas (no channel names yet); settings keys with `isKnownZone` refinement; `collectBlockIds`; unit tests `resolve-local`, `recurrence`, `zone-default`, `format-time`, `followup-settings`, `quiet-hours`, `snooze-target`, `contracts-phase05` (schema part), `settings` integration for the new keys | `npm run check` |
| S2 Follow-ups F04-A1, F04-A2 | `window-lifecycle.ts` escape (8.12) and unit cases; `onFreshTask`, async `windows()`, helper call sites, `test-hooks.test`, the `stickies.spec` stress case; D-072 regression E2E | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S3 Data and service | Migration 005 + checksums + LATEST 5 (all hard-coded version tests); `reminders-repo`, `reminder-service` (no scheduler yet: `onWrite` no-op), `reminder-anchors` + `ContentIndexer` hook, `system-zone`, `main-services` wiring; integration `reminders`, `reminder-views`, `migrations`, `trash` | `npm run check`; `npm run build`; `npm run test:e2e -- tests/e2e/smoke.spec.ts tests/e2e/migration-failure.spec.ts tests/e2e/editor.spec.ts` |
| S4 Scheduler core | `notification-adapter` (interface, gate, fake), `power-events`, `reminder-scheduler` (electron-free), `ensureSeries` integration; integration `scheduler`, `scheduler-recovery`; unit `notification-adapter`; boundaries "one timer" | `npm run check` |
| S5 IPC and main wiring | Channel names, schemas, bridge, preload and handlers for `zones:list`, `reminder:*`, `reminders:*`, `occurrence:*` and the events `reminder:changed`, `reminder:alert`, `app:openReminders` (the `widget:*` and `autostart:*` channels and `widget:state` are added in S6 together with their handlers, so the catalogue never has a channel without a handler); sticky allowlist additions; event bus; `electron-notifications`, `notification-probe`, capabilities (notifications), `electron-power`, scheduler start/stop in `index.ts`/`desktop.ts`, settings and tree wakes, `MainWindowController` (`blockId`, `openReminders`, attention), `window:getState` main variant, test hooks (clock, zone, notifications, power, scheduler, reminders); `contracts-phase05` (catalogue), `boundaries`, `ipc-handlers-phase05` (reminder channels), `security.spec` surface; renderer ignores the new events | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S6 Widget window, tray, autostart | `widget-manager`, `widget-window`, registry role `widget` and `WIDGET_ALLOWED_CHANNELS`, `widget:*` and `autostart:*` channel names, schemas, bridge entries and handlers, the `widget:state` event, the widget variant of `window:getState`, tray "Show widget", restore on startup, `autostart` builders, adapters, capability, handlers, `--launched-at-login` start; tests `widget-manager`, `widget-window-options`, `autostart` (unit and integration), `ipc-handlers-phase05` (widget and autostart), `lifecycle.spec › tray menu` | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S7 Main window renderer | Shared formatting in the renderer, `reminders-store`, `note-reminders`, `ReminderDialog`, chips extension and chip bar, panel section, Reminders page, Home section, alert and startup banners, `app:openReminders`, reveal block, Settings sections, sticky chips; unit tests (dialog, chips, store) | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S8 Widget renderer | `#/widget` route, `WidgetApp`, services, header, list, flush acknowledgment; unit `widget-header` | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S9 New E2E, visual, Windows release gates | `reminder-ui.ts`, `reminders.spec`, `widget.spec`, lifecycle and security additions, visual cases; repairs with regression tests; then dev smoke, `package:current`, `verify:native`, packaged E2E (dispatch case), deps unchanged, the notification platform observation (13.1) | Full `npm run test:e2e` green on Windows; Windows screenshots; all release gates exit 0 |
| S10 WSL leg | Section 13.2 | check, build, WSLg and Xvfb E2E green; visual WSLg; forced Wayland informational; packaged Linux E2E |
| S11 Report | BACKLOG and the progress report (section 15), traceability | `node tools/check-traceability.mjs --repo .` exit 0 |

## 15. Progress report and BACKLOG

### 15.1 `docs/progress/phase-05.md` must contain

1. Summary, date, agent role and model, and the checkpoint lines S1 to S11.
2. Hosts: Windows OS, Node, E2E runner Node 24.21; WSL Ubuntu, kernel, Node, WSLg version, Weston hash; observed ozone and the capabilities line (positioning, alwaysOnTop, tray, notifications, autostart) for WSLg, Xvfb and forced Wayland; both D-Bus probe results.
3. Changed and created files by area, one line each.
4. IPC catalogue as implemented (67 invoke channels, 12 events, three role allowlists). Any difference from section 6 needs a decision entry.
5. Command table: command, host, exit code, duration and log path for every log of section 13.
6. Requirement coverage: one row per ID (31, plus INF-DESK-02, INF-DESK-03, F04-A1, F04-A2) with the assertions run (file › case), W and L results, screenshot paths and the BACKLOG status set.
7. Scheduler evidence: the frozen-clock tables (instants per DST case), delivery rows for the race, crash and batch cases (copied from test output), and the timer count evidence.
8. Native observations: Windows packaged dispatch outcome and the notification platform record (AUMID only), WSLg `unsupported` outcome and fallback banner, the manual click procedure and its status, the 12.7 pending list.
9. Decisions added after planning (D-086 onward) or "none"; deviations with reasons.
10. Issues found and fixed: severity, reproduction, expected, actual, regression test.
11. Not run or pending: 12.7; forced-Wayland informational failures with counts; GNOME and X11 outside scope.
12. Known limitations: reminders fire only while the app runs; a live OS zone change may need an app restart to be seen by main; no native action buttons; a notification whose `show` cannot be confirmed within 3 s is recorded `uncertain` and stays overdue; the widget position is not restored under Wayland or WSLg; launch at login is unavailable in development builds and under WSL.

### 15.2 BACKLOG (Status and Planned tests columns only)

Set `done` for INF-REM-01..05, 08..18, INF-SCHED-01..04, 06..09, INF-WIDG-01, INF-WIDG-03 and INF-HOME-04 when every assertion in their 12.1 rows passed on W and L. INF-REM-06, INF-REM-07, INF-SCHED-05 and INF-WIDG-02 have an N part: `in_progress`, with the E/I/U parts passing and the native part named (Windows click manual or Phase 09; sleep and wake Phase 09; WSLg toast `not_run`). INF-DESK-02 stays `in_progress` (native tray, Phase 09) with "Show widget" done. INF-DESK-03 becomes `in_progress` (mechanism and integration test done in Phase 05; Settings completion Phase 08; native login check Phase 09). Keep the Planned tests text in sync with the final case names. Traceability must exit 0.

## 16. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R5-01 | Duplicate notification after a crash between claim and dispatch | Claim commits before dispatch, unique `(occurrence, sequence)`, stale claims become `uncertain` and are never re-sent (D-075); tested |
| R5-02 | Notification storm after sleep, restore or long downtime | One `next_alert_at_utc` per occurrence, one alert per occurrence per batch, summary above 3, bounded series generation; tested with 400 days and 5 restored reminders |
| R5-03 | Busy loop when the earliest alert belongs to a suspended note | `minNextAlert` uses the same live filter as the due query; no-progress backoff; tested |
| R5-04 | `Notification.isSupported()` true without a server (Linux) | D-Bus name check is the capability; synchronous `failed` handled; outcome recorded (probe) |
| R5-05 | Toasts not shown or not clickable for an unpackaged Windows build | Probe shows the platform receives them; the native click is checked with the packaged NSIS build and recorded honestly |
| R5-06 | DST arithmetic errors | App-owned resolver with probe-derived expectations, including 30-minute and 45-minute offsets; recurrence keeps wall-clock time; durations are instant arithmetic |
| R5-07 | Block anchors lost because load-time IDs were never saved | `blockMissing` → persist IDs (flush) and retry; anchor sync in the save transaction; note-level fallback |
| R5-08 | Chip decorations treated as edits or copied as text | Meta-only transactions (`isUserEdit` false), `contenteditable=false` widgets; unit and E2E copy checks |
| R5-09 | Fake clock leaks into packaged builds | Seams gated by `testHooksEnabled`; packaged case asserts they are ignored |
| R5-10 | E2E hooks hit "database connection is busy" | `onFreshTask` for every DB hook (F04-A2); stress regression |
| R5-11 | Real toasts flood the user's Windows notification center during E2E | Fake adapter by default; only the packaged dispatch case shows one toast |
| R5-12 | Launch at login changes the host | Tests never set real login items or the real autostart folder; packaged E2E reads only |
| R5-13 | The widget renderer delays Quit | It answers flush requests with `saved:true` immediately; covered by the quit flush log (`requested=n acked=n`) |
| R5-14 | Live OS zone change not seen by Electron main | Re-read per wake; restart picks it up; stated limitation; seam-tested |

## 17. Out of scope for Phase 05

- Natural-language suggestions, the confirmation card, `reminder_sources`, `suggestion_dismissals`, end-of-day and date-only settings (Phase 06).
- Full Settings screens, keyboard help, the global shortcut, preference E2E for INF-PREF-02..04 (Phase 08; Phase 05 adds the reminder and lifecycle controls these rows will verify).
- Backup and export of reminders (Phase 08), the 1,000-reminder performance measurement (Phase 09; correctness with 1,000 is in INF-SCHED-01), the native OS matrix (Phase 09).
- Native notification action buttons on any OS (D-026).

Never, in any phase: publishing, pushing, signing, apt installs, running as root, `--no-sandbox`, forcing an ozone platform, changing the host's time zone, clock or login items from a test.

## 18. Planner status

```json
{"status":"ready","evidence":["docs/plans/phase-05.md","docs/DECISIONS.md (D-073..D-085; D-072 status)","docs/ARCHITECTURE.md (sections 3, 4, 5, 8, 9, 15)","docs/UX_SPEC.md (sections 5, 6)","docs/BACKLOG.md (Phase 05 planned tests, W05 items, INF-DESK-02/03)",".infinity-work/logs/phase-05/planner-probe-notify-win.log",".infinity-work/logs/phase-05/planner-probe-notify-wsl.log",".infinity-work/logs/phase-05/planner-probe-resolve.log"],"blockers":[]}
```

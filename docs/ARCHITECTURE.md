# Infinity Notes architecture

Companion documents: [PRODUCT_SPEC](PRODUCT_SPEC.md), [UX_SPEC](UX_SPEC.md), [DECISIONS](DECISIONS.md), [BACKLOG](BACKLOG.md). Decision IDs (D-0NN) refer to DECISIONS.

## 1. Process model

- Main process: owns the SQLite database, the attachment store, all writes, the reminder scheduler, native windows, tray, notifications, protocol handler and platform capabilities.
- Preload: a single script exposing `window.infinity` with an explicit method list and a whitelisted `subscribe(channel, cb)`; no generic `invoke`.
- Renderers: one renderer bundle loaded by three kinds of window using hash routes: `#/` (main window), `#/sticky/<noteId>` (sticky window) and `#/widget` (reminder widget). Renderers never touch files, SQL or the shell.

## 2. Source layout

`src/main/{db,services,windows,ipc}`, `src/preload`, `src/renderer/{shell,editor,stickies,reminders,settings,widget}`, `src/shared/{contracts,types,time,nlp}`, `tests/{unit,integration,e2e,perf,fixtures}`. Phase 00 creates none of these.

## 3. Data model and migrations

Tables and essential columns (camelCase in TypeScript, snake_case in SQL):

- `meta` (schema version in `PRAGMA user_version`); `settings(key PK, value JSON, updated_at)`.
- `projects(id, name, favorite, sort_order, created_at, updated_at, deleted_at, trash_batch_id)`.
- `folders(id, project_id NULL, parent_id NULL, name, favorite, sort_order, created_at, updated_at, deleted_at, trash_batch_id)`.
- `notes(doc_key INTEGER PRIMARY KEY AUTOINCREMENT, id UNIQUE, project_id NULL, folder_id NULL, title, format 'rich'|'plain', content_json NULL, content_text NULL, plain_text, revision, sticky_enabled, color, pinned_at NULL, favorite, created_at, updated_at, deleted_at, trash_batch_id)`.
- `notes_fts` (external-content FTS5 over `notes`: columns title, plain_text; `content_rowid='doc_key'`; tokenizer per D-029; kept in sync by triggers that index only rows with `deleted_at IS NULL`; D-036).
- `note_versions(id, note_id, revision, format, content_snapshot, attachment_ids JSON, reason 'auto'|'conversion'|'conflict'|'restore'|'import', created_at)`.
- `note_drafts(id, note_id, view_id, base_revision, format, title NULL, content, reason 'conflict'|'lease_lost', created_at, resolved_at)`.
- `attachments(id, managed_relative_path, sha256 UNIQUE, mime, size_bytes, original_name, kind 'image'|'document', created_at, unreferenced_since NULL)`; `note_attachments(note_id, attachment_id, block_id NULL)`.
- `window_state(key PK, bounds JSON, display_id, open, collapsed, always_on_top, updated_at)` with key `sticky:<noteId>`, `widget` or `main`.
- `reminders`, `occurrences`, `alert_deliveries` per section 8, with an index on `occurrences(next_alert_at_utc)` where not null.
- `reminder_sources(reminder_id PK, note_id, block_id, source_text, span_start, span_end, reference_instant_utc, reference_zone, parser_version, source_state 'ok'|'changed'|'missing')`; `suggestion_dismissals(dedupe_key PK, note_id, created_at)` where the dedupe key is the SHA-256 of noteId, blockId, normalized span text, span start and the reference date in the zone.
- `note_references(id, source_note_id, source_block_id NULL, target_note_id, target_block_id NULL, target_title_snapshot)`; `tags(id, name UNIQUE)`; `note_tags(note_id, tag_id)`.

Conventions: timestamps are INTEGER epoch milliseconds UTC; booleans are INTEGER 0/1; foreign keys ON; WAL; `synchronous=FULL`; read queries exclude `deleted_at IS NOT NULL` by default.

Migrations: one forward-only SQL file per number, applied in a transaction together with `user_version`. Before applying, a pre-migration copy is made with the backup API into `data/pre-migration/` (last 3 kept). A failed migration rolls back and the app shows "Database upgrade failed; your data was not changed" with Show data folder and Quit. A database newer than the app is refused without modification. Accepted migrations are never edited. Allocation: 001 Phase 01 (settings, projects, folders, notes, notes_fts, note_versions, note_drafts, attachments, note_attachments); 002 Phase 04 (window_state); 003 Phase 05 (reminders, occurrences, alert_deliveries); 004 Phase 06 (reminder_sources, suggestion_dismissals); 005 Phase 07 (note_references, tags, note_tags); 006 Phase 08 only if needed.

### Hierarchy rules

- Scope is Common (projectId NULL) or a project. Common is permanent: not renameable, not deletable, always first in the tree.
- Folders exist in Common and in projects. Notes live at a scope root or in a folder; stickies are notes with `stickyEnabled = 1` and live anywhere a note can.
- Enforced in main inside transactions: a folder's projectId equals its parent's; a note's projectId equals its folder's; maximum folder depth 32 (error `LIMIT_EXCEEDED`).
- Cycle rule: moving folder F under T is rejected with `CYCLE` when T is F or a descendant of F (recursive CTE in the same transaction).
- Moving a folder to another scope updates projectId on the folder, descendant folders and contained notes in one transaction; references and reminders are ID-based and unaffected.
- Names are trimmed, 1-200 characters, without control characters; duplicate sibling names are allowed; pickers and search show the path.
- Ordering: folders before notes, then case-insensitive alphabetical (`sortOrder` reserved, unused in V1). Drag and drop is optional; the required path is the keyboard-accessible Move to dialog.
- Trash: deleting a note, folder or project soft-deletes it and all descendants with one `trashBatchId` and `deletedAt`. Restore returns the batch to its original parent if it is live, otherwise to the nearest live ancestor, otherwise to the Common root with a notice. Permanent delete needs confirmation, after which attachments become eligible for GC. Reminders of trashed notes are suspended.
- Pin (`pinnedAt`) applies to notes; favorites apply to notes, folders and projects. Tags (Phase 07) are lowercase, 1-32 characters, at most 20 per note, used only as a search filter.

### Tab session model

Tab kinds: `home` (singleton, index 0), `note` (one per noteId), singleton pages `stickies`, `reminders`, `settings`. Only the active note tab mounts a `NoteEditor`; inactive tabs keep `{noteId, title, scrollTop}` in memory only, and switching away flushes the pending save. The setting `session.tabs` = `{version:1, tabs:[{id, kind, noteId?, scrollTop?}], activeTabId}` is written on every change (debounced 500 ms) and on quit; on startup tabs for missing or trashed notes are dropped with one notice and duplicates collapse.

## 4. IPC conventions and catalogue

Channel names are `domain:action`, request and response via `invoke`; responses are `{ok:true, data}` or `{ok:false, error:{code, message, details?}}` (`details` is optional JSON, for example `CONFLICT {currentRevision, draftId}`; D-042) with codes `VALIDATION_FAILED, NOT_FOUND, CONFLICT, LEASE_REQUIRED, CYCLE, LIMIT_EXCEEDED, UNSUPPORTED, FORBIDDEN, INTERNAL`. Main-to-renderer events use the whitelisted `subscribe`, which returns an unsubscribe function. Every handler validates the sender frame URL and the Zod payload.

Catalogue (later phase plans may add channels but must update this list):

| Phase | Channels | Events |
| --- | --- | --- |
| 01 | `app:getInfo`, `app:showDataFolder`, `app:quit`, `settings:get`, `settings:set`, `capabilities:get` | `settings:changed` |
| 02 | `tree:list`, `project:create\|rename\|trash`, `folder:create\|rename\|move\|trash`, `note:create\|rename\|move\|trash`, `trash:list\|restore\|purge`, `note:setPinned`, `item:setFavorite`, `home:summary`, `session:get\|set`, `palette:searchTitles` | `tree:changed` |
| 03 | `note:open`, `note:save`, `lease:acquire\|release\|take`, `note:convertFormat`, `versions:list\|restore`, `drafts:list\|resolve`, `attachment:importImageBytes`, `attachment:importFromDialog` | `note:revision`, `note:lease`, `note:trashed`, `lease:release-request` |
| 04 | `sticky:float\|dock\|hide\|setColor\|setPinned\|setCollapsed\|removeSticky`, `window:getState` | `sticky:state` |
| 05 | `reminder:create\|update\|delete\|undoDelete\|listForNote\|listView`, `occurrence:complete\|snooze`, `reminders:summary`, `widget:show\|hide\|setPinned\|setCollapsed`, `zones:list` | `reminder:changed`, `app:openNote` |
| 06 | `reminder:createFromSuggestion`, `suggestion:dismiss\|listDismissed`, `reminder:updateFromSource` | |
| 07 | `refs:list`, `search:query`, `notes:pick`, `attachment:open\|showInFolder`, `shell:openExternal`, `tags:list\|set` | |
| 08 | `backup:create\|restore`, `export:markdown\|portable`, `import:portable`, `autostart:set`, `shortcut:setGlobal` | |

Test-only hooks (fake clock control, captured notifications, simulated notification click) exist only when `!app.isPackaged && process.env.INFINITY_NOTES_E2E === '1'`.

## 5. Windows and Capabilities

- Main window: native frame, single instance (second launch focuses it).
- Sticky windows: main keeps `Map<noteId, BrowserWindow>`; a second Float focuses the existing window; main validates the noteId (UUID, exists, not purged) before creating a window and the renderer route re-validates through IPC. The OS close button hides the window (stores `open = 0`) and never deletes. Dock closes the window and opens or focuses the note tab. Floating an ordinary note sets `stickyEnabled = 1`; "Remove from stickies" clears it.
- Window state is persisted in `window_state`. Restore clamps bounds to a connected display work area (fallback primary display, default size 320x300, minimum 220x120). On Wayland only size and collapsed state are restored. Restoring open stickies on startup is the setting `stickies.restoreOnStartup`, default off.
- Widget: optional, default off, uses the main ReminderService; hiding it does not stop scheduling.
- Close, tray and quit lifecycle (D-027): the first main-window close asks to keep running in the background or quit; the choice is remembered and editable; menus always have Quit; Quit flushes every view and closes all windows. If no tray host exists, launching the app again focuses the running instance.

### Capabilities

Detected at runtime by one `PlatformCapabilities` service in main (`src/main/services/capabilities.ts`) and exposed read-only to renderers. The UI hides or disables unsupported controls with the tooltip "Not supported by this desktop" and never pretends success.

| Capability | Windows 11 | Linux X11 (declared, outside validation scope) | Linux Wayland GNOME (declared, outside scope) | WSLg Wayland (validated env) | Fallback when unsupported |
| --- | --- | --- | --- | --- | --- |
| Independent native windows, user move and resize | yes | yes | yes | expected yes; verify | none needed |
| Programmatic position set and restore | yes | yes (window manager may adjust) | no (Wayland prohibits global coordinates) | treated as Wayland: no | restore size, collapsed and pin only; compositor places the window |
| Display clamping of restored bounds | yes | yes | not applicable | not applicable | skip |
| Always-on-top (sticky pin, widget pin) | yes | window-manager dependent | no | no | control disabled with tooltip; X11 is not forced |
| Tray icon | yes | needs a StatusNotifier host | extension dependent | no host detected | close dialog explains background behavior; relaunch focuses the running instance; Quit in the app menu |
| Native notifications | yes (AppUserModelID; installed shortcut for packaged build) | libnotify plus a running notification server | yes | no notification server detected | in-app banner, Reminders/Home/widget overdue lists, taskbar attention (`flashFrame`); outcome recorded as `failed`, `unsupported` or `uncertain` |
| Notification click opens note | yes | server dependent | yes | not applicable without a server | open from the in-app banner or widget |
| Native notification action buttons | not used | no | no | no | none in V1 on any OS (D-026); Snooze, Done and Open are in the app and widget |
| Launch at login | `app.setLoginItemSettings` | XDG autostart `.desktop` | same | session dependent | opt-in, default off; failure reported in Settings |
| Global shortcut | `globalShortcut` | yes | generally no | likely no | opt-in, default off; failure shown in Settings |
| Sleep and resume events | `powerMonitor` | yes | yes | WSL semantics differ; record actual | bounded timer and clock-jump detection |

The app never promises notifications while fully quit and never promises guaranteed window positioning or always-on-top under Wayland.

## 6. Autosave, revision and lease protocol

- Main is the only writer. The renderer debounces edits 400 ms and sends `note:save {noteId, viewId, leaseToken, baseRevision, requestId, title?, format, content}`; content JSON larger than 5 MB is rejected with `LIMIT_EXCEEDED`.
- In one transaction main verifies the lease, verifies `baseRevision == notes.revision`, writes content, extracted `plainText`, the FTS row, references (Phase 07) and attachment links, increments `revision`, commits, replies `{ok, revision, requestId}` (the acknowledgment) and broadcasts `note:revision {noteId, revision, sourceViewId}` to other views.
- Stale base revision: nothing is overwritten; the submitted content is stored in `note_drafts` (reason `conflict`) and the reply is `CONFLICT {currentRevision, draftId}`. The UI offers Compare, Restore draft (creates a version of the current content first, then saves the draft as a new revision) and Dismiss.
- Flush points with acknowledgment: blur, tab switch, tab close, window close, lease hand-off, format conversion and app quit. Window close and quit wait up to 2000 ms per view.
- Lease: main holds `Map<noteId, {viewId, token, acquiredAt}>`. The first editing view gets the lease; other views are read-only with the banner and a Take edit control button. Take: main sends `lease:release-request` to the holder, waits up to 3000 ms for the flush acknowledgment, grants the lease to the requester and broadcasts `note:lease`. If the holder does not answer or is destroyed the lease is revoked; any later save with the revoked token is stored as a `lease_lost` draft and rejected with `LEASE_REQUIRED`. Float is an implicit take request by the sticky. Read-only mirrors reload content on `note:revision`.

Text sequence for a normal save:

```
renderer(edit) -> debounce 400 ms -> main: note:save
main: BEGIN; check lease; check baseRevision; write content+plainText+FTS+links; revision+1; COMMIT
main -> renderer: {ok, revision, requestId}      (acknowledgment)
main -> other views: note:revision {noteId, revision, sourceViewId}
```

Durability: WAL with `synchronous=FULL`, so an acknowledged commit survives power loss. Edits within the last debounce window before a crash may be lost; renderer crashes never lose acknowledged content. Versions (`note_versions`) are created on format conversion, conflict restore, version restore, before a destructive import overwrite and automatically at most once per 10 minutes of editing per note; retention per D-034.

## 7. Attachments and protocol

- Main receives image bytes (clipboard bitmap converted to PNG in main, or file bytes from paste, drop or the import dialog), checks size, checks the magic number (PNG, JPEG, GIF, WebP only; SVG, HTML, HEIC and unknown types are rejected with a friendly message), computes SHA-256, writes to `data/attachments/tmp/`, fsyncs, renames atomically to `attachments/<aa>/<id>.<ext>` and registers the row in a transaction. An identical hash reuses the existing row.
- Documents: any type is copied as a managed copy up to the document limit and never executed. Opening uses `shell.openPath` on the managed copy only for non-executable extensions; executable or script types (exe, msi, bat, cmd, com, ps1, vbs, js, jar, sh, AppImage, desktop, lnk, scr, run, bin, deb, rpm) are refused for opening and offered Show in folder. Paths are never passed through a shell.
- Limits: image default 20 MB (range 1-100 MB); document default 50 MB (range 1-200 MB). Oversize shows "This image is larger than 20 MB. Change the limit in Settings or use a smaller image." and the editor stays responsive.
- Rendering: notes store `attachmentId` only; images load via `infinity-attachment://<attachmentId>` registered with `protocol.handle`. The handler validates the UUID, looks up the row, serves the file with the stored MIME and `X-Content-Type-Options: nosniff`, only for image MIME types inline, never accepts paths and answers everything else with 404.
- Remote images in pasted HTML are not fetched; they become a link or placeholder text. Pasted `data:` images are decoded and imported through the same pipeline.
- GC (Phase 08): a file is deleted only when no live note, trashed note, version or draft references it and it has been unreferenced for the 7-day grace period.

## 8. Reminders

Reminder (series) fields: id, noteId, blockId nullable, title, zoneId (IANA), startLocalDate (`YYYY-MM-DD`), localTime (`HH:mm`), recurrence (`null | {freq:'daily'} | {freq:'weekly', byWeekday:[1..7]}`, ISO weekday numbers), foldPreference (`earlier|later`, default earlier), followupIntervalMinutes (null = off; 5/10/15/30/60), maxFollowups (1/2/3/5), enabled, anchorState (`ok|block_missing`), suspended, revision, createdAt, updatedAt, deletedAt.

Occurrence stored states: `pending`, `snoozed`, `completed`, `missed`, `cancelled`. Overdue is derived (pending with dueAt at or before now, or snoozed with snoozedUntil at or before now and not yet re-alerted), never stored. Fields: dueAtUtc, originalLocalDateTime, snoozedUntilUtc, nextAlertAtUtc (null = no further alerts), followupsSent, revision, completedAt. Unique (reminderId, dueAtUtc).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| (new) | create, due in the future | pending | nextAlertAt = dueAt |
| (new) | create with an explicitly accepted past date | pending | nextAlertAt = null (shown overdue, no notification) |
| pending | tick, nextAlertAt reached, not in quiet hours, enabled and not suspended | pending | claim AlertDelivery (sequence n) then dispatch; followupsSent + 1 if n > 0; nextAlertAt = now + interval if follow-ups remain else null |
| pending | tick inside quiet hours | pending | nextAlertAt = quiet-hours end, no dispatch |
| pending, snoozed | Snooze(d) | snoozed | snoozedUntil = now + d; nextAlertAt = snoozedUntil; follow-ups paused |
| snoozed | tick at snoozedUntil | pending | dispatch kind `snooze`; follow-ups resume |
| pending, snoozed | Done | completed | completedAt = now; nextAlertAt = null; follow-ups stop |
| pending, snoozed (recurring) | next occurrence of the series becomes due | missed | nextAlertAt = null; at most one open overdue occurrence per series |
| pending, snoozed (not yet due) | series edited or deleted | cancelled | regenerated per the new rule if edited |
| pending, snoozed (overdue) | series edited | unchanged or completed | explicit choice: "Keep the current overdue reminder" (default) or "Mark it done" |
| any | notification dismissed or closed | unchanged | delivery outcome may record `closed`; never completion |

Series generation: ensure exactly one future pending occurrence exists for active recurring series. After downtime, only the latest occurrence with dueAt at or before now is generated (older open ones become missed) plus the next future one; intermediate rows are never created.

Note trash suspends all of the note's reminders (no alerts, hidden from Today and Upcoming); restore clears it, and occurrences that fell due meanwhile are overdue with at most one recovery alert. A deleted block leaves the reminder note-linked with `anchorState = block_missing` and the side-panel chip "Original text was removed" with Re-anchor and Keep note-level. Reminder delete is a soft delete with Undo for 10 s.

### Scheduler, delivery uncertainty, follow-ups, quiet hours and recovery

- One `ReminderService` in main serves the app, stickies and widget. Time comes from an injectable `Clock` (`now()`, `monotonicNow()`); notifications go through a `NotificationAdapter` (`show(payload)` returning an outcome, click and close callbacks). One timer is set to the minimum `nextAlertAtUtc`, capped at 60 s, and recalculated after every write, resume or unlock, settings change, zone change and startup.
- Clock jump: each wake compares the wall-clock delta with the monotonic delta; a difference above 120 s triggers recalculation and a recovery batch (forward jump) or rescheduling only (backward jump; claimed sequences never repeat).
- Delivery: in one transaction insert `alert_deliveries (occurrenceId, alertSequence, kind, batchId, claimedAt, outcome='claimed')` with UNIQUE(occurrenceId, alertSequence) and update the occurrence with `WHERE id=? AND revision=? AND state IN ('pending','snoozed')`; commit; then call the adapter and record `dispatched`, `failed` or `unsupported`. If the update matched 0 rows (Done or Snooze won), nothing is dispatched.
- Uncertainty: exactly-once delivery across crashes is impossible. A claim found at startup with outcome `claimed` and no dispatchedAt is marked `uncertain`, is never re-dispatched under the same sequence, and the occurrence stays overdue. A delivery attempt never completes an occurrence.
- Follow-ups: off by default; default 15 minutes times 2 when enabled. `followupsSent` increments at claim time. Follow-ups that would have fired during downtime or quiet hours are not replayed; the next alert happens once when eligible and the cadence continues from then.
- Quiet hours: setting `{enabled:false, start:'22:00', end:'07:00', zoneId}` with the zone explicitly stored. Deferred alerts are one per occurrence.
- Recovery batch (startup, resume, forward clock jump, quiet-hours end): collect occurrences with nextAlertAt at or before now; up to 3 get one alert each; more than 3 produce one summary notification "N reminders are overdue" (click opens Reminders > Overdue) with a claim per occurrence of kind `recovery_summary`. The main window shows an overdue summary banner on startup. Never more than one alert per occurrence per batch.
- Fully quit: no reminder fires; Settings > Reminders and the close dialog say so.

## 9. Time and DST

- Store zoneId plus the local wall-clock schedule (startLocalDate, localTime, recurrence) on the series; each occurrence stores dueAtUtc and originalLocalDateTime. Daily and weekly series keep wall-clock time in the stored zone across DST changes.
- `resolveLocal({date, time}, zoneId, foldPreference)` in `src/shared/time/resolve.ts` returns `{status:'ok'|'gap'|'fold', instantUtc, alternatives?}`.
  - Gap (nonexistent local time): the first valid instant after the gap. Example: 2026-03-08 02:30 America/New_York resolves to 03:00 EDT = 2026-03-08T07:00:00Z, disclosed as "02:30 does not exist on this date in New York; the reminder will use 03:00".
  - Fold (ambiguous local time): earlier occurrence by default, disclosed, later selectable. Example: 2026-11-01 01:30 America/New_York is 01:30 EDT = 05:30Z (default) or 01:30 EST = 06:30Z.
  - Implementation: compute candidates with offsets 12 h before and after the naive instant, keep candidates whose local rendering equals the request; with none, binary-search the transition at minute granularity. Luxon's default shifting is not used.
- Recurring series on a gap day use the gap rule for that day only; on a fold day they use the series foldPreference; never two occurrences for one fold.
- OS zone change affects local display and the default zone for new reminders only; stored zones never change. The zone is re-read on each scheduler wake and resume.
- Relative durations ("in 2 hours") use instant arithmetic; calendar phrases ("tomorrow 9am", "in 3 days") use calendar arithmetic in the selected zone.

## 10. NLP pipeline

chrono-node `parse(text, {instant: refInstant, timezone: offsetMinutesOfSelectedZoneAtRef}, {forwardDate: false})`, keep `knownValues` only, apply app rules, then `resolveLocal` in the selected IANA zone. Parsing runs locally in the renderer during idle time; main re-resolves the confirmed local components and zone before persisting and never trusts a renderer-provided instant.

- End of day ("end of (the) day", "EOD", "by end of day") uses `reminders.endOfDayTime`, default 17:00; standalone means today; the spurious chrono "the day" result is suppressed inside an EOD phrase.
- Date-only phrases use `reminders.dateOnlyTime`, default 09:00, disclosed as "09:00 (default time for date-only phrases)".
- Explicit times are used as given; a bare hour 1-12 without am/pm or a day-part word requires an am/pm choice.
- "in N minutes/hours" is refInstant plus duration; "in N days/weeks" is calendar arithmetic then the date-only default unless a time is given.
- Weekdays (Monday-Sunday ISO week): bare, "this", "on" or "by" W is the first date on or after today in the selected zone with weekday W whose resolved instant is after refInstant; "next W" is W in the following week; "last W" is the previous occurrence, visibly past. The preview shows the full date with weekday.
- Ambiguous numeric dates (both parts 12 or less and different) require choosing the order; zone abbreviations (CST, IST, BST, EST) require choosing an IANA zone with no default; unsupported text yields no candidate while manual entry stays available.
- Year omitted: current year in the selected zone; if past it is shown past with an explicit "Use next year" button and never silently rolled forward. Multiple phrases in a block produce separate candidates. English only.
- Frozen-clock examples: PRODUCT_SPEC section 6.

## 11. Search

FTS5 table with tokenizer `unicode61 remove_diacritics 2 categories 'L* N* Co M*'` (D-029), prefix queries, title substring fallback for 1-2 character queries, results capped at 50, query debounce 150 ms. Snippets are built from text with highlight markers, never raw HTML. Index updates inside the same transaction as the note write, and on move, trash and restore.

## 12. References

References are ID-based (`note_references`) with a target title snapshot for missing-target display and optional block IDs. Plain-text notes support note-level references and note-level reminders only in V1, never character offsets. Renaming or moving a target preserves links; a missing or trashed target shows a clear state with Restore or Search and never silently redirects. Pasted and duplicated content never aliases block IDs.

## 13. Backup, restore and export

- Backup `*.infinitybackup` (zip via yazl): `manifest.json` (`format: "infinity-notes-backup"`, `formatVersion: 1`, appVersion, schemaVersion, createdAt, db `{path, sha256, size}`, attachments `[{id, path, sha256, size}]`) and `db/infinity-notes.sqlite3` produced by the SQLite online backup API (`db.backup()`), so WAL content is included; the live file is never copied.
- Restore: preflight (zip entry names normalized; reject absolute paths, `..`, drive letters, symlink attributes, more than 200,000 entries, total uncompressed over 4 GB by default, per-entry compression ratio over 100), extract to `data/restore-staging/`, verify hashes, open the staged DB read-only, `PRAGMA integrity_check`, require schemaVersion at most the app's (older migrate forward after restore; newer are refused), close the live DB, move live data to `data/rollback-<timestamp>/`, move staging into place and reopen. Any failure moves the rollback copy back. The previous rollback copy is kept until the next successful start, then deletable from Settings.
- Portable export `*.infinityexport` (zip): JSON documents for projects, folders, notes, references and reminders plus attachments. Import remaps all note, block and attachment IDs and references and never overwrites existing items. Markdown or plain-text export is lossy (block IDs, reminders, colors and sticky state are dropped).
- Automatic backup: off by default; user-chosen destination; interval default 7 days; keep count default 5.

## 14. Security

`contextIsolation` true, `nodeIntegration` false, `sandbox` true for all renderers; a single preload exposes `window.infinity` with an explicit method list. Built and packaged renderers load `infinity-app://renderer/index.html` from a privileged custom scheme restricted to the bundled renderer directory, never `file://` (D-035). Every `ipcMain.handle` validates that the sender is a top-level frame of a window created by main whose origin is `infinity-app://renderer` (or the electron-vite dev origin in development only) and the payload with Zod; JSON payloads are limited to 5 MB except the image import channel (binary, bounded by the image limit).

CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob:; font-src 'self'; connect-src 'self'` (plus the dev server and websocket in development only); `object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`.

`will-navigate` is blocked, `setWindowOpenHandler` denies, and all permission requests are denied. External links open only on Ctrl+Click or the link popover Open, only http and https, through `shell.openExternal` after URL parsing. Renderers have no arbitrary file, SQL or shell access. Production never disables the Chromium sandbox. There are no outbound network requests at runtime.

## 15. Testing architecture

- Seams: `Clock`, `NotificationAdapter`, `DisplayProvider` (screens and work areas), `PlatformCapabilities`, `AttachmentStore` root path and the DB adapter.
- Integration tests run in Node 24 against real better-sqlite3 temporary databases (the same N-API binary as Electron). E2E launches the built Electron app with `INFINITY_NOTES_USER_DATA_DIR` pointing to a temporary directory. Linux E2E runs in WSL as the unprivileged user `infinity` (Chromium refuses root without disabling the sandbox; D-039), both in the WSLg session and under `xvfb-run` (application logic only); native compositor behavior is recorded separately in the native OS matrix.
- Test-type legend: U unit, I integration, E Electron E2E, N native OS validation, V visual or accessibility review, P performance, R review.
- Standard npm scripts: `dev, lint, typecheck, test:unit, test:integration, test:e2e, check, build, package:current, package:win, package:linux`. Scripts that do not yet apply must print their real status and exit non-zero rather than silently pass.

## 16. Performance fixtures and targets

10,000 notes, 100 projects, 10 tabs, 10 stickies, 1,000 reminders. Targets measured in Phase 09: cold startup under 3 s, search p95 under 300 ms, bounded memory with inactive editors disposed, no leaks after repeated window open and close.

## 17. Packaging notes

better-sqlite3 uses N-API prebuilds; electron-builder is configured with `npmRebuild: false` and `asarUnpack` for `**/*.node` (D-004, D-012). Windows NSIS installs from the Windows checkout; Linux AppImage and .deb are built from a copy on the WSL ext4 filesystem (for example `~/infinity-notes`) with its own `node_modules`; `node_modules` is never shared across operating systems. Builds are unsigned and labeled so. The Linux validation environment is WSL2 Ubuntu 26.04 with WSLg (Weston); the actual ozone platform used is logged at startup.

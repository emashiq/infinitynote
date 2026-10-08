# Infinity Notes backlog and traceability

Companion documents: [PRODUCT_SPEC](PRODUCT_SPEC.md), [UX_SPEC](UX_SPEC.md), [ARCHITECTURE](ARCHITECTURE.md), [DECISIONS](DECISIONS.md). This table is checked by `node tools/check-traceability.mjs`.

## 1. Legend

- ID scheme: `INF-<AREA>-<NN>`; areas FND foundation, SHELL shell, HOME, HIER hierarchy, TABS, KEY keyboard and commands, EDIT editor, SAVE persistence and editing, STKY stickies, DESK desktop lifecycle, REM reminders, SCHED scheduler, WIDG widget, NLP parsing, SUG suggestions, REF references, SRCH search, PORT portability, PREF preferences, A11Y accessibility, PERF performance, PKG packaging and release, SEC security.
- Test types: U unit, I integration, E Electron E2E, N native OS validation (recorded in the native OS matrix), V visual or accessibility review with screenshot evidence, P performance measurement, R review or inspection of code, config or docs.
- Statuses: `planned`, `in_progress`, `done`, `not_run`, `outside_validation_scope`, `deferred`.

## 2. Requirement table

<!-- BACKLOG-TABLE-START -->
| ID | Requirement | Phase | Tests | Planned tests | Status |
| --- | --- | --- | --- | --- | --- |
| INF-FND-01 | One offline Electron app; no backend, accounts, sync, telemetry or AI calls; no outbound network requests at runtime | 01 | E,R | e2e/smoke.spec › no network requests; dependency review | planned |
| INF-FND-02 | Single-instance lock; a second launch focuses the existing main window | 01 | E,N | e2e/smoke.spec › second instance focuses first | planned |
| INF-FND-03 | Secure windows: contextIsolation, no nodeIntegration, sandbox, CSP, blocked navigation/window.open, permission requests denied | 01 | E,R | e2e/security.spec › renderer has no node/require; navigation blocked | planned |
| INF-FND-04 | Narrow typed preload bridge; Zod-validated payloads; sender validation; payload size limits; renderer cannot read files, run SQL or shell | 01 | U,I,E | unit/contracts.test; integration/ipc-validation.test; e2e/security.spec › bridge surface | planned |
| INF-FND-05 | Main-owned SQLite adapter with WAL, foreign keys, forward-only transactional migrations, pre-migration copy; failed migration rolls back and shows recoverable error; newer schema refused | 01 | I,E | integration/migrations.test › failure rolls back; e2e/migration-failure.spec | planned |
| INF-FND-06 | Versioned settings repository persists across relaunch with defaults and validation | 01 | I,E | integration/settings.test; e2e/smoke.spec › setting survives relaunch | planned |
| INF-FND-07 | User data under userData/data, never install dir; INFINITY_NOTES_USER_DATA_DIR isolates tests | 01 | I,E | integration/paths.test; e2e/smoke.spec › temp userData used | planned |
| INF-FND-08 | Restricted infinity-attachment protocol serves only registered attachment IDs; no paths or traversal | 01 | I,E | integration/protocol.test › unknown id 404, traversal rejected | planned |
| INF-FND-09 | Standard npm scripts exist and report real status (no silent passes) | 01 | R | review package.json scripts + logs | planned |
| INF-FND-10 | Windows and Ubuntu CI definitions (not pushed) with build, tests, native-module check and artifacts | 01 | R | review .github/workflows files | planned |
| INF-FND-11 | Stable app identity (appId, productName, AppUserModelID, icon placeholder) | 01 | R,N | review builder config; native toast identity check | planned |
| INF-FND-12 | Native SQLite loads in Electron main with FTS5, BLOB and backup API on Windows and WSL Ubuntu | 01 | I,E,N | integration/sqlite-capabilities.test; e2e/smoke.spec › db diagnostics | planned |
| INF-FND-13 | Save-revision and writer-lease contracts defined in shared contracts before UI | 01 | U,I | unit/contracts.test › note:save schema; integration/revision.test | planned |
| INF-SHELL-01 | Compact reference-inspired shell: rail (Home, Notes, Stickies, Reminders, Settings), header with search/command box, tab strip, document area, violet accent, no capture-specific labels | 02 | V,E | e2e/shell.spec › rail navigation; screenshot 1100x720 | planned |
| INF-SHELL-02 | Collapsible, resizable tree pane 220-280 px, width persisted | 02 | E,V | e2e/shell.spec › tree toggle and width persists | planned |
| INF-SHELL-03 | Collapsible right context panel 280-340 px with Info section; later Reminders and References sections | 02 | E,V | e2e/shell.spec › panel toggle | planned |
| INF-SHELL-04 | Narrow windows turn tree (<960 px) and panel (<1180 px) into drawers | 02 | E,V | e2e/shell.spec › narrow 760x560 drawers; screenshot | planned |
| INF-SHELL-05 | Compact dark theme tokens following OS theme | 02 | V | screenshot light/dark | planned |
| INF-SHELL-06 | Native window frame and controls; visible keyboard focus | 02 | V,N | screenshot focus ring; native window check | planned |
| INF-HOME-01 | Single reusable Home tab, always first, not closable or duplicable | 02 | E | e2e/home.spec › one Home tab after relaunch | planned |
| INF-HOME-02 | Home shows quick actions (New note, New sticky, New project), Pinned and Recent | 02 | E | e2e/home.spec › pinned and recent reflect data | planned |
| INF-HOME-03 | Home scope filter All/Common/Project on one dashboard, persisted; new items inherit filter scope | 02 | I,E | e2e/home.spec › filter; integration/home-summary.test | planned |
| INF-HOME-04 | Home shows overdue and due-today reminders with link to Reminders page | 05 | E | e2e/reminders.spec › Home reminder section | planned |
| INF-HIER-01 | Common is a permanent scope for notes, stickies and folders; cannot be renamed or deleted | 02 | I,E | integration/hierarchy.test › Common immutable | planned |
| INF-HIER-02 | Create, rename and trash projects | 02 | I,E | integration/hierarchy.test › project CRUD; e2e/tree.spec | planned |
| INF-HIER-03 | Nested folders up to depth 32 in projects and Common; create, rename, trash | 02 | I,E | integration/hierarchy.test › deep folders, depth limit | planned |
| INF-HIER-04 | Notes created at scope root or inside any folder | 02 | I,E | e2e/tree.spec › create note in folder | planned |
| INF-HIER-05 | Stickies can belong to Common or any project/folder before floating exists | 02 | I,E | integration/hierarchy.test › sticky in folder | planned |
| INF-HIER-06 | Duplicate sibling names allowed and disambiguated by path | 02 | I | integration/hierarchy.test › duplicate names | planned |
| INF-HIER-07 | Move notes/folders across folders, projects and Common; subtree scope updated transactionally | 02 | I,E | integration/hierarchy.test › subtree move atomic | planned |
| INF-HIER-08 | Folder cycles rejected with clear message | 02 | I,E | integration/hierarchy.test › cycle rejected; e2e/tree.spec | planned |
| INF-HIER-09 | Trash with batch soft delete, restore to original or nearest valid location, permanent delete with confirmation | 02 | I,E | integration/trash.test; e2e/tree.spec › trash and restore | planned |
| INF-HIER-10 | Pin notes to Home; favorite notes, folders and projects | 02 | I,E | e2e/home.spec › pin; e2e/tree.spec › favorites | planned |
| INF-HIER-11 | Optional small tags (<=20 per note) usable as search filter | 07 | I,E | integration/tags.test; e2e/search.spec › tag filter | planned |
| INF-HIER-12 | Keyboard navigation of the tree (ARIA tree, F2, Delete, Enter, arrows) | 02 | E,V | e2e/a11y-keyboard.spec › tree | planned |
| INF-TABS-01 | Multiple note tabs; one tab per note, reopening focuses it | 02 | E | e2e/tabs.spec › no duplicate tabs | planned |
| INF-TABS-02 | Switch tabs by click and Ctrl+Tab/Ctrl+Shift+Tab | 02 | E | e2e/tabs.spec › ctrl+tab | planned |
| INF-TABS-03 | Close via Ctrl+W, button or middle-click; never deletes the note; pending save flushed first | 02 | E | e2e/tabs.spec › close keeps note; e2e/editor.spec › flush on close | planned |
| INF-TABS-04 | Tab overflow scrolls and offers an All tabs list | 02 | E,V | e2e/tabs.spec › overflow list | planned |
| INF-TABS-05 | Tabs, order and active tab restored after relaunch without duplicates | 02 | I,E | e2e/tabs.spec › restore after relaunch | planned |
| INF-TABS-06 | Trashing a note closes its tabs; restored session skips trashed/missing notes with notice | 02 | E | e2e/tabs.spec › trashed note tab closed | planned |
| INF-TABS-07 | Only the active tab mounts an editor; inactive tabs keep lightweight state; editors disposed; image cache bounded | 03 | E,P | e2e/editor.spec › single editor instance; perf/editors | planned |
| INF-TABS-08 | Singleton page tabs for Stickies, Reminders and Settings | 02 | E | e2e/tabs.spec › page singletons | planned |
| INF-KEY-01 | Ctrl+N creates a note in the current scope | 02 | E | e2e/keyboard.spec › ctrl+n | planned |
| INF-KEY-02 | Ctrl+Shift+N creates a sticky in the current scope | 02 | E | e2e/keyboard.spec › ctrl+shift+n | planned |
| INF-KEY-03 | Ctrl+K command palette with common actions and title search | 02 | E | e2e/palette.spec › actions and titles | planned |
| INF-KEY-04 | Ctrl+F find in the current note | 03 | E | e2e/editor.spec › find in note | planned |
| INF-KEY-05 | Optional global quick-sticky shortcut, off by default, capability checked, failure reported | 08 | I,N | integration/shortcuts.test; native check | planned |
| INF-KEY-06 | Keyboard help listing shortcuts | 08 | E | e2e/settings.spec › keyboard help | planned |
| INF-EDIT-01 | One shared Tiptap editor component for tabs and stickies; no custom contentEditable engine | 03 | R,E | review; e2e/editor.spec | planned |
| INF-EDIT-02 | Headings, bold, italic, bullet/numbered lists, checklist, links, inline code, code blocks, undo/redo | 03 | U,E | unit/editor-schema.test; e2e/editor.spec › formatting survives reload | planned |
| INF-EDIT-03 | Title editing; empty title shows Untitled; rename flushes | 03 | E | e2e/editor.spec › rename | planned |
| INF-EDIT-04 | Separate plain-text document format | 03 | U,I,E | integration/notes-format.test; e2e/editor.spec › plain note | planned |
| INF-EDIT-05 | Rich to plain conversion warns about formatting/image loss and creates a recoverable version | 03 | I,E | integration/notes-format.test › version created; e2e/editor.spec › conversion warning | planned |
| INF-EDIT-06 | Stable UUID block IDs preserved across edits; regenerated on paste and duplicate | 03 | U,E | unit/block-ids.test › paste regenerates | planned |
| INF-EDIT-07 | Pasted HTML sanitized (scripts, handlers, iframes, objects, embeds); remote images not fetched | 03 | U,E | unit/sanitize.test; e2e/paste.spec › no script execution | planned |
| INF-EDIT-08 | Clipboard bitmap paste stored as managed PNG attachment | 03 | I,E | integration/attachments.test; e2e/paste.spec › bitmap | planned |
| INF-EDIT-09 | Image files pasted/dropped/imported are copied into managed storage and remain after the original is removed | 03 | I,E | e2e/paste.spec › original deleted, image still shown after restart | planned |
| INF-EDIT-10 | Image size/type limits with friendly message; SVG/unknown rejected; editor stays responsive | 03 | U,I,E | integration/attachments.test › limits; e2e/paste.spec › oversized message | planned |
| INF-EDIT-11 | Image display with simple size presets | 03 | E | e2e/editor.spec › image size preset | planned |
| INF-EDIT-12 | Unicode including Bangla round-trips in title, content and extracted text | 03 | I,E | integration/notes-save.test › Bangla; e2e/editor.spec › Bangla | planned |
| INF-EDIT-13 | Visible saving/saved/error status | 03 | E | e2e/editor.spec › save indicator | planned |
| INF-EDIT-14 | Import local documents into managed attachments as file chips | 03 | I,E | integration/attachments.test › document import | planned |
| INF-SAVE-01 | Debounced autosave with acknowledgments; flush on blur, tab switch/close, window close and quit | 03 | I,E | integration/notes-save.test › ack; e2e/editor.spec › flush on close | planned |
| INF-SAVE-02 | Content, plain text, FTS and references committed in one transaction; revision broadcast | 03 | I | integration/notes-save.test › atomic commit | planned |
| INF-SAVE-03 | Stale revision never overwrites; conflicting content kept as recoverable draft with UI | 03 | I,E | integration/revision.test › stale save -> draft; e2e/conflict.spec | planned |
| INF-SAVE-04 | Main-managed editing lease; other views read-only with Take edit control; transfer after flush or persisted draft | 03 | I | integration/lease.test › transfer, timeout revoke | planned |
| INF-SAVE-05 | Acknowledged saves survive renderer crash and restart; unacknowledged loss window documented | 03 | I,E | e2e/crash.spec › renderer crash keeps acked text | planned |
| INF-SAVE-06 | Automatic throttled versions plus conversion/conflict/restore versions | 03 | I | integration/versions.test | planned |
| INF-STKY-01 | Float opens a native window for the same note ID; one window per note | 04 | E | e2e/stickies.spec › float same id, no duplicate | planned |
| INF-STKY-02 | Two or more stickies are independent native windows that move/resize outside the main window | 04 | E,N | e2e/stickies.spec › two windows; native move/resize | planned |
| INF-STKY-03 | Dock/Open in app closes the window and opens the note tab with content intact | 04 | E | e2e/stickies.spec › dock | planned |
| INF-STKY-04 | Sticky header: color, source badge, pin (capability checked), collapse, hide, menu | 04 | E,V | e2e/stickies.spec › header controls; screenshot | planned |
| INF-STKY-05 | Closing hides the window; Delete is a separate confirmed command | 04 | E | e2e/stickies.spec › close hides, note remains | planned |
| INF-STKY-06 | Bounds, collapsed and pin persisted; bounds clamped to connected displays; display removal recovery; Wayland restores size only | 04 | I,E,N | integration/window-state.test › clamp; native multi-display | planned |
| INF-STKY-07 | Lease transfer between tab and sticky; read-only mirror gets revisions; no acknowledged text lost | 04 | I,E | e2e/stickies.spec › take control | planned |
| INF-STKY-08 | Trashed note shows a recoverable trash state in its floating window | 04 | E | e2e/stickies.spec › trash overlay restore | planned |
| INF-STKY-09 | Restore open stickies on startup, default off | 04 | I,E | e2e/stickies.spec › restore on startup setting | planned |
| INF-STKY-10 | Stickies page lists sticky notes across scopes with Float/Open and New sticky | 04 | E | e2e/stickies.spec › stickies page | planned |
| INF-STKY-11 | No duplicate windows or leaked listeners; clean disposal | 04 | E | e2e/stickies.spec › reopen cycles leave one window | planned |
| INF-STKY-12 | Main window to background keeps stickies usable; explicit Quit flushes and closes all windows | 04 | E,N | e2e/lifecycle.spec › quit flushes | planned |
| INF-STKY-13 | Unsupported pin/positioning shown as unobtrusive capability fallback; X11 not forced | 04 | U,N | unit/capabilities.test; native WSLg check | planned |
| INF-DESK-01 | First main-window close asks keep running in background or quit; remembered and editable; states that quitting stops reminders | 04 | E | e2e/lifecycle.spec › close dialog | planned |
| INF-DESK-02 | Tray menu (Open, New sticky, Show widget, Quit) where available; tray-less fallback: relaunch focuses running instance | 04 | E,N | e2e/lifecycle.spec › second launch shows window; native tray | planned |
| INF-DESK-03 | Launch at login optional, default off, capability checked | 08 | I,N | integration/autostart.test; native login check | planned |
| INF-REM-01 | Create reminder on a note or block (including stickies) with title, date, time and IANA zone | 05 | I,E | integration/reminders.test › create; e2e/reminders.spec | planned |
| INF-REM-02 | Default zone is the OS zone, editable; never assumes UTC or a hard-coded zone | 05 | U | unit/zone-default.test | planned |
| INF-REM-03 | Show selected-zone time and local time when they differ | 05 | U,E | unit/format-time.test; e2e/reminders.spec | planned |
| INF-REM-04 | Reminder chip in content (decoration, text unchanged) and in side panel | 05 | E | e2e/reminders.spec › chip and panel | planned |
| INF-REM-05 | Reminders page with Today, Upcoming, Overdue and Completed | 05 | I,E | integration/reminder-views.test; e2e/reminders.spec | planned |
| INF-REM-06 | Native notification at due time while running, including background/tray | 05 | I,N | integration/scheduler.test › initial alert (fake adapter); native toast | planned |
| INF-REM-07 | Notification click opens and focuses the source note | 05 | E,N | e2e/reminders.spec › simulated click opens note; native click | planned |
| INF-REM-08 | Dismissing a notification does not complete the reminder | 05 | I | integration/scheduler.test › close is not done | planned |
| INF-REM-09 | Done completes only the current occurrence and stops its follow-ups | 05 | I,E | integration/scheduler.test › done stops followups | planned |
| INF-REM-10 | Snooze replaces next alert, pauses follow-ups, does not shift series, wins race with scheduler | 05 | I | integration/scheduler.test › snooze race | planned |
| INF-REM-11 | Follow-ups off by default; 15 min x2 when enabled; presets 5/10/15/30/60 min, max 1/2/3/5 | 05 | U,I | unit/followup-settings.test; integration/scheduler.test › follow-up limit | planned |
| INF-REM-12 | Daily/weekly recurrence keeps wall-clock time in stored zone across DST; completion affects current occurrence only | 05 | U,I | unit/recurrence.test; integration/scheduler.test › recurrence vs completion | planned |
| INF-REM-13 | Editing a series changes future occurrences and handles the pending one explicitly | 05 | I,E | integration/reminders.test › edit series pending policy | planned |
| INF-REM-14 | DST gap -> first valid instant after; fold -> earlier default, later selectable; previewed | 05 | U,E | unit/resolve-local.test › 2026-03-08 02:30, 2026-11-01 01:30 New York | planned |
| INF-REM-15 | OS zone change affects display/defaults only, not stored reminder zones | 05 | U,I | integration/scheduler.test › os zone change | planned |
| INF-REM-16 | No native action buttons; Snooze/Done/Open always available in app and widget | 05 | R,E | review adapter; e2e/widget.spec | planned |
| INF-REM-17 | Trashed note suspends reminders; restore resumes without flood; deleted block keeps reminder note-linked with anchor-missing state | 05 | I | integration/reminders.test › trash suspend, block missing | planned |
| INF-REM-18 | Delete reminder with undo | 05 | I,E | integration/reminders.test › delete undo | planned |
| INF-SCHED-01 | Single main ReminderService with Clock seam, indexed next-alert query and one timer capped at 60 s | 05 | U,I | integration/scheduler.test › single timer | planned |
| INF-SCHED-02 | Transactional delivery claim with unique key before dispatch; no duplicate dispatch across restart | 05 | I | integration/scheduler-recovery.test › restart around dispatch | planned |
| INF-SCHED-03 | Uncertain claims recorded, not re-dispatched, occurrence stays overdue, never auto-completed | 05 | I | integration/scheduler-recovery.test › crash after claim | planned |
| INF-SCHED-04 | Adapter failure and unsupported recorded distinctly with in-app fallback | 05 | I,E | integration/scheduler.test › adapter failure; e2e/reminders.spec › banner | planned |
| INF-SCHED-05 | Recovery after restart/sleep/clock jump: overdue summary and at most one alert per occurrence per batch; summary notification when more than 3 | 05 | I,N | integration/scheduler-recovery.test › batch limits; native sleep/wake | planned |
| INF-SCHED-06 | Quiet hours in an explicit zone defer alerts to the end, collapsed, still overdue | 05 | U,I | integration/scheduler.test › quiet hours | planned |
| INF-SCHED-07 | Recurrence generation unique per reminder+instant with bounded backfill (one open overdue per series) | 05 | I | integration/scheduler-recovery.test › long downtime no flood | planned |
| INF-SCHED-08 | Follow-up count increments at claim; recovery neither loops nor exhausts counts | 05 | I | integration/scheduler-recovery.test › followup counts | planned |
| INF-SCHED-09 | Reminders stop when fully quit; UI states it; relaunch recovers | 05 | E,R | e2e/lifecycle.spec › relaunch overdue summary | planned |
| INF-WIDG-01 | Optional reminder widget (default off) with Today/Upcoming/Overdue, Open, Snooze, Done | 05 | E | e2e/widget.spec › actions | planned |
| INF-WIDG-02 | Widget movable, resizable, collapsible, hideable; optional capability-checked always-on-top, default off | 05 | E,N | e2e/widget.spec › collapse/hide; native pin | planned |
| INF-WIDG-03 | Widget uses the main ReminderService; hiding it keeps scheduling; state shared live | 05 | I,E | e2e/widget.spec › done in widget updates app | planned |
| INF-NLP-01 | Local English parsing with explicit reference instant and selected zone; no network or LLM | 06 | U,R | unit/nlp-parse.test; dependency review | planned |
| INF-NLP-02 | Calendar components converted in the selected IANA zone, not a fixed offset | 06 | U | unit/nlp-parse.test › zone conversion | planned |
| INF-NLP-03 | End of day = configurable 17:00; tomorrow EOD at 2026-10-08 13:00 Dhaka -> 2026-10-09 17:00 Dhaka (11:00Z) | 06 | U | unit/nlp-parse.test › tomorrow end of the day | planned |
| INF-NLP-04 | Date-only phrases use 09:00 with visible disclosure | 06 | U,E | unit/nlp-parse.test › date-only; e2e/nlp.spec › disclosure | planned |
| INF-NLP-05 | Explicit times honored (tomorrow at 8pm -> 20:00) | 06 | U | unit/nlp-parse.test › explicit time | planned |
| INF-NLP-06 | Durations use instant arithmetic (in 2 hours -> 15:00 Dhaka) | 06 | U | unit/nlp-parse.test › duration | planned |
| INF-NLP-07 | Weekday policy (bare/this/next/last) per D-025 | 06 | U | unit/nlp-parse.test › weekday table | planned |
| INF-NLP-08 | Ambiguous numeric dates and bare hours require explicit choice | 06 | U,E | unit/nlp-parse.test › 03/04 at 5; e2e/nlp.spec › choice required | planned |
| INF-NLP-09 | Zone abbreviations require choosing an IANA zone | 06 | U,E | unit/nlp-parse.test › CST | planned |
| INF-NLP-10 | Past dates stay visibly past; year-less past dates offer explicit next year | 06 | U,E | unit/nlp-parse.test › past date | planned |
| INF-NLP-11 | Multiple phrases in one block yield separate candidates | 06 | U | unit/nlp-parse.test › multiple phrases | planned |
| INF-NLP-12 | Unsupported phrases give no candidate; manual entry remains available | 06 | U,E | unit/nlp-parse.test › unsupported | planned |
| INF-NLP-13 | Calendar arithmetic uses the selected zone near midnight (New York vs Dhaka) | 06 | U | unit/nlp-parse.test › new york tomorrow | planned |
| INF-NLP-14 | English only; no implied multilingual parsing | 06 | R | review docs/UI copy | planned |
| INF-SUG-01 | Idle detection in notes and stickies with unobtrusive underline and Create reminder; typing never interrupted, text unchanged | 06 | U,E | unit/suggest-detect.test; e2e/nlp.spec › underline, text unchanged | planned |
| INF-SUG-02 | Selected text -> Create reminder | 06 | E | e2e/nlp.spec › selection | planned |
| INF-SUG-03 | Confirmation card shows title, source text, weekday date, time, zone, local conversion, repeat, follow-up, Add/Cancel, DST choices | 06 | E | e2e/nlp.spec › card fields | planned |
| INF-SUG-04 | No reminder is persisted before Add | 06 | I,E | integration/suggestions.test › cancel creates nothing | planned |
| INF-SUG-05 | Confirmed absolute instant and source anchor persisted | 06 | I | integration/suggestions.test › source stored | planned |
| INF-SUG-06 | Suggestions and dismissals deduped across edits and restarts; confirmed links by reminder ID | 06 | I,E | integration/suggestions.test › dedupe after restart | planned |
| INF-SUG-07 | Restart never reinterprets saved relative text | 06 | I | integration/suggestions.test › next-day restart same instant | planned |
| INF-SUG-08 | Source edit requires explicit Update; no silent move | 06 | I,E | integration/suggestions.test › source changed state | planned |
| INF-SUG-09 | Deleted source block keeps reminder note-linked with anchor unavailable | 06 | I | integration/suggestions.test › block deleted | planned |
| INF-SUG-10 | End-to-end phrase -> preview -> confirm -> side panel -> notification opens source | 06 | E | e2e/nlp.spec › full flow | planned |
| INF-REF-01 | Insert note link via searchable picker | 07 | E | e2e/references.spec › picker | planned |
| INF-REF-02 | Stable block references to another note's block | 07 | I,E | integration/references.test › block ref | planned |
| INF-REF-03 | Side panel shows outgoing references and backlinks | 07 | I,E | e2e/references.spec › backlinks | planned |
| INF-REF-04 | Open reference in a tab and scroll to the block | 07 | E | e2e/references.spec › scroll to block | planned |
| INF-REF-05 | Rename/move of target preserves links | 07 | I,E | integration/references.test › rename/move | planned |
| INF-REF-06 | Missing/trashed target or block shows clear state with restore/search; no silent redirect | 07 | I,E | e2e/references.spec › trashed target | planned |
| INF-REF-07 | Pasted/duplicated content never aliases block IDs | 07 | U,I | integration/references.test › duplicate content | planned |
| INF-REF-08 | Attached documents opened via validated OS handoff; executables never launched | 07 | I,E | integration/handoff.test › blocked extensions | planned |
| INF-REF-09 | Quick sticky creation inherits scope; no forced project | 07 | E | e2e/stickies.spec › quick sticky scope | planned |
| INF-SRCH-01 | FTS5 search over titles and bodies including Bangla with prefix matching | 07 | I | integration/search.test › Bangla, prefix | planned |
| INF-SRCH-02 | Index updates on edit, move, trash and restore | 07 | I | integration/search.test › index lifecycle | planned |
| INF-SRCH-03 | Scope and tag filters in search | 07 | I,E | integration/search.test › scope filter | planned |
| INF-SRCH-04 | Highlighted snippets rendered safely | 07 | U,E | unit/snippet.test › no HTML injection | planned |
| INF-SRCH-05 | Debounced capped results (<=50); 10,000-note fixture measured | 07 | P,I | perf/search › p95 | planned |
| INF-SRCH-06 | Ctrl+K palette opens exact note/tab without unsaved edit loss | 07 | E | e2e/palette.spec › open with pending edit | planned |
| INF-PORT-01 | Backup: consistent snapshot including WAL data, referenced attachments, manifest with hashes | 08 | I | integration/backup.test › WAL content present | planned |
| INF-PORT-02 | Restore with preflight, staging and rollback; failed restore leaves data usable | 08 | I,E | integration/restore.test › failure rollback | planned |
| INF-PORT-03 | Import rejects traversal, symlinks, oversized, bombs and unsupported schema | 08 | I | integration/import-security.test | planned |
| INF-PORT-04 | Portable import remaps note/block/attachment IDs and references | 08 | I | integration/import.test › remap | planned |
| INF-PORT-05 | Markdown/plain-text export with documented lossy limits | 08 | I | integration/export.test | planned |
| INF-PORT-06 | Automatic backup option, default off, configurable destination and retention | 08 | I,E | integration/backup.test › auto schedule | planned |
| INF-PORT-07 | Configurable trash and version retention; version history with restore | 08 | I,E | integration/versions.test › retention; e2e/versions.spec | planned |
| INF-PORT-08 | Attachment GC only after reference checks and grace period | 08 | I | integration/attachment-gc.test | planned |
| INF-PREF-01 | Theme System/Light/Dark | 08 | E,V | e2e/settings.spec › theme | planned |
| INF-PREF-02 | Reminder defaults: zone, end-of-day 17:00, date-only 09:00, follow-up defaults | 08 | I,E | integration/settings.test › reminder defaults | planned |
| INF-PREF-03 | Quiet hours settings | 08 | E | e2e/settings.spec › quiet hours | planned |
| INF-PREF-04 | Window, tray, close, widget, startup and restore-stickies settings with fully-quit explanation | 08 | E | e2e/settings.spec › lifecycle settings | planned |
| INF-PREF-05 | Attachment size limits configurable within bounds | 08 | I | integration/settings.test › limits bounds | planned |
| INF-A11Y-01 | Keyboard-only use of tree, tabs, dialogs, editor, widget and palette | 08 | E,V | e2e/a11y-keyboard.spec | planned |
| INF-A11Y-02 | Focus returns to the invoking control after dialogs/menus | 08 | E | e2e/a11y-keyboard.spec › focus return | planned |
| INF-A11Y-03 | Accessible names and roles for icon buttons and regions | 08 | E | e2e/a11y-keyboard.spec › getByRole coverage | planned |
| INF-A11Y-04 | Text contrast >= 4.5:1 and UI boundaries >= 3:1 in both themes | 08 | U,V | unit/contrast.test › token pairs | planned |
| INF-A11Y-05 | Reduced motion honored | 08 | U,V | unit/css-motion.test; screenshot | planned |
| INF-A11Y-06 | High-DPI rendering (125-200%) is crisp | 08 | V,N | native scaling check | planned |
| INF-PERF-01 | Fixtures: 10,000 notes, 100 projects, 10 tabs, 10 stickies, 1,000 reminders | 09 | P | perf/fixtures generator | planned |
| INF-PERF-02 | Cold startup measured against <3 s target on documented machine | 09 | P | perf/startup | planned |
| INF-PERF-03 | Search p95 measured against <300 ms target at 10,000 notes | 09 | P | perf/search | planned |
| INF-PERF-04 | Image-heavy note responsiveness and inactive-editor memory measured | 09 | P | perf/editor-memory | planned |
| INF-PERF-05 | Repeated sticky/widget open-close leaves no leaked windows or listeners | 09 | E,P | e2e/stickies.spec › leak check; perf/windows | planned |
| INF-PKG-01 | Windows NSIS installer x64, unsigned and labeled | 09 | N | native install/launch Windows | planned |
| INF-PKG-02 | Linux AppImage and .deb built from WSL ext4 copy | 09 | N | native build/install WSL | planned |
| INF-PKG-03 | Packaged app loads native SQLite and persists data | 09 | N | native packaged launch/relaunch | planned |
| INF-PKG-04 | Reinstall/update preserves data; uninstall behavior documented | 09 | N,R | native reinstall; docs review | planned |
| INF-PKG-05 | Native OS matrix with host/compositor details; GNOME/X11-only cases marked outside_validation_scope | 09 | N,R | docs/NATIVE_OS_MATRIX.md review | planned |
| INF-PKG-06 | FINAL_REPORT, NATIVE_OS_MATRIX, RELEASE_CHECKLIST and user install/use/backup docs | 09 | R | docs review | planned |
| INF-SEC-01 | External links open only http/https via validated handoff on explicit action | 03 | U,E | unit/url-policy.test; e2e/editor.spec › link open | planned |
| INF-SEC-02 | Production keeps Chromium sandbox; packaged security settings reviewed | 09 | R | review builder/fuses config | planned |
| INF-SEC-03 | Dependency audit and license review before release | 09 | R | npm audit + license list log | planned |
<!-- BACKLOG-TABLE-END -->

## 3. TEST_MATRIX cross-reference

Each area of `infinity-notes-claude-pack/TEST_MATRIX.md` maps to the requirement IDs below (ranges expanded).

| TEST_MATRIX area | Requirement IDs |
| --- | --- |
| Hierarchy | INF-HIER-01, INF-HIER-02, INF-HIER-03, INF-HIER-04, INF-HIER-05, INF-HIER-06, INF-HIER-07, INF-HIER-08, INF-HIER-09, INF-HIER-10, INF-HIER-12 |
| Tabs | INF-TABS-01, INF-TABS-02, INF-TABS-03, INF-TABS-04, INF-TABS-05, INF-TABS-06, INF-TABS-07, INF-TABS-08 |
| Editor | INF-EDIT-01, INF-EDIT-02, INF-EDIT-03, INF-EDIT-04, INF-EDIT-05, INF-EDIT-06, INF-EDIT-07, INF-EDIT-08, INF-EDIT-09, INF-EDIT-10, INF-EDIT-11, INF-EDIT-12, INF-EDIT-13, INF-EDIT-14, INF-SEC-01 |
| Persistence | INF-FND-05, INF-FND-06, INF-FND-13, INF-SAVE-01, INF-SAVE-02, INF-SAVE-03, INF-SAVE-04, INF-SAVE-05, INF-SAVE-06, INF-SRCH-02 |
| Floating stickies | INF-STKY-01, INF-STKY-02, INF-STKY-03, INF-STKY-04, INF-STKY-05, INF-STKY-06, INF-STKY-07, INF-STKY-08, INF-STKY-09, INF-STKY-10, INF-STKY-11, INF-STKY-12, INF-STKY-13 |
| References | INF-REF-01, INF-REF-02, INF-REF-03, INF-REF-04, INF-REF-05, INF-REF-06, INF-REF-07, INF-EDIT-06 |
| Reminders | INF-REM-01, INF-REM-02, INF-REM-03, INF-REM-04, INF-REM-05, INF-REM-06, INF-REM-07, INF-REM-08, INF-REM-09, INF-REM-10, INF-REM-11, INF-REM-12, INF-REM-13, INF-REM-14, INF-REM-15, INF-REM-16, INF-REM-17, INF-REM-18, INF-HOME-04 |
| Scheduler recovery | INF-SCHED-01, INF-SCHED-02, INF-SCHED-03, INF-SCHED-04, INF-SCHED-05, INF-SCHED-06, INF-SCHED-07, INF-SCHED-08, INF-SCHED-09 |
| Time zones | INF-REM-02, INF-REM-03, INF-REM-12, INF-REM-14, INF-REM-15, INF-NLP-02, INF-NLP-13 |
| Parsing | INF-NLP-01, INF-NLP-02, INF-NLP-03, INF-NLP-04, INF-NLP-05, INF-NLP-06, INF-NLP-07, INF-NLP-08, INF-NLP-09, INF-NLP-10, INF-NLP-11, INF-NLP-12, INF-NLP-13, INF-NLP-14 |
| Suggestions | INF-SUG-01, INF-SUG-02, INF-SUG-03, INF-SUG-04, INF-SUG-05, INF-SUG-06, INF-SUG-07, INF-SUG-08, INF-SUG-09, INF-SUG-10 |
| Widget | INF-WIDG-01, INF-WIDG-02, INF-WIDG-03 |
| Portability | INF-PORT-01, INF-PORT-02, INF-PORT-03, INF-PORT-04, INF-PORT-05, INF-PORT-06, INF-PORT-07, INF-PORT-08 |
| Packaging | INF-PKG-01, INF-PKG-02, INF-PKG-03, INF-PKG-04, INF-FND-11, INF-FND-12 |
| Accessibility | INF-A11Y-01, INF-A11Y-02, INF-A11Y-03, INF-A11Y-04, INF-A11Y-05, INF-A11Y-06, INF-HIER-12, INF-SHELL-06 |
| Native OS matrix | INF-PKG-05, INF-REM-06, INF-REM-07, INF-STKY-02, INF-STKY-06, INF-STKY-13, INF-DESK-02, INF-DESK-03, INF-WIDG-02, INF-SCHED-05, INF-KEY-05, INF-A11Y-06 |

## 4. Per-phase work packages

Work items are ordered; each lists the requirement IDs it satisfies. Phase 01 is detailed enough to start immediately.

### Phase 01

- W01-01 Scaffold electron-vite project (main, preload, renderer, shared), TypeScript 6.0.3 strict, ESLint 10 flat config. IDs: INF-FND-09
- W01-02 Pinned dependency install from DECISIONS section 4 (exact versions, lockfile, engines >=24.15.0 <25). IDs: INF-FND-01, INF-FND-09
- W01-03 DB adapter (better-sqlite3 behind interface, WAL, foreign keys, synchronous=FULL), migration runner, migration 001, pre-migration backup, failure screen, newer-schema refusal. IDs: INF-FND-05
- W01-04 Settings repository with Zod defaults and versioning. IDs: INF-FND-06
- W01-05 User data paths and INFINITY_NOTES_USER_DATA_DIR override. IDs: INF-FND-07
- W01-06 Secure BrowserWindow factory, preload bridge window.infinity, sender validation, CSP, navigation and permission blocking. IDs: INF-FND-03, INF-FND-04
- W01-07 Shared Zod contracts including note:save, lease and revision shapes. IDs: INF-FND-04, INF-FND-13
- W01-08 infinity-attachment protocol handler with ID-only lookup. IDs: INF-FND-08
- W01-09 Single-instance lock, app identity (appId, productName, AppUserModelID, icon placeholder). IDs: INF-FND-02, INF-FND-11
- W01-10 Test harness: Vitest unit and integration projects, Playwright Electron smoke with temp userData, no-network check. IDs: INF-FND-01, INF-FND-07
- W01-11 npm scripts dev, lint, typecheck, test:unit, test:integration, test:e2e, check, build, package:current, package:win, package:linux with real status. IDs: INF-FND-09
- W01-12 CI definitions for Windows and Ubuntu (not pushed): build, tests, native-module check, artifacts. IDs: INF-FND-10
- W01-13 Native-module verification (FTS5, BLOB, db.backup, PRAGMA compile_options) in Electron main on Windows and in WSL; node:sqlite fallback decision if it fails (risk R-01). IDs: INF-FND-12
- W01-14 PlatformCapabilities service skeleton and ozone-platform logging (risk R-09). IDs: INF-FND-04

### Phase 02

- W02-01 App shell: rail, header, tab strip, resizable tree, context panel, drawers, tokens and themes. IDs: INF-SHELL-01, INF-SHELL-02, INF-SHELL-03, INF-SHELL-04, INF-SHELL-05, INF-SHELL-06
- W02-02 Hierarchy services in main: projects, folders, notes, stickies, move, cycle check, trash, pin, favorite (migration data already in 001). IDs: INF-HIER-01, INF-HIER-02, INF-HIER-03, INF-HIER-04, INF-HIER-05, INF-HIER-06, INF-HIER-07, INF-HIER-08, INF-HIER-09, INF-HIER-10, INF-HIER-12
- W02-03 Tree UI with ARIA tree keyboard model and Move to dialog. IDs: INF-HIER-07, INF-HIER-12
- W02-04 Tab strip, singleton pages, session persistence and restore. IDs: INF-TABS-01, INF-TABS-02, INF-TABS-03, INF-TABS-04, INF-TABS-05, INF-TABS-06, INF-TABS-08
- W02-05 Home dashboard and scope filter. IDs: INF-HOME-01, INF-HOME-02, INF-HOME-03
- W02-06 Keyboard shortcuts and command palette (titles only). IDs: INF-KEY-01, INF-KEY-02, INF-KEY-03

### Phase 03

- W03-01 Shared NoteEditor (Tiptap), formatting, block IDs, plain-text format and conversion. IDs: INF-EDIT-01, INF-EDIT-02, INF-EDIT-03, INF-EDIT-04, INF-EDIT-05, INF-EDIT-06, INF-EDIT-12, INF-EDIT-13
- W03-02 Paste sanitizer, images, attachments pipeline and document import. IDs: INF-EDIT-07, INF-EDIT-08, INF-EDIT-09, INF-EDIT-10, INF-EDIT-11, INF-EDIT-14
- W03-03 Autosave, revision, lease, drafts, versions in main. IDs: INF-SAVE-01, INF-SAVE-02, INF-SAVE-03, INF-SAVE-04, INF-SAVE-05, INF-SAVE-06
- W03-04 Single mounted editor, find in note, link policy. IDs: INF-TABS-07, INF-KEY-04, INF-SEC-01

### Phase 04

- W04-01 Sticky windows keyed by note ID, header, dock, colors, window_state (migration 002). IDs: INF-STKY-01, INF-STKY-02, INF-STKY-03, INF-STKY-04, INF-STKY-05, INF-STKY-06, INF-STKY-07, INF-STKY-08, INF-STKY-09, INF-STKY-10, INF-STKY-11, INF-STKY-12, INF-STKY-13
- W04-02 Close/tray/quit lifecycle and tray-less fallback. IDs: INF-DESK-01, INF-DESK-02

### Phase 05

- W05-01 Reminder data and services (migration 003), time resolver, recurrence. IDs: INF-REM-01, INF-REM-02, INF-REM-03, INF-REM-04, INF-REM-05, INF-REM-06, INF-REM-07, INF-REM-08, INF-REM-09, INF-REM-10, INF-REM-11, INF-REM-12, INF-REM-13, INF-REM-14, INF-REM-15, INF-REM-16, INF-REM-17, INF-REM-18
- W05-02 ReminderService scheduler, delivery claims, recovery, quiet hours. IDs: INF-SCHED-01, INF-SCHED-02, INF-SCHED-03, INF-SCHED-04, INF-SCHED-05, INF-SCHED-06, INF-SCHED-07, INF-SCHED-08, INF-SCHED-09
- W05-03 Reminder widget and Home reminder section. IDs: INF-HOME-04, INF-WIDG-01, INF-WIDG-02, INF-WIDG-03

### Phase 06

- W06-01 NLP parser pipeline with frozen-clock tables. IDs: INF-NLP-01, INF-NLP-02, INF-NLP-03, INF-NLP-04, INF-NLP-05, INF-NLP-06, INF-NLP-07, INF-NLP-08, INF-NLP-09, INF-NLP-10, INF-NLP-11, INF-NLP-12, INF-NLP-13, INF-NLP-14
- W06-02 Suggestions, confirmation card, sources and dismissals (migration 004). IDs: INF-SUG-01, INF-SUG-02, INF-SUG-03, INF-SUG-04, INF-SUG-05, INF-SUG-06, INF-SUG-07, INF-SUG-08, INF-SUG-09, INF-SUG-10

### Phase 07

- W07-01 References and backlinks (migration 005). IDs: INF-REF-01, INF-REF-02, INF-REF-03, INF-REF-04, INF-REF-05, INF-REF-06, INF-REF-07, INF-REF-08, INF-REF-09
- W07-02 Search (FTS5, palette results, filters), tags. IDs: INF-HIER-11, INF-SRCH-01, INF-SRCH-02, INF-SRCH-03, INF-SRCH-04, INF-SRCH-05, INF-SRCH-06

### Phase 08

- W08-01 Backup, restore, import, export, versions UI, retention, GC. IDs: INF-PORT-01, INF-PORT-02, INF-PORT-03, INF-PORT-04, INF-PORT-05, INF-PORT-06, INF-PORT-07, INF-PORT-08
- W08-02 Settings screens and preferences. IDs: INF-DESK-03, INF-PREF-01, INF-PREF-02, INF-PREF-03, INF-PREF-04, INF-PREF-05
- W08-03 Accessibility pass, keyboard help, global shortcut. IDs: INF-KEY-05, INF-KEY-06, INF-A11Y-01, INF-A11Y-02, INF-A11Y-03, INF-A11Y-04, INF-A11Y-05, INF-A11Y-06

### Phase 09

- W09-01 Performance fixtures and measurements. IDs: INF-PERF-01, INF-PERF-02, INF-PERF-03, INF-PERF-04, INF-PERF-05
- W09-02 Packaging and native OS matrix, release docs, security review. IDs: INF-PKG-01, INF-PKG-02, INF-PKG-03, INF-PKG-04, INF-PKG-05, INF-PKG-06, INF-SEC-02, INF-SEC-03

## 5. Change rule

Later phases update Status and Planned tests as work lands. Moving an ID to another phase requires a DECISIONS entry; the traceability checker then runs with `--allow-phase-moves` and prints each difference as WARN. Every Phase 00 ID has Status `planned`; native cases are never recorded as `done` without a native run.

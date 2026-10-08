# Infinity Notes product specification

Status: Phase 00 baseline. Companion documents: [UX_SPEC](UX_SPEC.md), [ARCHITECTURE](ARCHITECTURE.md), [DECISIONS](DECISIONS.md), [BACKLOG](BACKLOG.md).

## 1. Purpose and product summary

Infinity Notes is one minimal offline desktop app for Windows 11 and Ubuntu. Notes and stickies are the same document type and use the same editor. Notes are organized in a permanent Common scope and in projects, with nested folders, tabs, Home, references between notes, local full-text search (including Bangla), floating sticky windows, reminders with natural-language suggestions, and local backup. Everything runs on the user's machine. Electron main owns database writes, scheduling and native windows.

## 2. Users and core flows

One user on one machine. Core flow: create a project, add folders, create a note, paste text and images, link to another note, add a reminder, float the note as a sticky, and later find it with search. Secondary flows: quick sticky, snooze or complete a reminder from a notification or widget, back up and restore, export.

## 3. Scope boundaries and non-goals

In scope: the requirement catalogue in section 4.

Non-goals (decision D-001): backend, accounts, sync, collaboration, AI or LLM features, calendar integration, OCR, drawing, audio or video, Kanban, plugins, formula or database views, telemetry, multilingual parsing (parsing is English only).

## 4. Requirement catalogue

Every requirement has an ID (`INF-<AREA>-<NN>`), an observable acceptance criterion and the phase that delivers it. Test types: U unit, I integration, E Electron E2E, N native OS validation, V visual or accessibility review, P performance, R review. The same IDs, with planned test files and status, are tracked in [BACKLOG](BACKLOG.md).

### 4.1 Foundation (FND)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-FND-01 | One offline Electron app; no backend, accounts, sync, telemetry or AI calls; no outbound network requests at runtime | Observable when e2e/smoke.spec › no network requests; dependency review (types E,R) shows that one offline Electron app; no backend, accounts, sync, telemetry or AI calls; no outbound network requests at runtime. | 01 |
| INF-FND-02 | Single-instance lock; a second launch focuses the existing main window | Observable when e2e/smoke.spec › second instance focuses first (types E,N) shows that single-instance lock; a second launch focuses the existing main window. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 01 |
| INF-FND-03 | Secure windows: contextIsolation, no nodeIntegration, sandbox, CSP, blocked navigation/window.open, permission requests denied | Observable when e2e/security.spec › renderer has no node/require; navigation blocked (types E,R) shows that secure windows: contextIsolation, no nodeIntegration, sandbox, CSP, blocked navigation/window.open, permission requests denied. | 01 |
| INF-FND-04 | Narrow typed preload bridge; Zod-validated payloads; sender validation; payload size limits; renderer cannot read files, run SQL or shell | Observable when unit/contracts.test; integration/ipc-validation.test; e2e/security.spec › bridge surface (types U,I,E) shows that narrow typed preload bridge; Zod-validated payloads; sender validation; payload size limits; renderer cannot read files, run SQL or shell. | 01 |
| INF-FND-05 | Main-owned SQLite adapter with WAL, foreign keys, forward-only transactional migrations, pre-migration copy; failed migration rolls back and shows recoverable error; newer schema refused | Observable when integration/migrations.test › failure rolls back; e2e/migration-failure.spec (types I,E) shows that main-owned SQLite adapter with WAL, foreign keys, forward-only transactional migrations, pre-migration copy; failed migration rolls back and shows recoverable error; newer schema refused. | 01 |
| INF-FND-06 | Versioned settings repository persists across relaunch with defaults and validation | Observable when integration/settings.test; e2e/smoke.spec › setting survives relaunch (types I,E) shows that versioned settings repository persists across relaunch with defaults and validation. | 01 |
| INF-FND-07 | User data under userData/data, never install dir; INFINITY_NOTES_USER_DATA_DIR isolates tests | Observable when integration/paths.test; e2e/smoke.spec › temp userData used (types I,E) shows that user data under userData/data, never install dir; INFINITY_NOTES_USER_DATA_DIR isolates tests. | 01 |
| INF-FND-08 | Restricted infinity-attachment protocol serves only registered attachment IDs; no paths or traversal | Observable when integration/protocol.test › unknown id 404, traversal rejected (types I,E) shows that restricted infinity-attachment protocol serves only registered attachment IDs; no paths or traversal. | 01 |
| INF-FND-09 | Standard npm scripts exist and report real status (no silent passes) | Observable when review package.json scripts + logs (types R) shows that standard npm scripts exist and report real status (no silent passes). | 01 |
| INF-FND-10 | Windows and Ubuntu CI definitions (not pushed) with build, tests, native-module check and artifacts | Observable when review .github/workflows files (types R) shows that windows and Ubuntu CI definitions (not pushed) with build, tests, native-module check and artifacts. | 01 |
| INF-FND-11 | Stable app identity (appId, productName, AppUserModelID, icon placeholder) | Observable when review builder config; native toast identity check (types R,N) shows that stable app identity (appId, productName, AppUserModelID, icon placeholder). Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 01 |
| INF-FND-12 | Native SQLite loads in Electron main with FTS5, BLOB and backup API on Windows and WSL Ubuntu | Observable when integration/sqlite-capabilities.test; e2e/smoke.spec › db diagnostics (types I,E,N) shows that native SQLite loads in Electron main with FTS5, BLOB and backup API on Windows and WSL Ubuntu. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 01 |
| INF-FND-13 | Save-revision and writer-lease contracts defined in shared contracts before UI | Observable when unit/contracts.test › note:save schema; integration/revision.test (types U,I) shows that save-revision and writer-lease contracts defined in shared contracts before UI. | 01 |

### 4.2 Shell (SHELL)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-SHELL-01 | Compact reference-inspired shell: rail (Home, Notes, Stickies, Reminders, Settings), header with search/command box, tab strip, document area, violet accent, no capture-specific labels | Observable when e2e/shell.spec › rail navigation; screenshot 1100x720 (types V,E) shows that compact reference-inspired shell: rail (Home, Notes, Stickies, Reminders, Settings), header with search/command box, tab strip, document area, violet accent, no capture-specific labels. | 02 |
| INF-SHELL-02 | Collapsible, resizable tree pane 220-280 px, width persisted | Observable when e2e/shell.spec › tree toggle and width persists (types E,V) shows that collapsible, resizable tree pane 220-280 px, width persisted. | 02 |
| INF-SHELL-03 | Collapsible right context panel 280-340 px with Info section; later Reminders and References sections | Observable when e2e/shell.spec › panel toggle (types E,V) shows that collapsible right context panel 280-340 px with Info section; later Reminders and References sections. | 02 |
| INF-SHELL-04 | Narrow windows turn tree (<960 px) and panel (<1180 px) into drawers | Observable when e2e/shell.spec › narrow 760x560 drawers; screenshot (types E,V) shows that narrow windows turn tree (<960 px) and panel (<1180 px) into drawers. | 02 |
| INF-SHELL-05 | Compact dark theme tokens following OS theme | Observable when screenshot light/dark (types V) shows that compact dark theme tokens following OS theme. | 02 |
| INF-SHELL-06 | Native window frame and controls; visible keyboard focus | Observable when screenshot focus ring; native window check (types V,N) shows that native window frame and controls; visible keyboard focus. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 02 |

### 4.3 Home (HOME)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-HOME-01 | Single reusable Home tab, always first, not closable or duplicable | Observable when e2e/home.spec › one Home tab after relaunch (types E) shows that single reusable Home tab, always first, not closable or duplicable. | 02 |
| INF-HOME-02 | Home shows quick actions (New note, New sticky, New project), Pinned and Recent | Observable when e2e/home.spec › pinned and recent reflect data (types E) shows that home shows quick actions (New note, New sticky, New project), Pinned and Recent. | 02 |
| INF-HOME-03 | Home scope filter All/Common/Project on one dashboard, persisted; new items inherit filter scope | Observable when e2e/home.spec › filter; integration/home-summary.test (types I,E) shows that home scope filter All/Common/Project on one dashboard, persisted; new items inherit filter scope. | 02 |
| INF-HOME-04 | Home shows overdue and due-today reminders with link to Reminders page | Observable when e2e/reminders.spec › Home reminder section (types E) shows that home shows overdue and due-today reminders with link to Reminders page. | 05 |

### 4.4 Hierarchy (HIER)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-HIER-01 | Common is a permanent scope for notes, stickies and folders; cannot be renamed or deleted | Observable when integration/hierarchy.test › Common immutable (types I,E) shows that common is a permanent scope for notes, stickies and folders; cannot be renamed or deleted. | 02 |
| INF-HIER-02 | Create, rename and trash projects | Observable when integration/hierarchy.test › project CRUD; e2e/tree.spec (types I,E) shows that create, rename and trash projects. | 02 |
| INF-HIER-03 | Nested folders up to depth 32 in projects and Common; create, rename, trash | Observable when integration/hierarchy.test › deep folders, depth limit (types I,E) shows that nested folders up to depth 32 in projects and Common; create, rename, trash. | 02 |
| INF-HIER-04 | Notes created at scope root or inside any folder | Observable when e2e/tree.spec › create note in folder (types I,E) shows that notes created at scope root or inside any folder. | 02 |
| INF-HIER-05 | Stickies can belong to Common or any project/folder before floating exists | Observable when integration/hierarchy.test › sticky in folder (types I,E) shows that stickies can belong to Common or any project/folder before floating exists. | 02 |
| INF-HIER-06 | Duplicate sibling names allowed and disambiguated by path | Observable when integration/hierarchy.test › duplicate names (types I) shows that duplicate sibling names allowed and disambiguated by path. | 02 |
| INF-HIER-07 | Move notes/folders across folders, projects and Common; subtree scope updated transactionally | Observable when integration/hierarchy.test › subtree move atomic (types I,E) shows that move notes/folders across folders, projects and Common; subtree scope updated transactionally. | 02 |
| INF-HIER-08 | Folder cycles rejected with clear message | Observable when integration/hierarchy.test › cycle rejected; e2e/tree.spec (types I,E) shows that folder cycles rejected with clear message. | 02 |
| INF-HIER-09 | Trash with batch soft delete, restore to original or nearest valid location, permanent delete with confirmation | Observable when integration/trash.test; e2e/tree.spec › trash and restore (types I,E) shows that trash with batch soft delete, restore to original or nearest valid location, permanent delete with confirmation. | 02 |
| INF-HIER-10 | Pin notes to Home; favorite notes, folders and projects | Observable when e2e/home.spec › pin; e2e/tree.spec › favorites (types I,E) shows that pin notes to Home; favorite notes, folders and projects. | 02 |
| INF-HIER-11 | Optional small tags (<=20 per note) usable as search filter | Observable when integration/tags.test; e2e/search.spec › tag filter (types I,E) shows that optional small tags (<=20 per note) usable as search filter. | 07 |
| INF-HIER-12 | Keyboard navigation of the tree (ARIA tree, F2, Delete, Enter, arrows) | Observable when e2e/a11y-keyboard.spec › tree (types E,V) shows that keyboard navigation of the tree (ARIA tree, F2, Delete, Enter, arrows). | 02 |

### 4.5 Tabs (TABS)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-TABS-01 | Multiple note tabs; one tab per note, reopening focuses it | Observable when e2e/tabs.spec › no duplicate tabs (types E) shows that multiple note tabs; one tab per note, reopening focuses it. | 02 |
| INF-TABS-02 | Switch tabs by click and Ctrl+Tab/Ctrl+Shift+Tab | Observable when e2e/tabs.spec › ctrl+tab (types E) shows that switch tabs by click and Ctrl+Tab/Ctrl+Shift+Tab. | 02 |
| INF-TABS-03 | Close via Ctrl+W, button or middle-click; never deletes the note; pending save flushed first | Observable when e2e/tabs.spec › close keeps note; e2e/editor.spec › flush on close (types E) shows that close via Ctrl+W, button or middle-click; never deletes the note; pending save flushed first. | 02 |
| INF-TABS-04 | Tab overflow scrolls and offers an All tabs list | Observable when e2e/tabs.spec › overflow list (types E,V) shows that tab overflow scrolls and offers an All tabs list. | 02 |
| INF-TABS-05 | Tabs, order and active tab restored after relaunch without duplicates | Observable when e2e/tabs.spec › restore after relaunch (types I,E) shows that tabs, order and active tab restored after relaunch without duplicates. | 02 |
| INF-TABS-06 | Trashing a note closes its tabs; restored session skips trashed/missing notes with notice | Observable when e2e/tabs.spec › trashed note tab closed (types E) shows that trashing a note closes its tabs; restored session skips trashed/missing notes with notice. | 02 |
| INF-TABS-07 | Only the active tab mounts an editor; inactive tabs keep lightweight state; editors disposed; image cache bounded | Observable when e2e/editor.spec › single editor instance; perf/editors (types E,P) shows that only the active tab mounts an editor; inactive tabs keep lightweight state; editors disposed; image cache bounded. | 03 |
| INF-TABS-08 | Singleton page tabs for Stickies, Reminders and Settings | Observable when e2e/tabs.spec › page singletons (types E) shows that singleton page tabs for Stickies, Reminders and Settings. | 02 |

### 4.6 Keyboard and commands (KEY)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-KEY-01 | Ctrl+N creates a note in the current scope | Observable when e2e/keyboard.spec › ctrl+n (types E) shows that ctrl+N creates a note in the current scope. | 02 |
| INF-KEY-02 | Ctrl+Shift+N creates a sticky in the current scope | Observable when e2e/keyboard.spec › ctrl+shift+n (types E) shows that ctrl+Shift+N creates a sticky in the current scope. | 02 |
| INF-KEY-03 | Ctrl+K command palette with common actions and title search | Observable when e2e/palette.spec › actions and titles (types E) shows that ctrl+K command palette with common actions and title search. | 02 |
| INF-KEY-04 | Ctrl+F find in the current note | Observable when e2e/editor.spec › find in note (types E) shows that ctrl+F find in the current note. | 03 |
| INF-KEY-05 | Optional global quick-sticky shortcut, off by default, capability checked, failure reported | Observable when integration/shortcuts.test; native check (types I,N) shows that optional global quick-sticky shortcut, off by default, capability checked, failure reported. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 08 |
| INF-KEY-06 | Keyboard help listing shortcuts | Observable when e2e/settings.spec › keyboard help (types E) shows that keyboard help listing shortcuts. | 08 |

### 4.7 Editor (EDIT)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-EDIT-01 | One shared Tiptap editor component for tabs and stickies; no custom contentEditable engine | Observable when review; e2e/editor.spec (types R,E) shows that one shared Tiptap editor component for tabs and stickies; no custom contentEditable engine. | 03 |
| INF-EDIT-02 | Headings, bold, italic, bullet/numbered lists, checklist, links, inline code, code blocks, undo/redo | Observable when unit/editor-schema.test; e2e/editor.spec › formatting survives reload (types U,E) shows that headings, bold, italic, bullet/numbered lists, checklist, links, inline code, code blocks, undo/redo. | 03 |
| INF-EDIT-03 | Title editing; empty title shows Untitled; rename flushes | Observable when e2e/editor.spec › rename (types E) shows that title editing; empty title shows Untitled; rename flushes. | 03 |
| INF-EDIT-04 | Separate plain-text document format | Observable when integration/notes-format.test; e2e/editor.spec › plain note (types U,I,E) shows that separate plain-text document format. | 03 |
| INF-EDIT-05 | Rich to plain conversion warns about formatting/image loss and creates a recoverable version | Observable when integration/notes-format.test › version created; e2e/editor.spec › conversion warning (types I,E) shows that rich to plain conversion warns about formatting/image loss and creates a recoverable version. | 03 |
| INF-EDIT-06 | Stable UUID block IDs preserved across edits; regenerated on paste and duplicate | Observable when unit/block-ids.test › paste regenerates (types U,E) shows that stable UUID block IDs preserved across edits; regenerated on paste and duplicate. | 03 |
| INF-EDIT-07 | Pasted HTML sanitized (scripts, handlers, iframes, objects, embeds); remote images not fetched | Observable when unit/sanitize.test; e2e/paste.spec › no script execution (types U,E) shows that pasted HTML sanitized (scripts, handlers, iframes, objects, embeds); remote images not fetched. | 03 |
| INF-EDIT-08 | Clipboard bitmap paste stored as managed PNG attachment | Observable when integration/attachments.test; e2e/paste.spec › bitmap (types I,E) shows that clipboard bitmap paste stored as managed PNG attachment. | 03 |
| INF-EDIT-09 | Image files pasted/dropped/imported are copied into managed storage and remain after the original is removed | Observable when e2e/paste.spec › original deleted, image still shown after restart (types I,E) shows that image files pasted/dropped/imported are copied into managed storage and remain after the original is removed. | 03 |
| INF-EDIT-10 | Image size/type limits with friendly message; SVG/unknown rejected; editor stays responsive | Observable when integration/attachments.test › limits; e2e/paste.spec › oversized message (types U,I,E) shows that image size/type limits with friendly message; SVG/unknown rejected; editor stays responsive. | 03 |
| INF-EDIT-11 | Image display with simple size presets | Observable when e2e/editor.spec › image size preset (types E) shows that image display with simple size presets. | 03 |
| INF-EDIT-12 | Unicode including Bangla round-trips in title, content and extracted text | Observable when integration/notes-save.test › Bangla; e2e/editor.spec › Bangla (types I,E) shows that unicode including Bangla round-trips in title, content and extracted text. | 03 |
| INF-EDIT-13 | Visible saving/saved/error status | Observable when e2e/editor.spec › save indicator (types E) shows that visible saving/saved/error status. | 03 |
| INF-EDIT-14 | Import local documents into managed attachments as file chips | Observable when integration/attachments.test › document import (types I,E) shows that import local documents into managed attachments as file chips. | 03 |

### 4.8 Persistence and editing (SAVE)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-SAVE-01 | Debounced autosave with acknowledgments; flush on blur, tab switch/close, window close and quit | Observable when integration/notes-save.test › ack; e2e/editor.spec › flush on close (types I,E) shows that debounced autosave with acknowledgments; flush on blur, tab switch/close, window close and quit. | 03 |
| INF-SAVE-02 | Content, plain text, FTS and references committed in one transaction; revision broadcast | Observable when integration/notes-save.test › atomic commit (types I) shows that content, plain text, FTS and references committed in one transaction; revision broadcast. | 03 |
| INF-SAVE-03 | Stale revision never overwrites; conflicting content kept as recoverable draft with UI | Observable when integration/revision.test › stale save -> draft; e2e/conflict.spec (types I,E) shows that stale revision never overwrites; conflicting content kept as recoverable draft with UI. | 03 |
| INF-SAVE-04 | Main-managed editing lease; other views read-only with Take edit control; transfer after flush or persisted draft | Observable when integration/lease.test › transfer, timeout revoke (types I) shows that main-managed editing lease; other views read-only with Take edit control; transfer after flush or persisted draft. | 03 |
| INF-SAVE-05 | Acknowledged saves survive renderer crash and restart; unacknowledged loss window documented | Observable when e2e/crash.spec › renderer crash keeps acked text (types I,E) shows that acknowledged saves survive renderer crash and restart; unacknowledged loss window documented. | 03 |
| INF-SAVE-06 | Automatic throttled versions plus conversion/conflict/restore versions | Observable when integration/versions.test (types I) shows that automatic throttled versions plus conversion/conflict/restore versions. | 03 |

### 4.9 Stickies (STKY)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-STKY-01 | Float opens a native window for the same note ID; one window per note | Observable when e2e/stickies.spec › float same id, no duplicate (types E) shows that float opens a native window for the same note ID; one window per note. | 04 |
| INF-STKY-02 | Two or more stickies are independent native windows that move/resize outside the main window | Observable when e2e/stickies.spec › two windows; native move/resize (types E,N) shows that two or more stickies are independent native windows that move/resize outside the main window. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 04 |
| INF-STKY-03 | Dock/Open in app closes the window and opens the note tab with content intact | Observable when e2e/stickies.spec › dock (types E) shows that dock/Open in app closes the window and opens the note tab with content intact. | 04 |
| INF-STKY-04 | Sticky header: color, source badge, pin (capability checked), collapse, hide, menu | Observable when e2e/stickies.spec › header controls; screenshot (types E,V) shows that sticky header: color, source badge, pin (capability checked), collapse, hide, menu. | 04 |
| INF-STKY-05 | Closing hides the window; Delete is a separate confirmed command | Observable when e2e/stickies.spec › close hides, note remains (types E) shows that closing hides the window; Delete is a separate confirmed command. | 04 |
| INF-STKY-06 | Bounds, collapsed and pin persisted; bounds clamped to connected displays; display removal recovery; Wayland restores size only | Observable when integration/window-state.test › clamp; native multi-display (types I,E,N) shows that bounds, collapsed and pin persisted; bounds clamped to connected displays; display removal recovery; Wayland restores size only. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 04 |
| INF-STKY-07 | Lease transfer between tab and sticky; read-only mirror gets revisions; no acknowledged text lost | Observable when e2e/stickies.spec › take control (types I,E) shows that lease transfer between tab and sticky; read-only mirror gets revisions; no acknowledged text lost. | 04 |
| INF-STKY-08 | Trashed note shows a recoverable trash state in its floating window | Observable when e2e/stickies.spec › trash overlay restore (types E) shows that trashed note shows a recoverable trash state in its floating window. | 04 |
| INF-STKY-09 | Restore open stickies on startup, default off | Observable when e2e/stickies.spec › restore on startup setting (types I,E) shows that restore open stickies on startup, default off. | 04 |
| INF-STKY-10 | Stickies page lists sticky notes across scopes with Float/Open and New sticky | Observable when e2e/stickies.spec › stickies page (types E) shows that stickies page lists sticky notes across scopes with Float/Open and New sticky. | 04 |
| INF-STKY-11 | No duplicate windows or leaked listeners; clean disposal | Observable when e2e/stickies.spec › reopen cycles leave one window (types E) shows that no duplicate windows or leaked listeners; clean disposal. | 04 |
| INF-STKY-12 | Main window to background keeps stickies usable; explicit Quit flushes and closes all windows | Observable when e2e/lifecycle.spec › quit flushes (types E,N) shows that main window to background keeps stickies usable; explicit Quit flushes and closes all windows. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 04 |
| INF-STKY-13 | Unsupported pin/positioning shown as unobtrusive capability fallback; X11 not forced | Observable when unit/capabilities.test; native WSLg check (types U,N) shows that unsupported pin/positioning shown as unobtrusive capability fallback; X11 not forced. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 04 |

### 4.10 Desktop lifecycle (DESK)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-DESK-01 | First main-window close asks keep running in background or quit; remembered and editable; states that quitting stops reminders | Observable when e2e/lifecycle.spec › close dialog (types E) shows that first main-window close asks keep running in background or quit; remembered and editable; states that quitting stops reminders. | 04 |
| INF-DESK-02 | Tray menu (Open, New sticky, Show widget, Quit) where available; tray-less fallback: relaunch focuses running instance | Observable when e2e/lifecycle.spec › second launch shows window; native tray (types E,N) shows that tray menu (Open, New sticky, Show widget, Quit) where available; tray-less fallback: relaunch focuses running instance. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 04 |
| INF-DESK-03 | Launch at login optional, default off, capability checked | Observable when integration/autostart.test; native login check (types I,N) shows that launch at login optional, default off, capability checked. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 08 |

### 4.11 Reminders (REM)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-REM-01 | Create reminder on a note or block (including stickies) with title, date, time and IANA zone | Observable when integration/reminders.test › create; e2e/reminders.spec (types I,E) shows that create reminder on a note or block (including stickies) with title, date, time and IANA zone. | 05 |
| INF-REM-02 | Default zone is the OS zone, editable; never assumes UTC or a hard-coded zone | Observable when unit/zone-default.test (types U) shows that default zone is the OS zone, editable; never assumes UTC or a hard-coded zone. | 05 |
| INF-REM-03 | Show selected-zone time and local time when they differ | Observable when unit/format-time.test; e2e/reminders.spec (types U,E) shows that show selected-zone time and local time when they differ. | 05 |
| INF-REM-04 | Reminder chip in content (decoration, text unchanged) and in side panel | Observable when e2e/reminders.spec › chip and panel (types E) shows that reminder chip in content (decoration, text unchanged) and in side panel. | 05 |
| INF-REM-05 | Reminders page with Today, Upcoming, Overdue and Completed | Observable when integration/reminder-views.test; e2e/reminders.spec (types I,E) shows that reminders page with Today, Upcoming, Overdue and Completed. | 05 |
| INF-REM-06 | Native notification at due time while running, including background/tray | Observable when integration/scheduler.test › initial alert (fake adapter); native toast (types I,N) shows that native notification at due time while running, including background/tray. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 05 |
| INF-REM-07 | Notification click opens and focuses the source note | Observable when e2e/reminders.spec › simulated click opens note; native click (types E,N) shows that notification click opens and focuses the source note. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 05 |
| INF-REM-08 | Dismissing a notification does not complete the reminder | Observable when integration/scheduler.test › close is not done (types I) shows that dismissing a notification does not complete the reminder. | 05 |
| INF-REM-09 | Done completes only the current occurrence and stops its follow-ups | Observable when integration/scheduler.test › done stops followups (types I,E) shows that done completes only the current occurrence and stops its follow-ups. | 05 |
| INF-REM-10 | Snooze replaces next alert, pauses follow-ups, does not shift series, wins race with scheduler | Observable when integration/scheduler.test › snooze race (types I) shows that snooze replaces next alert, pauses follow-ups, does not shift series, wins race with scheduler. | 05 |
| INF-REM-11 | Follow-ups off by default; 15 min x2 when enabled; presets 5/10/15/30/60 min, max 1/2/3/5 | Observable when unit/followup-settings.test; integration/scheduler.test › follow-up limit (types U,I) shows that follow-ups off by default; 15 min x2 when enabled; presets 5/10/15/30/60 min, max 1/2/3/5. | 05 |
| INF-REM-12 | Daily/weekly recurrence keeps wall-clock time in stored zone across DST; completion affects current occurrence only | Observable when unit/recurrence.test; integration/scheduler.test › recurrence vs completion (types U,I) shows that daily/weekly recurrence keeps wall-clock time in stored zone across DST; completion affects current occurrence only. | 05 |
| INF-REM-13 | Editing a series changes future occurrences and handles the pending one explicitly | Observable when integration/reminders.test › edit series pending policy (types I,E) shows that editing a series changes future occurrences and handles the pending one explicitly. | 05 |
| INF-REM-14 | DST gap -> first valid instant after; fold -> earlier default, later selectable; previewed | Observable when unit/resolve-local.test › 2026-03-08 02:30, 2026-11-01 01:30 New York (types U,E) shows that dST gap -> first valid instant after; fold -> earlier default, later selectable; previewed. | 05 |
| INF-REM-15 | OS zone change affects display/defaults only, not stored reminder zones | Observable when integration/scheduler.test › os zone change (types U,I) shows that oS zone change affects display/defaults only, not stored reminder zones. | 05 |
| INF-REM-16 | No native action buttons; Snooze/Done/Open always available in app and widget | Observable when review adapter; e2e/widget.spec (types R,E) shows that no native action buttons; Snooze/Done/Open always available in app and widget. | 05 |
| INF-REM-17 | Trashed note suspends reminders; restore resumes without flood; deleted block keeps reminder note-linked with anchor-missing state | Observable when integration/reminders.test › trash suspend, block missing (types I) shows that trashed note suspends reminders; restore resumes without flood; deleted block keeps reminder note-linked with anchor-missing state. | 05 |
| INF-REM-18 | Delete reminder with undo | Observable when integration/reminders.test › delete undo (types I,E) shows that delete reminder with undo. | 05 |

### 4.12 Scheduler (SCHED)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-SCHED-01 | Single main ReminderService with Clock seam, indexed next-alert query and one timer capped at 60 s | Observable when integration/scheduler.test › single timer (types U,I) shows that single main ReminderService with Clock seam, indexed next-alert query and one timer capped at 60 s. | 05 |
| INF-SCHED-02 | Transactional delivery claim with unique key before dispatch; no duplicate dispatch across restart | Observable when integration/scheduler-recovery.test › restart around dispatch (types I) shows that transactional delivery claim with unique key before dispatch; no duplicate dispatch across restart. | 05 |
| INF-SCHED-03 | Uncertain claims recorded, not re-dispatched, occurrence stays overdue, never auto-completed | Observable when integration/scheduler-recovery.test › crash after claim (types I) shows that uncertain claims recorded, not re-dispatched, occurrence stays overdue, never auto-completed. | 05 |
| INF-SCHED-04 | Adapter failure and unsupported recorded distinctly with in-app fallback | Observable when integration/scheduler.test › adapter failure; e2e/reminders.spec › banner (types I,E) shows that adapter failure and unsupported recorded distinctly with in-app fallback. | 05 |
| INF-SCHED-05 | Recovery after restart/sleep/clock jump: overdue summary and at most one alert per occurrence per batch; summary notification when more than 3 | Observable when integration/scheduler-recovery.test › batch limits; native sleep/wake (types I,N) shows that recovery after restart/sleep/clock jump: overdue summary and at most one alert per occurrence per batch; summary notification when more than 3. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 05 |
| INF-SCHED-06 | Quiet hours in an explicit zone defer alerts to the end, collapsed, still overdue | Observable when integration/scheduler.test › quiet hours (types U,I) shows that quiet hours in an explicit zone defer alerts to the end, collapsed, still overdue. | 05 |
| INF-SCHED-07 | Recurrence generation unique per reminder+instant with bounded backfill (one open overdue per series) | Observable when integration/scheduler-recovery.test › long downtime no flood (types I) shows that recurrence generation unique per reminder+instant with bounded backfill (one open overdue per series). | 05 |
| INF-SCHED-08 | Follow-up count increments at claim; recovery neither loops nor exhausts counts | Observable when integration/scheduler-recovery.test › followup counts (types I) shows that follow-up count increments at claim; recovery neither loops nor exhausts counts. | 05 |
| INF-SCHED-09 | Reminders stop when fully quit; UI states it; relaunch recovers | Observable when e2e/lifecycle.spec › relaunch overdue summary (types E,R) shows that reminders stop when fully quit; UI states it; relaunch recovers. | 05 |

### 4.13 Widget (WIDG)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-WIDG-01 | Optional reminder widget (default off) with Today/Upcoming/Overdue, Open, Snooze, Done | Observable when e2e/widget.spec › actions (types E) shows that optional reminder widget (default off) with Today/Upcoming/Overdue, Open, Snooze, Done. | 05 |
| INF-WIDG-02 | Widget movable, resizable, collapsible, hideable; optional capability-checked always-on-top, default off | Observable when e2e/widget.spec › collapse/hide; native pin (types E,N) shows that widget movable, resizable, collapsible, hideable; optional capability-checked always-on-top, default off. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 05 |
| INF-WIDG-03 | Widget uses the main ReminderService; hiding it keeps scheduling; state shared live | Observable when e2e/widget.spec › done in widget updates app (types I,E) shows that widget uses the main ReminderService; hiding it keeps scheduling; state shared live. | 05 |

### 4.14 Natural-language parsing (NLP)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-NLP-01 | Local English parsing with explicit reference instant and selected zone; no network or LLM | Observable when unit/nlp-parse.test; dependency review (types U,R) shows that local English parsing with explicit reference instant and selected zone; no network or LLM. | 06 |
| INF-NLP-02 | Calendar components converted in the selected IANA zone, not a fixed offset | Observable when unit/nlp-parse.test › zone conversion (types U) shows that calendar components converted in the selected IANA zone, not a fixed offset. | 06 |
| INF-NLP-03 | End of day = configurable 17:00; tomorrow EOD at 2026-10-08 13:00 Dhaka -> 2026-10-09 17:00 Dhaka (11:00Z) | Observable when unit/nlp-parse.test › tomorrow end of the day (types U) shows that end of day = configurable 17:00; tomorrow EOD at 2026-10-08 13:00 Dhaka -> 2026-10-09 17:00 Dhaka (11:00Z). | 06 |
| INF-NLP-04 | Date-only phrases use 09:00 with visible disclosure | Observable when unit/nlp-parse.test › date-only; e2e/nlp.spec › disclosure (types U,E) shows that date-only phrases use 09:00 with visible disclosure. | 06 |
| INF-NLP-05 | Explicit times honored (tomorrow at 8pm -> 20:00) | Observable when unit/nlp-parse.test › explicit time (types U) shows that explicit times honored (tomorrow at 8pm -> 20:00). | 06 |
| INF-NLP-06 | Durations use instant arithmetic (in 2 hours -> 15:00 Dhaka) | Observable when unit/nlp-parse.test › duration (types U) shows that durations use instant arithmetic (in 2 hours -> 15:00 Dhaka). | 06 |
| INF-NLP-07 | Weekday policy (bare/this/next/last) per D-025 | Observable when unit/nlp-parse.test › weekday table (types U) shows that weekday policy (bare/this/next/last) per D-025. | 06 |
| INF-NLP-08 | Ambiguous numeric dates and bare hours require explicit choice | Observable when unit/nlp-parse.test › 03/04 at 5; e2e/nlp.spec › choice required (types U,E) shows that ambiguous numeric dates and bare hours require explicit choice. | 06 |
| INF-NLP-09 | Zone abbreviations require choosing an IANA zone | Observable when unit/nlp-parse.test › CST (types U,E) shows that zone abbreviations require choosing an IANA zone. | 06 |
| INF-NLP-10 | Past dates stay visibly past; year-less past dates offer explicit next year | Observable when unit/nlp-parse.test › past date (types U,E) shows that past dates stay visibly past; year-less past dates offer explicit next year. | 06 |
| INF-NLP-11 | Multiple phrases in one block yield separate candidates | Observable when unit/nlp-parse.test › multiple phrases (types U) shows that multiple phrases in one block yield separate candidates. | 06 |
| INF-NLP-12 | Unsupported phrases give no candidate; manual entry remains available | Observable when unit/nlp-parse.test › unsupported (types U,E) shows that unsupported phrases give no candidate; manual entry remains available. | 06 |
| INF-NLP-13 | Calendar arithmetic uses the selected zone near midnight (New York vs Dhaka) | Observable when unit/nlp-parse.test › new york tomorrow (types U) shows that calendar arithmetic uses the selected zone near midnight (New York vs Dhaka). | 06 |
| INF-NLP-14 | English only; no implied multilingual parsing | Observable when review docs/UI copy (types R) shows that english only; no implied multilingual parsing. | 06 |

### 4.15 Suggestions (SUG)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-SUG-01 | Idle detection in notes and stickies with unobtrusive underline and Create reminder; typing never interrupted, text unchanged | Observable when unit/suggest-detect.test; e2e/nlp.spec › underline, text unchanged (types U,E) shows that idle detection in notes and stickies with unobtrusive underline and Create reminder; typing never interrupted, text unchanged. | 06 |
| INF-SUG-02 | Selected text -> Create reminder | Observable when e2e/nlp.spec › selection (types E) shows that selected text -> Create reminder. | 06 |
| INF-SUG-03 | Confirmation card shows title, source text, weekday date, time, zone, local conversion, repeat, follow-up, Add/Cancel, DST choices | Observable when e2e/nlp.spec › card fields (types E) shows that confirmation card shows title, source text, weekday date, time, zone, local conversion, repeat, follow-up, Add/Cancel, DST choices. | 06 |
| INF-SUG-04 | No reminder is persisted before Add | Observable when integration/suggestions.test › cancel creates nothing (types I,E) shows that no reminder is persisted before Add. | 06 |
| INF-SUG-05 | Confirmed absolute instant and source anchor persisted | Observable when integration/suggestions.test › source stored (types I) shows that confirmed absolute instant and source anchor persisted. | 06 |
| INF-SUG-06 | Suggestions and dismissals deduped across edits and restarts; confirmed links by reminder ID | Observable when integration/suggestions.test › dedupe after restart (types I,E) shows that suggestions and dismissals deduped across edits and restarts; confirmed links by reminder ID. | 06 |
| INF-SUG-07 | Restart never reinterprets saved relative text | Observable when integration/suggestions.test › next-day restart same instant (types I) shows that restart never reinterprets saved relative text. | 06 |
| INF-SUG-08 | Source edit requires explicit Update; no silent move | Observable when integration/suggestions.test › source changed state (types I,E) shows that source edit requires explicit Update; no silent move. | 06 |
| INF-SUG-09 | Deleted source block keeps reminder note-linked with anchor unavailable | Observable when integration/suggestions.test › block deleted (types I) shows that deleted source block keeps reminder note-linked with anchor unavailable. | 06 |
| INF-SUG-10 | End-to-end phrase -> preview -> confirm -> side panel -> notification opens source | Observable when e2e/nlp.spec › full flow (types E) shows that end-to-end phrase -> preview -> confirm -> side panel -> notification opens source. | 06 |

### 4.16 References (REF)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-REF-01 | Insert note link via searchable picker | Observable when e2e/references.spec › picker (types E) shows that insert note link via searchable picker. | 07 |
| INF-REF-02 | Stable block references to another note's block | Observable when integration/references.test › block ref (types I,E) shows that stable block references to another note's block. | 07 |
| INF-REF-03 | Side panel shows outgoing references and backlinks | Observable when e2e/references.spec › backlinks (types I,E) shows that side panel shows outgoing references and backlinks. | 07 |
| INF-REF-04 | Open reference in a tab and scroll to the block | Observable when e2e/references.spec › scroll to block (types E) shows that open reference in a tab and scroll to the block. | 07 |
| INF-REF-05 | Rename/move of target preserves links | Observable when integration/references.test › rename/move (types I,E) shows that rename/move of target preserves links. | 07 |
| INF-REF-06 | Missing/trashed target or block shows clear state with restore/search; no silent redirect | Observable when e2e/references.spec › trashed target (types I,E) shows that missing/trashed target or block shows clear state with restore/search; no silent redirect. | 07 |
| INF-REF-07 | Pasted/duplicated content never aliases block IDs | Observable when integration/references.test › duplicate content (types U,I) shows that pasted/duplicated content never aliases block IDs. | 07 |
| INF-REF-08 | Attached documents opened via validated OS handoff; executables never launched | Observable when integration/handoff.test › blocked extensions (types I,E) shows that attached documents opened via validated OS handoff; executables never launched. | 07 |
| INF-REF-09 | Quick sticky creation inherits scope; no forced project | Observable when e2e/stickies.spec › quick sticky scope (types E) shows that quick sticky creation inherits scope; no forced project. | 07 |

### 4.17 Search (SRCH)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-SRCH-01 | FTS5 search over titles and bodies including Bangla with prefix matching | Observable when integration/search.test › Bangla, prefix (types I) shows that fTS5 search over titles and bodies including Bangla with prefix matching. | 07 |
| INF-SRCH-02 | Index updates on edit, move, trash and restore | Observable when integration/search.test › index lifecycle (types I) shows that index updates on edit, move, trash and restore. | 07 |
| INF-SRCH-03 | Scope and tag filters in search | Observable when integration/search.test › scope filter (types I,E) shows that scope and tag filters in search. | 07 |
| INF-SRCH-04 | Highlighted snippets rendered safely | Observable when unit/snippet.test › no HTML injection (types U,E) shows that highlighted snippets rendered safely. | 07 |
| INF-SRCH-05 | Debounced capped results (<=50); 10,000-note fixture measured | Observable when perf/search › p95 (types P,I) shows that debounced capped results (<=50); 10,000-note fixture measured. | 07 |
| INF-SRCH-06 | Ctrl+K palette opens exact note/tab without unsaved edit loss | Observable when e2e/palette.spec › open with pending edit (types E) shows that ctrl+K palette opens exact note/tab without unsaved edit loss. | 07 |

### 4.18 Portability (PORT)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-PORT-01 | Backup: consistent snapshot including WAL data, referenced attachments, manifest with hashes | Observable when integration/backup.test › WAL content present (types I) shows that backup: consistent snapshot including WAL data, referenced attachments, manifest with hashes. | 08 |
| INF-PORT-02 | Restore with preflight, staging and rollback; failed restore leaves data usable | Observable when integration/restore.test › failure rollback (types I,E) shows that restore with preflight, staging and rollback; failed restore leaves data usable. | 08 |
| INF-PORT-03 | Import rejects traversal, symlinks, oversized, bombs and unsupported schema | Observable when integration/import-security.test (types I) shows that import rejects traversal, symlinks, oversized, bombs and unsupported schema. | 08 |
| INF-PORT-04 | Portable import remaps note/block/attachment IDs and references | Observable when integration/import.test › remap (types I) shows that portable import remaps note/block/attachment IDs and references. | 08 |
| INF-PORT-05 | Markdown/plain-text export with documented lossy limits | Observable when integration/export.test (types I) shows that markdown/plain-text export with documented lossy limits. | 08 |
| INF-PORT-06 | Automatic backup option, default off, configurable destination and retention | Observable when integration/backup.test › auto schedule (types I,E) shows that automatic backup option, default off, configurable destination and retention. | 08 |
| INF-PORT-07 | Configurable trash and version retention; version history with restore | Observable when integration/versions.test › retention; e2e/versions.spec (types I,E) shows that configurable trash and version retention; version history with restore. | 08 |
| INF-PORT-08 | Attachment GC only after reference checks and grace period | Observable when integration/attachment-gc.test (types I) shows that attachment GC only after reference checks and grace period. | 08 |

### 4.19 Preferences (PREF)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-PREF-01 | Theme System/Light/Dark | Observable when e2e/settings.spec › theme (types E,V) shows that theme System/Light/Dark. | 08 |
| INF-PREF-02 | Reminder defaults: zone, end-of-day 17:00, date-only 09:00, follow-up defaults | Observable when integration/settings.test › reminder defaults (types I,E) shows that reminder defaults: zone, end-of-day 17:00, date-only 09:00, follow-up defaults. | 08 |
| INF-PREF-03 | Quiet hours settings | Observable when e2e/settings.spec › quiet hours (types E) shows that quiet hours settings. | 08 |
| INF-PREF-04 | Window, tray, close, widget, startup and restore-stickies settings with fully-quit explanation | Observable when e2e/settings.spec › lifecycle settings (types E) shows that window, tray, close, widget, startup and restore-stickies settings with fully-quit explanation. | 08 |
| INF-PREF-05 | Attachment size limits configurable within bounds | Observable when integration/settings.test › limits bounds (types I) shows that attachment size limits configurable within bounds. | 08 |

### 4.20 Accessibility (A11Y)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-A11Y-01 | Keyboard-only use of tree, tabs, dialogs, editor, widget and palette | Observable when e2e/a11y-keyboard.spec (types E,V) shows that keyboard-only use of tree, tabs, dialogs, editor, widget and palette. | 08 |
| INF-A11Y-02 | Focus returns to the invoking control after dialogs/menus | Observable when e2e/a11y-keyboard.spec › focus return (types E) shows that focus returns to the invoking control after dialogs/menus. | 08 |
| INF-A11Y-03 | Accessible names and roles for icon buttons and regions | Observable when e2e/a11y-keyboard.spec › getByRole coverage (types E) shows that accessible names and roles for icon buttons and regions. | 08 |
| INF-A11Y-04 | Text contrast >= 4.5:1 and UI boundaries >= 3:1 in both themes | Observable when unit/contrast.test › token pairs (types U,V) shows that text contrast >= 4.5:1 and UI boundaries >= 3:1 in both themes. | 08 |
| INF-A11Y-05 | Reduced motion honored | Observable when unit/css-motion.test; screenshot (types U,V) shows that reduced motion honored. | 08 |
| INF-A11Y-06 | High-DPI rendering (125-200%) is crisp | Observable when native scaling check (types V,N) shows that high-DPI rendering (125-200%) is crisp. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 08 |

### 4.21 Performance (PERF)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-PERF-01 | Fixtures: 10,000 notes, 100 projects, 10 tabs, 10 stickies, 1,000 reminders | Observable when perf/fixtures generator (types P) shows that fixtures: 10,000 notes, 100 projects, 10 tabs, 10 stickies, 1,000 reminders. | 09 |
| INF-PERF-02 | Cold startup measured against <3 s target on documented machine | Observable when perf/startup (types P) shows that cold startup measured against <3 s target on documented machine. | 09 |
| INF-PERF-03 | Search p95 measured against <300 ms target at 10,000 notes | Observable when perf/search (types P) shows that search p95 measured against <300 ms target at 10,000 notes. | 09 |
| INF-PERF-04 | Image-heavy note responsiveness and inactive-editor memory measured | Observable when perf/editor-memory (types P) shows that image-heavy note responsiveness and inactive-editor memory measured. | 09 |
| INF-PERF-05 | Repeated sticky/widget open-close leaves no leaked windows or listeners | Observable when e2e/stickies.spec › leak check; perf/windows (types E,P) shows that repeated sticky/widget open-close leaves no leaked windows or listeners. | 09 |

### 4.22 Packaging and release (PKG)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-PKG-01 | Windows NSIS installer x64, unsigned and labeled | Observable when native install/launch Windows (types N) shows that windows NSIS installer x64, unsigned and labeled. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 09 |
| INF-PKG-02 | Linux AppImage and .deb built from WSL ext4 copy | Observable when native build/install WSL (types N) shows that linux AppImage and .deb built from WSL ext4 copy. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 09 |
| INF-PKG-03 | Packaged app loads native SQLite and persists data | Observable when native packaged launch/relaunch (types N) shows that packaged app loads native SQLite and persists data. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 09 |
| INF-PKG-04 | Reinstall/update preserves data; uninstall behavior documented | Observable when native reinstall; docs review (types N,R) shows that reinstall/update preserves data; uninstall behavior documented. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 09 |
| INF-PKG-05 | Native OS matrix with host/compositor details; GNOME/X11-only cases marked outside_validation_scope | Observable when docs/NATIVE_OS_MATRIX.md review (types N,R) shows that native OS matrix with host/compositor details; GNOME/X11-only cases marked outside_validation_scope. Native (N) part is recorded in the native OS matrix and is not run in Phase 00. | 09 |
| INF-PKG-06 | FINAL_REPORT, NATIVE_OS_MATRIX, RELEASE_CHECKLIST and user install/use/backup docs | Observable when docs review (types R) shows that fINAL_REPORT, NATIVE_OS_MATRIX, RELEASE_CHECKLIST and user install/use/backup docs. | 09 |

### 4.23 Security (SEC)

| ID | Requirement | Acceptance criterion | Phase |
| --- | --- | --- | --- |
| INF-SEC-01 | External links open only http/https via validated handoff on explicit action | Observable when unit/url-policy.test; e2e/editor.spec › link open (types U,E) shows that external links open only http/https via validated handoff on explicit action. | 03 |
| INF-SEC-02 | Production keeps Chromium sandbox; packaged security settings reviewed | Observable when review builder/fuses config (types R) shows that production keeps Chromium sandbox; packaged security settings reviewed. | 09 |
| INF-SEC-03 | Dependency audit and license review before release | Observable when npm audit + license list log (types R) shows that dependency audit and license review before release. | 09 |

## 5. Reminder behavior in plain language

- Done completes only the current occurrence and stops its follow-ups. A repeating series continues with its next occurrence.
- Dismissing or closing a system notification does not complete anything; the reminder stays visible as overdue in the app.
- Snooze replaces the next alert time for the current occurrence, pauses follow-ups and never moves the series. Presets are 5, 10, 15, 30 and 60 minutes and "Tomorrow 09:00" in the reminder's zone.
- Follow-ups are off by default. When enabled the default is every 15 minutes, 2 times (presets 5/10/15/30/60 minutes, maximum 1/2/3/5). Done, a snooze or the limit stops them.
- Recurrence is daily or weekly and keeps wall-clock time in the stored zone across daylight-saving changes.
- Quiet hours are off by default; when on, alerts that fall inside are deferred to the end of the window and stay overdue in the app meanwhile.
- After downtime, sleep or a clock jump, the app shows an overdue summary and sends at most one alert per occurrence per batch; more than 3 overdue occurrences produce one summary notification.
- If the app has been fully quit, no reminder or notification is sent. After relaunch the app shows what became overdue.
- A delivery attempt never completes a reminder, and a delivery that could not be confirmed is shown as overdue, not hidden.

## 6. Natural-language policy summary

The parser is local and English only. End of day is 17:00 by default, date-only phrases use 09:00 by default, and both are disclosed in the confirmation card and configurable. Explicit times are used as given. Ambiguous numeric dates, bare hours and zone abbreviations require an explicit choice. Weekdays follow a Monday-Sunday week. Past dates stay visibly past, with an explicit "Use next year" choice. Confirmed reminders store an absolute instant and are never re-interpreted on restart. The frozen-clock reference table (Appendix B of the Phase 00 plan) is the contract for tests:

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

## 7. Platform promises and limits

Promises (verbatim):

- Reminders and notifications only fire while the app process is running (window, background or tray); a fully quit app sends nothing until relaunch, and relaunch shows an overdue summary.
- Window positions are restored only where the platform allows; there is no guaranteed positioning under any Wayland compositor.

Capability summary (full table in [ARCHITECTURE](ARCHITECTURE.md) section 5): independent windows work on Windows and are expected on WSLg; programmatic position restore and always-on-top are not available under Wayland, and the app disables those controls with a short explanation instead of pretending; the tray needs a status-notifier host on Linux and WSLg has none by default; native notifications need a running notification server on Linux, and WSLg has none by default, so the in-app banner and Reminders lists carry the alert; native notification action buttons are not offered on any OS; launch at login and the global shortcut are opt-in, default off and capability checked.

## 8. Release targets and OS minimums

- Windows: Windows 11 version 24H2 (build 26100) or later, x64. Validation host: Windows 11 Pro build 26300 x64. Windows 10 and arm64 are not supported targets.
- Linux: Ubuntu 24.04 LTS or later, x64 (declared minimum). Validation environment per the user decision of 2026-10-08: Ubuntu 26.04.1 LTS on WSL2 with WSLg 1.0.73 (Weston). Native Ubuntu 24.04 and GNOME or X11 desktops are declared, not validated.
- Packages: Windows NSIS installer (unsigned, labeled "unsigned local build"); Linux AppImage and .deb built from a copy on the WSL ext4 filesystem.

Validation scope: native matrix columns are Windows 11 host, WSLg Wayland, optional WSLg XWayland, and GNOME Wayland or X11 session marked `outside_validation_scope` (never recorded as pass). WSLg results are labeled as WSLg/Weston, never as GNOME or an X11 session. Xvfb runs validate application logic only. The Phase 09 acceptor decides whether outside-scope cases permit a final `complete`.

## 9. Performance targets

Engineering targets measured in Phase 09 on a documented machine, not claims before measurement: cold startup under 3 s, search p95 under 300 ms at 10,000 notes, fixtures of 10,000 notes, 100 projects, 10 tabs, 10 stickies and 1,000 reminders, bounded memory with 10 open tabs (inactive tabs hold no editor), and no leaked windows or listeners after repeated sticky or widget open and close.

Durability statement: acknowledged saves are durable (WAL with `synchronous=FULL`); edits typed within the last 400 ms debounce window before a crash or kill may be lost; a renderer crash never loses acknowledged content.

## 10. Glossary

- Common: the permanent default scope (no project) for notes, stickies and folders.
- Scope: Common or one project.
- Sticky: a note with `stickyEnabled` set; it can be shown in a native floating window.
- Lease: the main-process permission for exactly one view at a time to edit a note.
- Occurrence: one due instance of a reminder series.
- Follow-up: an additional alert for an unacknowledged occurrence.
- Recovery batch: the bounded set of alerts or one summary produced after startup, resume or a clock jump.

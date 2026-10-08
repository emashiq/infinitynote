# Infinity Notes — full product plan

## Product intent

A personal, fully desktop, offline notebook for Windows and Linux. Opening a note, pasting text/images, floating a sticky and setting a reminder must be quick. Use one application and one local database. No web app, backend, signup, sync, team roles, SSO, billing, cloud storage or embedded AI in this release. Earlier broader NoteFlow ideas are outside this desktop scope.

## UX based on the supplied reference

Use the FrameCapt screenshot's light, quiet shell: a narrow icon rail at left, compact title/menu area, command/search box at top, a horizontal document tab strip, softly bordered panels and violet accent. Adapt it to notes; do not copy capture-specific labels or controls. Provide a compact dark theme too. Keep standard native window controls and keyboard focus. Avoid oversized marketing cards, animated decoration or a giant toolbar.

Rail: Home, Notes, Stickies, Reminders, Settings. Notes expands a collapsible tree. Home is a single reusable tab. A common dashboard shows recent/pinned notes, due/overdue reminders and quick New Note/New Sticky actions. Filter by All, Common or Project without creating separate dashboards. Common is a valid permanent scope for notes and stickies with no project. A project contains nested folders and direct child notes; stickies may belong anywhere a note belongs.

Layout: icon rail, optional 220–280px tree, flexible editor, optional 280–340px reference/reminder panel. Open tabs only mount the active editor; keep inactive state without loading every document. Narrow windows collapse the tree/panel into drawers. Tab overflow scrolls or uses a list. Closing a tab does not delete its note. Reopening or relaunching restores tabs and the active tab. A deleted note closes its tabs and shows a recoverable trash state to any floating window.

## Everyday use

Create a project, create subfolders, add a note, paste text or images, link another note with a searchable picker, attach a reminder, and optionally float it. A sticky is a regular rich-text note with sticky presentation enabled, not a second database record. Float/dock actions open and close a native window for that same note. Native windows move/resize independently on the desktop. Sticky color, pin/always-on-top, collapse and source/project badge sit in a small header. Closing a sticky hides its window; deletion is a distinct command. Optional restore-open-stickies on startup defaults off.

Support Normal note and Sticky views, shared editing, plain-text notes, checklist items, headings, bold/italic, bullet/number lists, links, code blocks, undo/redo, pasted screenshots and imported images. Plain-text mode is a separate document format; conversion from rich text warns about formatting and image loss and creates a recoverable version. No hand-written contentEditable engine. Images are copied into managed local attachments, including clipboard bitmaps. Offline availability must survive the original file moving. Pasted HTML loses scripts, event handlers and unsupported embedded content. Remote images are not silently fetched.

Pin notes to Home, favorite items, assign sticky colors, move notes/folders between projects/Common, and use trash with restore. Disallow tree cycles. Keep tags optional and small, not a mandatory classification system. Quick search supports titles and body text; command palette Ctrl+K supports common actions. Ctrl+N creates a note, Ctrl+Shift+N a sticky, Ctrl+W closes the active tab, Ctrl+Tab switches tabs, Ctrl+F finds in the current note. Native/global shortcuts are optional and capability checked.

## References and reminders in the side panel

Insert a note link or a stable block reference. The side panel shows outgoing references, backlinks and reminders for the active note. Open references in another tab. Renaming/moving a note preserves links. Missing/deleted targets show a clear state with restore/search, never a silent redirect. Support referencing internal notes/blocks and local attached documents; document opening uses validated OS handoff. No collaborative comments or external calendar integration.

## Reminders

Reminders attach to a note or stable content block, including sticky notes in Common/projects. They show as a chip in content and in the side panel; the Reminders page provides Today, Upcoming, Overdue and Completed. Inputs: title, date, time, IANA time zone, optional daily/weekly repeat and optional follow-up. Show both selected-zone time and local time when different. Default zone is the OS zone with an editable setting; never assume UTC or hard-code Bangladesh.

Use an optional, separate floating reminder widget with Today/Upcoming/Overdue, Open Note, Snooze and Done. It is movable/resizable/collapsible, can be hidden independently, and has an optional always-on-top toggle. Widget and startup launch default off. Widget does not own a second scheduler. A reminder stays available in the main app when the widget is hidden.

Native Windows/Linux notifications alert while the app is running, including tray mode. Notification click opens the source note. Only offer native action buttons if supported; the widget and app always provide Snooze/Done/Open. Dismissing a notification is not completion. Default close behavior is a visible choice: keep running in tray where available, otherwise explain that exiting stops reminders. Fully quit means reminders stop until relaunch; do not promise background alerts from a dead process.

Follow-ups default off per reminder. If enabled: 15 minutes, maximum 2 by default; allowed presets 5/10/15/30/60 minutes, max 1/2/3/5. Complete stops all follow-ups for that occurrence. Snooze replaces its next alert and pauses follow-ups until the snoozed alert, without shifting the recurring series. A follow-up is an extra alert for a pending occurrence; recurrence creates the next due occurrence. Avoid unlimited re-alerts, notification storms after sleep, or past-event floods after startup. Recovery shows an overdue summary and at most one re-alert per eligible occurrence in the recovery batch. User can set quiet hours; delayed alerts appear once quiet hours end and still remain overdue.

Daily/weekly recurrence follows wall-clock time in the stored zone across DST. Completion applies to the current occurrence, not future ones. Editing a series affects future occurrences and explicitly handles the pending one. Provide a simple stated policy for nonexistent/ambiguous DST times with a preview rather than silently changing zones.

## Natural-language reminder generation

English parsing runs locally. When a user writes “Have to submit this by tomorrow end of the day”, detect a candidate after a short idle delay, underline/chip its date phrase unobtrusively and show “Create reminder”. Also allow selecting text and choosing Create Reminder. Never interrupt typing, change note text or auto-schedule an unconfirmed candidate.

Confirmation card: extracted title, literal source text, full date with weekday, exact time, selected zone, local conversion, repeat/follow-up options and Add/Cancel. Defaults: “end of day” = 17:00 in the selected zone, editable in settings; date-only = 09:00, visibly disclosed. With a frozen reference clock of 2026-10-08 13:00 Asia/Dhaka, “tomorrow end of the day” resolves to 2026-10-09 17:00 Asia/Dhaka. “Tomorrow at 8pm” = 20:00. “In 2 hours” is a duration from the captured current instant. Past explicit dates remain visibly past; do not roll them forward secretly.

Resolve relative calendar dates in the selected zone. Chrono can extract date components, but the application must perform IANA-zone/DST conversion separately; a fixed UTC offset is insufficient. Do not assume Chrono directly resolves every IANA zone. Ambiguous dates such as 03/04 require selection, as do ambiguous zone abbreviations like CST. Unsupported phrases still allow manual date input. Weekday-only phrases preview the upcoming date; “Friday” vs “next Friday” uses a tested documented policy. Limit V1 to English; Bangla/multilingual parsing is a later extension, not an implied feature.

Store the confirmed absolute time and source anchor. Editing the phrase later does not silently move the reminder: offer an explicit Update action. Dedupe suggestions by note/block/span/text/reference date, and confirmed links by reminder ID. Restarting must not reinterpret yesterday's saved “tomorrow”. If the content block is deleted, keep the reminder note-linked and mark the anchor unavailable until the user resolves it.

## Useful additions that keep the product small

Include trash/restore, automatic recoverable versions, local backup/export, full-text search, quick capture, checklist items, keyboard navigation and portable attachments. Defer OCR, drawing canvas, audio/video, Kanban, plugins, arbitrary formula/database views, accounts and sync.

## Milestones and release

Phases 00–03 deliver the notebook. Phase 04 delivers real desktop stickies. Phases 05–06 deliver useful reminders. Phases 07–08 complete navigation and data portability. Phase 09 closes defects and builds native packages. Do not start the next phase before the current gate is accepted.

Release targets: supported Windows 11 x64 and Ubuntu LTS x64, documented minimum versions selected during Phase 00. Linux acceptance includes GNOME Wayland and at least one X11 session, because window/tray behaviors differ. Windows NSIS installer; Linux AppImage plus .deb where toolchain permits. Native dependency packaging is verified on each OS. Unsigned local builds are allowed with explicit labeling. Code signing, publishing and automatic updates are separate distribution tasks.

The final report uses `complete` only with passing core checks, packaged builds on both OSes and evidence for the native notification/window/reminder matrix. If the other OS is unavailable, report `ready_for_os_validation`, list exact pending cases, and finish the available code/tests/builds. No fabricated “100% tested” claim.

## Autonomous finishing and file organization

Follow CLEANUP_POLICY.md after the final acceptance gate. Continue planning, coding, testing and repair without phase confirmation prompts. Organize prompts/plans/progress/evidence under docs/development/, keep active README/CLAUDE instructions at root, create docs/INDEX.md and preserve application source, tests, data, backups and installers. Do not clean active checkpoints while blocked or waiting for native OS validation. Both launcher and sequential workflows invoke finalize_docs.py after verified completion.

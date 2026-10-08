# Infinity Notes UX specification

Companion documents: [PRODUCT_SPEC](PRODUCT_SPEC.md), [ARCHITECTURE](ARCHITECTURE.md), [DECISIONS](DECISIONS.md), [BACKLOG](BACKLOG.md). Requirement IDs refer to PRODUCT_SPEC.

## 1. Reference adaptation

Source: `infinity-notes-claude-pack/reference/framecapt-reference.png`.

Taken from the reference: a 52 px icon rail with a selected-state pill, a compact title and menu row, a centered command and search box showing `Ctrl K`, a Home tab in a horizontal strip, small uppercase section labels, softly bordered rounded panels, tile buttons, toggles and a violet accent.

Not copied: capture and record labels, recording options, the "Saving to" bar, the red badge dot and capture-specific icons. No screenshot-tool concepts appear anywhere in the UI.

## 2. Layout and measurements

| Region | Size |
| --- | --- |
| Rail | 52 px wide |
| Header | 44 px high |
| Tab strip | 36 px high; tab width 120-220 px |
| Tree pane | 220-280 px, default 248, resizable, persisted in `layout.treeWidth` |
| Editor | flexible; content max width 760 px |
| Context panel | 280-340 px, default 300 |
| Minimum window | 720 x 480 |

Breakpoints: window width below 960 px turns the tree into a drawer; below 1180 px the context panel becomes an overlay drawer. Visual checks run at 1100x720 and 760x560 (INF-SHELL-01, INF-SHELL-04). The main window uses the native OS frame and native window controls with the compact header inside the window (D-033).

## 3. Tokens

Light / dark values:

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | #FFFFFF | #17181D |
| `--bg-rail` | #F5F6FA | #1D1F26 |
| `--bg-subtle` | #F7F7FB | #22242C |
| `--border` | #E4E6EE | #30333D |
| `--text` | #1D2030 | #E7E8EE |
| `--text-muted` | #5F6475 | #A0A4B3 |
| `--accent` | #6A5AE0 | #8E80FF |
| `--accent-hover` | #5848D0 | #A196FF |
| `--accent-soft` | #EFEDFD | #2B2747 |
| `--accent-border` | #CFC9F7 | #4A4380 |
| `--danger` | #C0392B | #FF7A6E |
| `--warning` | #9A5B00 | #F2B45C |
| `--success` | #2E7D4F | #6BCB8F |

Radius: 8 px for panels, 6 px for controls. Focus ring: 2 px accent with 2 px offset. Theme follows the OS (System) with Light and Dark overrides in Settings (INF-SHELL-05, INF-PREF-01). Phase 08 verifies contrast numerically (INF-A11Y-04) and may adjust values, recording the change in DECISIONS.

## 4. Typography

UI 13 px; editor body 15 px with line height 1.55; H1 22 px, H2 18 px, H3 15 px semibold; section labels 11 px uppercase with letter spacing 0.04em. Font stack: `"Segoe UI Variable Text", "Segoe UI", Ubuntu, Cantarell, "Noto Sans", "Noto Sans Bengali", system-ui, sans-serif`. Code font: `"Cascadia Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`.

## 5. Screens

- Home: one tab, always first, not closable. Header "Home" with scope filter `All | Common | Project v` (projects alphabetical), persisted in `home.scope`; a trashed project falls back to All. Sections in order: Quick actions (96x80 tiles: New note, New sticky, New project); Pinned (up to 12 tiles, "View all"); Recent (10 most recently updated notes with scope path and relative time); Reminders (Overdue and Due today, up to 5 each, link to Reminders) added in Phase 05 and absent before, with no placeholders. New note or sticky inherits the filter: Project goes to the project root, Common or All to the Common root.
- Notes tree: groups Favorites, Common (always first, not renameable), Projects, Trash at the bottom; folders before notes, then case-insensitive alphabetical; duplicate sibling names disambiguated by path; empty title shows "Untitled".
- Tab strip: Home, note tabs, singleton pages (Stickies, Reminders, Settings). Overflow scrolls horizontally with scroll buttons and an "All tabs" list button.
- Note editor: title field and a slim formatting toolbar (H, B, I, bullet list, numbered list, checklist, link, code block, image, more); no giant toolbar. Image size presets. Save indicator in the header.
- Context panel: collapsible sections for the active note: Info (Phase 02-03), Reminders (Phase 05), Outgoing references and Backlinks (Phase 07). Non-note tabs show "Open a note to see its details".
- Stickies page: grid of colored cards with Float and Open actions, New sticky.
- Sticky window: native frame; 36 px header with color button (6 presets), title, source badge ("Common" or "Project > Folder"), pin (always on top, disabled with a tooltip where unsupported), collapse, overflow menu (Open in app/Dock, Change color, Remove from stickies, Move to Trash). The OS close button hides the window and never deletes. Default size 320x300, minimum 220x120.
- Reminders page: tabs Today, Upcoming, Overdue, Completed.
- Reminder widget: default 300x420, minimum 240x160; header with collapse, pin, hide; rows show the selected-zone time and the local time when different, the title and the source; actions Open, Snooze menu, Done.
- Settings: sections General, Appearance, Notes and attachments, Reminders, Windows and tray, Backup, Keyboard.
- Command palette (Ctrl+K): actions plus results (titles first, full-text in Phase 07).

## 6. Dialogs and banners (exact copy)

Dialogs:
- Close behavior: "Keep Infinity Notes running in the background? Reminders and stickies only work while the app is running." Buttons "Keep running in background" and "Quit"; checkbox "Remember my choice". Linux adds: "If no tray icon appears, launching Infinity Notes again brings this window back."
- Plain-text conversion: "Convert to plain text? Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it."
- Move dialog: scope and folder picker, keyboard accessible, shows the path; cycle attempts show "A folder cannot be moved into itself or one of its subfolders."
- Delete confirmations: "Move to Trash?" for items; "Delete forever?" and "Empty trash?" for permanent deletion with the number of items.
- Reminder editor: title, date, time, zone, repeat, follow-up; DST notices "02:30 does not exist on this date in New York; the reminder will use 03:00" and, for ambiguous times, "01:30 happens twice on this date; using the earlier one" with a choice of the later one.
- Natural-language confirmation card: title, literal source text, full date with weekday, time, zone, local conversion, repeat, follow-up, Add and Cancel; disclosures "09:00 (default time for date-only phrases)" and "17:00 (default end of day)"; required choices for month/day order, am/pm and zone; "Use next year" button for past year-less dates. Nothing is saved before Add.

Banners and states:
- Read-only lease banner: "This note is being edited in another window" with a "Take edit control" button.
- Conflict banner: "This note changed elsewhere. Your edits were kept as a recovered draft" with Compare, Restore draft, Dismiss.
- Trash overlay (sticky and tab): "This note is in Trash" with Restore and Close window; editing disabled.
- Overdue summary banner on startup when overdue occurrences exist: "N reminders are overdue" with an action to open Reminders > Overdue.
- Migration failure screen: "Database upgrade failed; your data was not changed" with "Show data folder" and "Quit".
- Newer-schema screen (D-040): "This notebook was created by a newer version of Infinity Notes. Your data was not changed." with "Show data folder" and "Quit".
- Database open failure screen (D-040): "Infinity Notes could not open its database. Your data was not changed." with "Show data folder" and "Quit".
- Closed-tab notice: "1 tab was closed because its note is in Trash"; plural "N tabs were closed because their notes are in Trash"; when a restored session also skipped missing notes, "N tabs were closed because their notes are in Trash or no longer exist" (D-047).
- Restore notice: "Restored to <path>" or, when the original location is gone, "Restored to <path> because its original location is in Trash or no longer exists".
- Common protection: "Common cannot be renamed" and "Common cannot be moved to Trash" (status messages for F2 and Delete on Common).

## 7. Keyboard map

| Keys | Action |
| --- | --- |
| Ctrl+N | New note in the current location (D-047: tree selection when the tree has focus, else the active note's folder, else the Home filter, else Common) |
| Ctrl+Shift+N | New sticky in the current scope |
| Ctrl+W | Close tab (no effect on Home) |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab in strip order |
| Ctrl+K | Command palette |
| Ctrl+F | Find in note |
| Ctrl+\ | Toggle tree |
| Ctrl+Shift+\ | Toggle context panel |
| F2 | Rename in tree |
| Delete | Move to Trash (with confirmation) |
| Enter | Open |
| Arrow keys | Tree navigation |
| Escape | Close popovers and dialogs |
| Ctrl+/ | Keyboard help (Phase 08) |
| Ctrl+B, Ctrl+I | Bold, italic |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | Undo, redo |
| Ctrl+Shift+7 / 8 / 9 | List shortcuts (Tiptap defaults) |

The global quick-sticky shortcut is optional and off by default; registration failure is shown in Settings.

## 8. States

Empty (illustrated text plus primary action), loading, saving and saved indicator ("Saved", "Saving...", "Not saved - retrying"), read-only, trashed, missing reference ("The linked note is in Trash" or "no longer exists" with Restore or Search), and unsupported capability: the control is disabled with the tooltip "Not supported by this desktop". The UI never pretends an unsupported action succeeded.

## 9. Accessibility

ARIA tree for the notes tree, tablist for tabs, dialog patterns for modals; a visible 2 px focus ring; focus returns to the invoking control after dialogs and menus; accessible names on every icon button; text contrast at least 4.5:1 and UI boundaries at least 3:1 in both themes; `prefers-reduced-motion` disables transitions; vector icons for high-DPI displays (INF-A11Y-01 to INF-A11Y-06).

## 10. Sticky colors

| Color | Light | Dark |
| --- | --- | --- |
| yellow (default) | #FFF4B8 | #4A4320 |
| green | #DDF5D8 | #24402A |
| blue | #DCEBFF | #22344F |
| pink | #FFE0EC | #4A2634 |
| violet | #ECE6FF | #342C52 |
| gray | #ECEDF1 | #2E3038 |

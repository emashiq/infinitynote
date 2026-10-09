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

Breakpoints: window width below 960 px turns the tree into a drawer; below 1180 px the context panel becomes an overlay drawer. Visual checks run at 1100x720 and 760x560 (INF-SHELL-01, INF-SHELL-04). The main window has no OS title bar (D-097, superseding the native-frame part of D-033): one 44 px app-drawn title bar holds the app icon and "Infinity Notes", the menus "File" (New note Ctrl+N, New sticky Ctrl+Shift+N, Close tab Ctrl+W, Quit Infinity Notes), "View" (Light/Dark/System theme, Toggle notes tree, Toggle details panel, Show/Hide reminder widget) and "Help" (Keyboard shortcuts, About Infinity Notes), the centered search box with the "Ctrl K" chip and the panel toggles; the OS draws minimize, maximize/restore and close over its right end in the theme colors. The bar is the drag region; its controls are not. Alt focuses the menu bar; Left/Right move between menus, Down/Enter/Space open one, Up/Down move inside it, Escape closes it. Sticky windows and the reminder widget are frameless: their 36 px header is the drag region, and a sticky's header ends with "Close sticky" (×, hides it).

## 3. Tokens

Light / dark values:

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | #FFFFFF | #17181D |
| `--bg-rail` | #F5F6FA | #1D1F26 |
| `--bg-subtle` | #F7F7FB | #22242C |
| `--border` | #E4E6EE | #30333D |
| `--border-strong` | #80869A | #70758A |
| `--text` | #1D2030 | #E7E8EE |
| `--text-muted` | #5F6475 | #A0A4B3 |
| `--accent` | #6A5AE0 | #8E80FF |
| `--accent-hover` | #5848D0 | #A196FF |
| `--accent-soft` | #F5F4FE | #2B2747 |
| `--accent-border` | #CFC9F7 | #4A4380 |
| `--on-accent` | #FFFFFF | #17181D |
| `--danger` | #C0392B | #FF7A6E |
| `--warning` | #9A5B00 | #F2B45C |
| `--success` | #2E7D4F | #6BCB8F |

Radius: 8 px for panels, 6 px for controls. Focus ring: 2 px accent with 2 px offset. Theme follows the OS (System) with Light and Dark overrides in Settings (INF-SHELL-05, INF-PREF-01). Phase 08 verifies contrast numerically (INF-A11Y-04, `tests/unit/contrast.test.ts`): `--border` stays for separators, while inputs, buttons and switches use `--border-strong` (at least 3:1); `--accent-soft` (light) was lightened so accent text on it reaches 4.5:1; text on `--accent` uses `--on-accent` (dark in the dark theme, D-099).

## 4. Typography

UI 13 px; editor body 15 px with line height 1.55; H1 22 px, H2 18 px, H3 15 px semibold; section labels 11 px uppercase with letter spacing 0.04em. Font stack: `"Segoe UI Variable Text", "Segoe UI", Ubuntu, Cantarell, "Noto Sans", "Noto Sans Bengali", system-ui, sans-serif`. Code font: `"Cascadia Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`.

## 5. Screens

- Home: one tab, always first, not closable. Header "Home" with scope filter `All | Common | Project v` (projects alphabetical), persisted in `home.scope`; a trashed project falls back to All. Sections in order: Quick actions (96x80 tiles: New note, New sticky, New project); Pinned (up to 12 tiles, "View all"); Recent (10 most recently updated notes with scope path and relative time); Reminders (Overdue and Due today, up to 5 each, link to Reminders) added in Phase 05 and absent before, with no placeholders. New note or sticky inherits the filter: Project goes to the project root, Common or All to the Common root.
- Notes tree: groups Favorites, Common (always first, not renameable), Projects, Trash at the bottom; folders before notes, then case-insensitive alphabetical; duplicate sibling names disambiguated by path; empty title shows "Untitled".
- Tab strip: Home, note tabs, singleton pages (Stickies, Reminders, Settings). Overflow scrolls horizontally with scroll buttons and an "All tabs" list button.
- Note editor (D-102, replaces the title field and toolbar row): the note area is only the text. The note tab is the title: a new note's tab opens in rename mode ("Title" field, placeholder "Untitled"); double-click or F2 on a note tab renames it; Enter saves and moves into the text, a click elsewhere saves, Escape puts the title back and returns to the tab. Formatting floats: selecting text (or Alt+F10 at the cursor) shows the "Formatting" toolbar beside the selection (Heading menu, Bold, Italic, Inline code, Link, Bulleted list, Numbered list, Checklist, Code block; the link actions inside a link; "Image size" for a selected image). Left and Right move between its buttons, Escape returns to the text. "/" at the start of a line or after a space opens the "Insert" list (Heading 1-3, Bulleted list, Numbered list, Checklist, Code block, Insert image, Attach file, Link to note…, Add reminder…, Create reminder from text), filtered by the letters typed; Up/Down, Enter or Tab, Escape. Right-click or Shift+F10 opens "Note actions": Insert image, Attach file, Link to note…; Add reminder…, Create reminder from text; Find in note, Convert to plain text… (or Convert to rich text), Version history…, Float as sticky. The save state is read by screen readers and is visible only as a small "Not saved" pill when the note is not saved; its reason (for example too large) shows below it. Banners (conflict, recovered drafts, conversion, Trash) are unchanged; there is no read-only lease banner since every view of a note edits at once (D-103). The Details panel starts closed (`layout.panelOpen` default false) and opens with its title bar toggle, View menu or Ctrl+Shift+.
- Context panel: collapsible sections for the active note: Info (Phase 02-03), Reminders (Phase 05), Outgoing references and Backlinks (Phase 07). Non-note tabs show "Open a note to see its details".
- Stickies page: sticky notes from every scope with a color dot and path, each with Float (`Float <title>`) and Open (`Open <title>`) actions, and New sticky (Phase 04 keeps the accepted Phase 02 list layout).
- Float (Phase 04; D-102 moved the tab's button into the note menu): note menu "Float as sticky", tree note menu "Float as sticky", palette "Float current note". New sticky (Ctrl+Shift+N, Home tile, tree, Stickies page, palette, tray) creates the sticky where the user is working and floats it; no tab opens (D-069).
- Sticky window (D-070):
  - Native frame and no application menu. The window background is the sticky color.
  - 36 px header, left to right:
    - color button "Sticky color" (menu of 6 radio items Yellow, Green, Blue, Pink, Violet, Gray);
    - the title field "Title", as wide as its text and edited in place (D-102): a click edits it, Enter or a click elsewhere saves, Escape restores it; F2 and Rename in the actions menu select it. It is the only no-drag part besides the buttons;
    - source badge with the path joined by " › " ("Common" at the Common root; full path as tooltip);
    - pin toggle "Keep on top" (always on top), disabled with the tooltip "Not supported by this desktop" where unsupported;
    - collapse toggle "Collapse sticky" / "Expand sticky";
    - menu "Sticky actions": Open in app, Rename, Change color, Hide, Remove from stickies, Move to Trash, Quit Infinity Notes.
  - The whole header drags the frameless window; only the color, pin, collapse, actions and × controls are no-drag (D-102).
  - Body: banners, the shared editor (floating formatting, "/" and the note menu as in tabs, without Float), notices. Collapsed shows only the header and cannot be resized.
  - The OS close button, Hide and Ctrl+W hide the window and never delete. Open in app docks it into a tab. Remove from stickies clears the sticky flag and opens the note in the app. Move to Trash asks "Move to Trash?" with the tree's copy.
  - Default size 320x300, minimum 220x120. At most 50 open stickies: "You have 50 open stickies. Hide some to open more."
- Reminders page (Phase 05): header "Reminders" with "Show widget"/"Hide widget"; tabs Today, Upcoming, Overdue, Completed with counts in their names ("Overdue, 2"); rows show the title, the source path, the selected-zone time and "Your time: …" when the local wall time differs, badges (Overdue, Snoozed until <time>, Missed, Done, Repeats daily/weekly) and actions Open, Snooze (overdue only; 5, 10, 15, 30 minutes, 1 hour, Tomorrow 09:00), Done, Edit, Delete. Completed lists completed and missed occurrences of the last 30 days. Empty texts: "Nothing due today.", "No upcoming reminders.", "Nothing is overdue.", "No completed reminders in the last 30 days."
- Reminder chips (Phase 05, D-080): a small button after the anchored block's text (bell, short time, state), never part of the text; note-level reminders and reminders whose block was removed show in a chip bar above the editor. Stickies show chips read-only.
- Context panel Reminders section (Phase 05): "Add reminder", rows with Done, Snooze, Edit, Delete; a removed block shows "Original text was removed" with "Attach to current paragraph" and "Keep note-level". Toolbar More gains "Add reminder…".
- Reminder widget (D-081): default 300x420, minimum 240x160; window title "Reminders - Infinity Notes"; 36 px header "Reminders" with "Keep on top" (disabled with "Not supported by this desktop" where unsupported), "Collapse widget"/"Expand widget" and "Hide widget"; segments Today, Upcoming, Overdue with counts; rows show the selected-zone time and the local time when different, the title and the source; actions Open, Snooze menu (overdue only), Done. Default off; a widget open at Quit returns at the next start.
- Settings: sections General, Appearance, Notes and attachments, Reminders, Windows and tray, Backup, Keyboard. Phase 04 adds Windows and tray:
  - segmented control "When the main window closes" with Ask, Keep running and Quit (`app.closeBehavior`);
  - the text "Reminders and stickies only work while the app is running.";
  - where no tray is supported, "No tray icon is available on this desktop. Launch Infinity Notes again to bring the main window back.";
  - switch "Restore open stickies on startup" (`stickies.restoreOnStartup`, default off).
- Tray (where supported, D-067): tooltip "Infinity Notes"; left click opens the main window. Menu: "Open Infinity Notes", "New sticky", "Show widget" (Phase 05), "Quit Infinity Notes".
- Settings > Reminders (Phase 05, D-083): select "Default time zone for new reminders" (first option "Computer time zone (<zone>)"); switch "Follow up on new reminders" with "Every" and "At most"; switch "Quiet hours" with "From", "To" and "Time zone"; the text "Reminders only fire while Infinity Notes is running: with a window open, in the background or in the tray. After you quit, nothing is sent until you start the app again, and then overdue reminders are shown."; without a notification service: "This desktop has no notification service. Reminders appear inside Infinity Notes and in the reminder widget instead." Windows and tray gains the switches "Show reminder widget" and "Start Infinity Notes when you sign in" (default off; disabled with "Not supported by this desktop", or "Available in the installed app" in development builds).
- Settings > Reminders (Phase 06, D-094):
  - switch "Suggest reminders from dates in notes" (`reminders.suggestFromText`, default on);
  - time "End of day" (`reminders.endOfDayTime`, default 17:00);
  - time "Time for date-only phrases" (`reminders.dateOnlyTime`, default 09:00);
  - the text "Suggestions understand English dates and times only. Your text is read on this computer and is not sent anywhere."
- Suggestions in the editor (Phase 06, D-091):
  - A detected phrase gets a dotted accent underline (decoration only, never part of the text).
  - While the cursor is inside the phrase, a slim bar overlays the bottom of the editor. It does not take focus and does not shift the text. It is a group "Reminder suggestion" with the text "Reminder: Fri 9 Oct, 17:00" ("Reminder: needs a choice"; past: "Reminder: Thu 1 Oct, 09:00 (past)") and the buttons "Create reminder" and "Dismiss".
  - When the phrase belongs to a reminder whose source text changed, the buttons are "Update reminder", "Create new reminder" and "Dismiss"; in a sticky, "Open in app to update" replaces "Update reminder".
  - The toolbar More menu (rich and plain notes, tabs and stickies) gains "Create reminder from text". It uses the selection, else the phrase at the cursor, else the paragraph at the cursor.
- Command palette (Ctrl+K): actions plus results (titles first, full-text in Phase 07).
- Phase 07 (D-098): the palette input reads "Type a command or search notes"; before typing it lists Pinned and Favorites, then Actions; typing shows up to 50 Notes with the title and a body snippet, hits marked; "Filters" reveals "Search in" (All notes, Common, projects) and "Tag" (Any tag, #tag (count)). Toolbar More (rich notes, main window) and the palette gain "Link to note…": a dialog "Link to note" (search notes by title), then "Link to <title>" with "Whole note" and the note's paragraphs ("Filter paragraphs"), Back and Cancel. A reference chip shows the target's live title (and "› paragraph"); a target in Trash or gone keeps its old title, dashed and struck through. File chips gain "Open" and "Show in folder"; a refused type says "This kind of file is not opened from Infinity Notes. Use Show in folder." The Details panel gains "Tags" in Info (chips with Remove, "Add tag" on Enter or comma; "Use 1-32 letters or digits without spaces"; "A note can have at most 20 tags"), "Outgoing references" and "Backlinks" sections ("The linked note is in Trash" with Restore and Search, "The linked note no longer exists" with Search, "The linked paragraph is no longer in this note."), and, docked, a "Close details panel" (×) control. A note tab in Trash or missing also offers Search.

## 6. Dialogs and banners (exact copy)

Dialogs:
- Close behavior (native message box, D-066):
  - message "Keep Infinity Notes running in the background?", detail "Reminders and stickies only work while the app is running.";
  - buttons "Keep running in background" (default), "Quit" and "Cancel" (Escape);
  - checkbox "Remember my choice", checked by default.
  - Linux, and any desktop without a supported tray, adds to the detail: "If no tray icon appears, launching Infinity Notes again brings this window back."
- Plain-text conversion: "Convert to plain text? Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it."
- Move dialog: scope and folder picker, keyboard accessible, shows the path; cycle attempts show "A folder cannot be moved into itself or one of its subfolders."
- Delete confirmations: "Move to Trash?" for items; "Delete forever?" and "Empty trash?" for permanent deletion with the number of items.
- Reminder editor (Phase 05): titles "Add reminder" / "Edit reminder"; fields Title, "Today" and "Tomorrow" shortcuts (dates in the selected zone), Date, Time, Time zone, Repeat (None, Daily, Weekly with Mon-Sun toggles), "Follow up if not done" with "Every" (5/10/15/30/60 minutes) and "At most" (1/2/3/5 times); preview "Fri 9 Oct 2026, 17:00 · Asia/Dhaka" and "Your time: …" when the local wall time differs; DST notices "02:30 does not exist on this date in New York; the reminder will use 03:00" and, for ambiguous times, "01:30 happens twice on this date; using the earlier one" with "Use the later one (EST)"; past time "This time has already passed. It will be added as overdue, without a notification." with "Add anyway"; editing a schedule with an overdue occurrence: "This reminder has an overdue occurrence." with "Keep the current overdue reminder" (default) and "Mark it done"; "Attach to the note instead" when the paragraph cannot be saved; "Choose a time zone" when no default zone is known; Save and Cancel. Errors: "Choose a time zone from the list", "This reminder is not due yet", "This reminder can no longer be snoozed", "This reminder was replaced by an edit", "Undo is no longer available", "This reminder changed elsewhere. Reopen it to edit.", "A note can have at most 200 reminders.", "This reminder no longer exists", "The linked paragraph is no longer in this note."
- Natural-language confirmation card: title, literal source text, full date with weekday, time, zone, local conversion, repeat, follow-up, Add and Cancel; disclosures "09:00 (default time for date-only phrases)" and "17:00 (default end of day)"; required choices for month/day order, am/pm and zone; "Use next year" button for past year-less dates. Nothing is saved before Add. Exact Phase 06 copy (D-093):
  - Dialog title: "Create reminder", or "Update reminder" in update mode.
  - Fields:
    - "Title";
    - "From your note" followed by the phrase in quotes (“tomorrow end of the day”);
    - for relative phrases, "Read on Thu 8 Oct 2026, 13:00 · Asia/Dhaka";
    - "Date" with the full date line "Friday, 9 October 2026";
    - "Time" with a disclosure while the default is unchanged: "17:00 (default end of day)", "09:00 (default time for date-only phrases)", or "20:00 (default for “tonight”)" and likewise for morning, afternoon and evening;
    - "Time zone";
    - the Phase 05 preview, "Your time: …" and the DST notices with "Use the later one (EST)";
    - "Repeat" and "Follow up if not done", as in the reminder editor.
  - Required choices (no default):
    - radio group "Date order" with options such as "4 March" and "3 April";
    - radio group "Time of day" with options such as "05:00" and "17:00";
    - "“CST” can mean more than one time zone. Choose one." with one button per suggested zone;
    - "Enter a time" for "midnight".
  - Add stays disabled while a choice is missing, showing one of "Choose the date order", "Choose AM or PM", "Choose a time zone", "Enter a time", "Enter a title".
  - Past result: "This time has already passed. It will be added as overdue, without a notification." with "Use next year" (year-omitted dates only) and "Add anyway".
  - Several phrases in a selection: radio group "Dates found".
  - No phrase found: "No date or time found in this text. Enter the date and time below." The card then works as manual entry.
  - Update mode shows "Now: Fri 9 Oct 2026, 17:00 · Asia/Dhaka" and the button "Update".
  - Buttons "Add" (or "Add anyway") and "Cancel"; Escape cancels and nothing is saved.
  - Errors:
    - "The note text changed. Try again.";
    - "The note could not be saved. Try again.";
    - "Select text within one paragraph.";
    - "Select a shorter part (up to 2,000 characters).";
    - "This reminder was not created from note text." (Keep current time on a reminder without a source; D-096)
  - Notices: "This reminder already exists." (the phrase was already confirmed) and "Could not dismiss this suggestion."
- Context panel Reminders section (Phase 06):
  - A reminder whose source changed shows "The text this reminder came from changed: “<text>”." with "Update from text…" and "Keep current time".
  - A removed source block keeps the Phase 05 text "Original text was removed" and adds "Created from “<text>”".
  - Chips of a changed source add ", its text changed" to their accessible name.

Banners and states:
- (Removed by D-103: the read-only lease banner and "Take edit control"; the tab and the sticky of a note edit at once and show each other's edits.)
- Conflict banner: "This note changed elsewhere. Your edits were kept as a recovered draft" with Compare, Restore draft, Dismiss.
- Trash overlay (sticky and tab): "This note is in Trash" with Restore and Close window (Close tab in a tab); editing disabled. In a sticky, Restore shows the existing restore notice ("Restored to <path>" or the relocated variant), and pending edits made just before the trash show the recovered-draft notice (Phase 04).
- Invalid window route: "This window could not be opened." with Close (also when the URL does not match what main says the window is, D-072).
- Unsaved text when a window closes (D-072): "Could not save this note. The window stays open." (sticky Hide, Open in app, Remove from stickies, the OS close button, and closing the main window to the background); on Quit: "Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it."
- Overdue summary banner on startup when overdue occurrences exist: "N reminders are overdue" ("1 reminder is overdue") with "Show overdue" (opens Reminders > Overdue).
- Reminder alert banner (Phase 05, when a native notification was not delivered): "Reminder: <title>", "Due <time>" with Open, Snooze, Done and Dismiss; more than 3 collapse into "N reminders are overdue" with "Show overdue". Notice "Reminder deleted" with Undo (10 s).
- Home Reminders section (Phase 05): "Reminders" with "Overdue" and "Due today" (up to 5 each), "Open Reminders"; empty "Nothing overdue or due today." Unknown computer zone: "Your computer's time zone is unknown; days are shown in UTC."
- Notifications (Phase 05): title = reminder title, body "Due <short time> · <note title>"; summary title "Infinity Notes", body "N reminders are overdue". No action buttons (D-026).
- Migration failure screen: "Database upgrade failed; your data was not changed" with "Show data folder" and "Quit".
- Newer-schema screen (D-040): "This notebook was created by a newer version of Infinity Notes. Your data was not changed." with "Show data folder" and "Quit".
- Database open failure screen (D-040): "Infinity Notes could not open its database. Your data was not changed." with "Show data folder" and "Quit".
- Closed-tab notice: "1 tab was closed because its note is in Trash"; plural "N tabs were closed because their notes are in Trash"; when a restored session also skipped missing notes, "N tabs were closed because their notes are in Trash or no longer exist" (D-047).
- Restore notice: "Restored to <path>" or, when the original location is gone, "Restored to <path> because its original location is in Trash or no longer exists".
- Common protection: "Common cannot be renamed" and "Common cannot be moved to Trash" (status messages for F2 and Delete on Common).

Editor copy added in Phase 03 (D-053 to D-058; exact strings):
- Recovered draft on open: "This note has a recovered draft from <relative time>." (several: "This note has N recovered drafts. The newest is from <relative time>.") with Compare, Restore draft, Dismiss. Restore draft waits while another content operation of the note runs.
- (Removed by D-103: the lease-lost banner.)
- Trashed while editing (notice): `Your unsaved edits to "<title>" were kept as a recovered draft. Restore the note from Trash to see them.`
- Compare dialog: title "Compare recovered draft", columns "Current note" and "Recovered draft", buttons Restore draft and Close.
- Converted banner: "Converted to plain text. A version with formatting and images was saved." with "Restore formatted version" and Dismiss.
- Version history dialog: title "Version history"; reasons "Automatic", "Before conversion", "Before restoring a draft", "Before restoring a version", "Before import"; restore confirmation "Restore this version? The current content is saved as a version first." with Restore and Cancel.
- Attachments: "This image is larger than N MB. Change the limit in Settings or use a smaller image."; "This file is larger than N MB. Change the limit in Settings or use a smaller file." (Phase 08 wording, once the Settings control exists); "This image type is not supported. Use PNG, JPEG, GIF or WebP."; "This image is too large to display. Use an image under 100 megapixels."; "Only the first 20 files were added."; "Plain-text notes cannot contain images. Convert to rich text to add images."; "Plain-text notes cannot contain files. Convert to rich text to add files." (D-059); generic "The image could not be added." and "The file could not be added."; in-content states "Adding image…", "Adding file…", "Image unavailable".
- Note too large: "This note is too large to save (over 5 MB). Remove some content to keep editing safely." Shown as visible text below the "Not saved" status (D-061, D-102).
- Paste too large (D-060): "This paste is too large (over 8 MB). Paste a smaller part."
- Document limits (D-061): "This would nest lists or quotes more deeply than a note can store. Use fewer levels." and "This would make the note too large to store. Paste or add a smaller part."
- Link dialog: title "Link", field "Address", error "Use an address that starts with http:// or https://", buttons Save, Remove link, Cancel. Link bar: the address with "Open link", "Edit link", "Remove link"; links open only on Ctrl+Click or Open link.
- Find bar: field "Find in note", counter "<i> of <n>" or "No results", buttons "Previous match", "Next match", "Close find".
- Toolbar (role toolbar, label "Formatting"; floating since D-102, see section 5): Heading menu (Paragraph, Heading 1, Heading 2, Heading 3), Bold, Italic, Inline code, Link, Bulleted list, Numbered list, Checklist, Code block. With an image selected it shows "Image size": Small (240 px), Medium (480 px), Full width. Plain-text notes have no formatting toolbar; their note menu has Find in note, Convert to rich text and Version history.

Phase 08 copy (D-099):
- Settings sections (labelled regions): General ("Show data folder"); Appearance; Notes and attachments ("Largest image" MB, "Largest file" MB, "Empty Trash automatically" Never / After 30 days / After 90 days, "Keep automatic versions for" days, "Most automatic versions per note"; out of range: "Enter a whole number from N to M."); Reminders; Windows and tray; Backup ("Back up now…", "Restore from backup…", "Export all notes…", "Import notes…", switch "Back up automatically", "Backup folder" with "Choose folder…", "Back up every", "Keep", "Last automatic backup: <date>", "Delete previous data"); Keyboard (switch "Quick sticky from anywhere (Ctrl+Alt+N)", "Shortcut", "This shortcut is used by another app. Choose another one.", "Show keyboard shortcuts").
- File menu: Export note as Markdown…, Export note as plain text… (disabled without a note tab), Export all notes…, Import notes…, Back up now…, Restore from backup…. Help → Keyboard shortcuts (Ctrl+/).
- Restore confirmation "Restore from backup?": "Restore the backup from <date>? It has N notes and M attachments. Your current notes, reminders and settings are replaced by the backup. A copy of your current data is kept, and Infinity Notes restarts to finish." with "Restore and restart" and Cancel. After the restart: "Your notebook was restored from the backup." or "The backup could not be restored. Your data was not changed."
- Notices: "Backup saved: <file>", "Exported to <file>", "Exported N notes to <file>", "Imported N notes into “Imported <date time>”". Refusals: "This file is not an Infinity Notes backup or export.", "This file was refused because it contains unsafe or unexpected entries.", "This file was refused because it is too large or too heavily compressed.", "This backup was made by a newer version of Infinity Notes. Update the app to restore it.", "This backup is damaged: a file inside it does not match its checksum."

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
| F2 | Rename in tree; on a note tab, rename the note (D-102) |
| Alt+F10 | Formatting toolbar at the selection or cursor (D-102) |
| / | Insert list at the start of a line or after a space (D-102) |
| Shift+F10 | Note menu in the text (D-102) |
| Delete | Move to Trash (with confirmation) |
| Enter | Open |
| Arrow keys | Tree navigation |
| Escape | Close popovers and dialogs |
| Ctrl+/ | Keyboard help (Phase 08; also Help → Keyboard shortcuts) |
| Ctrl+B, Ctrl+I | Bold, italic |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | Undo, redo |
| Ctrl+Shift+7 / 8 / 9 | List shortcuts (Tiptap defaults) |
| Ctrl+Alt+1 / 2 / 3 | Heading levels (Tiptap defaults) |
| Ctrl+E | Inline code |
| Ctrl+Enter | Toggle the checklist item at the cursor (Phase 03) |
| Ctrl+Click | Open a link (http and https only) |
| Enter / Shift+Enter in find | Next / previous match |

In a sticky window (Phase 04): Ctrl+W hides the sticky, Ctrl+F finds in the note, F2 renames it (D-102), Escape closes popovers, and the editor keys above apply. Ctrl+Shift+N in the main window floats the new sticky (D-069).

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

# Changelog

All notable changes to Infinity Notes. Versions follow [Semantic Versioning](https://semver.org/); each release's section is also its GitHub release notes.

## [0.2.0] - 2026-10-10

Tables, fonts and colors, locked notes, linked files, custom sticky colors and a new logo. Free to use (see [LICENSE](https://github.com/emashiq/infinitynote/blob/main/LICENSE)). Developed by [Ashiqur Rahman Emran](https://github.com/emashiq).

### Downloads

| File | For |
| --- | --- |
| `Infinity-Notes-Setup-x64.exe` | Windows 11 x64 (24H2 or newer). Per-user install, no administrator rights. |
| `infinity-notes_amd64.deb` | Ubuntu 24.04 or newer, Debian-based x64 (recommended on Linux). |
| `Infinity-Notes-x86_64.AppImage` | Other x64 Linux distributions. |
| `SHA256SUMS.txt` | SHA-256 checksums of every file in this release. |
| `THIRD_PARTY_NOTICES.md` | Licenses of the open-source components the app includes. |

Your notes from 0.1.0 are upgraded automatically on first start.

### New

- **Tables.** Insert a table with `/table` or **Insert table…**, add and remove rows and columns, toggle the header row, move between cells with Tab and resize columns. Copy a table into a spreadsheet, or paste one from Excel, LibreOffice, Google Sheets, a web page or tab-separated text.
- **Fonts and colors.** Font, font size, text color and highlight in notes, table cells and stickies, with presets and a custom color picker. Colors stay readable in light and dark themes.
- **Locked notes.** Lock a note with a password, and unlock it with Windows Hello too where available. The body is encrypted on disk (AES-256-GCM); the title stays visible. Locking destroys the note's earlier versions, drafts and search entries, so they cannot be rolled back, and a forgotten password cannot be recovered. Unlocked notes lock again after 5 idle minutes, on sleep, on screen lock (Windows) and on quit. Reminder titles stay visible.
- **Copy or link files.** When you add a file, choose **Copy into Infinity Notes** or **Link to the original**; a setting can make the choice for you. Files over 25 MB are never copied: they are linked, with a warning. Linked files open through the same safety checks as attachments, and programs or scripts are only shown in their folder.
- **Stickies.** Any custom background color, a text color per sticky, colored text inside stickies, and a tidier header where the title and project line up.
- **New logo** for the app, installer, tray and website, and a short logo loader while the app starts.
- **Wider note view.** Notes use the whole pane, with the scrollbar at the right edge.

### Changed

- The copy limit for files is now 1–25 MB (was up to 200 MB). A larger stored limit is read as 25 MB.
- The website was rebuilt, with download cards, install help and a how-to guide.

### Known limitations

- **Unsigned builds.** The installers are not code-signed, so Windows SmartScreen and some Linux desktops warn about an unknown publisher.
- Attached and linked files in a locked note are not encrypted, and backups made before a note was locked still contain its text.
- Windows Hello is only offered on Windows computers where it is set up; Linux uses the password.
- Linked files are not included in backups or exports; only the link is. On Windows only files on a local drive can be linked, and network links in an imported export are not kept.
- A table can have up to 10,000 cells, and a merged cell can span up to 50 rows or columns.
- Markdown export and plain-text conversion drop fonts and colors; tables become plain rows.
- Reminders are delivered only while the app runs (a sticky, the widget or the tray icon is enough). A fully quit app delivers nothing; the next start shows an overdue summary.
- Window positions and always-on-top depend on the desktop: under Wayland compositors (and WSLg) only window sizes are restored and pin is shown as unavailable.
- On Ubuntu 24.04 and newer the AppImage may not start because unprivileged user namespaces are restricted; use the `.deb`. The app never runs with `--no-sandbox`.

## [0.1.0] - 2026-10-09

The first public release of Infinity Notes: offline notes, floating stickies and reminders for Windows and Linux. Free to use (see [LICENSE](https://github.com/emashiq/infinitynote/blob/main/LICENSE)). Developed by [Ashiqur Rahman Emran](https://github.com/emashiq).

### Downloads

| File | For |
| --- | --- |
| `Infinity-Notes-Setup-x64.exe` | Windows 11 x64 (24H2 or newer). Per-user install, no administrator rights. |
| `infinity-notes_amd64.deb` | Ubuntu 24.04 or newer, Debian-based x64 (recommended on Linux). |
| `Infinity-Notes-x86_64.AppImage` | Other x64 Linux distributions. |
| `SHA256SUMS.txt` | SHA-256 checksums of every file in this release. |
| `THIRD_PARTY_NOTICES.md` | Licenses of the open-source components the app includes. |

macOS is planned; there is no macOS build yet.

### Highlights

- **Notes and projects.** Rich or plain-text notes in Common and in projects with folders of any depth, tabs with session restore, a Home dashboard, Trash with restore, version history and autosave.
- **Floating stickies with live editing.** Any note can float as its own always-available window; edit it in the main window and the sticky at the same time. Colors, collapse and always-on-top where the desktop allows it.
- **Reminders with time zones.** Reminders in any IANA time zone, with repeats, follow-ups and quiet hours, delivered as native notifications while the app runs (also in the background), plus a small reminder widget.
- **Natural-language suggestions.** Type "tomorrow end of the day" or "in 2 hours" in a note and the app suggests a reminder; nothing is created until you confirm the preview.
- **Links, backlinks and search.** Links between notes and blocks with backlinks, tags, and full-text search (Ctrl+K), Bangla included.
- **Backup and restore.** One-file backups (manual or automatic) with verified, rollback-safe restore; portable export and import; Markdown export.
- **Private by design.** No accounts, no sync, no telemetry, no network access. Everything stays in one data folder on your computer.

### Known limitations

- **Unsigned builds.** The installers are not code-signed, so Windows SmartScreen and some Linux desktops warn about an unknown publisher.
- Reminders are delivered only while the app runs (a sticky, the widget or the tray icon is enough). A fully quit app delivers nothing; the next start shows an overdue summary.
- Window positions and always-on-top depend on the desktop: under Wayland compositors (and WSLg) only window sizes are restored and pin is shown as unavailable.
- On Ubuntu 24.04 and newer the AppImage may not start because unprivileged user namespaces are restricted; use the `.deb`, which installs the needed AppArmor profile. The app never runs with `--no-sandbox`.
- Reminder suggestions understand English only; ambiguous dates ("03/04") and zone abbreviations ("CST") ask for an explicit choice.
- Markdown export is lossy (no reminders, tags, sticky state, image sizes or underline).
- A paragraph that contains an unbroken run of more than 4,096 characters may break ordinary words in that paragraph mid-word.
- Native checks still pending by hand on a real Windows 11 desktop: sleep and wake (M7), launch at sign-in (M9), 125-200 % display scaling (M11), a second monitor (M12) and a live time-zone change (M8). GNOME Wayland and X11 desktops have not been validated; Linux was validated under WSL2 with WSLg.

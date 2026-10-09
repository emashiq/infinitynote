# Changelog

All notable changes to Infinity Notes. Versions follow [Semantic Versioning](https://semver.org/); each release's section is also its GitHub release notes.

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

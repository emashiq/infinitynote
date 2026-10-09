# Infinity Notes

An offline desktop app for notes, floating stickies and reminders, for Windows and Linux. No accounts, no sync, no network: everything stays in one data folder on your computer.

- Rich or plain-text notes in projects and folders, tabs, search (Ctrl+K), links between notes, images.
- Stickies: any note in its own always-available window.
- Reminders with time zones, repeats and follow-ups, suggested from what you type and confirmed by you; a small reminder widget. Reminders are delivered while the app runs (also in the background); a fully quit app delivers nothing until it starts again.
- Backup and restore of everything in one file, export and import, Markdown export.

Documentation: [docs/INDEX.md](docs/INDEX.md). For users, start with the [user guide](docs/USER_GUIDE.md).

## Install

Builds are unsigned local builds (see [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)).

- Windows 11 x64 (tested; supported from 24H2; Windows 10 is not supported): run `Infinity-Notes-Setup-0.1.0-x64-unsigned.exe` (per-user, no administrator rights).
- Linux x64: `sudo apt install ./infinity-notes-0.1.0-amd64-unsigned.deb`, or run the AppImage. On Ubuntu 24.04 and newer use the `.deb`.

Your data lives in `%APPDATA%\Infinity Notes` (Windows) or `~/.config/Infinity Notes` (Linux) and is kept when you uninstall.

## Back up

**File > Back up now…** writes one `.infinitybackup` file; **File > Restore from backup…** checks it and swaps it in, keeping your previous data until you delete it. Settings > Backup can make automatic backups. Details: [user guide, section 3](docs/USER_GUIDE.md#3-back-up-and-move-your-data).

## Build from source

Requirements: Node.js 24.15 or newer within 24.x, npm 11. No Python is needed. Linux packages are built on Linux (or WSL2 from a copy on the Linux file system, with its own `npm ci`).

```sh
npm ci
npm run dev                # development app
npm run check              # lint, typecheck, unit, integration, traceability
npm run build              # production bundles in out/
npm run test:e2e           # Electron end-to-end tests (Playwright)
npm run package:current    # installer for this OS in release/ (NSIS on Windows; AppImage and .deb on Linux)
npm run test:e2e:packaged  # end-to-end checks against the packaged app
npm run verify:install:win # Windows: silent install, launch, update and uninstall check
```

Results of the release checks and the measured limits: [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md), [docs/NATIVE_OS_MATRIX.md](docs/NATIVE_OS_MATRIX.md).

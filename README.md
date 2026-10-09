# Infinity Notes

[![ci](https://github.com/emashiq/infinitynote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/emashiq/infinitynote/actions/workflows/ci.yml)
[![release](https://github.com/emashiq/infinitynote/actions/workflows/release.yml/badge.svg)](https://github.com/emashiq/infinitynote/actions/workflows/release.yml)

Offline notes, floating stickies and reminders for Windows and Linux. No accounts, no sync, no network: everything stays in one data folder on your computer. macOS is planned.

- **Website:** https://emashiq.github.io/infinitynote/
- **Download:** [latest release](https://github.com/emashiq/infinitynote/releases/latest) (Windows `.exe`, Linux `.deb` and AppImage; unsigned builds with SHA-256 checksums)
- **Developed by** [Ashiqur Rahman Emran](https://github.com/emashiq)

What it does:

- Rich or plain-text notes in projects and folders, tabs, search (Ctrl+K), links between notes, images.
- Stickies: any note in its own always-available window, editable there and in the main window at the same time.
- Reminders with time zones, repeats and follow-ups, suggested from what you type and confirmed by you; a small reminder widget. Reminders are delivered while the app runs (also in the background); a fully quit app delivers nothing until it starts again.
- Backup and restore of everything in one file, export and import, Markdown export.

For users, start with the [user guide](docs/USER_GUIDE.md). Changes per version: [CHANGELOG.md](CHANGELOG.md).

## Install

Download from the [latest release](https://github.com/emashiq/infinitynote/releases/latest). The installers are not code-signed yet, so Windows SmartScreen may warn: choose **More info**, then **Run anyway**. Compare each download with `SHA256SUMS.txt` from the same release.

- Windows 11 x64 (supported from 24H2; Windows 10 is not supported): run `Infinity-Notes-Setup-x64.exe` (per-user, no administrator rights).
- Linux x64: `sudo apt install ./infinity-notes_amd64.deb`, or run `Infinity-Notes-x86_64.AppImage`. On Ubuntu 24.04 and newer use the `.deb`.

Your data lives in `%APPDATA%\Infinity Notes` (Windows) or `~/.config/Infinity Notes` (Linux) and is kept when you uninstall.

## Back up

**File > Back up now…** writes one `.infinitybackup` file; **File > Restore from backup…** checks it and swaps it in, keeping your previous data until you delete it. Settings > Backup can make automatic backups. Details: [user guide, section 3](docs/USER_GUIDE.md#3-back-up-and-move-your-data).

## Build from source

Requirements: Node.js 24.15 or newer within 24.x, npm 11. No Python is needed. Linux packages are built on Linux (or WSL2 from a copy on the Linux file system, with its own `npm ci`). `.npmrc` disables install scripts, so `npm run setup:electron` downloads the Electron binary after `npm ci`.

```sh
git clone https://github.com/emashiq/infinitynote.git
cd infinitynote
npm ci
npm run setup:electron
npm run dev                # development app
npm run check              # lint, typecheck, unit, integration, traceability
npm run build              # production bundles in out/
npm run test:e2e           # Electron end-to-end tests (Playwright)
npm run package:current    # installer for this OS in release/ (NSIS on Windows; AppImage and .deb on Linux)
npm run test:e2e:packaged  # end-to-end checks against the packaged app
npm run verify:install:win # Windows: silent install, launch, update and uninstall check
npm run notices            # regenerate THIRD_PARTY_NOTICES.md after dependency changes
```

Releases are built and published by `.github/workflows/release.yml` when a `v<version>` tag is pushed; see [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Results of the release checks and the measured limits: [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md), [docs/NATIVE_OS_MATRIX.md](docs/NATIVE_OS_MATRIX.md).

## License

Infinity Notes is freeware: free to use for personal and commercial purposes, but not open source. You may not modify it or redistribute modified versions; the source is published for transparency. See [LICENSE](LICENSE) (plain-language terms that have not been reviewed by a lawyer). Third-party components keep their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright © 2026 [Ashiqur Rahman Emran](https://github.com/emashiq).

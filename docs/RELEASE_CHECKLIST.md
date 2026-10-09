# Release checklist

Infinity Notes 0.1.0. The builds are **unsigned**. Sections 1-6 record the local release validation; section 7 is the GitHub publishing step (2026-10-09). Every checked item names the log that shows it ran (`.infinity-work/logs/phase-09/`). Results for each native case are in [NATIVE_OS_MATRIX.md](NATIVE_OS_MATRIX.md).

## 1. Gates before packaging

The last source change was Phase 09 Repair 1 (D-101). What ran on which tree:

- [x] `npm run check` (lint, typecheck, unit, integration, traceability) on the final tree: Windows `repair1-check.log` (18:47); WSL mirror `wsl-repair1-check.log` (18:59, mirror identical).
- [x] `npm run build` on the final tree: Windows `repair1-build.log`.
- [x] `npm run test:e2e` on the final tree on Windows: `repair1-test-e2e.log` (Playwright runner on Node 24.21.0 through `INFINITY_E2E_NODE`).
- [x] `npm run test:e2e` under WSLg: the full suite ran once at 16:12 (`wsl-test-e2e-wslg.log`), **before** the final-gate changes (a test-only hand-off fix, removal of an unused `EditorHandle` getter) and before Repair 1 (N-D2 chip fix, Windows-only notification identity, NSIS include, test changes). On the final tree only `reminders.spec` ran under WSLg (12/12, `wsl-repair1-test-e2e-reminders.log`), plus the packaged E2E and installed-build checks of section 3. The full WSLg suite was not re-run on the final tree.
- [x] Dependency audit: `npm audit --omit=dev` finds 0 vulnerabilities in what ships (`audit-prod.log`). The full tree has 8 moderate advisories, all in electron-builder's build-time download chain (`sprintf-js` < `roarr` < `global-agent` < `@electron/get`; `audit-all.log`); nothing of it is packaged, and the offered fix downgrades electron-builder. Accepted for this local release.
- [x] License review: the 8 packaged runtime modules are MIT; the renderer bundle (React, Tiptap, ProseMirror, DOMPurify under Apache-2.0, chrono-node, lucide) is MIT, ISC or Apache-2.0; the whole lockfile has only permissive licenses (`licenses.log`).

## 2. Windows (NSIS, x64)

- [x] `npm run package:current` builds `release/Infinity-Notes-Setup-0.1.0-x64-unsigned.exe` (`repair1-package-current.log`). Size and SHA-256: see [FINAL_REPORT.md section 5](FINAL_REPORT.md#5-release-artifacts).
- [x] The file name says unsigned and Authenticode reports `NotSigned` (`repair1-signature.log`).
- [x] `npm run test:e2e:packaged` against `release/win-unpacked` (`repair1-test-e2e-packaged.log`): packaged SQLite, sandboxed renderers, fuses, test hooks absent, notification layer, cold start with 10,000 notes.
- [x] `npm run verify:install:win` (`repair1-verify-install-win.log`): silent per-user install into a temporary folder, launch and create data, relaunch, install over it, uninstall (which removes the pinned toast activator registration a real notification created), host left clean. User data in a temporary folder through `INFINITY_NOTES_USER_DATA_DIR`, never the user's profile.
- [x] Native GUI cases with real pointer and keyboard input on the installed build: M1 toast click, M2 Notification Center click after the toast closed, M3 tray, M4 drag and resize with restore, M5 title bar, M6 always on top, M10 global shortcut, M13 file hand-off (2026-10-09; `native/` logs and screenshots, NATIVE_OS_MATRIX section 2a). Its findings N-D1 to N-D3 are fixed in Repair 1 and have regression tests (D-101, FINAL_REPORT section 4a).
- [ ] Manual native cases M7 sleep and wake, M9 launch at login, M11 125-200 % scaling, M12 second monitor (required), M8 live time-zone change (recommended) (NATIVE_OS_MATRIX section 5).

## 3. Linux (AppImage and .deb, x64), built in WSL

Build from the ext4 copy (`~/infinity-notes`, synchronized with `rsync --delete` and compared with `diff -r`), with its own `npm ci`; never share `node_modules` with Windows. Never pass `--no-sandbox`.

The Linux packages were rebuilt from the final tree at 19:07 (mirror identical, `final2-wsl-sync.log`; `npm ci`, `final2-wsl-npm-ci.log`). The `final2-wsl-*` logs below are the release evidence; the earlier `wsl-*` package logs (16:22-16:25) belong to packages built before Repair 1 and are superseded.

- [x] `npm run package:linux` builds `infinity-notes-0.1.0-x86_64-unsigned.AppImage` and `infinity-notes-0.1.0-amd64-unsigned.deb` (`final2-wsl-package-linux.log`). Sizes and SHA-256: FINAL_REPORT section 5.
- [x] `npm run test:e2e:packaged` against `release/linux-unpacked`: 7 passed (`final2-wsl-test-e2e-packaged.log`).
- [x] `.deb`: `wsl -d Ubuntu -u root -- dpkg -i …` (`final2-wsl-deb-install.log`), launched as the normal user twice with the data persisting (`final2-wsl-deb-create.log`, `final2-wsl-deb-verify.log`), desktop entry (`infinity-notes.desktop`, `StartupWMClass=infinity-notes`) checked (`final2-wsl-deb-desktop.log`; post-install script `wsl-deb-postinst.log`), `dpkg -r` (`final2-wsl-deb-remove.log`; that it keeps the user data was checked on the earlier package, `wsl-deb-remove.log`), then purged (`final2-wsl-deb-purge.log`).
- [x] AppImage launched directly, data created and found again (`final2-wsl-appimage-create.log`, `final2-wsl-appimage-verify.log`).
- [x] Sandbox negative control (`--no-sandbox` must fail the sandbox assertion): `wsl-sandbox-negative-control.log` (16:24, earlier tree; not re-run).
- [x] User-driven move and resize under WSLg with real pointer input on the installed final .deb: stickies and widget moved and resized; sizes restored after quit and relaunch; positions compositor-controlled (documented fallback). `native-wslg/` (NATIVE_OS_MATRIX section 3).
- [ ] GNOME Wayland and X11 desktops: outside the user-selected validation scope (NATIVE_OS_MATRIX section 4).

## 4. Security settings of the packaged app (INF-SEC-02)

- [x] Chromium sandbox on for every renderer (main, stickies, widget), `contextIsolation`, no Node in renderers, narrow validated IPC, CSP, navigation and permission blocking, no network (Phases 01-08 E2E; packaged checks above).
- [x] Electron fuses on the built binary (checked by the packaged E2E): `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `OnlyLoadAppFromAsar` on, `EnableEmbeddedAsarIntegrityValidation` on (enforced on Windows), `GrantFileProtocolExtraPrivileges` off. `EnableNodeCliInspectArguments` is on so Playwright can drive the packaged app (D-100).
- [x] Test hooks and test seams are absent from packaged builds (packaged E2E).

## 5. Remaining distribution steps (not done; signing and publishing are out of scope)

1. **Code signing.** Sign the Windows installer, `Infinity Notes.exe`, `elevate.exe` and the uninstaller with an Authenticode certificate (EV for immediate SmartScreen reputation), with a timestamp server; drop `-unsigned` from `artifactName`. Optionally sign the `.deb` repository and provide an AppImage signature.
2. **Distribution build hardening.** After the packaged and installed checks pass, rebuild with `electronFuses.enableNodeCliInspectArguments: false` and smoke-test it by hand (Playwright can no longer attach).
3. **Ubuntu 24.04+ AppImage.** The `.deb` installs an AppArmor profile that allows the sandbox's user namespaces; the AppImage cannot. Either document the `.deb` as the supported package there (done in the user guide) or provide a profile for the AppImage. Never ship `--no-sandbox`.
4. **Native validation still open.** Run manual steps M7, M9, M11 and M12 (required) and M8 (recommended) on Windows 11 (M1-M6, M10 and M13 passed on 2026-10-09; WSLg move and resize passed on 2026-10-09) and, if the scope is extended, the GNOME Wayland and X11 cases on real Ubuntu desktops; record them in NATIVE_OS_MATRIX.
5. **Publishing.** Done through GitHub Releases and GitHub Pages; see section 7. No auto-update is built in; updates are new installers.
6. **Version.** Bump `version` in `package.json` and `APP_VERSION` together for each release; the migration checksum test guards the schema.

## 6. Development machines (Windows)

Since Phase 09 Repair 1, unpackaged runs (`npm run dev`, `npm run test:e2e`) use their own notification identity (`com.infinitynotes.desktop.dev` and a separate pinned toast activator CLSID), and packaged builds pin the production CLSID `{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}`, which the uninstaller removes (D-101). Earlier development runs registered the production identity for Electron's development binary. If the installed app's notifications show as "Electron", or clicking one opens Electron's default window, remove these leftovers by hand (the build tools never delete them):

- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Electron.lnk`, created by earlier unpackaged runs with the production AppUserModelID.
- Under `HKCU\Software\Classes\CLSID`, keys named "Electron Notification Activator" whose `LocalServer32` points at `node_modules\electron\dist\electron.exe` or at a `release\win-unpacked` or removed `Infinity Notes.exe` (earlier builds registered a new random CLSID on every run).

`npm run verify:install:win` backs up an existing `{16B1084D-…}` registration before it installs and puts it back afterwards.

## 7. Publishing on GitHub

Repository: https://github.com/emashiq/infinitynote (default branch `main`). Website: https://emashiq.github.io/infinitynote/. Nothing is ever force-pushed.

One-time setup:

- [ ] Settings > Pages > Source: **GitHub Actions**. `.github/workflows/pages.yml` then deploys `website/` (static, no build step) on every push to `main` that changes it, or when started by hand.

For each release:

1. [ ] Bump `version` in `package.json` and `APP_VERSION` in `src/shared/app-identity.ts` together, and add a `## [<version>] - <date>` section to `CHANGELOG.md` (highlights and known limitations). That section becomes the release notes, followed by the unsigned-build notice.
2. [ ] After dependency changes, run `npm run notices` and commit `THIRD_PARTY_NOTICES.md`; `npm run check` fails while it is stale.
3. [ ] `ci.yml` is green on `main` for the commit to release. It runs the E2E suites, which the release workflow does not repeat.
4. [ ] Tag the commit `v<version>` and push the tag. `.github/workflows/release.yml` runs (it can also be started by hand for an existing tag):
   - **prepare:** `node tools/release-notes.mjs <tag>` fails unless the tag is `v` plus the `package.json` version and `APP_VERSION`, and `CHANGELOG.md` has a section for it.
   - **build** on `windows-2025` and `ubuntu-24.04`: `npm ci`, `npm run setup:electron`, the Linux sandbox prerequisites of `ci.yml`, `npm run check`, `npm run package:current` (production bundles, then the installers), `npm run verify:native -- --packaged`.
   - **publish:** renames the installers to their stable names, writes `SHA256SUMS.txt` over every asset, and creates or updates the release "Infinity Notes v<version>" with `gh` and `GITHUB_TOKEN` (`contents: write` in this job only), marked as the latest release.
5. [ ] On the release page: the assets below, the notes, and each website download button starts its download.

Release assets. The installer names are stable and **must not change between releases**: the website links to `https://github.com/emashiq/infinitynote/releases/latest/download/<name>`, and these plain links are what makes one-click downloads work without JavaScript.

| Asset | Source |
| --- | --- |
| `Infinity-Notes-Setup-x64.exe` | `release/Infinity-Notes-Setup-<version>-x64-unsigned.exe` |
| `infinity-notes_amd64.deb` | `release/infinity-notes-<version>-amd64-unsigned.deb` |
| `Infinity-Notes-x86_64.AppImage` | `release/infinity-notes-<version>-x86_64-unsigned.AppImage` |
| `THIRD_PARTY_NOTICES.md` | repository root; also packaged in the app's `resources/` next to `LICENSE.txt` |
| `SHA256SUMS.txt` | written by the publish job (`sha256sum` format, covers every asset above) |

The license is the Infinity Notes Freeware License (`LICENSE`); the NSIS installer shows it. macOS builds are planned and are not part of the pipeline.

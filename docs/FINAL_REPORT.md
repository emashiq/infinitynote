# Infinity Notes 0.1.0: final report

**Status: `ready_for_os_validation`.** Every implementation gate passes on Windows 11 and on WSL2 Ubuntu 26.04.1 + WSLg (section 2 says exactly which gates ran on the final tree). Both OS packaging gates were built from the final tree, installed, launched and checked on their own hosts: the Windows NSIS installer, and the Linux AppImage and .deb, which were rebuilt from the final tree in WSL on 2026-10-09 at 19:07. A native GUI run on Windows 11 with real pointer and keyboard input (2026-10-09, [NATIVE_OS_MATRIX.md section 2a](NATIVE_OS_MATRIX.md#2a-native-gui-run-2026-10-09)) passed the toast click (M1), the Notification Center click after the toast closed (M2), the tray icon and menu (M3), user drag and resize with restore (M4), the title bar (M5), always on top (M6), the global shortcut (M10) and the OS file hand-off (M13). Under WSLg, user-driven move and resize of two stickies and the widget passed with real pointer input on the installed final .deb: sizes were restored after a relaunch, and positions are compositor-controlled, which is the documented fallback (NATIVE_OS_MATRIX section 3). Still `not_run` and required: Windows sleep and wake (M7, which also covers WSLg sleep and wake), launch at login (M9), 125-200 % scaling (M11) and a second monitor (M12). The live zone change (M8) is recommended. Exact steps are in section 8. That run found three low or development-host defects (N-D1 to N-D3), none in data, scheduling or security; all three are fixed and verified in Phase 09 Repair 1 (section 4a). GNOME Wayland and X11 cases are outside the user-selected validation scope. No critical or high data-loss, scheduler or security defect is open.

Date: 2026-10-09. Logs: `.infinity-work/logs/phase-09/` (raw command output; each ends with `EXIT=<code>`).

## 1. What was delivered

One offline Electron 44 desktop app for Windows and Linux. No backend, accounts, sync, collaboration, telemetry or AI.

- **Foundation (Phase 01):** secure windows (sandbox, context isolation, CSP, navigation and permission blocking, no network), narrow Zod-validated IPC, better-sqlite3 (WAL, FTS5) with checksummed migrations and pre-migration backups, single instance, user-data override for tests.
- **Organization (Phase 02):** Common and projects, folders of any depth, cycle-safe moves, Trash with restore, tabs with session restore, Home dashboard, command palette, keyboard model.
- **Editor (Phase 03):** one Tiptap editor for rich and plain notes, block IDs, sanitized paste, images and files copied into managed storage, autosave with revisions, edit leases, drafts and versions, find in note.
- **Stickies (Phase 04):** any note as its own native window (dock and float the same note, read-only mirror and control transfer, colors, collapse, pin where supported, bounds clamped to displays), tray and close-to-background lifecycle.
- **Reminders (Phase 05):** time-zone-aware reminders (IANA zones, DST gap and fold, recurrence, follow-ups, quiet hours), one scheduler in main with delivery claims and recovery batches, native notifications with an in-app fallback, Reminders page and widget.
- **Suggestions (Phase 06):** English phrases ("tomorrow end of the day", "in 2 hours", …) suggest a reminder that is only created after the user confirms a preview; no re-parse shifts. Custom title bar (D-097).
- **Retrieval (Phase 07):** note and block references with backlinks, full-text search (Bangla included), tags, file hand-off.
- **Portability and preferences (Phase 08):** WAL-safe hashed backups with verified, rollback-safe restore; portable export/import with ID remapping; Markdown export; retention and attachment GC; complete Settings; accessibility pass.
- **Release (Phase 09):** defect closure (section 4), integrated measurements (section 3), release hardening (Electron fuses, Linux desktop identity, minified renderer), Windows and Linux packages verified on their hosts, release and user documentation.

## 2. Tests that ran

The last source change was Phase 09 Repair 1 (D-101). On Windows, every gate in this table ran on the final tree (`repair1-*.log`, 18:47-18:58), except the dependency audit and license review (16:09-16:10); no dependency changed after them. On WSL, these ran on the final tree: `npm run check` (18:59), `reminders.spec` under WSLg, the Linux packages, the packaged E2E and the installed-build checks (`final2-wsl-*.log`, 19:06-19:16). Two WSL runs used an earlier tree and were not re-run: the full WSLg E2E suite (16:12) and the sandbox negative control (16:24). That tree predates the final-gate changes (a test-only hand-off fix and the removal of an unused `EditorHandle` getter) and Repair 1 (the N-D2 chip fix, the Windows-only notification identity, the NSIS include and test changes).

| Gate | Host | Result | Log |
| --- | --- | --- | --- |
| `npm run check`: lint, typecheck, unit, integration, traceability | Windows | unit 91 files / 663 tests; integration 48 files / 418 passed + 1 skipped (Linux-only symlink case); traceability 187 IDs, fails=0 | `repair1-check.log` (Repair 1, after the last change; the first final gate: `final-check.log`) |
| `npm run check` | WSL ext4 mirror | unit 663; integration 419 (the symlink case runs on Linux); traceability fails=0 | `wsl-repair1-check.log` |
| `npm run build` | Windows | pass | `repair1-build.log` |
| `npm run test:e2e` (real Electron, Playwright) | Windows | 224 passed, 1 skipped (Linux-only main.log ozone line), 8.5 min | `repair1-test-e2e.log` |
| `npm run test:e2e` | WSLg | Earlier tree (16:12): 221 passed, 2 skipped (Windows-only tray specs), 1 failed and then fixed (the test now states its capability; NATIVE_OS_MATRIX section 3); settings.spec re-run 8/8. Final tree: only reminders.spec, 12/12 | `wsl-test-e2e-wslg.log`, `wsl-test-e2e-wslg-settings-rerun.log`, `wsl-repair1-test-e2e-reminders.log` |
| `npm run package:current` (NSIS) and `npm run test:e2e:packaged` | Windows | installer built; packaged E2E 7 passed | `repair1-package-current.log`, `repair1-test-e2e-packaged.log` |
| `npm run verify:install:win`: install, launch, relaunch, update, uninstall | Windows | 15 of 15 steps pass (incl. toast activator registered, then removed by the uninstaller) | `repair1-verify-install-win.log` |
| Mirror sync, `npm ci`, `npm run package:linux` and `npm run test:e2e:packaged` (final tree) | WSL | MIRROR_IDENTICAL; AppImage and .deb built; 7 passed | `final2-wsl-sync.log`, `final2-wsl-npm-ci.log`, `final2-wsl-package-linux.log`, `final2-wsl-test-e2e-packaged.log` |
| Final packages: .deb installed with `dpkg -i` as root, launched as `infinity` (note created), relaunched (note, image and search found; sandbox `mode=user-namespace`), desktop entry checked, then `dpkg -r` and `dpkg -P`; AppImage launched and relaunched | WSLg | pass | `final2-wsl-deb-*.log`, `final2-wsl-appimage-*.log`, `final2-wsl-cleanup.log` |
| User-driven move and resize of two stickies and the widget, with real pointer input on the installed final .deb; quit and relaunch | WSLg | pass: windows moved and resized; sizes restored; positions compositor-controlled (fallback) | `native-wslg/` (`summary.txt`, `drag-resize.log`) |
| Sandbox negative control (`--no-sandbox` must fail) | WSLg | fails as intended (earlier tree) | `wsl-sandbox-negative-control.log` |
| Dependency audit and licenses | Windows | 0 runtime advisories; 8 moderate build-time only; all licenses permissive | `audit-prod.log`, `audit-all.log`, `licenses.log` |

The unit and integration suites cover the TEST_MATRIX areas with temporary databases and frozen clocks (hierarchy, persistence, migrations, references, reminders, scheduler recovery, time zones, parsing contract table, suggestions, portability and archive security). The E2E suites drive the real Electron app with temporary user data and read its SQLite database directly.

## 3. Measurements

Synthetic fixture (`tests/support/perf-fixture.ts`): 10,000 plain notes of 40 words in Common and 100 projects; 1,000 reminders created through the real IPC; for the editor, 24 noise PNGs of 800x600 (they do not compress, so decoding costs what photos cost) and a 20,000-paragraph rich note. Measured by `tests/e2e/perf.spec.ts` (`PERF` lines in the logs) unless noted. Machine details: [NATIVE_OS_MATRIX.md section 1](NATIVE_OS_MATRIX.md#1-hosts) (AMD Ryzen 7 7700, 63 GB RAM, NVMe, Windows 11 Pro 10.0.26300; WSL2 on the same machine). Cold start is the warm-cache launch (the OS file cache already holds the app); "process" is Electron's own uptime when the shell reports ready, "launch" is Playwright's launch-to-ready time including its inspector attach.

| Measurement | Windows 11, dev build | Windows 11, packaged | WSLg, dev build | WSLg, packaged | Target |
| --- | --- | --- | --- | --- | --- |
| Search through the bridge, 40 queries at 10,000 notes (p95 / median) | 10.6 / 8.4 ms | 9.9 / 7.3 ms | 11.5 / 8.1 ms | 11.4 / 8.5 ms | p95 < 300 ms |
| Palette, typing to rendered results incl. 150 ms debounce (median of 3) | 341 ms | - | 417 ms | - | - |
| Cold start, process start to ready shell (3 runs) | 1139, 1100, 1133 ms | 1115, 1112, 1094 ms | 1483, 1434, 1436 ms | 1464, 1443, 1440 ms | < 3 s |
| Cold start, Playwright launch to ready (3 runs) | 1285, 1345, 1270 ms | 1314, 1247, 1254 ms | 1614, 1566, 1554 ms | 1611, 1581, 1549 ms | - |
| 1,000 reminders created through IPC | 3 ms each | - | 3 ms each | - | - |
| Reminders > Upcoming shown (first 200 rows of 1,000) | 303 ms | - | 271 ms | - | - |
| Due burst: 2 days pass at once with 1,000 reminders | one summary notification, tick 52 ms | - | one summary, 22 ms | - | no alert storm |
| Note with 24 photos: open until the images in view are decoded; jump to the end | 174 ms; 141 ms | - | 102 ms; 174 ms | - | - |
| Typing below 24 photos, key to next frame (p95 / median) | 15.6 / 7.9 ms | - | 16.0 / 8.1 ms | - | < 100 ms |
| 20,000-paragraph note: open; typing key to next frame (p95 / median) | 496 ms; 29.8 / 25.3 ms | - | 664 ms; 31.5 / 26.5 ms | - | < 100 ms |
| 256K-character unbroken Bangla run: paste until responsive; reopen | 203 ms; 26 ms | - | 137 ms; 41 ms | - | < 1 s |
| 10 note tabs open (one live editor): app working set before / after | 739 / 952 MB | - | 864 / 1067 MB | - | - |
| 10 stickies + widget: open time per cycle (3 cycles) | 1039, 1028, 965 ms | - | 871, 816, 869 ms | - | - |
| 10 stickies + widget: renderers open / after close; windows, webContents, listeners after close | 12 / 1; equal to baseline every cycle | - | 12 / 1; equal to baseline | - | no leak |
| Working set: baseline / after 3 cycles | 383 / 444 MB | - | 561 / 639 MB | - | - |

Logs: `final-test-e2e.log`, `final-test-e2e-packaged.log`, `wsl-test-e2e-wslg.log`. The WSLg packaged column is from the final Linux packages (`final2-wsl-test-e2e-packaged.log`). The superseded packages measured search 10.0 / 7.4 ms and process cold start 1427, 1415, 1396 ms (`wsl-test-e2e-packaged.log`). Inactive-tab memory over five Ctrl+Tab cycles through 10 tabs (`editor-memory.spec`, Windows): renderer working set 223 MB, 247 MB after one cycle, 253 MB after five; JS heap 27, 61, 47 MB.

Notes:

- **Search:** the product target (p95 < 300 ms at 10,000 notes) holds with a wide margin; most of the palette time is the 150 ms input debounce plus rendering.
- **Cold start:** under the 3 s target on both hosts, dev and packaged, with 10,000 notes and 1,000 reminders. A first start after a reboot (cold disk cache) was not measured.
- **Long Bangla run (F-03-1):** 203 ms on Windows now; before the fix the same 256K-character paste took 3,370 ms to become responsive on Windows (Phase 03 acceptance probe).
- **Large-note typing (F-03-2):** caching the limits delta did not change typing latency measurably (Windows p95 27.0 ms before, 26.9 ms after, `dev-perf-f032-*.log`): the remaining cost is elsewhere and is well under the 100 ms budget.
- **Inactive tabs:** with 10 note tabs open, exactly one editor is mounted and no image elements exist outside the active tab (also `editor-memory.spec`, five Ctrl+Tab cycles).
- **Window cleanup:** after each of three cycles of 10 stickies plus the widget, the window count, webContents count, registry size and every tracked listener count (`web-contents-created`, `second-instance`, `before-quit`, `nativeTheme updated`, display listeners) return exactly to the baseline, and the renderer process count returns to 1. The browser process keeps some memory after the first cycle; an eight-cycle probe (`probe-window-memory-win.log`, outside the suite) shows it fluctuating between 165 and 233 MB without growing per cycle (total 426-499 MB against 391 MB at the start).

## 4. Defects closed in Phase 09

| ID | Severity | Problem | Fix | Verification |
| --- | --- | --- | --- | --- |
| A08-F1 | low (UX) | Enter in a new note's title, then typing at once: the text went into the title. Reproduced 8 of 8 (`dev-a08f1-repro-1.log`): Tiptap's `focus` command waits for an animation frame | `EditorHandle` focuses synchronously, and keeps a request until an editable editor is attached (dropped if the focus moved elsewhere) | unit `editor-handle.test` (5); E2E `a11y-keyboard.spec` › Enter right after typing a new title (3 notes, no waits) and the keyboard-only flow without its former wait: 8/8 repeated (`dev-a08f1-1.log`), then Windows and WSLg suites |
| A08-F2 | low | Cancelled restore left `data/restore-staging/` until the next prepare | Removed at startup when no restore marker exists | integration `restore.test` › restore prepared but never confirmed (fails on the old code) |
| A05-F2 | medium if it occurs (risk; not reproduced natively) | Windows raises `close` when a toast times out into Action Center; the adapter dropped its reference, so a later click could be lost | References kept until clicked, bounded at 50 | unit `notification-adapter.test` (2 new); native M2 (2026-10-09): toast closed (Windows `close` recorded), then clicked in Notification Center, note opened |
| CL-F1 | low (test) | Sandbox assertion required a user namespace, which the SUID sandbox does not create | Verdict accepts user-namespace or SUID mode and records it; `--no-sandbox` still fails | unit `linux-sandbox.test`; WSL negative control; packaged and installed runs record `mode=user-namespace` |
| F-03-1 | medium (performance) | A very long unbroken Bangla run made layout superlinear (3.4 s for 256K characters) | `word-break: break-all` decoration on blocks with a run over 4,096 characters; text unchanged | unit `long-runs.test`; E2E `perf.spec` › 256K Bangla run (byte-exact, < 1 s) |
| F-03-2 | low | `doc-limits` computed each change twice and walked from the document start | One measurement per transaction, `nodesBetween` | unit `paste-limits.test` › exact incremental count; measurement above |
| F-03-3 | low | Unused `@tiptap/extension-image` | `npm uninstall` | lockfile, check, build |
| F-01-5 | low | Unminified renderer (2.60 MB) | esbuild minification (1.16 MB) | `final-build.log` |
| F-01-6, F04-A3 | low (packaging) | No `desktopName`; no fuses | `desktopName` + `syncDesktopName`; fuses (D-100) | unit `app-identity.test`; packaged E2E reads the fuse wire; `.desktop` file checked on the installed .deb |
| WSLg settings spec | low (test) | The Phase 08 global-shortcut E2E assumed Windows' capability | States the capability it needs | `wsl-test-e2e-wslg-settings-rerun.log` |
| Hand-off test | low (intermittent test) | The Phase 07 junction case used the fixed shard `cd`, which collides with a random attachment about 1 run in 85 | Uses a hex shard no attachment uses | 5 consecutive runs, final gates |

## 4a. Findings of the native GUI run (fixed in Repair 1)

| ID | Severity | Problem | Fix | Verification |
| --- | --- | --- | --- | --- |
| N-D1 | medium on development machines, none on a clean install | Unpackaged runs (dev, E2E) used the production AppUserModelID, so Electron created `Start Menu\Programs\Electron.lnk` with that ID and an activator for `node_modules\electron\dist\electron.exe`. With it present, the installed app's toasts showed as "Electron" and a Notification Center click started Electron's default app instead of opening the note | Unpackaged runs use `com.infinitynotes.desktop.dev` and their own pinned activator CLSID; packaged builds keep the production IDs (D-101). Stale development leftovers are documented for manual removal (RELEASE_CHECKLIST section 6); the existing `Electron.lnk` was not deleted | unit `app-identity.test` (selection, main wiring); `repair1-check.log`. M1/M2 passed natively before this fix with the stale shortcut moved aside; the change affects only unpackaged runs, and the packaged identity is unchanged |
| N-D2 | low (display only) | A reminder chip was drawn after the wrong paragraph (Enter at the end of an anchored paragraph) or disappeared (a file inserted right after it); the stored anchor stayed right | On every edit, the chips of the blocks the change touches are rebuilt from the block IDs; the rest are mapped (D-101) | unit `reminder-chips.test` › N-D2 a, N-D2 b (both fail on the old code); E2E `reminders.spec` › chips stay on their anchored paragraphs (fails on the old code with the chip inside the new paragraph; 6/6 repeated; Windows `repair1-test-e2e.log`, WSLg `wsl-repair1-test-e2e-reminders.log`) |
| N-D3 | low (uninstall leftover) | The uninstaller left the "Electron Notification Activator" COM registration (`HKCU\Software\Classes\CLSID\{16B1084D-…}\LocalServer32`) pointing at the removed exe; Electron also registered a new random CLSID on every run | Packaged builds pin `{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}`; `resources/installer.nsh` (`nsis.include`) deletes exactly that key on uninstall, not on update (D-101) | unit `app-identity.test` (the include deletes only that key); `repair1-verify-install-win.log`: `toast-activator-registered` (the installed exe after a real notification), `uninstall-removes-toast-activator`, and the host's previous registration restored |

## 5. Release artifacts

All unsigned and unpublished. Sizes in bytes; SHA-256 as recorded in `release/artifacts.json` at build time.

| Artifact | Host built on | Bytes | SHA-256 | Install verified |
| --- | --- | --- | --- | --- |
| `release/Infinity-Notes-Setup-0.1.0-x64-unsigned.exe` (NSIS, per-user, Authenticode `NotSigned`) | Windows 11 | 119,429,467 | `5886137c237cb72a63e1c84493d1155f6e821fc0e4326fd8467f52513c21323c` | yes: silent install, launch, relaunch, update over, uninstall (`repair1-verify-install-win.log`); the native GUI run used the previous build `8f3ddf79…a18a` |
| `infinity-notes-0.1.0-amd64-unsigned.deb` (in the WSL mirror's `release/`, built 2026-10-09 19:07 from the final tree) | WSL2 Ubuntu 26.04.1 | 107,874,876 | `b52aa1d323675ca59ff74c0e307e5ce5b2f47fdb744d32cf4a57a037ecbecbf4` | yes: `dpkg -i`, launch, relaunch, user-driven move and resize under WSLg, `dpkg -r`, `dpkg -P` (`final2-wsl-deb-*.log`, `native-wslg/`) |
| `infinity-notes-0.1.0-x86_64-unsigned.AppImage` (in the WSL mirror's `release/`, built 2026-10-09 19:07 from the final tree) | WSL2 Ubuntu 26.04.1 | 135,650,991 | `9990641213ce948054243d68313cd9c698fb4ecdf149bb09038ca97956c77b04` | yes: launched directly twice (`final2-wsl-appimage-*.log`) |

The Linux packages built before Repair 1 (.deb `5d357e43…413a`, AppImage `6db99ae3…7ea5`, `wsl-package-linux.log`) are superseded and are not release artifacts. The installed Windows program is 246,302,208 bytes (`Infinity Notes.exe`); the renderer bundle is 1.16 MB minified.

## 6. Security review (INF-SEC-02, INF-SEC-03)

- Sandboxed renderers confirmed by the OS in packaged builds (Windows `sandboxed=true integrity=untrusted`; Linux own user and PID namespaces with `Seccomp: 2`), context isolation, no Node integration, CSP, blocked navigation, permissions and network (Phases 01-08).
- Electron fuses on the built binaries: `RunAsNode` off, `NODE_OPTIONS` off, only `app.asar`, embedded asar integrity on (enforced on Windows), no extra `file://` privileges. The inspector switch stays on for the Playwright checks; the distribution step to turn it off is in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md#5-remaining-distribution-steps-not-done-signing-and-publishing-are-out-of-scope).
- IPC, attachment and import boundaries were reviewed with their adversarial suites (`ipc-validation`, `import-security`, `protocol`, `attachments`): unchanged in Phase 09 and green in the final gates.
- `npm audit --omit=dev`: 0. Full tree: 8 moderate advisories in electron-builder's build-time download chain, not shipped.

## 7. Known limitations

- Reminders are delivered only while the app runs (also with only a sticky, the widget or the tray open). A fully quit app delivers nothing; the next start shows an overdue summary. A notification clicked after an app restart cannot open the note (no COM activator on Windows).
- Positioning and always on top depend on the desktop: under Wayland compositors (and WSLg) the app restores window sizes only and shows pin as unavailable.
- You drag a sticky by the free parts of its header: the scope badge, the gaps and the padding. The title field takes most of the header width and does not drag the window, because clicking it edits the title (observation N-O2, NATIVE_OS_MATRIX section 3).
- Under WSLg there is no notification server and no tray host; the in-app alert banner and "a second launch brings the window back" are the fallbacks. Launch at login is unavailable under WSL.
- On Ubuntu 24.04 and newer the AppImage may not start because user namespaces are restricted; the .deb (with its AppArmor profile) is the supported package. The app never runs with `--no-sandbox`.
- Natural-language suggestions are English only; ambiguous dates ("03/04") and zone abbreviations ("CST") require an explicit choice.
- Markdown export is lossy (no block IDs, reminders, tags, sticky state, image sizes, underline).
- A paragraph holding an unbroken run over 4,096 characters wraps anywhere (`break-all`), so ordinary words in that same paragraph may also break mid-word.
- The installers are unsigned: SmartScreen and some Linux desktops warn about an unknown publisher.

## 8. Remaining steps to `complete`

The Linux packages are rebuilt from the final tree, and the WSLg move and resize case passed (2026-10-09). The steps that remain are manual steps on the Windows 11 host. Use the final installer `release/Infinity-Notes-Setup-0.1.0-x64-unsigned.exe` (SHA-256 `5886137c…323c`), installed normally (double-click, per user) with your usual profile or a test profile. For each case, record the date, the Windows build, pass or fail, and a screenshot or log path in NATIVE_OS_MATRIX section 2 (and section 3 for the WSLg sleep row). Then update the matching BACKLOG row.

Required:

1. **M7 Sleep and wake** (INF-SCHED-05; TEST_MATRIX Windows sleep/wake; also the WSLg sleep/wake row).
   1. Start Infinity Notes. Create a note, then use More > Add reminder… to add a reminder due 3 minutes from now. Save it.
   2. Optional, for the WSLg row: in WSL, install the .deb and start it as `infinity` (see NATIVE_OS_MATRIX section 3). Add a reminder there that is due at the same time.
   3. Put the PC to sleep (Start > Power > Sleep) right away. Leave it asleep for 5 minutes, so the reminder becomes due while it sleeps.
   4. Wake the PC and sign in.
   5. Expected: one notification for the reminder (or one overdue summary if more than 3 were due), with no burst of repeated alerts. Under WSLg, expect the in-app alert banner. Open the Reminders page: the reminder shows as delivered once.
2. **M9 Launch at login** (INF-DESK-03).
   1. In the installed app, turn on Settings > Windows and tray > Start Infinity Notes when you sign in.
   2. Check Task Manager > Startup apps: "Infinity Notes" is listed and enabled.
   3. Sign out of Windows and sign in again.
   4. Expected: Infinity Notes starts in the background, with its tray icon present (it may be in the ^ overflow).
   5. Turn the setting off again. Expected: the entry is gone from Task Manager > Startup apps (or shows as disabled), and the next sign-in does not start the app.
3. **M11 Display scaling 125 / 150 / 200 %** (INF-A11Y-06).
   1. Open the main window, one sticky and the reminder widget.
   2. In Settings > System > Display > Scale, choose 125 %, then 150 %, then 200 %. Sign out and back in if Windows asks you to.
   3. Expected at each step: text, icons and the title-bar buttons are crisp (not blurry), nothing is cut off, and stickies keep their size.
   4. Set the scale back to 100 %.
4. **M12 Second monitor** (INF-STKY-06).
   1. Float a sticky (Ctrl+Shift+N). Drag it by its scope badge or the header gaps onto the 2560x1440 display.
   2. Quit (File > Quit Infinity Notes), start the app again, and reopen the sticky (Stickies page > Float). Expected: it returns to the same place on the second display.
   3. Quit. Disconnect the second display (or turn off "Extend these displays"). Start the app and reopen the sticky.
   4. Expected: the sticky appears fully visible on the remaining display, with its size kept.
   5. Reconnect the display.

Recommended (not gating):

5. **M8 Live time-zone change.** Create a reminder in the computer's zone, and a second reminder pinned to another zone (for example Europe/London). While the app runs, change the time zone in Settings > Time & language > Date & time (turn off "Set time zone automatically" first). Expected: the first reminder keeps the same instant and its time is shown in the new zone; the pinned reminder keeps its wall time in its own zone. Change the zone back afterwards.
6. **Spot recheck on the final installer.** The native GUI run used the previous build `8f3ddf79…`. Repeat M1 (toast click) once, and the N-D2 checks (a) and (b) with the real pointer (NATIVE_OS_MATRIX section 2a).

After steps 1-4 pass, rerun the Phase 09 acceptance. If it is accepted, the coordinator commits Phase 09 and runs `node tools/finalize-docs.mjs --repo .`. Other options:

- If the user extends the validation scope: run the GNOME Wayland and X11 cases on real Ubuntu desktops (NATIVE_OS_MATRIX section 4).
- Distribution (out of scope here): signing and publishing, as listed in RELEASE_CHECKLIST section 5.

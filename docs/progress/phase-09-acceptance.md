# Phase 09 acceptance: Integrated testing, defect closure and native release

Acceptor: infinity-acceptor (Opus 5.5, high), fast mode (CLAUDE.md 2026-10-09). Date: 2026-10-09. Host: Windows 11 Pro 10.0.26300.

## Decision

**`ready_for_os_validation`.** This is a handoff status. It does not mean the project is complete.

All implementation and local gates pass on Windows 11 and on WSL2 Ubuntu 26.04.1 + WSLg. The Windows NSIS installer was built, installed, launched, updated and uninstalled on the real host. The Linux AppImage and .deb were built, installed, launched and removed in WSL. A real-input native GUI run on Windows passed M1-M6, M10 and M13. The three defects it found (N-D1 to N-D3) are fixed and have regression tests. No critical or high data-loss, scheduler or security defect is open.

The phase cannot be `accepted`. acceptor.md allows `accepted` only when every required native Windows/Linux case and every packaged-install gate has actual evidence. Required native cases are still `not_run`:

- Windows, listed in the pack's TEST_MATRIX native matrix: sleep/wake (M7) and login startup (M9).
- Windows, BACKLOG native rows: 125-200 % scaling (M11, INF-A11Y-06) and second-monitor restore and removal (M12, INF-STKY-06).
- WSLg, the user-selected Linux environment, standing in for the GNOME Wayland row: user-driven move and resize of stickies and the widget.

The user's scope decision covers only GNOME/X11-only cases. It does not cover any of these.

## F-9 decision (Phase 00 follow-up)

Marking GNOME Wayland and X11 cases `outside_validation_scope` **does not by itself block a final `complete`**. The CLAUDE.md user decision (2026-10-08) names WSL2 Ubuntu 26.04 + WSLg as *the* Linux build/test/native-validation environment, and D-021 encodes it. The Linux native requirement is therefore met by the WSLg equivalents of the TEST_MATRIX GNOME Wayland cases: installed launch, independent windows, user-driven move/resize, pin fallback, notification fallback, tray fallback and sleep/wake. The outside-scope rows must never be shown as passes, and they are not (NATIVE_OS_MATRIX section 4, RELEASE_CHECKLIST unchecked box).

Note: the coordinator's brief quoted a sentence ("the run can finish as complete instead of stopping at ready_for_os_validation") that does not appear in the current CLAUDE.md. This decision rests on the CLAUDE.md text that does exist and on D-021, not on that quote.

This exclusion does not apply to the Windows cases or to the WSLg user-drag case. Those are still required.

## Evidence reviewed

Logs are in `.infinity-work/logs/phase-09/`. Every exit code was read from the log file.

| Gate | Log | Verified result |
| --- | --- | --- |
| Windows `npm run check` (after the last source change) | `repair1-check.log` | EXIT=0; unit 91 files / 663; integration 48 files / 418 + 1 skipped (Linux-only); traceability ids=187 fails=0 |
| Windows build | `repair1-build.log` | EXIT=0 |
| Windows E2E | `repair1-test-e2e.log` | EXIT=0; 224 passed, 1 skipped (Linux-only) |
| Windows package + Authenticode | `repair1-package-current.log`, `repair1-signature.log` | EXIT=0; `NotSigned`. The acceptor recomputed the installer: 119,429,467 bytes, SHA-256 `5886137c237cb72a63e1c84493d1155f6e821fc0e4326fd8467f52513c21323c`. Matches FINAL_REPORT section 5. |
| Windows packaged E2E | `repair1-test-e2e-packaged.log` | EXIT=0; 7 passed |
| Windows install / relaunch / update / uninstall | `repair1-verify-install-win.log` | EXIT=0; 15/15 steps PASS, including `after-update-data-preserved`, `uninstall-keeps-user-data`, `uninstall-removes-toast-activator` and `host-clean` |
| No source change after the final Windows gates | file mtimes | No file under `src/`, `tests/`, `resources/`, `tools/` or the build config is newer than `repair1-check.log` |
| WSL check (after Repair 1) | `wsl-repair1-sync.log`, `wsl-repair1-check.log` | MIRROR_IDENTICAL; EXIT=0; traceability fails=0 |
| WSLg full E2E | `wsl-test-e2e-wslg.log`, `wsl-test-e2e-wslg-settings-rerun.log`, `wsl-repair1-test-e2e-reminders.log` | 221 passed, 2 skipped, 1 failed. The failure is `settings.spec` global shortcut, which assumed Windows' capability; the test was fixed without weakening it. Rerun 8/8. After Repair 1, `reminders.spec` 12/12. |
| Linux packages, packaged E2E, .deb and AppImage | `wsl-package-linux.log`, `wsl-test-e2e-packaged.log`, `wsl-deb-*.log`, `wsl-appimage-*.log`, `wsl-sandbox-negative-control.log` | All EXIT=0. The negative control fails on purpose (EXIT=1, `mode=none`). The acceptor recomputed the hashes in `~/infinity-notes/release`: .deb `5d357e43…413a` and AppImage `6db99ae3…7ea5`, both matching FINAL_REPORT. |
| Native GUI run | `native/` (59 PNGs plus JSON/txt/log) | Spot-checked. `m1r-toast.png` is a real "Infinity Notes" toast. `m1r-deliveries.json` and `m2s-click.log` show `clicked_at` set and the main window recreated in the foreground. The failed first attempt ("Open me", `clicked_at` null) is recorded as a failure caused by N-D1, not hidden. `m6-always-on-top.log` has `WS_EX_TOPMOST` and `WindowFromPoint` read-back. |
| Acceptor spot run | `npx vitest run --project unit` on app-identity, reminder-chips and notification-adapter | 3 files, 29/29 passed |

Code reviewed:

- `src/main/index.ts`: the AUMID/CLSID calls are gated on `process.platform === 'win32'`.
- `src/shared/app-identity.ts`: `windowsNotificationIdentity`.
- `resources/installer.nsh`: deletes only the pinned CLSID key, not during an update.
- `src/renderer/editor/reminder-chips.ts` (`followEdit`): rebuilds the decorations of the touched blocks from their block IDs and maps the rest. This is correct for the N-D2 cases.

Test edits recorded in the progress report fix races and locators. None weakens an assertion.

## Answers to the review questions

1. **Verdict:** `ready_for_os_validation` (see Decision).
2. **Linux packages predating Repair 1.** The .deb and AppImage were built at 16:23. Later changes:
   - Removal of an unused `EditorHandle.current` getter.
   - A test-only hand-off fix.
   - The N-D2 chip renderer fix.
   - The Windows-only AUMID/CLSID code (gated to win32) and the NSIS include.

   None of these affects Linux packaging, the native module or the sandbox. The chip fix was verified under WSLg with the dev build. For this handoff state the packages are **acceptable as evidence** of the Linux packaging gate. They are **not acceptable as the final release artifacts**, because they do not contain the shipped N-D2 fix. Before `complete`, rebuild them from the final tree and rerun the packaged E2E and the .deb install/launch/relaunch. Doing this in the same WSLg session as the user-drag case costs little. FINAL_REPORT section 5 does not currently say that the Linux packages predate Repair 1. That is issue I-2.
3. **No fabricated claims.** Every `pass` in NATIVE_OS_MATRIX names a dated host (section 1, 2026-10-09) and an evidence path that exists. `not_run` and `outside_validation_scope` rows are labelled honestly, and no WSLg result is called GNOME. Installer size, hash and unsigned status are present and were recomputed. BACKLOG statuses are honest: 183 `done`, and 4 `not_run` (INF-STKY-06, INF-DESK-03, INF-SCHED-05, INF-A11Y-06), which match the remaining manual cases. A few stale or imprecise sentences are listed under Issues. None of them claims a test that did not run.
4. **Overall defects.** There is no open critical or high data-loss, scheduler or security defect. Residual risks are documented, not hidden:
   - The `enableNodeCliInspectArguments` fuse is still on so Playwright can drive the packaged app. Turning it off is a distribution step in RELEASE_CHECKLIST section 5.
   - The builds are unsigned.
   - There are 8 moderate build-time-only advisories (0 in the runtime tree).
   - Clicks on a notification after an app restart cannot open the note (no COM activator; known limitation).

## Issues (non-blocking documentation fixes; do these with the remaining validation)

- **I-1:** `docs/RELEASE_CHECKLIST.md` section 2 says "Findings N-D1 to N-D3 are open". They are fixed (D-101, FINAL_REPORT 4a). Correct the sentence.
- **I-2:** `docs/FINAL_REPORT.md` section 2 ("after the last source change") and section 5 do not state that the WSLg full E2E run and the Linux packages predate the final-gate changes and Repair 1. Only `reminders.spec` and `check` were rerun on WSL. `RELEASE_CHECKLIST.md` section 1 has the same imprecision. State this, or rebuild the packages and replace the rows.
- **I-3:** `docs/FINAL_REPORT.md` section 8 step 1 lists only the Windows manual cases. It omits the WSLg user-driven move/resize case, which is `not_run` in NATIVE_OS_MATRIX section 3.
- **I-4:** `docs/progress/phase-09.md` has two stale passages, both superseded by the Repair 1 section and NATIVE_OS_MATRIX 2a. The A05-F2 row still says "native click not_run" (M2 passed), and "Remaining OS-dependent cases" still lists M1-M13 as not run.
- **I-5:** `README.md` says "Windows 10/11 x64", but only Windows 11 was tested. Say so, or mark Windows 10 as untested.

## Remaining manual steps for the user

Use the final installer `release/Infinity-Notes-Setup-0.1.0-x64-unsigned.exe` (SHA-256 `5886137c…323c`). The detailed steps are in `docs/NATIVE_OS_MATRIX.md` section 5. For each case, record the date, the Windows build, pass or fail, and a screenshot or log path in NATIVE_OS_MATRIX sections 2 and 3, and update the matching BACKLOG row.

Required before `complete`:

1. **M7 Sleep and wake (Windows; also covers WSLg sleep/wake).** Create a reminder due in 3 minutes. Optionally keep a WSLg instance running at the same time. Sleep the PC for 5 minutes, then wake it. Expected: one alert (or one overdue summary when more than 3 are due), no burst; under WSLg, the in-app banner. Rows: INF-SCHED-05; TEST_MATRIX Windows sleep/wake; WSLG sleep/wake.
2. **M9 Launch at login (Windows, installed build).** Settings > Windows and tray > Start Infinity Notes when you sign in: on. Sign out, then sign in. Expected: the app starts in the background (tray). Turn the setting off and confirm the entry is gone from Task Manager > Startup apps. Row: INF-DESK-03.
3. **M11 Display scaling 125 / 150 / 200 %.** Expected: text, icons and the title-bar buttons are crisp, and stickies keep their size. Row: INF-A11Y-06.
4. **M12 Second monitor.** Drag a sticky to the 2560x1440 display, quit, start: it returns there. Quit, disconnect that display, start: the sticky appears fully visible on the remaining display. Row: INF-STKY-06.
5. **WSLg user-driven move and resize.** In WSL, rebuild the Linux packages from the final tree: sync the mirror, `npm ci` if the lockfile changed, `npm run package:linux`, `npm run test:e2e:packaged`. Then `dpkg -i` the new .deb as root, launch it as `infinity`, float two notes and show the widget. Drag each window by its header and resize it from an edge with the real mouse. Quit and relaunch. Expected: windows move and resize under the user's pointer; sizes are restored; positions are compositor-controlled, which is the documented fallback. Record the new .deb/AppImage sizes and hashes in FINAL_REPORT section 5. Then `dpkg -r` and `dpkg -P`.

Recommended (not gating):

6. **M8 Live OS time-zone change.** TEST_MATRIX lists "OS zone change" under Time zones (logic, covered by the zone seam in unit/integration/E2E); INF-REM-15 has no native test type. Create a reminder in the computer's zone, change the Windows time zone while the app runs, and confirm that the instant is unchanged and that a reminder pinned to another zone keeps its wall time.
7. **Spot recheck on the final installer.** The native GUI run used the previous build `8f3ddf79…`. Repeat M1 (toast click) once, and N-D2 (a) and (b) with the real pointer.

After steps 1-5 pass and I-1 to I-5 are corrected, rerun the Phase 09 acceptance. If it is accepted, the coordinator commits Phase 09 and runs `node tools/finalize-docs.mjs --repo .`. Until then, keep the pack and checkpoints in place (CLAUDE.md, CLEANUP_POLICY).

# Phase 09 progress: Integrated testing, defect closure and native release

Implementer: infinity-code-opus (Opus 5.5, high), fast mode (CLAUDE.md 2026-10-09: no separate planner or QA). Plan pointer: `docs/plans/phase-09.md`. Logs: `.infinity-work/logs/phase-09/`. Decisions: D-100.

## Plan

1. Close the follow-ups assigned to Phase 09, each with a regression test that fails on the old code:
   - A08-F1: an `EditorHandle` per note view; Enter in the title focuses the editor synchronously, or as soon as an editable editor is attached. E2E: Enter and typing right after Ctrl+N, no wait.
   - A08-F2: remove `data/restore-staging/` at startup when no restore marker exists (integration).
   - A05-F2: the notification adapter keeps a reference until click (bounded at 50); `close` no longer drops it (unit).
   - CL-F1: the Linux sandbox verdict accepts the SUID sandbox (own PID namespace, `Seccomp: 2`, setuid root helper) and records the mode; the `--no-sandbox` negative control stays a failure (unit, WSL negative run).
   - F-03-1: `word-break: break-all` through a node decoration for blocks with a run over 4,096 characters without whitespace; text unchanged (unit, E2E 256K Bangla paste and reopen under 1 s).
   - F-03-2: `doc-limits` measures each transaction once and walks only up to the changed range; exact-count unit test; large-note typing measured.
   - F-03-3: remove `@tiptap/extension-image` with `npm uninstall`.
   - F-01-5: minify the renderer (esbuild).
   - F-01-6, F04-A3: `desktopName` and `linux.syncDesktopName`; Electron fuses compatible with Playwright (inspect stays on), checked on the built binary by the packaged E2E.
2. Measurements (INF-PERF-01..05) in `tests/e2e/perf.spec.ts` with the synthetic fixture `tests/support/perf-fixture.ts` (10,000 notes, 100 projects, 1,000 reminders): cold start (dev and packaged), search p95 through the bridge, palette, Reminders page, a due burst (one summary), image-heavy and 20,000-paragraph typing latency, 10 tabs with one live editor, 10 stickies plus the widget opened and closed three times with listener, window and renderer counts back to baseline. Each prints a `PERF` line used by docs/FINAL_REPORT.md.
3. Windows release: `npm run package:current`, `npm run test:e2e:packaged`, `npm run verify:install:win` (new tool: silent per-user install into a temporary folder, launch and create data, relaunch, install over, uninstall, host left clean; data in a temporary folder through `INFINITY_NOTES_USER_DATA_DIR`), installer size and SHA-256, signature status.
4. Linux release in WSL (user `infinity`, `~/infinity-notes` exact mirror with its own `npm ci`, never `--no-sandbox`): check, the full E2E under WSLg once, `package:linux`, packaged E2E, sandbox negative control, `.deb` installed as root and launched as `infinity` twice (data persists), `dpkg -r`, AppImage launched directly. Script: `.infinity-work/wsl-leg-p09.sh`.
5. Dependency audit and license list (INF-SEC-03), security settings review (INF-SEC-02).
6. Final Windows gate after the last change: check, build, test:e2e, package:current, test:e2e:packaged, verify:install:win (`final-*.log`).
7. Docs: FINAL_REPORT, NATIVE_OS_MATRIX (every TEST_MATRIX native case; manual Windows cases not_run with steps; GNOME/X11 outside_validation_scope), RELEASE_CHECKLIST, USER_GUIDE, README, BACKLOG statuses. The finalizer is not run (coordinator).

## Summary

All Phase 09 follow-ups are closed with regression tests (A08-F1, A08-F2, A05-F2, CL-F1, F-03-1, F-03-2, F-03-3, F-01-5, F-01-6/F04-A3). The integrated measurements meet every product target on Windows 11 and WSLg, dev and packaged (search p95 about 10 ms at 10,000 notes; cold start 1.1-1.5 s; typing p95 under 32 ms in a 20,000-paragraph note and next to 24 photos; a 256K Bangla run responsive in 137-203 ms instead of 3.4 s; no window, renderer or listener leak over repeated sticky/widget cycles). The Windows NSIS installer was built, installed silently, launched, relaunched, updated in place and uninstalled with the data kept and the host left clean. The Linux AppImage and .deb were built in the WSL ext4 mirror, installed (`dpkg -i` as root), launched as `infinity`, relaunched, removed and purged. Release status: `ready_for_os_validation` (manual Windows cases remain, and GNOME/X11 is outside the scope; see docs/FINAL_REPORT.md).

## Hosts

- Windows 11 Pro 10.0.26300 (AMD Ryzen 7 7700, 63 GB RAM, two displays at 100 %); Node 24.15.0 for tools; Playwright runner on Node 24.21.0 (`INFINITY_E2E_NODE`); Electron 44.7.0.
- WSL2 Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, WSLg 1.0.73 (Weston 2318feca), user `infinity`, mirror `~/infinity-notes` (`wsl-env.log`). Electron runs on XWayland there; not labelled GNOME.

## Files

- Source: `src/renderer/editor/editor-handle.ts` (new, A08-F1), `src/renderer/editor/long-runs.ts` (new, F-03-1), `src/renderer/editor/{doc-limits.ts,extensions.ts,NoteEditor.tsx}`, `src/renderer/notes/{NoteTitleInput,NoteView}.tsx`, `src/renderer/stickies/StickyView.tsx`, `src/renderer/styles/editor.css`, `src/main/portability/restore.ts` (A08-F2), `src/main/services/electron-notifications.ts` (A05-F2).
- Build and packaging: `electron.vite.config.ts` (minify), `electron-builder.json` (fuses, `syncDesktopName`), `package.json` (`desktopName`, `verify:install:win`, `@electron/fuses` 1.8.0 dev, `@tiptap/extension-image` removed), `package-lock.json` (npm), `tsconfig.node.json` (`tests/install`).
- Tools: `tools/verify-windows-install.mjs` (new).
- Tests (new): `tests/e2e/perf.spec.ts`, `tests/install/{installed.spec,playwright.config}.ts`, `tests/support/{perf-fixture,linux-sandbox}.ts`, `tests/unit/linux-sandbox.test.ts`, `tests/unit/renderer/editor/{editor-handle,long-runs}.test.ts`.
- Tests (extended, no assertion weakened): `e2e/a11y-keyboard.spec.ts` (immediate-Enter test; the keyboard flow no longer waits for the saved title), `e2e/packaged.spec.ts` (fuse wire), `e2e/fixtures.ts` (sandbox mode), `e2e/settings.spec.ts` (states the global-shortcut capability it needs), `integration/restore.test.ts`, `integration/handoff.test.ts` (shard collision, below), `unit/notification-adapter.test.ts`, `unit/app-identity.test.ts`, `unit/renderer/editor/paste-limits.test.ts`; `tests/support/png.ts` (noise PNG). `prng` moved from `integration/hierarchy-helpers.ts` to `tests/support/perf-fixture.ts` and is reused by `integration/{hierarchy,search}.test.ts` (search seeding now uses the shared fixture).
- Docs: `docs/FINAL_REPORT.md`, `docs/NATIVE_OS_MATRIX.md`, `docs/RELEASE_CHECKLIST.md`, `docs/USER_GUIDE.md`, `README.md` (new); `docs/DECISIONS.md` (D-100, pinned `@electron/fuses`, Tiptap row), `docs/BACKLOG.md` (29 rows), `docs/plans/phase-09.md`, this report. Phase-only script: `.infinity-work/wsl-leg-p09.sh`; probe outside the suite: `.infinity-work/probes/phase-09/`.

## Requirement and follow-up coverage

| ID | Evidence (tests that ran) | Status |
| --- | --- | --- |
| A08-F1 | repro failing 8/8 on the old code (`dev-a08f1-repro-1.log`); unit editor-handle.test (5); e2e a11y-keyboard › Enter right after typing a new title, and the keyboard flow without its wait (8/8 repeated, `dev-a08f1-1.log`; final Windows and WSLg suites) | closed |
| A08-F2 | integration restore.test › restore prepared but never confirmed (fails on the old code) | closed |
| A05-F2 | unit notification-adapter.test › Action Center click after close; bounded references (both fail on the old code); real click in Notification Center after Windows raised `close`: native M2 passed on 2026-10-09 (NATIVE_OS_MATRIX section 2) | closed (native M2 pass) |
| CL-F1 | unit linux-sandbox.test (5); packaged, .deb and AppImage runs record `mode=user-namespace`; the negative control records `mode=none` and fails | closed |
| F-03-1 | unit long-runs.test (3); e2e perf.spec › 256K Bangla run (Windows 203 ms, WSLg 137 ms; reopen 26/41 ms; byte-exact) | closed |
| F-03-2 | unit paste-limits.test › exact incremental count; typing latency unchanged (`dev-perf-f032-*.log`) | closed |
| F-03-3 | `npm uninstall` (`dev-f033-uninstall.log`), check and build | closed |
| F-01-5 | renderer 2.60 MB to 1.16 MB (`final-build.log`) | closed |
| F-01-6, F04-A3 | unit app-identity.test; packaged E2E reads the fuse wire (Windows, WSL); installed .deb has `infinity-notes.desktop` with `StartupWMClass=infinity-notes`; electron-builder no longer warns | closed |
| INF-PERF-01..05 | e2e perf.spec (Windows dev and packaged, WSLg dev and packaged), editor-memory.spec, stickies.spec reopen cycles | done |
| INF-PKG-01, 03, 04 (Windows) | `final-package-current.log`, `final-test-e2e-packaged.log`, `final-verify-install-win.log` (12/12) | done |
| INF-PKG-02, 03, 04 (Linux) | `wsl-package-linux.log`, `wsl-test-e2e-packaged.log`, `wsl-deb-*.log`, `wsl-appimage-*.log` | done |
| INF-PKG-05, 06 | docs/NATIVE_OS_MATRIX.md, FINAL_REPORT.md, RELEASE_CHECKLIST.md, USER_GUIDE.md, README.md | done |
| INF-SEC-02 | fuses on both built binaries, sandbox in packaged and installed builds, negative control | done |
| INF-SEC-03 | `audit-prod.log` (0), `audit-all.log` (8 moderate, build-time only), `licenses.log` | done |
| Native rows FND-11, SHELL-06, KEY-05, STKY-02/06/12, DESK-02/03, REM-07, SCHED-05, WIDG-02, A11Y-06 | automated parts pass on Windows and WSLg. Real-input native cases passed on 2026-10-09: Windows M1-M6, M10, M13 and WSLg move/resize (NATIVE_OS_MATRIX sections 2a and 3a). Still not_run: M7 (SCHED-05), M9 (DESK-03), M11 (A11Y-06) and M12 (STKY-06 second monitor) | partly not_run |
| Native rows FND-02, STKY-13, REM-06 | a real second process on Windows and WSLg; the WSLg pin fallback; Windows reports the toast shown | done |

## Commands and results

| Step | Command | Log | Result |
| --- | --- | --- | --- |
| A08-F1 reproduction | e2e immediate Enter, `--repeat-each 8` (temporary spec, removed) | dev-a08f1-repro-1..2.log | 8/8 failed on the old code; the focus moved one frame later |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/a11y-keyboard.spec.ts -g "A08-F1\|primary flows" --repeat-each 4` | dev-a08f1-1.log | 8/8 |
| Perf spec | `node tools/run-e2e.mjs tests/e2e/perf.spec.ts` | dev-perf-1..2.log | 1: the Reminders view opens on Today, and images load lazily (test fixes: open Upcoming, measure the images in view); 2: pass |
| F-03-2 comparison | perf spec image-heavy with the old and the new doc-limits | dev-perf-f032-before/after.log | p95 27.0 / 26.9 ms |
| Windows package and packaged E2E (dev) | `npm run package:current`, `npm run test:e2e:packaged` | dev-package-win-1.log, dev-test-e2e-packaged-win-1.log | pass, 7/7 |
| Install check (dev) | `npm run verify:install:win` | dev-verify-install-win-1..2.log | 1: pass, but its mtime check was vacuous and was replaced by a marker the update must remove; 2: 12/12 |
| WSL | `.infinity-work/wsl-leg-p09.sh wsl env sync ci check wslg package packaged negative appimage install-create install-verify desktop`, plus `dpkg -i/-r/-P` as root | wsl-*.log | NATIVE_OS_MATRIX section 3. WSLg E2E: 221 passed, 1 failed (global-shortcut spec capability; fixed, settings.spec 8/8), 2 skipped |
| Final Windows check | `npm run check` | final-check.log | EXIT=0: unit 91 files / 658, integration 48 files / 418 + 1 skipped, traceability fails=0 |
| Final Windows build | `npm run build` | final-build.log | EXIT=0 |
| Final Windows E2E | `INFINITY_E2E_NODE=…\node-v24.21.0-win-x64\node.exe npm run test:e2e` | final-test-e2e.log | EXIT=0: 223 passed, 1 skipped (Linux-only), 8.4 min |
| Final Windows package | `npm run package:current`; Authenticode check | final-package-current.log, final-signature.log | EXIT=0; 119,429,011 bytes, SHA-256 8f3ddf79…a18a, NotSigned |
| Final packaged E2E | `npm run test:e2e:packaged` | final-test-e2e-packaged.log | EXIT=0: 7 passed |
| Final install check | `npm run verify:install:win` | final-verify-install-win.log | EXIT=0: 12/12 steps; host clean |
| Final WSL check | sync and `npm run check` in the mirror | wsl-final-sync.log, wsl-final-check.log | MIRROR_IDENTICAL; EXIT=0 (unit 658, integration 419, fails=0) |
| Memory probe | eight sticky/widget cycles (outside the suite) | probe-window-memory-win.log | no per-cycle growth |

No Electron or Infinity Notes process was left on either host (`final-verify-install-win.log` host-clean, `wsl-cleanup.log`). No installed copy remains: Windows was uninstalled and the .deb purged. The synthetic data folders were removed. After the final gates only documentation changed (this report, FINAL_REPORT, NATIVE_OS_MATRIX, RELEASE_CHECKLIST); traceability was re-run afterwards (`final-traceability-after-docs.log`).

## Issues found and fixed during the phase

- WSLg: `settings.spec` › global quick-sticky shortcut (Phase 08) failed on Linux. Severity low (test only). Reproduction: run it under WSLg, where the capability is `unsupported` (D-099) and the switch is disabled. Expected: the test exercises the registration; actual: it depended on Windows reporting the capability supported. Fix: the test sets `globalShortcut: 'supported'` through the existing test seam; the unsupported desktop keeps its own test. Verified: `wsl-test-e2e-wslg-settings-rerun.log` 8/8, `final-test-e2e.log`.
- `integration/handoff.test.ts` › refuses … a file replaced by a link (Phase 07) failed once in the first final check with `EEXIST`. Severity low (intermittent test). Cause: it planted the outside-pointing junction at the fixed shard `attachments/cd`, which already exists whenever one of the test's randomly named attachments falls into that shard (about 1 run in 85). Fix: the test picks a hex shard no stored attachment uses (the schema only allows hex shards); the junction and its rejection are unchanged. Verified: 5 consecutive runs pass, then the re-run final gate.
- After the first final gate, an `EditorHandle.current` getter used only by a unit test was removed (no behavior change); together with the hand-off fix this is why the final gate was run a second time. The `final-*.log` files are from that second run. On WSL, the check was re-run on the final tree (`wsl-final-check.log`); the WSLg E2E run and the Linux packages predate only these two changes (a test-only fix and the removal of an unused getter).

## Remaining OS-dependent cases (not run)

Updated after the native runs of 2026-10-09. M1-M6, M10 and M13 passed on Windows 11 (NATIVE_OS_MATRIX section 2a), and user-driven move and resize passed under WSLg on the final .deb (section 3a). Still not run:

- Windows, required: sleep and wake (M7), real launch at login (M9), 125-200 % scaling (M11), and a second monitor and its removal (M12).
- Windows, recommended: live OS time-zone change (M8).
- WSLg: sleep and wake, which is covered by M7 with a WSLg instance running.
- GNOME Wayland and X11: outside_validation_scope.

Steps: docs/FINAL_REPORT.md section 8.

The final organizer (`node tools/finalize-docs.mjs --repo .`) was not run. The release is `ready_for_os_validation`, so the pack and the checkpoints stay in place.

## Repair 1 (native findings)

Input: the coordinator's native Windows GUI run (real pointer and keyboard, docs/NATIVE_OS_MATRIX.md section 2a) passed M1-M6, M10 and M13 and found N-D1 to N-D3. Fast mode: targeted tests, then one final Windows gate (`repair1-*.log`), and the WSL check plus the reminders spec under WSLg. Decision: D-101.

### Fixes

| ID | Severity | Reproduction, expected and actual | Fix | Regression and verification |
| --- | --- | --- | --- | --- |
| N-D1 | medium on development machines | Run the app unpackaged (`npm run dev`, E2E), then the installed app. Expected: the installed app's toasts say "Infinity Notes" and a click opens the note. Actual: Electron's development `Electron.lnk` carried the production AUMID, so the toasts showed as "Electron" and a click launched `electron.exe` | `windowsNotificationIdentity(isPackaged)`: packaged builds keep `com.infinitynotes.desktop`; unpackaged runs use `com.infinitynotes.desktop.dev` and their own pinned activator CLSID; main sets both before any window | `unit/app-identity.test` (selection for both modes, main wiring); `repair1-check.log`. M1/M2 had passed natively before the fix (stale shortcut moved aside); packaged identity unchanged. Stale `Electron.lnk` not deleted; manual removal documented (RELEASE_CHECKLIST section 6, USER_GUIDE section 4) |
| N-D2 | low (display) | (a) Caret at the end of an anchored paragraph, End, Enter, type: the chip appeared in the new paragraph. (b) Attach file right after an anchored paragraph: its chip disappeared. Expected: chips stay on the anchored block (the stored anchor was right) | Chip decorations of every block a change touches are rebuilt from the block IDs; the others are mapped (`reminder-chips.ts`) | `unit/renderer/editor/reminder-chips.test` › N-D2 a, N-D2 b, edits elsewhere and deleting the block (a and b fail on the old code); `e2e/reminders.spec` › chips stay on their anchored paragraphs (old code: chip inside the new paragraph, `repair1-dev-chips-e2e-oldcode.log`; new code 6/6 repeated, `repair1-dev-chips-e2e-3.log`; Windows and WSLg suites) |
| N-D3 | low (uninstall leftover) | Install, show a toast, uninstall. Expected: the app's activator registration is removed. Actual: `HKCU\Software\Classes\CLSID\{16B1084D-…}\LocalServer32` remained; Electron also registered a new random CLSID per run (three keys point at `release\win-unpacked`) | Packaged builds pin `{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}`; `resources/installer.nsh` (`nsis.include`, `customUnInstall`) deletes exactly that key, not on update | `unit/app-identity.test` (the include deletes only that key, guarded by `isUpdated`); `verify:install:win` shows a real notification from the installed exe, then asserts `toast-activator-registered` and `uninstall-removes-toast-activator`; a registration that existed before the run is exported and restored (`repair1-dev-verify-install-1..2.log`, `repair1-verify-install-win.log` 15/15) |

The first install-check run (`repair1-dev-verify-install-1.log`) showed that Electron registers the activator only when a notification is first shown, not at startup. The installed-build spec now shows one real notification from the installed executable; it asserts the `show` event on Windows.

A first attempt of the N-D2 E2E failed 5 of 6 runs with the text order wrong (`repair1-dev-chips-e2e-2.log`). Debugging (`repair1-dev-debug-caret.log`) showed that the DOM caret was right but ProseMirror had not yet read it: it updates its selection on the asynchronous `selectionchange` event, and Enter came immediately after End. The test now waits until the editor's own selection is at the end of the paragraph, as a person's typing would. No assertion was relaxed.

### Files (Repair 1)

- Source: `src/shared/app-identity.ts` (`windowsNotificationIdentity`, pinned CLSIDs), `src/main/index.ts`, `src/renderer/editor/reminder-chips.ts`.
- Packaging: `resources/installer.nsh` (new), `electron-builder.json` (`nsis.include`).
- Tools and tests: `tools/verify-windows-install.mjs` (activator checks, backup and restore of a previous registration), `tests/install/installed.spec.ts` (one real notification), `tests/unit/app-identity.test.ts`, `tests/unit/renderer/editor/reminder-chips.test.ts`, `tests/e2e/reminders.spec.ts`.
- Docs: `docs/DECISIONS.md` (D-101), `docs/NATIVE_OS_MATRIX.md` (2a fixed-verification, N-D3 row), `docs/FINAL_REPORT.md` (4a, gates, artifact), `docs/RELEASE_CHECKLIST.md` (section 6, Repair 1 logs), `docs/USER_GUIDE.md` (development-machine note), this section.

### Commands and results (Repair 1)

| Step | Command | Log | Result |
| --- | --- | --- | --- |
| Targeted unit | `npx vitest run --project unit tests/unit/app-identity.test.ts tests/unit/renderer/editor/reminder-chips.test.ts` | console | 12/12 and 8/8; the chip regressions fail on the old code (2 failed) |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/reminders.spec.ts -g "N-D2"` | repair1-dev-chips-e2e-1..3.log, -oldcode.log | 1: pass; old code: fail; 2: caret timing in the test (see above); 3: 6/6 |
| Targeted install check | `npm run package:current`; `npm run verify:install:win` | repair1-dev-package.log, repair1-dev-verify-install-1..2.log | 1: the activator is registered only on a notification; 2: 15/15 |
| Final Windows check | `npm run check` | repair1-check.log | EXIT=0: unit 91 files / 663, integration 48 files / 418 + 1 skipped, traceability fails=0 (a first attempt failed typecheck: attachment kind `file` in the new unit test, corrected to `document`) |
| Final Windows build | `npm run build` | repair1-build.log | EXIT=0 |
| Final Windows E2E | `INFINITY_E2E_NODE=…\node-v24.21.0-win-x64\node.exe npm run test:e2e` | repair1-test-e2e.log | EXIT=0: 224 passed, 1 skipped (Linux-only), 8.5 min |
| Final Windows package | `npm run package:current`; Authenticode check | repair1-package-current.log, repair1-signature.log | EXIT=0; 119,429,467 bytes, SHA-256 5886137c…323c, NotSigned |
| Final packaged E2E | `npm run test:e2e:packaged` | repair1-test-e2e-packaged.log | EXIT=0: 7 passed |
| Final install check | `npm run verify:install:win` | repair1-verify-install-win.log | EXIT=0: 15/15 steps; host clean |
| WSL | re-sync, `npm run check`, `npm run test:e2e -- tests/e2e/reminders.spec.ts` under WSLg | wsl-repair1-sync.log, wsl-repair1-check.log, wsl-repair1-test-e2e-reminders.log | MIRROR_IDENTICAL; check EXIT=0 (unit 663, integration 419); reminders.spec 12/12 incl. N-D2; no Electron process left |

Host state: no Infinity Notes or Electron process is running, and no installed copy or login item remains. The user's `Electron.lnk` and the older random development activator keys are untouched (`repair1-activator-keys-after.log`). The pinned activator key now points at `release\win-unpacked\Infinity Notes.exe`, written by the packaged E2E's own notification; NATIVE_OS_MATRIX 2a records this. The Linux packages were not rebuilt. The repair changes renderer and main code that the Linux packages also contain, but the Windows-only identity code does not run on Linux, and the N-D2 change was verified under WSLg with the dev build.

## Final Linux rebuild and WSLg real-pointer run (release operator, 2026-10-09)

The release operator (Opus) ran this step and changed no source, tests or tools.

- **Linux rebuild from the final tree.** `.infinity-work/wsl-leg-p09.sh final2-wsl env sync ci package packaged desktop install-create install-verify appimage`, with `dpkg -i`, `dpkg -r` and `dpkg -P` run as root. Result: MIRROR_IDENTICAL, `npm ci` EXIT=0, package EXIT=0, packaged E2E 7 passed. The .deb was installed, launched as `infinity` (note created) and relaunched (data found, `mode=user-namespace`), and the AppImage was launched and relaunched. New artifacts: .deb 107,874,876 bytes, SHA-256 `b52aa1d3…ecbf4`; AppImage 135,650,991 bytes, SHA-256 `99906412…7b04`. Logs: `final2-wsl-*.log`.
- **WSLg move and resize with real pointer input** on the installed final .deb: pass, with sizes restored and positions compositor-controlled (the documented fallback). Observation N-O2: a sticky's title field is not a drag region. Evidence: `.infinity-work/logs/phase-09/native-wslg/`; NATIVE_OS_MATRIX section 3a.
- **Docs:** acceptance issues I-1 to I-5 are fixed. RELEASE_CHECKLIST sections 1-3 and 5. FINAL_REPORT status, section 2 (exactly what ran on which tree), measurements (WSLg packaged column from the final packages), section 5 artifacts, section 7 and section 8 (remaining steps). NATIVE_OS_MATRIX section 3 and the new section 3a. This report. README. BACKLOG INF-STKY-02, INF-STKY-06, INF-WIDG-02, INF-PKG-02 and INF-PKG-03.
- **Not re-run on the final tree:** the full WSLg E2E suite (last run at 16:12) and the sandbox negative control (16:24).
- **Host state:** the package is purged, the temporary profiles are removed, and no Infinity Notes or Electron process remains in WSL or on Windows.

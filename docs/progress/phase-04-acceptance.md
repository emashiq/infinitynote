# Phase 04 acceptance: Real floating sticky windows

Acceptor: infinity-acceptor (Opus 5.5, high), 2026-10-09. Windows host: Windows 11 Pro 10.0.26300, Node 24.15 (tools); the Playwright runner and workers use Node 24.21.0 through `INFINITY_E2E_NODE`; Electron 44.7.0. WSL host: Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, WSLg 1.0.73 (Weston 2318feca…), observed `ozone=x11` (XWayland), no StatusNotifier host. WSLg and Xvfb results are not GNOME or X11 desktop results.

Scope reviewed: the working tree on top of the Phase 03 commit 3e1d357 (80 modified files plus the new Phase 04 sources and tests). I read the phase file, the pack TEST_MATRIX rows for floating stickies and the native matrix, `docs/plans/phase-04.md` (section 12.1 per-ID assertions), `docs/progress/phase-04.md` including Repair 1, `docs/progress/phase-04-qa.md` (initial FAIL with QA-1 and QA-2, re-QA PASS, new low item QA2-X1), D-062 to D-072, UX_SPEC sections 6 and 10, the BACKLOG Phase 04 rows and the code (`git diff HEAD` and the new files).

Process note: the progress report names the implementer as `infinity-code-opus` (Opus 5.5, high). The CLAUDE.md role table lists a Sonnet medium implementer. Phase 03 used the same coordinator choice. This does not affect the functional gates and is recorded only for traceability.

## Decision: ACCEPTED

All functional local gates for Phase 04 pass on the current tree, and every gate postdates the last source change. Each acceptance criterion in `phases/04-real-floating-sticky-windows.md` is covered by a real Electron E2E case that checks native windows and reads the SQLite database directly. The QA defects QA-1 (medium, data loss) and QA-2 (low) are fixed. They have regression tests at unit, integration and E2E level, and fresh QA verified them by behavior on Windows and WSLg. QA2-X1 is test-hook-only, and my probe shows the mechanism (below). The Linux packaging evidence that predated Repair 1 has been replaced by my own run on the current tree. No placeholders, no disabled or weakened tests, no retries. Pending native cases are listed below and are not counted as passes.

## Evidence read or run

| Item | Source | Result |
| --- | --- | --- |
| Coordinator check: lint, typecheck, 445 unit, 243 integration + 1 skip (Windows file symlink), traceability ids=187 fails=0 | `.infinity-work/logs/phase-04/coordinator2-check.log` | exit 0 |
| Coordinator build | `coordinator2-build.log` | exit 0 |
| Coordinator Windows E2E: 149 passed, 1 Linux-only skip (not counted as a pass) | `coordinator2-test-e2e.log` | exit 0 |
| Gates postdate source | newest `src` file 04:25 (`src/renderer/stickies/StickyView.tsx`); `out/main/index.js` 05:22; `find src tests -newer out/main/index.js` returns nothing; repair1 gates 04:59 to 05:17, coordinator2 gates 05:21 to 05:27 | verified |
| Implementer Repair 1, Windows: check, build, E2E 149 + 1 skip, `package:current` (NSIS sha256 `8532d4e5…5e2b`), packaged E2E 3 passed (sticky renderer `sandboxed=true integrity=untrusted`), dependencies unchanged | `repair1-win-*.log`, `repair1-deps-unchanged.log` | all exit 0 |
| Implementer Repair 1, WSL: `MIRROR_IDENTICAL`, check 445/244, build, WSLg E2E 148 passed, Xvfb E2E 148 passed (2 Windows-only tray skips each) | `repair1-wsl-*.log` | all exit 0 |
| QA initial (FAIL) and re-QA (PASS): 22 earlier QA cases on Windows, 21 + 1 Windows-only skip on WSLg, plus the new QA2-01 to QA2-05 | `docs/progress/phase-04-qa.md`, `qa2-all-win.log`, `qa2-wslg.log`, `qa2-repair-win.log`, `qa2-repair-qa01-repeat.log` | read |
| **Acceptor run**: `npm run check` | `accept-check.log` | exit 0 (445 unit; 243 integration + 1 skip; traceability fails=0) |
| **Acceptor run**: `save-failure.spec`, `stickies.spec`, `lifecycle.spec` on Windows | `accept-e2e-sticky-subset-win.log` | exit 0, 28 passed |
| **Acceptor run**: Linux packaging and packaged E2E on the post-repair tree (user `infinity`, `~/infinity-notes`, rsync + `diff -rq` gave `MIRROR_IDENTICAL` at 05:45) | `accept-env.log`, `accept-sync.log`, `accept-package-linux.log`, `accept-test-e2e-packaged.log` | all exit 0. `.deb` sha256 `e37cd716…5550`, AppImage sha256 `d850e0cb…05b`. Packaged E2E 3 passed, including the packaged sticky case (`ownUserNamespace=true ownPidNamespace=true Seccomp=2` for the main and the sticky renderer). `electron left: 0`. |
| **Acceptor probe** for QA2-X1 | `.infinity-work/qa/p04-accept-busy.spec.ts`; `accept-busy-probe-win.log`, `accept-busy-probe-fail-win.log` | details below |
| Test integrity | `git diff HEAD -- tests`. Assertions removed only where Phase 04 changed the behavior, and each was replaced: the tab sticky icon became an assertion on the sticky window with no tab (D-069); schema 3 became 4; `getAllWindows()[0]` became URL-based selection (D-064); the flush-coordinator and `app:flushed` shapes gained `unsaved`/`saved` (D-072); boundary guards moved to Phase 05 names; the screenshot size floor is a parameter (lower only for the small sticky shots). The only new `test.skip` calls are the two Windows-only tray cases with reasons. No `.only`, no `fixme`, no retries. | verified |
| Leftover processes | `tasklist` on Windows after my runs; `pgrep` in WSL | 0 and 0 |

## Acceptance criteria (phase file) and where they are proven

| Criterion | Proof (test bodies read) |
| --- | --- |
| Two independent stickies outside the main window, move/resize and edit | `stickies.spec` › two stickies are independent windows: different renderer OS PIDs and native handles; A1/B1 isolated in the DB; A's bounds set outside the main window, and `getBounds()` is exact and does not intersect it on Windows and Xvfb; B unchanged; stored size (x/y null where positioning is unsupported). User-dragged move/resize is pending (Phase 09). |
| Each maps to its original note | `stickies.spec` › float opens one native window for the same note id: URL `#/sticky/<id>`, one entry, title and text, `sticky_enabled=1`, revision unchanged, activation 4 after three more Floats, no second window; NOT_FOUND / VALIDATION_FAILED / trashed create nothing. Role allowlist and note ownership: `security.spec` › sticky windows are hardened, `integration/ipc-validation`; QA-10 and QA2-05 (the registry wins over the URL). |
| Switching control cannot lose acknowledged text | `stickies.spec` › edit control moves between tab and sticky without losing text (revisions 1 < 2 < 3 < 4, drafts 0 on every host); › a mirror becomes editable when the editing sticky closes; QA-02 and QA-03 (type then Float, Dock, Hide, close or take; read-only views never save). |
| Hide/reopen/dock preserve content | `stickies.spec` › close hides; delete is separate; › Ctrl+W hides once the key is released; › dock preserves content and edit control (also with the main window closed to background). With failing saves: `save-failure.spec` (window kept with the notice, DB unchanged, no tab, flag kept; closes after recovery with the text stored). |
| Project membership remains visible | `stickies.spec` › header controls: badge "Common" becomes "Alpha › Plans" after a move, without reopening; › stickies page (paths and dots in both scopes). |
| App/tray/quit behavior is distinct | `lifecycle.spec` › main window to background keeps stickies usable; › quit flushes every window (`requested=3 acked=3 timedOut=0`, all texts stored, rows `open=1`); › quit from the tray (Windows); › first close asks, choice remembered and editable; › relaunch path named where no tray exists; › tray menu (Windows); › without a tray host a second launch brings the window back. `save-failure.spec` › Quit is canceled once while a window cannot save; › Quit waits for a save that succeeds after retries; › background close keeps the main window open while its note cannot be saved. |
| Current native environment verified; Windows/Wayland/X11 cases logged | Progress report sections 2 and 8: Windows capabilities supported; WSLg positioning and pin unsupported, no tray (`(false,)`), frame offset logged. Forced Wayland is informational (D-050). GNOME/X11 are outside the user-selected scope. |

All 15 Phase 04 BACKLOG rows have an E2E, integration or unit case that matches plan 12.1. INF-STKY-02, 06, 12, 13 and INF-DESK-02 stay `in_progress` only for their native (N) parts. Traceability fails=0.

## Decisions requested by the coordinator

### QA2-X1: the `windows()` test hook throws "This database connection is busy executing a query"

Verdict: test-harness only. It is not a re-entrancy hazard that product code can reach. Evidence:

- `accept-busy-probe-win.log`: 40 float/type/close cycles with tight polling of the hook (211 polls) gave 0 errors.
- `accept-busy-probe-fail-win.log`: 25 cycles in the QA2-01 shape (saves fail, close kept open, recovery, close) with tight polling (127 polls) gave 3 errors. The probe captured the full JS stack of each error (`Error.stackTraceLimit = 200`). Each stack has the same shape:
  `state.windows → StickyService.state → WindowStateRepo.get → Database.prepare` (the hook, run by Playwright's `UtilityScript.evaluate`). Below it, on the same stack, sits the interrupted product frame: `rowFactory (better-sqlite3/lib/database.js) ← Statement.get ← WindowStateRepo.get / HierarchyRepo.getNoteMeta ← StickyService.state / patch ← StickyManager.saveBounds ← hideEntry`.
- Mechanism. better-sqlite3 13 builds result rows with a JavaScript `rowFactory` function. It calls that function from native code while the statement is executing, so the connection's `busy` flag is set. Playwright's `electronApplication.evaluate` goes through the Node inspector. Node dispatches inspector messages with a V8 interrupt (`RequestInterrupt`), and that interrupt can run at the entry of any JavaScript function, including `rowFactory`. So the hook ran inside one synchronous `stmt.get()` of `hideEntry → saveBounds` and found the connection busy.
- Product reachability. Main has no other way to run JavaScript inside a statement. No `.iterate()`, user-defined functions, aggregates, virtual tables or `verbose` logger exist in `src/main` (checked). Transactions are plain better-sqlite3 transactions, and `busy` is not set while their callback runs. `onTreeChanged` (which destroys purged stickies) runs after the commit. Electron events and IPC are separate tasks. The product code on that stack is synchronous and correct; only the debugger-injected evaluate re-entered it. The packaged app has the hooks removed (`packaged.spec`). Electron fuses that disable the inspector in packaged builds are already tracked as INF-SEC-02 (Phase 09).
- Consequence: this is a flake risk for E2E code that calls `stickyNoteIds`/`windowsOf` directly (outside `expect.poll`) while a window closes. Follow-up F04-A2 below.

### D-072 behavior changes

- Flush wait 5000 ms per window (`SAVE_RETRIES × SAVE_RETRY_DELAY_MS + 2000`). This is consistent with PRODUCT_PLAN and honest. Flushes run in parallel (`Promise.all` in `FlushCoordinator.flush`), so a quit with many windows still waits at most about 5 s. A hung renderer cannot block quitting (QA2-04: exit after about 5.6 s). A session end never waits (QA2-03: about 130 ms). The previous 2 s bound cut off saves that would have succeeded on a retry (QA-1).
- Closing hides the window only after the renderer answers `saved`. Otherwise the window stays open and shows "Could not save this note. The window stays open." This matches PRODUCT_PLAN ("Closing a sticky hides its window") in the normal case, matches D-055 and the tab behavior, and never destroys unsaved text silently.
- Quit, cancel once. The first explicit Quit that finds unsaved text is canceled, and the affected window shows "Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it." A repeated Quit exits. This is honest: the copy names the consequence, and it preserves the PRODUCT_PLAN rule that explicit Quit flushes and exits all windows. The escape hatch is needed because storage can fail persistently. One gap remains: `quitCanceled` in `src/main/window-lifecycle.ts` is never reset. After one canceled Quit, any later Quit in the same run, even hours later after saving recovered and failed again, exits without the warning and loses that window's text. This needs two separate storage faults in one session, so it does not block this phase. It is follow-up F04-A1.

### Linux packaging evidence after Repair 1

Required and done. `final-wsl-package-linux.log` (03:41) predated the Repair 1 source changes (latest 04:25), and Repair 1 changed packaged main, preload and renderer code. I re-ran `npm run package:linux` and `npm run test:e2e:packaged` in WSL as user `infinity` (not root) from an exact mirror (`MIRROR_IDENTICAL`). All exit 0, 3 packaged cases passed (`accept-*.log`). The Windows packaged evidence (`repair1-win-package-current.log`, `repair1-win-test-e2e-packaged.log`, 05:05) already postdated the last source change.

### Code quality

Main is cleanly layered:
- `StickyManager` and `MainWindowController` are Electron-free and tested with fakes.
- `sticky-window.ts` and `main-window.ts` are thin factories that share `secureWebPreferences` and `trackWindow`.
- Display clamping is a pure function.
- The test hooks and the inspector are confined to unpackaged E2E runs.

In the renderer, the sticky and the main window share `core-services`, `NoteController` and `textIsSafe`, so close and flush rules are not duplicated. Comments are accurate, and IPC stays narrow: 9 invoke channels, 2 events, a role allowlist and note ownership. No dependency changes. The only quality items are the follow-ups below.

## Follow-ups (assigned)

| ID | Severity | Phase | Item |
| --- | --- | --- | --- |
| F04-A1 | Low (data loss on a double fault) | 05 (quit and tray work) | `createWindowLifecycle` never resets `quitCanceled`. Arm the "quit again to discard" escape only for the next Quit after a canceled one. For example, reset it when a later quit flush reports every window saved, or when a later save succeeds in the window that could not save, or limit it to a short interval. Add a unit regression to `window-lifecycle.test`: cancel, recovered state, a new failure, Quit is canceled again. Update D-072 wording to match. |
| F04-A2 | Low (test flake) | 05 | Make the hooks that read the DB safe against Playwright evaluate interrupts. For example, `windows()` resolves its snapshot on a fresh macrotask (`setImmediate`), or helpers call it only through `expect.poll`. Add a note to the harness. Root cause and stacks: `accept-busy-probe-fail-win.log`. |
| F04-A3 | Low (packaging) | 09 | electron-builder warns that `desktopName` is not set (Linux window association with the `.desktop` entry, WM_CLASS). Decide `desktopName` and `linux.syncDesktopName` with the Linux install checks (`accept-package-linux.log`). |
| (existing) | | 09 | INF-SEC-02 fuses review (includes disabling inspector arguments in packaged builds, related to QA2-X1). |

## Pending native cases (not run, not claimed)

- Windows 11: user-dragged move/resize of two stickies, real always-on-top over other applications, tray icon click and menu from the notification area, restored positions on a second physical monitor and monitor removal (Phase 09 matrix).
- WSLg (Weston, XWayland): user-dragged move/resize, compositor behavior with pinned and collapsed windows, real pointer input on the sticky header (QA-06 was Windows-only by design).
- Forced Wayland run: informational only (D-050).
- `outside_validation_scope` (user decision, CLAUDE.md): GNOME Wayland pin and positioning, X11 restored bounds and always-on-top, a StatusNotifier tray on GNOME.

## Evidence files

- `.infinity-work/logs/phase-04/coordinator2-{check,build,test-e2e}.log`, `repair1-*.log`, `qa*.log`, `qa2-*.log`
- `.infinity-work/logs/phase-04/accept-check.log`, `accept-e2e-sticky-subset-win.log`, `accept-env.log`, `accept-sync.log`, `accept-package-linux.log`, `accept-test-e2e-packaged.log`, `accept-busy-probe-win.log`, `accept-busy-probe-fail-win.log`
- Probe source: `.infinity-work/qa/p04-accept-busy.spec.ts`

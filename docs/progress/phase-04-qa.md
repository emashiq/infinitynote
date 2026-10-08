# Phase 04 QA: Real floating sticky windows

Reviewer: infinity-qa (fresh Sonnet 5.5, medium), 2026-10-09. Scope: the working tree on top of Phase 03 commit 3e1d357 (uncommitted Phase 04 changes). No application source, test or tool was edited. QA specs: `.infinity-work/qa/p04-*.spec.ts` with `.infinity-work/qa/p04.config.ts` and `.infinity-work/qa/wsl-p04-qa.sh`. Logs: `.infinity-work/logs/phase-04/qa-*.log`.

## Verdict: FAIL (1 actionable Medium defect; everything else passed)

The implementation holds up under adversarial multi-window use: one window per note under concurrent Float, no listener growth, no lost text when typing is followed immediately by Float, Dock, Hide, OS close, Quit or Take Edit Control, read-only views never save, trash/restore/purge across three views, persistence across relaunch, the role allowlist and note ownership, oversized payloads, navigation, crash recovery and display recovery. One real data-loss path remains: a sticky is destroyed by Hide, Open in app, Remove and the OS close even when its last save failed or timed out, which breaks the Phase 03 rule D-055 that the tab behavior follows (QA-1).

## Inputs checked

- `.infinity-work/logs/phase-04/coordinator-check.log` (lint, typecheck, 441 unit, 239 integration + 1 skip, traceability ids=187 fails=0, exit 0), `coordinator-build.log` (exit 0), `coordinator-test-e2e.log` (143 passed, 1 skipped Linux-only case; the skip is not counted as a pass). `out/main/index.js` is newer than every file under `src/`, so my runs used the current build.
- Implementer `final-*.log` (WSLg 142, Xvfb 142, packaged on both OSes) were read, not re-run.
- `docs/BACKLOG.md`: intact. `git diff HEAD --numstat` shows 20 added and 20 removed lines in one file of 299 lines (HEAD and now), three hunks: the 17 Phase 04 requirement rows plus INF-FND-03 and INF-FND-04 (status and test cells only), the two W04 work items, and the W05-03 line (adds the tray item "Show widget"). No other row or section changed; traceability passes.
- No `test.fixme`, `.only` or disabled gate was added; the only `test.skip` calls are platform or packaged conditions with reasons.
- Header/drag regions: the sticky has the native OS frame and no `-webkit-app-region` anywhere (CSS rule scan returned 0), so controls cannot be swallowed by a drag region. Real mouse clicks on every header control and the editor worked on Windows (QA-06).

## Checks run by QA

All on Windows 11 (Playwright runner Node 24.21.0 portable, Electron 44.7.0) unless noted. Command prefix: `E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe node_modules/@playwright/test/cli.js test -c .infinity-work/qa/p04.config.ts <spec>`.

| ID | Case | Result | Notes |
| --- | --- | --- | --- |
| QA-01 | 6 concurrent `sticky.float` calls; 6 rounds of simultaneous float (main) and hide (sticky); 10 float/hide and 5 float/dock cycles | pass | exactly one `created:true`, one window, `window_state.open` always equals the number of windows; raw Electron counts (51 invoke handlers, webContents, app `before-quit`/`window-all-closed`/`second-instance`, screen display listeners, main window close/crash/loading listeners) identical before and after; test-hook listener counts equal baseline; 0 drafts |
| QA-02 | Type then Float immediately (4 rounds); type then Open in app immediately; type then Ctrl+W; type then `BrowserWindow.close()`; Float again | pass | every typed token (`seed|t0|s0|...|w|c`) is in the DB and in the other view; tab becomes read-only mirror then editable; no lease banner after dock; 0 drafts |
| QA-03 | Programmatic edit (`insertContentAt`) into the read-only tab and then into the read-only sticky; sticky types then tab Takes control; 3 ping-pong rounds with typing in each holder | pass | read-only edits never saved (revision unchanged after 1.8 s), no drafts, no `ROGUE` text, previous writer's last keystrokes preserved at every transfer, final text exact |
| QA-04 | Trash from the main window while the sticky has unsaved text and a tab mirror; restore from the main window (`trash.restore`); trash again; purge | pass | sticky shows the trash state, one `conflict` draft holds "kept pending", note stays deleted 2.5 s later (no resurrecting save); restore returns the editor with stored text and typing saves; purge closes the window, removes the `window_state` row and drafts |
| QA-05 | Hide/reopen keeps text; color, resize 401x377, collapse, pin; relaunch with restore on; expand; restore off; Float from the page | pass | pink/collapsed/pinned restored, expanded size 401x377 returns; with the setting off nothing is restored and the Float keeps color and text. WSLg: same, pin is unsupported there |
| QA-06 | Real mouse clicks on color, collapse, expand, pin, title, editor, actions menu | pass (Windows only) | skipped on WSLg by design (no frame callbacks, D-050); not a WSLg pass |
| QA-10 | Sticky renderer calls 15 main-only channels, 21 channels naming another note, cross-note draft ids, 6 MB `note.save`/`rename`, 40 MB attachment, `window.open`, `location.href` to https and file, hash route spoofing | pass | all FORBIDDEN except own `note.open`/`window:getState`; other note's draft/version untouched; `drafts.resolve` with own note and B's draft id gives NOT_FOUND, restore with a held lease gives NOT_FOUND and A never receives B's text; oversized requests LIMIT_EXCEEDED; navigation and `window.open` blocked, no new window; changing the hash to another note id and reloading shows "This window could not be opened." (registry wins over URL) |
| QA-11 | `forcefullyCrashRenderer` on the sticky that holds the lease, with a tab mirror | pass | main window untouched, sticky reloads, text acked before the crash intact, editable again, lease released and re-taken (tab read-only again), edit saved, Hide works, 0 drafts |
| QA-12 | Display seam: stored bounds at (-30000,-30000) on removed display 99, 5000x4000, and malformed bounds; later the display shrinks | pass | placements all inside the 1280x680 work area and above the 220x120 minimum; native bounds match on Windows; after the display shrinks, a window whose top strip was no longer reachable moved inside; on WSLg only the app-computed placements are meaningful |
| QA-13 | Keep running, type in the sticky, two second launches in a row, then Quit via the close dialog with unsaved text in both windows; `app.quit()` with unsaved sticky text | pass | one main window, one sticky; `flush: requested=2 acked=2 timedOut=0`; all text saved; second quit also saved |
| QA-20 | Hostile HTML (script, onclick, onerror, javascript: link, iframe srcdoc, svg onload, remote img) pasted with Ctrl+V into a sticky | pass (Windows only) | `__pwned` stays 0, stored JSON has none of the dangerous constructs, remote image becomes a visible link as in the tab, `blockedRequests` empty. Not run on WSLg |
| QA-14, FS-* | Injected `note:save` INTERNAL failures, then Hide or Open in app right after typing; tab Ctrl+W as the control | **defect** | see QA-1 |
| WSLg | QA-01..QA-05, QA-10..QA-14 in `~/infinity-notes` (WSLg, ozone x11, Ubuntu 26.04.1, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0) | 10 passed, 1 skipped (QA-06), QA-14 shows the same loss | QA files were copied into `~/infinity-notes/.infinity-work/qa` (excluded from the mirror sync) and removed again; the source/tests/tools mirror is unchanged (the only `diff -rq` entry is `docs/progress/phase-04.md`, documentation edited after the implementer's last sync); 0 electron processes left on either host |

Not repeated (already passing in the controller logs and not in doubt): per-ID happy paths in `stickies.spec`/`lifecycle.spec`, tray menu, close dialog copy, packaged sandbox check, the Phase 03 stale/lease/crash cases.

## Issues

### QA-1 (Medium): Hide, Open in app, Remove and the OS close destroy a sticky after a failed or timed-out save

- Reproduce: `.infinity-work/qa/p04-probe-failsave.spec.ts` (and QA-14 in `p04-hardening.spec.ts`). Float a note, set `globalThis.__infinityTest.failSaves` (the existing hook for `INTERNAL` save failures) to 100, type " TYPED" in the sticky and choose Hide or Open in app.
- Expected: D-055 (`docs/DECISIONS.md` line 354): "A tab or the window is never closed after a failed flush unless main kept a draft (`CONFLICT`, `LEASE_REQUIRED`) or the note no longer exists". The tab control in the same probe behaves that way (Ctrl+W with failing saves keeps the tab open, `FS-tab: tabsOpen=2`). The sticky should stay open with its error state, or main should keep the text as a draft.
- Actual: the window is destroyed after the 2 s flush timeout, the text is gone, there is no draft and no notice. Windows `qa-probe-failsave-win.log`: `FS-dock: db="safe" drafts=0 tabEditorText="safe"`; `FS-hide fails=3: db="safe" drafts=0 ... flush: requested=1 acked=0 timedOut=1`. With 1 or 2 transient failures the text survives (`fails=1`, `fails=2`: `db="safe TYPED"`), but 3 transient failures (about 3 s of retries against a 2 s timeout) lose it. WSLg shows the same (`qa-wslg.log`, QA-14).
- Cause: `StickyManager.hideEntry` ignores the flush outcome (`sticky-manager.ts` lines 251-265), the renderer acknowledges `app:flush-request` in a `finally` regardless of the result (`sticky-services.ts` `bridge.app.flushed`), and `actions.dock`/`actions.remove` call `controller.flush()` and continue whatever it returns. Hide (`actions.hide`) does not flush in the renderer at all before calling main.
- Suggested repair (implementer decides): in the renderer, `hide`/`dock`/`remove` await `controller.flush()` and, when it fails without a kept draft, show the error notice and do not call main; for the OS close, make the ack carry the flush result so `hideEntry` can keep the window when the save failed. A regression E2E should use `failSaves` as above.
- Context: persistent save failures need a disk or database fault, so this is not a happy-path defect; quit has the same bounded wait for every window (D-055, stated limitation). The sticky is inconsistent with the tab, which is why it is reported.

### QA-2 (Low, informational): a sticky document can render the main shell after its hash is changed

- Reproduce: in a sticky renderer run `location.hash = '#/'; location.reload()`. The sticky window then shows the main shell (Home, rail). The IPC role is still `sticky`: `tree.list` and `session.get` answer FORBIDDEN and the main log shows `channel not allowed for role=sticky`. This needs a compromised or scripted renderer and gives no extra privilege, so it is not a defect; hardening would be to make the sticky bundle ignore non-sticky routes. Evidence: `qa-hardening-win.log` ("after '#/' reload").

## Pending native cases (not run, not claimed)

- Windows 11: user-dragged move/resize of two stickies, real always-on-top over other applications, tray icon clicks from the notification area, restored positions on a second physical monitor and monitor removal (Phase 09 matrix; the display seam above only exercises the app's computation).
- WSLg: user-dragged move/resize and compositor behavior with pinned/collapsed windows; real pointer input (QA-06 and the hostile-paste probe QA-20 were Windows only).
- Linux X11/GNOME and Wayland desktops: outside the user-selected validation scope (WSLg and Xvfb only, per CLAUDE.md); forced-Wayland run stays informational (D-050).
- Daylight saving, time zones and reminder duplication are not part of this phase.

## Evidence

- `.infinity-work/logs/phase-04/qa-multiwin-win.log` (6 passed), `qa-hardening-win.log` (5 passed), `qa-probe-failsave-win.log` (5 probes run, QA-1), `qa-paste-win.log` (1 passed), `qa-wslg.log` (10 passed, 1 skipped).
- QA specs: `.infinity-work/qa/p04-multiwin.spec.ts`, `p04-hardening.spec.ts`, `p04-probe-failsave.spec.ts`, `p04-paste.spec.ts`.

## Re-QA after Repair 1 (2026-10-09)

Verdict: PASS. QA-1 and QA-2 are fixed and verified by behavior, not only by the implementer's tests. Inputs read: "Repair 1" in `docs/progress/phase-04.md`, D-072, `coordinator2-check.log` (exit 0, traceability fails=0), `coordinator2-build.log` (exit 0), `coordinator2-test-e2e.log` (149 passed, 1 Linux-only skip, not counted as a pass). `out/` was newer than every source file when I ran.

The two old probes were rewritten to the new contract: P04-QA-14 and FS-dock now assert that the window stays open with "Could not save this note. The window stays open.", the database keeps the old text, Open in app opens no tab, and after saves recover (`failSaves = 0`) the same action closes/docks with the typed text stored and no draft. New spec `.infinity-work/qa/p04-repair.spec.ts`.

| ID | Case | Result | Evidence |
| --- | --- | --- | --- |
| QA-14 / FS-dock (updated) | failure, notice and window kept; recovery then Hide / Open in app succeeds, text in DB, tab opened only after recovery | pass (Windows, WSLg) | `qa2-all-win.log`, `qa2-wslg.log` |
| FS-hide 1, 2 and 3 transient failures | Hide right after typing | pass: `db="safe TYPED"`, `flush: ... timedOut=0 unsaved=0` (3 failures previously lost the text) | `qa2-all-win.log`, `qa2-wslg.log` |
| FS-tab | tab Ctrl+W with failing saves | pass, unchanged (tab stays open) | same |
| QA2-01 | OS close and Remove from stickies while saves fail: window and sticky flag kept, text still in the editor, DB unchanged; then saves work and OS close closes with the text stored, 0 drafts | pass (Windows, WSLg) | `qa2-all-win.log`: `flush ... unsaved=1`, `sticky: kept open (text not saved)`, then `unsaved=0` |
| QA2-02 | two stickies, one cannot save: first Quit is canceled (`quit: canceled, unsaved windows=1`), notice "did not quit. Quit again to quit without saving it." in that window, process alive, 3 windows; second Quit exits | pass (Windows, WSLg): the abandoned text is the only loss (`a-acked` / `b-acked+b2` kept) | `qa2-all-win.log`, `qa2-wslg.log` |
| QA2-03 | session end (`session-end` emitted) with failing saves, then quit | pass: exits in about 130 ms, no wait, no hang | `qa2-all-win.log` |
| QA2-04 | sticky renderer frozen in `for(;;){}` then Quit | pass: process exits after about 5.6 s (`flush: requested=2 acked=1 timedOut=1`), no forever block | `qa2-all-win.log` |
| QA2-05 | sticky hash set to `#/`, `#/sticky/<otherId>`, `#/settings`, `#/sticky/not-a-uuid` and reloaded; main window hash set to `#/sticky/<ownId>` and `#/sticky/<otherId>` | pass: each shows "This window could not be opened.", no `#app-shell`, no primary navigation, no sticky view, other note's text never in the DOM; main works again after restoring `#/` | `qa2-all-win.log`, `qa2-wslg.log` |
| Regression of all earlier p04 specs (multiwin, hardening, probe-failsave, paste) | full set | 22 passed on Windows (`qa2-all-win.log`); WSLg 21 passed, 1 skipped (QA-06, real mouse, Windows only) | `qa2-wslg.log` |

WSLg host: Ubuntu 26.04.1, WSLg ozone x11, Node 24.21.0. The mirror's source, tests and tools are unchanged by my run (QA files are copied into the mirror's excluded `.infinity-work/qa` and removed again; `diff -rq` lists only `docs/progress/phase-04.md`, documentation edited after the implementer's last sync). The paste probe (QA-20) ran on WSLg too this time.

Orphans: `tasklist` shows 0 electron processes on Windows after each run, and `pgrep -c electron` is 0 in WSL (`electron left: 0`), including after the cancel-then-quit, hung-renderer and session-end teardowns.

### QA2-X1 (Low, test hook only): `__infinityTest.windows()` can throw "This database connection is busy executing a query"

Observed in 1 of 5 and 1 of 8 repetitions of QA2-01, only in the poll that follows the recovery close (hide: flush, bounds save, set open = 0, destroy). The poll's next call succeeded and the close completed with the text stored, so no lasting state and no product code path calls the database from outside the main flow. It is a flake risk for specs that poll `stickyNoteIds` during a close (the implementer's suite polls the same hook; its runs passed). Not a product defect; the hook (`src/main/test-hooks.ts` `windows`) could catch and retry. My spec retries. Evidence: `qa2-repair-win.log`, `qa2-repair-qa01-repeat.log`.

### Still pending (unchanged)

Native Windows drag/resize, real always-on-top, tray clicks, second physical monitor and monitor removal; WSLg real pointer input; GNOME/X11 desktops (outside the user-selected scope); forced Wayland stays informational.

Evidence logs: `.infinity-work/logs/phase-04/qa2-all-win.log`, `qa2-wslg.log`, `qa2-repair-win.log`, `qa2-repair-qa01-repeat.log`.

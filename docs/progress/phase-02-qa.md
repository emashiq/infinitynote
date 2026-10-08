# Phase 02 QA: Home, projects, folders and tabs

Reviewer: infinity-qa (fresh Sonnet 5.5, medium), 2026-10-08. Windows 11, Node 24.15; Playwright worker Node 24.21.0 (`INFINITY_E2E_NODE`). No application source or test files were changed. QA-only specs live in `.infinity-work/qa/` (`p02.config.ts`, `p02-hierarchy.spec.ts`, `p02-ui.spec.ts`, `p02-stale.spec.ts`).

## Verdict: FAIL (one medium actionable defect, four low ones)

The data layer, tabs, trash, shortcuts, focus and drawers all behaved correctly under adversarial use. The single reason for failing is QA-P02-1: an open note keeps showing a stale title, path and Location after a rename or move done elsewhere. The coordinator gates were read and are green (check exit 0 with traceability fails=0, build exit 0, Windows E2E 70 passed, 1 Linux-only skipped).

## Checks

| # | Check | Command | Status | Evidence |
| - | --- | --- | --- | --- |
| 1 | Coordinator check, build, E2E logs read | read `coordinator-*.log` | passed (all exit 0) | `.infinity-work/logs/phase-02/coordinator-check.log`, `coordinator-build.log`, `coordinator-test-e2e.log` |
| 2 | 32-deep nesting, LIMIT_EXCEEDED at 33, same-name projects and sibling folders, subtree move that would exceed depth refused, deepest note after UI reload, palette path | `playwright test -c .infinity-work/qa/p02.config.ts p02-hierarchy` | passed | `.infinity-work/logs/phase-02/qa-hierarchy.log` |
| 3 | Cycle rejected (into self, child, grandchild, cross-project descendant) with DB unchanged; subtree moved A to Beta to Common to Alpha folder, every descendant folder and note (live and trashed, sticky) follows scope; trashed target refused; sticky moved to Common, project, folder; inconsistent project/folder refused; restart persists and text intact | same | passed | same |
| 4 | Trash and restore of subtrees: counts, nearest live ancestor with relocated, parent purged while child in an earlier batch, project purged with separately trashed folder (re-anchored to Common and restorable), double restore and purge without confirm refused, note restore after its folder moved scope, invariants after restart | same | passed | same |
| 5 | Type then Ctrl+W at once saves; type then Ctrl+Tab saves; type then quit the app at once (measured: saved); type then trash the parent folder from the tree then restore keeps the text; close does not delete notes; rename title then Ctrl+W saves | `playwright test ... p02-ui` and `p02-stale` | passed | `qa-ui.log`, `qa-ui-rerun.log`, `qa-stale.log` |
| 6 | 60 notes opened as 61 tabs, All tabs menu lists 61, 30 closed with Ctrl+W, reopen, relaunch restores 32 tabs and the active tab, typing after relaunch saves | same | passed | `qa-ui-rerun.log` |
| 7 | Shortcuts: Ctrl+W on Home keeps the window and tabs, Ctrl+Tab with one tab, Ctrl+N, Ctrl+Shift+N, Ctrl+N/W/Tab ignored inside a modal dialog, Ctrl+K and Escape return focus | same | passed | `qa-ui-rerun.log` |
| 8 | Home filter set to a project, project trashed, restart: no error banner, Home shows Common notes | same | passed | `qa-ui.log` |
| 9 | Keyboard-only tree: Home/End, ArrowLeft/Right parent and collapse, dialog cancel returns focus to row, confirmed trash leaves focus on a tree row (not body), F2 Escape keeps focus | same | passed | `qa-ui-rerun.log` |
| 10 | Narrow windows 760x560 and 720x480 (min size): no horizontal or vertical page overflow, tree drawer opens from the rail, Escape returns focus to the Notes rail button, Ctrl+\ and Ctrl+Shift+\ toggle, opening a note closes the drawer | same | passed | `qa-ui-rerun.log`, `.infinity-work/logs/phase-02/qa-narrow-760x560.png`, `qa-narrow-720x480.png` |
| 11 | Open note stays current after rename (tree F2), folder rename and move elsewhere | `playwright test ... p02-stale` | FAILED (QA-P02-1) | `qa-stale.log`, `qa-stale-path.png` |
| 12 | WSLg flake review: `home.spec` pin repeated 25 times (plus 25 runs of its neighbour) | `wsl -u infinity npx playwright test tests/e2e/home.spec.ts -g pin --repeat-each=25` | passed 50/50, flake not reproduced | `qa-wslg-pin-repeat.log` |
| 13 | Full E2E on WSLg (Wayland, WSLg Weston) from the WSL ext4 copy, sources identical to the Windows tree | `wsl -u infinity npx playwright test --grep-invert @packaged` | passed 71/71 (Linux-only case runs and passes) | `qa-wslg-full-e2e.log` |
| 14 | Screenshots compared with the FrameCapt reference | viewed `screens/win/1100x720-light-home.png`, `1100x720-light-note.png`, `760x560-light-tree-drawer.png`, `tab-overflow.png` | passed, no obvious defect (same rail, header search, tab strip, tokens and spacing language) | `.infinity-work/logs/phase-02/screens/win/` |

## Issues

### QA-P02-1 (medium): open note shows stale title, path and Location after changes elsewhere
- Repro: open note "Old title" in Alpha > Fold (window 1300x800 so the Details panel is docked). Rename it from the tree with F2 to "Tree renamed". Then rename the folder, and move the note to project Beta via the bridge (same `tree:changed` path as the Move dialog).
- Expected: the Title field, the header path under the title and the Info panel Location follow the current data.
- Actual: the tab label and the Info Title update, but the Title field keeps "Old title"; the header path and the Info Location keep "Alpha › Fold" after the folder rename and after the note was moved to Beta.
- Cause: `NoteController` takes `note.path` and `title` only at `open()` and updates only its own renames, and the NoteView title effect depends on `state.title`. It never reacts to `tree:changed`. `InfoSection` mixes live title with stale `note.path`.
- Risk: misleading location and a visible title that contradicts the tab; low data risk (a later title edit still writes the new value).
- Suggested fix for the implementer: derive path and title from the live tree snapshot (`tree.store` snapshot plus path index) or refresh the controller note on `tree:changed`; add a regression test for rename, folder rename and move of an open note.

### QA-P02-2 (low): save indicator says "Saved" for up to 400 ms after a keystroke
`setText` does not set `save: 'saving'` until the debounce fires, so `.save-status` reads "Saved" while an edit is pending (measured right after one keystroke). Truthfulness nit; set a pending state on `setText`.

### QA-P02-3 (low): empty title field for one render when a note opens
`NoteView` initialises the title with `useState(state.title)` while the controller is still loading, then fills it in an effect, so the input exists empty for one commit (QA read `''` right after open, and Playwright `fill` then produced "OrigRenamed quickly"). Practically unreachable by a human but a real ordering glitch; initialise the field when the controller becomes ready.

### QA-P02-4 (low): restore after the original parent was purged is silent
When a trashed folder's parent was purged, purge re-anchors the survivor, so `trash:restore` returns `relocated: false` and no "Restored to ..." notice is shown, although the original location no longer exists. Data is correct (lands in the nearest surviving ancestor). The plan wording ("no longer exists") suggests a notice; decide whether this is intended.

### QA-P02-5 (info): WSLg flake `home.spec > pin` (row not found after 30 s)
Not reproduced in 50 repeated WSLg runs (25 pin, 25 neighbour), nor in a full 71 test WSLg run, and no product race was found in `TreeStore.reload`, `createAppServices.init` or `Shell` ready handling (the `data-ready` flag is set only after settings, tree, session and Home load). The only plausible product-side contributor found: the layout mode is read once from `window.innerWidth` at service construction (`LayoutStore`), and a docked tree exists only at width >= 960; a transient narrow reading on a hidden WSLg surface would leave the tree in drawer mode (no `tree-note:` row in the DOM) until a `resize` event. Unproven. Cheap hardening: re-read the viewport width when `ready` resolves. The first-run failure happened in the same run as an XWayland "X connection error" crash, so an environmental cascade is the more likely cause.

## Observations (not defects)
- D-048 limitation measured: typing and quitting the app within the 400 ms debounce window saved the text on Windows (`pagehide` flush worked).
- Focus after creating a folder, confirming a trash and closing dialogs lands on the invoking tree row or rail button, never `body`.

## Pending native cases
- macOS is out of scope. Native Windows E2E and WSLg Linux E2E pass; GNOME/X11-only cases remain outside the user-selected scope. Packaged-build E2E was not re-run by QA (implementer logs `passC-win-test-e2e-packaged.log`).
- The QA-only specs were run on Windows only; the WSLg run used the repository suite.

## Skipped
- Windows E2E: 1 Linux-only case skipped (`smoke.spec` main.log ozone line); not counted as passed.

---

# Re-QA after Repair 1

Reviewer: infinity-qa (fresh Sonnet 5.5, medium), 2026-10-08. Windows 11, Node 24.15, Playwright worker Node 24.21.0 (`INFINITY_E2E_NODE`). No application source or repository tests were changed. New QA-only spec: `.infinity-work/qa/p02-stale2.spec.ts`.

## Verdict: PASS (one doc issue and two low observations, none blocking)

QA-P02-1 to QA-P02-4 are fixed in real application behavior. QA-P02-5 remains an environment flake with no product cause found. The coordinator logs after repair were read: check exit 0 (traceability fails=0), build exit 0, Windows E2E 75 passed and 1 Linux-only skipped, packaged build created, packaged E2E 2 passed.

## Checks

| # | Check | Command | Status | Evidence |
| - | --- | --- | --- | --- |
| 1 | Coordinator check, build, E2E, package and packaged E2E logs read | read `coordinator2-*.log` | passed (all exit 0; 1 Linux-only skip not counted as passed) | `.infinity-work/logs/phase-02/coordinator2-check.log`, `coordinator2-build.log`, `coordinator2-test-e2e.log`, `coordinator2-package-current.log`, `coordinator2-test-e2e-packaged.log` |
| 2 | Earlier stale repro now fixed: title field follows tree rename, header path and Info Location follow folder rename and note move to Beta; save label reads "Editing…" right after a keystroke; title before fill is "Orig" | `playwright test -c .infinity-work/qa/p02.config.ts p02-stale` | passed 3/3 | `qa2-stale.log` |
| 3 | Adversarial: external rename while typing in the title keeps the typed text and the final typed value wins (DB, tab, field); after blur a later external rename is followed; title never empty across 6 opens (MutationObserver) | `p02-stale2` | passed | `qa2-stale.log` |
| 4 | Two folder renames fired together; folder moved to Common: header and Info show "Common › Two"; relaunch shows the same path and title | `p02-stale2` | passed | `qa2-stale.log` |
| 5 | Editing…/Saved transitions: "Editing…" immediately after typing, then "Saved" | `p02-stale2`, `p02-stale` | passed | `qa2-stale.log` |
| 6 | Note trashed while open: tab closed with "1 tab was closed because its note is in Trash"; text saved before is preserved | `p02-stale2 -g "trashed while open"` | passed (see QA-P02-6) | `qa2-stale.log`, `qa2-trashed-open.log` |
| 7 | Purge of a trashed parent re-anchors the child: `trash_reanchored` has 1 row, survives relaunch, restore shows "Restored to Alpha because its original location is in Trash or no longer exists", row cleared | `p02-stale2` | passed | `qa2-stale.log` |
| 8 | Migration 003 on an existing v2 database: created a db with the app, dropped `trash_reanchored`, set `user_version=2`, relaunched: table created, `user_version`=3, project and note rows intact | `p02-stale2` | passed | `qa2-stale.log` |
| 9 | Migration failure path unchanged (failed upgrade screen with data untouched and one pre-migration copy, newer schema refused, unreadable db) | `playwright test tests/e2e/migration-failure.spec.ts` | passed 3/3 | `qa2-migration-failure.log` |
| 10 | Earlier hierarchy and UI QA specs re-run | `playwright test -c p02.config.ts p02-hierarchy p02-ui` | passed 13, 1 failed: `p02-ui.spec.ts:78` is the QA spec's own locator on the Details panel at the default window width where the panel is not docked. It failed identically before the repair (`qa-ui.log`), the assertions on header path and title before it passed, and the same behavior is covered at 1300x800 by check 2. Not a regression | `qa2-regress.log` |
| 11 | WSLg launch flake: `tabs.spec close keeps note` repeated on WSLg from the WSL copy: 30 (1 failed), 40 (0 failed), 80 (0 failed) | `wsl -u infinity npx playwright test tests/e2e/tabs.spec.ts -g "close keeps note" --repeat-each=N` | 149/150 passed; the single failure was an assertion at `tabs.spec.ts:106` (not a launch exit) | `qa2-wslg-launch-repeat.log`, `qa2-wslg-launch-repeat2.log` |

## Issues

### QA-P02-1 .. QA-P02-4: resolved
Verified as above. Title and path derive from the tree snapshot (`live-note.ts`); in-progress title typing is protected; no empty title on open; relocation notice shown after a purged parent.

### QA-P02-5 (info): WSLg launch exit flake - assessment
- The repair run-1 failure was `launchApp` seeing the page closed before `data-ready` (`repair1-wsl-test-e2e-wslg.log`), and an earlier run showed `[ERROR:ui/gfx/x/connection.cc:66] X connection error received` from a Chromium child (`passC-final-wsl-test-e2e-wslg-run1-2flakes.log`). That is the X11 (XWayland) connection of the Electron process dropping under WSLg, before any renderer code runs, so it is environmental. I found no product path that can close the app before `data-ready`.
- Not reproduced in 120 launch repeats. The one failure I did see in 150 repeats was a non-retrying `expect(await tabLabels(page)).toEqual([...])` right after opening tabs (`tabs.spec.ts:106`), a test-design race, not product behavior. Suggest changing it to a polling `expect.poll` or `toHaveText` in a later test-hardening step.
- Product-side note: the `app-services.init` viewport re-read added in the repair is the correct cheap hardening and I found no new race in it.

### QA-P02-6 (low): edit pending at the instant a note is trashed from elsewhere is dropped silently
Typing " more" and trashing the same note through the bridge within the 400 ms debounce kept only the previously saved text ("precious"); the tab then closes with a notice. A tree click blurs the editor and flushes first (earlier QA confirmed no loss on that path), so this needs a trash from another window or a command in the same instant. Decide whether to accept; no action required for Phase 02.

### DOC-P02-1 (doc, low): `docs/ARCHITECTURE.md` migration allocation is stale
Line 34 still reads "002 Phase 02 (hierarchy indexes only); 003 Phase 04 (window_state); 004 Phase 05 ...". Migration 003 is now `003_trash_reanchored` (Phase 02), so window_state and every later allocation shift by one number (or the doc must record that Phase 04 takes 004 and so on). Implementer or coordinator should update the document and the D-044 decision note; the application code itself is consistent (`user_version` 3 and the checksums file).

## Pending native cases and skipped
- Native Windows E2E and WSLg Linux E2E pass; GNOME/X11-only cases remain outside the user-selected scope. macOS out of scope.
- 1 Linux-only case skipped on Windows (not counted as passed). QA-only specs ran on Windows; the repeats ran on WSLg.

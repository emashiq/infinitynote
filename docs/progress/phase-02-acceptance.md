# Phase 02 acceptance: Home, projects, folders and tabs

Acceptor: infinity-acceptor (Opus 5.5, high), 2026-10-08. Host: Windows 11 Pro 10.0.26300, Node 24.15 (Playwright worker Node 24.21.0 via `INFINITY_E2E_NODE`). WSL evidence: Ubuntu 26.04.1 LTS, WSLg 1.0.73 (Weston), observed `ozone=x11` (XWayland); not labelled GNOME.

## Decision: ACCEPTED

The Phase 02 functional local gates pass on the current tree. There are no placeholders, no weakened or disabled tests, and no retries added. The acceptance criteria in `phases/02-home-projects-folders-and-tabs.md` are covered by real SQLite-backed E2E cases that read the database directly. One latent data-loss path (QA-P02-6) was confirmed by an acceptor probe. It cannot be reached through any Phase 02 user path, so it is accepted with a mandatory Phase 03 follow-up (F-02-1). The rationale is below.

## Evidence read or run

| Item | Source | Result |
| --- | --- | --- |
| Coordinator check (lint, typecheck, 222 unit, 126 integration, traceability ids=187 fails=0) | `.infinity-work/logs/phase-02/coordinator2-check.log` | exit 0 |
| Coordinator build | `coordinator2-build.log` | exit 0 |
| Windows E2E (75 passed, 1 Linux-only skip not counted) | `coordinator2-test-e2e.log` | exit 0 |
| Package current (NSIS, sha256 `276a7b59...`) and packaged E2E (2 passed, schemaVersion 3) | `coordinator2-package-current.log`, `coordinator2-test-e2e-packaged.log` | exit 0, exit 0 |
| Logs postdate source | latest `src`/`tests` mtime 18:45:04, coordinator2 logs 18:49 to 18:51 | verified |
| WSLg full suite after Repair 1 | `repair1-wsl-test-e2e-wslg.log` (75 passed, 1 launch exit), `repair1-wsl-test-e2e-wslg-run2.log` (76 passed) | recorded as separate runs |
| WSL check and build after Repair 1 | `repair1-wsl-check.log`, `repair1-wsl-build.log` | exit 0 |
| Pass C WSLg and Xvfb suites (71/71 each) | `passC-final-wsl-test-e2e-wslg.log`, `passC-final-wsl-test-e2e-xvfb.log` | exit 0 |
| QA initial (FAIL on QA-P02-1) and Re-QA (PASS) | `docs/progress/phase-02-qa.md`, `qa-*.log`, `qa2-*.log` | read |
| Acceptor spot-run: `npm run check` | `acceptor-check.log` | exit 0 (222 unit, 126 integration, fails=0) |
| Acceptor probe on QA-P02-6 (bridge trash within debounce vs tree trash within debounce) | `.infinity-work/qa/p02-acceptor-probe.spec.ts`, `acceptor-probe-qa-p02-6.log` | see QA-P02-6 below |
| Test integrity | `git diff tests/`: `smoke`/`packaged` specs only add Settings navigation and keep every assertion (`schemaVersion` 1 to 3 is the real schema). `security.spec` now asserts the full frozen D-045 surface. Boundary guards were retargeted at Phase 03-only channels. `.skip` is used only for the Phase 01 packaged-only and Linux-only conditions. No `.only`, no retries. | verified |
| Phase 01 follow-ups due in Phase 02 | F-01-1: `ci.yml` 24.21.0, `ci-config.test`, D-049. F-01-4: probe table and D-050 | closed |

## Acceptance criteria (phase file) and where they are proven

| Criterion | Proof (actual test bodies read) |
| --- | --- |
| Common and project notes, multiple folder levels | `e2e/tree.spec` › nested folders (aria-level 2 to 5), › create note in folder, › sticky in folder; `integration/hierarchy.test` depth 32/33 |
| Move, rename, restart persistence | `tree.spec` › project CRUD (F2 rename, DB check, restart, trash); › move persists after restart (subtree including a trashed note follows the project; DB rows checked after restart) |
| Reject cycles | `tree.spec` › cycle rejected (alert text, focus returns to row, DB unchanged); `hierarchy.test` |
| Tabs restore without duplicates | `tabs.spec` › restore after relaunch (order, active tab, text; tampered session with duplicates sanitized with no notice) |
| Close tab does not delete the note | `tabs.spec` › close keeps note; `editor.spec` › flush on close |
| Home scopes reflect the same stored data | `home.spec` › pinned and recent reflect data, › pin, › filter (including trashed-project reset) |
| Visual at 1100x720 and narrow | `visual.spec` (6 cases on Windows, WSLg, Xvfb) and screenshots reviewed below |
| Keyboard-only tree and tabs | `a11y-keyboard.spec` › tree, › tabs keyboard-only, › dialogs return focus, › accessibility structure on every view; `tree-pane.test`, `tab-strip.test` |

All 30 Phase 02 BACKLOG IDs are `done`, except INF-SHELL-06, which stays `in_progress` with the native-frame (N) part pending in the Phase 09 matrix. Traceability reports fails=0.

## Decisions on the open questions

### QA-P02-6: pending edit dropped when the open note is trashed through the bridge
- Confirmed in code. `TabsStore.closeNoteTabs` calls `controller.dispose({ flush: false })`, so the debounced text is never sent. `NoteWriter.save` would have stored a `note_drafts` row (reason `conflict`, the `trashed` branch) because trashing does not revoke the lease. In this path no request reaches main, so no draft exists.
- Confirmed by probe (`acceptor-probe-qa-p02-6.log`). After typing " more" and calling `note.trash` through the bridge within 400 ms, the result was `plain_text = "precious"` and `drafts []`. The tree (UI) control case kept the pending text (`"alpha beta"`), because `TreeStore.trash` flushes first.
- Reachability in Phase 02: the only renderer caller of any trash operation is `DialogHost` → `TreeStore.trash{Project,Folder,Note}`, and that path flushes the active note before the IPC call. Phase 02 has exactly one renderer view. The faulty path needs a second view (Phase 03 leases and views, Phase 04 sticky windows) or a direct bridge call. No Phase 02 user can lose text this way.
- Decision: this is a real violation of the ARCHITECTURE rule "never silently discard text", but it is latent in Phase 02. It does not block acceptance. It becomes F-02-1, a mandatory Phase 03 entry item that must land before any second view or the `note:trashed` event ships. The fix is to flush (not discard) before dispose in `closeNoteTabs`, so main stores the draft and the user sees the "kept as a recovered draft" message, with a regression test that asserts the `note_drafts` row.

### DOC-P02-1: stale migration allocation
- Confirmed stale in three places: `docs/ARCHITECTURE.md` line 34 ("003 Phase 04 (window_state) ..."), DECISIONS D-044, and BACKLOG W04-01 ("window_state (migration 003)"). No decision records `003_trash_reanchored`.
- The application is consistent: `MIGRATIONS`, `checksums.json` key 3, `user_version` 3, migration and checksum tests. `migrations-checksum.test` would reject a second file numbered 003. This is a documentation and traceability defect, not a functional one, so it does not block acceptance. Assigned as F-02-2. It must be fixed before Phase 04 plans `window_state`, and preferably by the coordinator in the Phase 02 commit or the Phase 03 planner.

### WSLg flake
- Evidence on disk: a launch exit before `data-ready` (`repair1-wsl-test-e2e-wslg.log`, "Target page, context or browser has been closed" in `launchApp`), and an earlier XWayland "X connection error" (`passC-final-wsl-test-e2e-wslg-run1-2flakes.log`). Full-suite reruns on the identical tree passed (76/76), and repeats passed 40/40 and 80/80 (`qa2-wslg-launch-repeat*.log`). The Repair 1 viewport re-read in `createAppServices.init` is reasonable hardening.
- Evidence gap: the QA-reported 30-repeat run with 1 failure at `tabs.spec.ts:106` has no log on disk; only the 40 and 80 repeat logs exist. I accept the analysis on code grounds: line 106 is a non-polling `expect(await tabLabels(page)).toEqual([...])` right after opening tabs, which is a test race and not a product assertion.
- Decision: accepted as environmental plus test-design, with follow-up F-02-3. No retries are allowed as the fix.

### Shell UI (Sonnet LOW, Pass B) against the UX contract
Reviewed the post-repair WSLg screens (`screens/wslg/*.png`, 18:49) against `reference/framecapt-reference.png`: `1100x720-light-home`, `1100x720-light-note`, `1100x720-dark-home`, `760x560-light-tree-drawer`, `1280x800-light-panel`, `tab-overflow`, `context-menu`.
- Matches the reference language: 52 px icon rail with accent-soft active state and settings at the bottom; header with centered "Search notes and commands" and the Ctrl K chip; compact tab strip with an accent top border on the active tab and an overflow list button; 13 to 14 px type; uppercase section labels; bordered quick-action tiles with violet icons; a segmented All/Common/Project control like the reference's segmented controls; switches in the Info panel. There are no capture-specific labels.
- Narrow 760x560: the tree is a drawer over a scrim with a visible focus ring, and there is no clipping. Dark theme tokens are coherent. Tab overflow shows scroll chevrons and the All tabs button. The context menu is compact and focus-ringed.
- Pass B's structural accessibility gaps (splitter Home/End, drawer focus, focus loss after trash, missing `h2`) were found and fixed with regression tests in Pass C. Verdict: meets the UX contract for Phase 02. Minor note: the Windows screenshot set (18:19) predates Repair 1, while the WSLg set is post-repair. The coordinator2 Windows `visual.spec` run passed, and Repair 1 touched only the title and path sources.

## Follow-ups

| ID | Item | Assigned |
| --- | --- | --- |
| F-02-1 | `TabsStore.closeNoteTabs`: flush the active controller (not `dispose({flush:false})`) when its note is trashed elsewhere, so main stores the `trashed` conflict draft; surface "Your edits were kept as a recovered draft"; regression test that trashes through the bridge within the 400 ms debounce and asserts a `note_drafts` row with the pending text. Must land before a second view or `note:trashed` exists. Coordinate with F-01-3 (draft dedupe). | Phase 03 (entry, blocking for multi-view) |
| F-02-2 | Update `docs/ARCHITECTURE.md` migration allocation (003 Phase 02 `trash_reanchored`; window_state becomes 004, and every later number shifts), D-044 (or a new decision recording migration 003 and the shift), and BACKLOG W04-01 "migration 003". | Coordinator or Phase 03 planner; before Phase 04 planning |
| F-02-3 | Test hardening: replace non-polling `expect(await tabLabels(...)).toEqual` and `activeTabLabel` reads in `tabs.spec` (line 106 and the restart reads) with `expect.poll`/`toHaveText`. Keep the WSLg launch-exit flake under watch in every WSLg run, recorded as separate runs, with no retries. | Phase 03 |
| F-02-4 | Regenerate the Windows screenshot set on the post-repair tree during the next visual run. | Phase 03 |
| (carried) | D-048 window-close flush gap with the temporary text area; F-01-3 draft dedupe | Phase 03 |
| (carried) | F-01-5 renderer minification (bundle now 967 kB unminified), F-01-6 | Phase 09 |

## Pending native cases (not run, not counted as passed)
- INF-SHELL-06 N: native frame and window controls on a real desktop session. Phase 09 matrix.
- `npm run package:linux` and Linux packaged E2E: not re-run in Phase 02 (packaging unchanged). Phase 09.
- GNOME and X11 desktop sessions: outside the user-selected validation scope (WSLg is the Linux environment). Not a pass.
- Forced native Wayland (`--ozone-platform=wayland`) suite: 56 passed, 15 failed, informational only (hidden-surface frame callbacks; D-050).
- macOS: out of scope.
- Windows E2E: 1 Linux-only case skipped (runs and passes on WSLg).

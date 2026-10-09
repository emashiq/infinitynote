# Phase 05 acceptance: Time-zone reminders, notifications and widget

Acceptor: infinity-acceptor (Opus 5.5, high), 2026-10-09. HEAD = `a44d883` (Phase 04). No application code was written by the acceptor.

## Decision: accepted

All local functional gates for Phase 05 pass on Windows 11 and on WSL2 Ubuntu 26.04.1 (WSLg/Weston and Xvfb). The gate logs come after the last source change, and the acceptor re-ran some of them. The QA defects QA5-01 to QA5-04 are fixed and have regression tests. The two remaining QA observations (QA6-01, QA6-02) are acceptable as described below. Cases that need a native OS are recorded as pending, and none of them is claimed as passed. Under the rule for phases 00 to 08, this means the phase is accepted with the native cases moved to the Phase 09 matrix.

## What was read

- Pack: `phases/05-time-zone-reminders-notifications-and-widget.md` (acceptance), the PRODUCT_PLAN Reminders section, ARCHITECTURE "Reminders and clocks", and TEST_MATRIX (Reminders, Scheduler recovery, Time zones, Widget, frozen-clock examples, native matrix).
- `docs/plans/phase-05.md`, `docs/progress/phase-05.md` (incl. Repair 1), `docs/progress/phase-05-qa.md` (initial fail and re-QA pass), DECISIONS D-073 to D-087, UX_SPEC Phase 05 entries, the BACKLOG Phase 05 rows (W05-01..03 and 31 IDs).
- Code: the diff against HEAD (91 modified files, plus the new files). I reviewed these in detail: `reminder-scheduler.ts`, `reminders-repo.ts` (claim, `retargetFollowups`, `stillAlerting`, `dueForAlert` cursor, `deferDue`, `markStaleClaimsUncertain`), `reminder-service.ts#update`, `electron-notifications.ts`, `reminder-handlers.ts`, `005_reminders.sql`, `migrations/index.ts`, `checksums.json`, `ReminderSettings.tsx`, `SettingsPage.tsx`, and the regression tests in `tests/integration/scheduler.test.ts`.

## Gates and freshness

The last source or test change was `tests/integration/scheduler.test.ts` at 10:27:22 (followed by `reminders-repo.ts` 10:25, `reminder-service.ts` 10:22, `reminder-scheduler.ts` 10:22, migration 005 and checksums 10:21). `find -newer coordinator2-check.log` shows that no file in `src/` or `tests/` changed after the coordinator gates. The only newer file is `playwright-report/index.html`, which is git-ignored.

| Gate | Host | Exit | Result | Log (`.infinity-work/logs/phase-05/`) | Time |
| --- | --- | --- | --- | --- | --- |
| `npm run check` (coordinator) | Windows | 0 | lint, typecheck, unit, integration, traceability fails=0 | coordinator2-check.log | 10:50 |
| `npm run build` (coordinator) | Windows | 0 | | coordinator2-build.log | 10:50 |
| `npm run test:e2e` (coordinator, `INFINITY_E2E_NODE` portable Node 24.21.0) | Windows | 0 | 168 passed, 1 skipped (Linux-only smoke case) | coordinator2-test-e2e.log | 10:56 |
| **`npm run check` (acceptor rerun)** | Windows | 0 | unit 77 files / 527 passed; integration 34 files / 328 passed, 1 platform skip; traceability ids=187 fails=0 warns=0 | acceptor-check.log | 2026-10-09 |
| `npm run package:current` + `npm run test:e2e:packaged` | Windows | 0 | NSIS build; 4 passed; packaged delivery `dispatched`, autostart only read (`login-items`, disabled) | repair1-package-current.log, repair1-test-e2e-packaged.log | 10:34-10:36 |
| sync, check, build, E2E WSLg, E2E Xvfb | WSL | 0 | MIRROR_IDENTICAL; 167 passed, 2 Windows-only skips (each display) | repair1-wsl-*.log | 10:36-10:48 |
| **env, sync, `npm run package:linux`, `npm run test:e2e:packaged` (acceptor rerun)** | WSL (user `infinity`, `~/infinity-notes`) | 0 | MIRROR_IDENTICAL; AppImage and .deb built; 4 passed; capabilities `notifications unsupported(no-notification-server)`, autostart `unsupported(wsl-no-session-autostart)`, delivery `unsupported`; sticky sandbox: own user and PID namespaces, Seccomp=2; `electron left: 0` | acceptor-env.log, acceptor-sync.log, acceptor-package-linux.log, acceptor-test-e2e-packaged.log | 11:01 |
| QA re-run (29 vitest probes, 6 E2E on Windows and WSLg) | both | 0 | 29/29, 6/6, 6/6 | qa2-*.log | 10:58-10:59 |

I re-ran Linux packaging myself because Repair 1 changed main-process code and migration 005, and both are bundled in the package. The earlier `final-wsl-package-linux.log` and `final-wsl-test-e2e-packaged.log` were made before that change. The rerun used the post-repair source.

Environment for the acceptor rerun: Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, npm 11.19.0, WSLg 1.0.73, Weston 2318fecaeac1f1a2d5a7a042c34d931c71dae04c. Neither `org.freedesktop.Notifications` nor `org.kde.StatusNotifierWatcher` is on the session bus. These results come from WSLg/Weston and are not labelled as GNOME results.

Test integrity: the test diff adds no `.skip`, `.only`, `.fixme`, `todo` or `skipIf`. The only skips are platform skips from earlier phases (`lifecycle.spec` Windows-tray cases ×2, `smoke.spec` Linux-only case, `packaged.spec` when no packaged exe is set). A scan for TODO, FIXME or placeholder in `src/` found nothing related to this phase. Dependencies are unchanged (`repair1-deps-unchanged.log`).

## Requirement coverage

I checked the coverage table in `docs/progress/phase-05.md` against the plan's per-ID assertions and the test files. For these IDs the assertions exist and passed in the gates above: INF-REM-01 to -05, -08 to -18, INF-HOME-04, INF-SCHED-01 to -04, -06 to -09, INF-WIDG-01 and INF-WIDG-03. These are partly done (`in_progress`), and each one's missing part needs a native OS:

- INF-REM-06: the Windows packaged toast reached the notification platform (`S9-native-toast-win.log`, `repair1-test-e2e-packaged.log` `dispatched`). The WSLg native toast was not run because there is no notification server (D-077).
- INF-REM-07: click routing is covered by E2E through the adapter seam (block selected and highlighted, `clicked_at`, background recreate, summary opens Overdue). The real toast click is pending a manual run; an automated UIA attempt could not find the toast (`planner-probe-notify-win.log` run 3).
- INF-SCHED-05: sleep and wake on real hardware (Phase 09).
- INF-WIDG-02: user drag and resize, and pin over other applications (Phase 09).
- INF-DESK-02: native tray (Phase 09).
- INF-DESK-03: completing the Settings part is Phase 08; the native login check is Phase 09.

Phase acceptance criteria:

- Frozen-clock tests cover initial alerts, follow-ups, complete and snooze races, recurrence and DST, quiet hours, a crash around dispatch, recovery and duplicate suppression. Covered by `scheduler.test`, `scheduler-recovery.test`, `recurrence`, `resolve-local`, `quiet-hours` and `snooze-target`, plus QA adversarial probes Q1-Q19 and R1-R8. The TEST_MATRIX frozen-clock examples (Dhaka "tomorrow 17:00" gives 11:00Z, and a New York "tomorrow" while the computer is in Dhaka near midnight) were checked in QA Q12/Q13 and the unit tests.
- Widget and main window stay consistent: `widget.spec › one scheduler for both windows` and `integration/widget-manager`.
- A real native notification opens the correct note: delivery to the real Windows notification layer is proven, and click routing is proven through the seam. The real click is pending a person (procedure below). This is the OS-dependent part that is recorded for later.
- Unsupported native action buttons fall back to app and widget actions: no actions, reply field or toast XML are ever sent (`electron-notifications.ts`, `unit/notification-adapter`). Snooze, Done and Open are always available in the app, the banner and the widget. On WSLg the real `unsupported` capability is E2E-tested with the in-app banner.

## Decisions on the questions raised

### QA6-01: a `skipped` follow-up still increments `followups_sent`. Acceptable, no code change required

- ARCHITECTURE leaves this open: "Follow-up count increments on the chosen documented dispatch policy". The chosen policy is D-075: "`followups_sent` counts only follow-ups and increments at claim". The code (`reminder-scheduler.ts` `claim`, lines 236-242) does exactly that. Every outcome after the claim (`dispatched`, `failed`, `unsupported`, `uncertain`, `skipped`) is treated the same way, and INF-SCHED-08 already asserts this for `uncertain`.
- The effect is bounded and fails safe. A follow-up can only be `skipped` when Done, Snooze, an edit or trash lands in the short window between the claim and the show (normally milliseconds, at most the 3 s show timeout). After Done the count no longer matters. After a Snooze the user can get one follow-up fewer than the maximum, never more. This does not "exhaust follow-up counts accidentally" through recovery: recovery never creates `skipped`, and a stale claim becomes `uncertain` with no extra count.
- Follow-up A05-F1 (documentation, Phase 06): add one sentence to D-087 or D-075 saying that a claimed follow-up counts whatever its outcome, including `skipped`. That way the coordinator's earlier expectation ("skipped does not count") is not mistaken for the contract. Changing to decrement-on-skip stays optional and is not required.

### QA6-02: pre-release edit of migration 005 (outcome CHECK gains `skipped`). Acceptable

- `git log --all -- src/main/db/migrations/005_reminders.sql` is empty, so 005 has never been committed, and there is no tag or release.
- `git diff HEAD -- src/main/db/migrations/` changes only `index.ts` (one import and one entry for version 5) and adds the `"5"` key to `checksums.json`. Migrations 001-004 are not modified.
- The SHA-256 of each `.sql` file matches `checksums.json`: 001 `303c9fc2…`, 002 `224e179b…`, 003 `af4dace8…`, 004 `4d1f211a…` (all unchanged from HEAD), 005 `8f394b6b…` (the post-repair file). `unit/migrations-checksum` passes in acceptor-check.log. QA M1 confirmed that a populated v4 database built with 001-004 at `a44d883` upgrades to v5 with every row the same.
- Risk on this host: none. There is no real Infinity Notes profile under `%APPDATA%`, `%LOCALAPPDATA%` or WSL `~/.config`, and test profiles are created fresh each run. Rule from now on: after Phase 05 is committed, migration 005 is frozen. Any later schema change needs migration 006.

### Linux packaging evidence before Repair 1

I re-ran it, as described above (`acceptor-package-linux.log`, `acceptor-test-e2e-packaged.log`, both exit 0, on the post-repair source with MIRROR_IDENTICAL). The Windows packaged run was already made after the repair (`repair1-*`).

### Honest wording

- Settings > Reminders (`FULLY_QUIT_TEXT`): "Reminders only fire while Infinity Notes is running: with a window open, in the background or in the tray. After you quit, nothing is sent until you start the app again, and then overdue reminders are shown." It does not promise alerts after a full quit. `e2e/reminders › settings explain the lifecycle` and `e2e/lifecycle › relaunch overdue summary` (nothing is claimed while the app is quit, then one `startup` delivery) check this.
- Without a notification service (WSLg): `NO_NOTIFICATIONS_TEXT`, "This desktop has no notification service. Reminders appear inside Infinity Notes and in the reminder widget instead." The capability comes from a session-bus check, not from Electron's `isSupported()`, which wrongly reports true there.
- Tray fallback: Settings > Windows and tray shows "Reminders and stickies only work while the app is running." When there is no tray it adds "No tray icon is available on this desktop. Launch Infinity Notes again to bring the main window back." The widget pin tooltip falls back to "Not supported by this desktop".
- The known limitations in the progress report say plainly that a live OS zone change may need a restart, that there are no native action buttons, that the widget position is not restored under Wayland or WSLg, and that launch at login is unavailable in development builds and under WSL. No text claims guaranteed Wayland positioning or GNOME results.

## Code quality notes

- Scheduler: one timer, capped at 60 s, with backoff from 1 s to 60 s when no progress is made. Each claim is its own `IMMEDIATE` transaction guarded by revision and still-due checks. Dispatch happens outside transactions. Each item is re-checked just before it is shown (`stillAlerting`). Paging uses a stable cursor (next alert, due, rowid), so a tick reads each due row once, and claimed rows move past `now`. A summary names the count that is still current at dispatch. These are clean and well tested.
- `retargetFollowups` runs inside the edit transaction, does not touch snoozed alerts, and bumps every open revision so that a claim prepared under the old settings loses. Raising the maximum after it was reached fires the late follow-up once and then stops (QA R1). This is reasonable and documented in D-087.
- IPC: reminder handlers are thin and validated by the router schemas. A sticky window can open only its own note's reminders. The widget is limited to `WIDGET_ALLOWED_CHANNELS`, and QA probed all 54 other channels and got `FORBIDDEN` on both OSes.
- No real login item was created. The Windows `HKCU\…\Run` key has no Infinity or Electron entry, WSL has no `~/.config/autostart` entry, and no Electron process was left on either host after the runs.

## Follow-ups (assigned)

| ID | Item | Phase |
| --- | --- | --- |
| A05-F1 | Document in D-075/D-087 that a claimed follow-up counts whatever its outcome, including `skipped` (QA6-01). Decrement-on-skip is optional | 06 (docs) |
| A05-F2 | Native check: after a Windows toast times out into Action Center, clicking it there still opens the note. The adapter drops its reference on `close` (`electron-notifications.ts`), and Windows may raise `close` when a toast times out. If the click is lost, keep the reference until it is clicked, still bounded by `MAX_KEPT_NOTIFICATIONS`. Clicks after an app restart are out of scope (no COM activator) and must be listed as a limitation | 09 (native matrix; repair if it fails) |
| A05-F3 | Freeze migration 005 once Phase 05 is committed; later schema changes go in 006+ | 06 onward |
| A05-F4 | INF-DESK-03 Settings completion (launch at login switch in the final Settings layout) | 08 |
| A05-F5 | Native matrix rows INF-REM-06/07 (Windows real toast and click), INF-SCHED-05 (real sleep and wake), INF-WIDG-02 (drag, resize, pin over other apps), INF-DESK-02 (native tray), INF-DESK-03 (real login item in an installed build, then removed), live OS zone change | 09 |

## Pending native cases (not run, not claimed)

- Windows 11: real toast click (manual procedure below), the Action Center click after a timeout (A05-F2), sleep and wake, live OS zone change, launch at login set for real in the installed build, widget always on top over other applications, user drag and resize.
- WSLg: native Linux toast and click are `not_run` because WSLg has no notification server (D-077), and nothing was installed to provide one. Launch at login is `unsupported` under WSL. The in-app fallback is the tested WSLg behavior.
- `outside_validation_scope` (user decision): GNOME notifications and their click, XDG autostart in a GNOME session, X11 always-on-top for the widget.

### Manual Windows toast-click procedure (INF-REM-07 native part; pending a person)

1. `npm run package:current`. Install the NSIS build from `release/` and start Infinity Notes.
2. Create a note "Click test" with the paragraph "Open me", and put the cursor in that paragraph.
3. More → Add reminder…, set a time 2 minutes ahead in the computer's zone, Save.
4. Close the main window and choose "Keep running".
5. When the toast appears, click it. Expected: the main window comes back with "Click test" as the active tab and "Open me" selected and highlighted.
6. Repeat with a new reminder. Let the toast time out into Action Center, then click it there (A05-F2). Record the result.
7. Record the Windows build, the date, and pass or fail with a screenshot path. Then uninstall, or keep the install for Phase 09.

## Evidence

- `.infinity-work/logs/phase-05/coordinator2-check.log`, `coordinator2-build.log`, `coordinator2-test-e2e.log`
- `.infinity-work/logs/phase-05/acceptor-check.log`, `acceptor-env.log`, `acceptor-sync.log`, `acceptor-package-linux.log`, `acceptor-test-e2e-packaged.log`
- `.infinity-work/logs/phase-05/repair1-*.log` (Windows packaged, WSLg and Xvfb E2E after the repair), `qa2-*.log`
- `.infinity-work/logs/phase-05/S9-native-toast-win.log`, `planner-probe-notify-win.log`, `screens/win/`, `screens/wslg/`
- `docs/plans/phase-05.md`, `docs/progress/phase-05.md`, `docs/progress/phase-05-qa.md`, `docs/DECISIONS.md` (D-073 to D-087)

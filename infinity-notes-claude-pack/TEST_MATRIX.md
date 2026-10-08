# Verification matrix and finish gate

Use temporary test databases and mocked clocks/notification adapters for deterministic checks. Never use a real user's notebook. Actual native desktop behavior is checked separately on Windows and Linux.

| Area | Required evidence |
| --- | --- |
| Hierarchy | Common/project roots; deep folders; duplicate names; cycle prevention; transactional moves; trash and restore |
| Tabs | Multiple documents; overflow; active state; autosave on close; reopen after restart; deleted target |
| Editor | Format/checklist/undo; plain-text conversion; Unicode incl. Bangla text; image bitmap/file/HTML paste; reload offline; no executable pasted content |
| Persistence | Migration rollback/failure; crash recovery; stale revision conflict; writer lease transfer; acknowledged saves durable; FTS updates |
| Floating stickies | Two distinct native windows; dock/float same note ID; read-only mirror and control transfer; collapse/pin; close hides; off-screen display recovery |
| References | Rename/move preserves link; block IDs stable; pasted IDs regenerated; incoming/outgoing links; deleted target/anchor feedback |
| Reminders | Initial due alert; notification click opens correct note; dismiss differs from Done; snooze wins scheduler race; follow-up limit; recurrence vs completion |
| Scheduler recovery | Restart around dispatch; duplicate claim prevention; OS adapter failure; sleep/resume; clock jump; quiet hours; no alert storms |
| Time zones | Asia/Dhaka calendar tomorrow; America/New_York DST gap/fold; OS zone change; local conversion; recurring wall-clock vs elapsed duration |
| Parsing | tomorrow EOD; explicit date/time; in 2 hours; weekday policy; date-only default; ambiguous numeric date/CST; past date; multiple phrases; unsupported text |
| Suggestions | Preview required; no automatic creation; persistence/restart dedupe; source edit requires update; deletion keeps source note; no reparse shift |
| Widget | Hidden widget leaves scheduling running; quick Done/Snooze/Open; shared state with app; optional startup/always-on-top |
| Portability | Consistent backup incl. WAL data; image references; version/hash validation; restore rollback; path traversal/oversized import rejected |
| Packaging | Install/launch/relaunch with native SQLite; update preserves data; uninstall behavior documented; local unsigned status stated |
| Accessibility | Keyboard-only tree/tabs/dialog/editor/widget; focus return; labels; contrast; reduced motion and high DPI |

## Frozen-clock examples

- Reference: 2026-10-08 13:00 Asia/Dhaka. “tomorrow end of the day” -> 2026-10-09 17:00 Asia/Dhaka, displayed UTC 11:00.
- Same reference: “in 2 hours” -> 15:00 Asia/Dhaka on October 8.
- A selected New York reminder must use tomorrow in New York even if the machine is in Dhaka near midnight.
- US DST dates are calculated from the selected year/zone by the library, not hard-coded per-year offset tables; test 2026-03-08 02:30 and 2026-11-01 01:30 America/New_York.
- “03/04 at 5” cannot confirm until date order/time interpretation are visible and accepted.
- Confirm once, restart the next day, and verify the same due instant.

## Native OS matrix

Windows 11: installed launch, tray exit behavior, notification presence and click, floating movement/resize/always-on-top, sleep/wake, login startup if enabled, data across reinstall.

Ubuntu LTS GNOME Wayland: installed launch, independent windows, user-driven movement/resize, supported pin behavior or graceful fallback, notifications/click, tray availability/fallback, sleep/wake. Do not assert reliable programmatic positioning where the compositor blocks it.

Ubuntu X11: restored bounds, multi-monitor removal, always-on-top, notifications and tray behavior. Record compositor/desktop/version in results. E2E under Xvfb validates application logic but does not substitute for native compositor and toast checks.

## Evidence format

Every phase writes docs/progress/phase-XX.md with implementation summary, changed files, commands, exit codes, log paths, acceptance coverage and remaining OS-dependent cases. Every issue lists severity, reproduction, expected/actual and fixed verification. Keep sample notebooks/screenshots synthetic.

Phase 09 writes docs/FINAL_REPORT.md, docs/NATIVE_OS_MATRIX.md and docs/RELEASE_CHECKLIST.md. Each case is pass/fail/not_run with dated host details and an evidence path. Documentation is not evidence that a test ran. Installer files require file size/hash plus install/launch results on the actual OS.

Complete means no blocking defects, all local gates passed, both OS package/build evidence and actual native matrix pass or a documented capability fallback that meets the user flow. Missing hosts/signing/publish rights never justify an invented pass. With missing native verification, finish independent work and return ready_for_os_validation; with broken code/tests return blocked.

## Autonomous finishing and file organization

Follow CLEANUP_POLICY.md after the final acceptance gate. Continue planning, coding, testing and repair without phase confirmation prompts. Organize prompts/plans/progress/evidence under docs/development/, keep active README/CLAUDE instructions at root, create docs/INDEX.md and preserve application source, tests, data, backups and installers. Do not clean active checkpoints while blocked or waiting for native OS validation. Both launcher and sequential workflows invoke finalize_docs.py after verified completion.

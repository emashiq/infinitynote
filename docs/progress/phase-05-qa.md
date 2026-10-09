# Phase 05 QA: Time-zone reminders, notifications and widget

Reviewer: infinity-qa (Sonnet 5.5 medium), fresh session, 2026-10-09. No application source, test or tool file was changed. QA scripts are in `.infinity-work/qa/p05-*` (`p05.vitest.config.ts`, `p05-adversarial.test.ts`, `p05-more.test.ts`, `p05-e2e.spec.ts`, `p05.config.ts`, `wsl-p05-qa.sh`); logs in `.infinity-work/logs/phase-05/qa-*.log`.

## Verdict: fail (one small defect to repair, then re-verify)

Everything the controller and implementer reported holds (coordinator check/build exit 0, E2E 168 passed and 1 Linux-only skip). The adversarial probes found one actionable defect in follow-up handling after an edit (QA5-01, Medium) and three Low issues. Nothing found loses data, duplicates a claimed alert after a restart, or breaks the role boundaries.

## Checks

| Check | Command | Status | Evidence |
| --- | --- | --- | --- |
| Controller check, build, E2E logs read | `coordinator-check.log` (lint, typecheck, unit, integration, traceability fails=0), `coordinator-build.log`, `coordinator-test-e2e.log` (168 passed, 1 skipped) | passed (read, not rerun) | `.infinity-work/logs/phase-05/coordinator-check.log`, `coordinator-build.log`, `coordinator-test-e2e.log` |
| Adversarial scheduler, recurrence, quiet-hours and zone probes (17 cases) | `npx vitest run --config .infinity-work/qa/p05.vitest.config.ts` | failed: 3 of 17 (Q1, Q4, Q5; each is a defect below); 14 passed | `.infinity-work/logs/phase-05/qa-integration-adversarial.log` |
| Contract bounds, settings validation, 1,000-due behavior | `npx vitest run --config .infinity-work/qa/p05.vitest.config.ts p05-more` | Q8b and Q18 passed; Q19 failed because my probe used an unknown settings key (probe error, not an app defect; validation answers were printed and are correct) | `.infinity-work/logs/phase-05/qa-integration-more.log` |
| Windows Electron E2E (5 cases: type then add reminder at once, widget role, sticky role, 1,000 reminders UI, trashed note) | `node node_modules/@playwright/test/cli.js test -c .infinity-work/qa/p05.config.ts` (Node 24.21 portable) | passed 5/5 (an earlier run of the same specs failed on my own probe mistakes; fixed in the QA spec and rerun) | `.infinity-work/logs/phase-05/qa-e2e-win.log` |
| WSLg run of the same 5 E2E specs (Ubuntu 26.04.1, Node 24.21.0, Weston/WSLg, user infinity, source mirror identical, only 2 docs differ) | `wsl -d Ubuntu -u infinity -- bash /mnt/e/notecapt/.infinity-work/qa/wsl-p05-qa.sh` | passed 5/5, `electron left: 0` | `.infinity-work/logs/phase-05/qa-e2e-wslg.log` |
| Orphaned Electron processes on Windows after the runs | `tasklist` | none | (command output, no log) |

## What was verified, with actual behavior

- Race with Done or Snooze before the claim (Q2, Q3): Done landing between the due read and the claim, for an initial alert and for a follow-up, produces no delivery and no notification, and no later alert. An edit that lands there also makes the stale claim lose; the occurrence alerts once at the new time.
- Restart around dispatch (Q6): five claimed alerts as one summary, process dropped, restarted: all five deliveries become `uncertain`, none is re-sent over 3 hours of fake time, all five stay in Overdue.
- Adapter failure (Q17): `failed` is recorded once, no retry, the occurrence stays pending and overdue (retry bound is zero; the in-app banner takes over).
- Storm control (Q7, Q9): 60 reminders due after a sleep produce exactly one summary; repeated resume and unlock events add nothing; follow-ups later give one summary per tick. Clock jumps of -1 day, +1 day, +30 days and -30 days after an alert produce no second alert for that occurrence.
- DST and wall clock, real notification instants (Q10), America/New_York, system zone Asia/Dhaka: daily 02:30 fires 03-07 07:30Z, 03-08 07:00Z (gap, 03:00 EDT), 03-09 06:30Z; daily 01:30 with fold preference later fires 10-31 05:30Z, 11-01 06:30Z, 11-02 06:30Z; with earlier 10-31 05:30Z, 11-01 05:30Z, 11-02 06:30Z; weekly Monday 09:00 fires 10-26 13:00Z, 11-02 14:00Z, 11-09 14:00Z. Exactly one alert per occurrence across the fold.
- Done twice and snooze after Done (Q16): the second Done is a no-op, snooze after Done is refused, the daily series keeps one future occurrence and alerts the next day.
- Quiet hours in an explicit zone different from the computer's (Q11): quiet 22:00 to 07:00 in New York, alert due 2026-11-01 01:30 EDT, shown once at 12:00Z (07:00 EST), listed as overdue while delayed, no repeat for a day afterwards.
- Frozen clock (Q12, Q13): Dhaka 2026-10-08 13:00, "tomorrow 17:00" is 11:00Z. At Dhaka 00:30 on 10-09 (still 10-08 in New York), "Tomorrow 09:00" snooze is 13:00Z on 10-09 for the New York reminder and 03:00Z on 10-10 for the Dhaka one.
- Trashed note and deleted block (Q14, E5): no alert while the note is trashed (also after 10 and 60 minutes of fake time); after restore exactly one; a reminder whose block was removed reports `block_missing`, still alerts, and a click opens the note without a block.
- Contract bounds (Q18): follow-up interval 7, 1; max counts 0 and 4; time 24:00 and 9:00; dates 2026-02-30 and 1999; zone `../etc/passwd` and a markup zone; blank and control-character titles; weekly with no weekdays or weekday 8; monthly; extra keys; snooze preset 7 are all rejected. Settings reject unknown zones, `CST`, invalid quiet-hour time and an unknown key.
- Role boundaries (E2, E3, both OS): from the widget renderer, all 54 channels outside `WIDGET_ALLOWED_CHANNELS` (except `app:quit`, not called) answer `FORBIDDEN`; `ipcRenderer`, `require` and `process` are undefined. From a sticky, another note's reminders cannot be listed, opened, completed, snoozed or created (all `FORBIDDEN`).
- Type then Add reminder at once (E1, both OS): the dialog saved with an `ok` block anchor, the text "Immediate text" was stored, no stale-save loss.
- Performance (E4 and Q8): 1,000 reminders created through the real bridge in 2.6 s; Reminders page first row 73 ms (Windows) and 97 ms (WSLg), tab switches 70 to 110 ms, Home 53 ms (Windows); a due-all tick with 1,000 reminders 327 ms in the integration run; the page shows the first 200 rows and says so ("Bulk 200" is the last row; limit text present).
- F04-A1 quit escape: read `window-lifecycle.ts` against D-085. The escape is armed by a canceled Quit, consumed by every Quit, valid for 120,000 ms inclusive, never carried by a Quit whose flush saved everything. The existing unit tests cover 119 s (goes ahead), 121 s (canceled again and re-armed), saved-then-exit and session end. No further defect.

## Issues

| ID | Severity | Issue | Reproduction | Expected | Actual |
| --- | --- | --- | --- | --- | --- |
| QA5-01 | Medium | Turning follow-ups off, or lowering the maximum, does not cancel an already pending follow-up | `p05-adversarial.test.ts` Q4: reminder with follow-up 5 min x 3, first alert shown, `reminder.update` with `followup: null` (same time), advance 1 hour. Q5: follow-up 5 min x 5, three notifications shown (initial and 2 follow-ups), update to max 1, advance 1 hour | No notification after the edit (Q4), none beyond the new limit (Q5) | Q4: one extra `followup` notification (deliveries `initial`, `followup`). Q5: a 4th notification, although 2 follow-ups already exceeded the new maximum 1. Cause: `ReminderService.update` keeps `next_alert_at_utc`, and `ReminderScheduler.claim` only computes the following alert, so the stored one still fires. Fix suggestion: in an edit that changes the follow-up settings, recompute `next_alert_at_utc` of open occurrences with `alert_sequence > 0` (NULL if disabled or `followups_sent >= max_followups`, else keep or re-base) in the same transaction, then add the two cases to `tests/integration/scheduler.test.ts` (copy Q4 and Q5) |
| QA5-02 | Low | Done does not cancel a sibling notification of the same tick that is claimed but not yet shown | Q1: two reminders due together, adapter `hang` on the first, Done on the second, release | The second notification is not shown after Done | Both are shown (`['A','B']`). Window is the dispatch of up to 3 singles, each waiting for the adapter's show confirmation (up to 3 s on a slow desktop; milliseconds normally). Suggestion: before `adapter.show` in `dispatch`, skip a claimed item whose occurrence is no longer pending or snoozed and record it as `uncertain` or `skipped`. Acceptable to defer with a recorded note |
| QA5-03 | Low | More than 500 overdue at once produce two summaries, each saying "500 reminders are overdue" | Q8b: 1,000 reminders due, resume | One summary naming the true total (1,000) | Two notifications "500 reminders are overdue" (`DUE_CHUNK` 500). Overdue summary and Reminders counts are correct (1,000). Rare; fix by counting the remaining due rows or capping to one summary per wake |
| QA5-04 | Low | Quiet hours enabled with an unknown zone are silently ignored | Code review: `quietWindowAt` returns null when `zoneId` is null. A fresh install leaves the default null | Either a visible state in Settings or the computer zone as the fallback | Quiet hours do nothing, without a message, when no zone is stored and the computer zone was unknown at the time of saving. `ReminderSettings.tsx` fills `zoneId` with the computer or default zone when quiet hours are enabled, so the UI path is covered; only a hand-written setting could hit it. Informational |

## Notes and unverified items

- Notification click on a note trashed after the alert (Q15) calls `openNote` for the trashed note's id with no block. What the main window then shows is the Phase 02 trashed-note behavior; I did not verify the screen.
- A forced Wayland leg is informational only (D-050) and was not rerun.
- Dismissing a notification not equal to Done, click opens the correct note, hidden widget keeps scheduling, widget Done/Snooze/Open and one scheduler: relied on the implementer's passing E2E and integration cases (`reminders.spec`, `widget.spec`, `scheduler.test`), which I read and found to assert the stated behavior; not rerun.

## Pending native cases (not run, not claimed as passed)

- Windows real toast click opening the note (INF-REM-07 native part): manual steps are in `docs/progress/phase-05.md`; pending a person.
- WSLg native toast and click: `not_run` (no notification server on WSLg, D-077).
- Real sleep and wake, live OS zone change, launch at login set for real, widget pinned over other applications, user drag and resize: Phase 09 matrix.
- GNOME notification and autostart cases: outside the user-selected validation scope.

## Re-QA after Repair 1

Date 2026-10-09. Read: "Repair 1" in `docs/progress/phase-05.md`, D-087, `coordinator2-check.log` (exit 0), `coordinator2-build.log` (exit 0), `coordinator2-test-e2e.log` (168 passed, 1 skipped, exit 0). Probe Q19 was fixed (key `reminders.followupDefault`); all earlier probes and specs were rerun unchanged, plus new probes in `.infinity-work/qa/p05-repair.test.ts` and E6 in `p05-e2e.spec.ts`.

### Verdict: pass (local acceptance). Native cases remain pending as before.

### Checks

| Check | Command | Status | Evidence |
| --- | --- | --- | --- |
| All vitest probes (Q1 to Q19, R1 to R8, M1; 29 tests) | `npx vitest run --config .infinity-work/qa/p05.vitest.config.ts --reporter=verbose --silent=false` | passed 29/29 (two probe-side mistakes in my new M1 were fixed first, see the log of the first run `qa2-vitest-m1.log`) | `.infinity-work/logs/phase-05/qa2-vitest.log`, `qa2-vitest-m1.log` |
| Windows Electron E2E (E1 to E5 plus new E6 settings:set quiet hours) | `node node_modules/@playwright/test/cli.js test -c .infinity-work/qa/p05.config.ts` (Node 24.21 portable) | passed 6/6 | `.infinity-work/logs/phase-05/qa2-e2e-win.log` |
| WSLg run of the same 6 specs (Ubuntu 26.04.1, Node 24.21.0; only `docs/progress/phase-05.md` differs from the mirror) | `wsl -d Ubuntu -u infinity -- bash /mnt/e/notecapt/.infinity-work/qa/wsl-p05-qa.sh` | passed 6/6, `electron left: 0` | `.infinity-work/logs/phase-05/qa2-e2e-wslg.log` |
| Vitest probes under WSL | not run | not run (optional; the Windows run and the implementer's WSL `npm run check` cover it) | none |

### Repairs verified

- QA5-01: Q4 now shows only `initial` (one notification); Q5 shows 3 before and after the edit. R1: raising the maximum after it was reached fires the late follow-up at once and then stops at the new total (initial plus 3 follow-ups); switching off then on again with 10 min x 5 stays bounded (6 notifications in total in the test). R2: editing the interval while snoozed keeps the snooze alert and its time, then follow-ups use the new 30 minute interval (deliveries initial, snooze, followup, followup). R3: an edit between read and claim of a follow-up makes the claim lose: no delivery, no further notification.
- QA5-02: Q1 now shows `['A']`. R5: Done on a claimed sibling gives delivery `skipped` (detail `superseded-before-dispatch`), the occurrence is completed, listed under Completed only, absent from Overdue, with no in-app alert. R4: a snoozed sibling is also `skipped`, stays `snoozed`, alerts once at its snooze time, and raises no in-app alert. R6 (a scheduler built so that Done and Snooze land between claim and dispatch): the summary says "3 reminders are overdue" for 5 claimed, with 2 `skipped` and 3 `dispatched`. R7: three same-instant alerts are shown in creation order.
- QA5-03: R8 and Q8/Q8b: 1,000 due at a resume give exactly one notification "1000 reminders are overdue", one batch and 1,000 deliveries, no in-app alert.
- QA5-04: Q19 and E6 through the real IPC (Windows and WSLg): `settings:set` quiet hours with `enabled: true` and zone null, a missing zone, start `25:00` and an unknown zone all return `VALIDATION_FAILED` with a message ("Invalid request: value", "Choose a time zone from the list", ...), no crash, and the main process stays alive; `enabled: false` with null zone and an enabled value with `America/New_York` are accepted.
- Migration 005 (M1): migrations 001 to 004 are byte-identical to commit a44d883. A v4 database built with them and populated (project, folder, rich Bangla note with a block ID, plain note, trashed note, settings, window state) upgrades to v5 with every table identical row for row, `foreign_key_check` empty, FTS search still finds the note, one pre-migration copy kept. The new tables accept a `skipped` delivery and reject an unknown outcome. A fresh profile opens at schema 5.

### Observations (not blocking)

- QA6-01 (Low, observation): a `skipped` follow-up still counts toward `followups_sent`, because the claim increments the count before dispatch (R4: deliveries `initial`, `followup:skipped`, `snooze`, `followup`; `followups_sent` was 1 after the skipped one). The user can therefore see fewer follow-ups than the maximum after a snooze, never more. This is bounded and arguably consistent with "a snooze restarts the cadence"; if the stricter reading (a skipped alert never counts) is wanted, decrement the count when recording `skipped`. The coordinator's brief expected skipped not to count; I could not confirm that from the code.
- QA6-02 (Low, pre-release only): a development profile that already holds schema 5 from before Repair 1 keeps the old outcome CHECK, so recording `skipped` fails the dispatch transaction there (implementer already notes this). No runtime migration-checksum comparison exists, so such a profile still opens. Delete or recreate the dev profile before the acceptance run. I did not run this failure.
- R6 relies on a test-only arrangement (Done and Snooze invoked from `emitChanged`) because in production nothing can run between the claim and the check of a summary; the mixed-superseded count is covered by that arrangement and by the code path being the same as for singles.

### Pending native cases (unchanged, not claimed)

Windows real toast click (manual steps in `docs/progress/phase-05.md`); WSLg native toast (`not_run`, D-077); real sleep and wake, live OS zone change, launch at login set for real, widget pin, drag and resize (Phase 09); GNOME-only cases outside the validation scope.

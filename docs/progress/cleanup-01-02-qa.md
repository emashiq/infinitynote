# QA: cleanup of Phases 01-02 (independent review)

Reviewer: infinity-qa (Sonnet 5.5 medium), 2026-10-08. Base: `1dda11f`. Reviewed `git diff HEAD -- src tests tools` and `docs/progress/cleanup-01-02.md`. No application source, test or tool file was edited. QA specs live in `.infinity-work/qa/`.

## Verdict: PASS

No actionable defect. Behavior is preserved, the sandbox fix is real and its assertion genuinely fails when the sandbox is off.

## 1. Behavior preservation (diff-based)

- IPC: `CHANNEL_SCHEMAS` entries are textually unchanged. Only the type annotation changed (`as const satisfies Record<InvokeChannel, ChannelSchema>`). The router validation order is unchanged (sender policy, size, Zod parse, handler, optional response validation, envelope, same messages). The preload forwards `req ?? {}` as before.
  - One theoretical difference: the old `call0` bridge methods dropped any argument, so the new generic `call` forwards a stray argument. The bridge types forbid arguments (`Query<C> = () => ...`), no renderer code passes one, and the "bridge surface" and "validation errors" specs pass.
- Migrations and DB: `src/main/db/migrations*` is untouched. `migrate.ts` and `open-database.ts` only swap in `errorMessage`. The `migration-failure` spec (sha-256 unchanged, pre-migration copy, newer schema, unreadable DB) passes on Windows and WSLg.
- Settings: `PUBLIC_SETTING_KEYS` is derived from the registry and equals the six keys of the old hand-copied list. `session.tabs` stays internal.
- Strings: `MSG` moved verbatim, and the "Storage is unavailable" text is the same.
- Trash rewrite (363 to 265 lines plus `TrashRepo`): compared line by line with the old service. Batch marking, `restoreTarget`, the `relocated` rule, `reanchorSurvivors` (guards of 100 steps and 40 rounds), the invariant check and `onChange` after commit are equivalent. `NoteWriter` conflict ordering (trashed, then stale, then format mismatch), the draft in the same transaction, ack cache and emit are equivalent. `HierarchyService.moveFolder` keeps the check order (live, location, scope, cycle, depth, no-op).
- Tests, not weakened:
  - E2E: titles and `expect` counts per spec are identical to HEAD. The only removed `test.*` lines are the per-file `afterEach`/`beforeEach` hooks, now provided by `useApp()`. New assertions: `security.spec` sandbox test (+1) and `packaged.spec` (+1).
  - Integration: the "two broadened cases" check out. `registers every catalogue channel` now requires all 31 channels (was 27, excluding app and capabilities). The storage-unavailable case covers 13 storage channels through the production `registerIpcHandlers`, plus a working app channel (was 2 channels). The oversize case adds `handler not called`. The `ipc-validation` loss of one `expect` is the settings storage-unavailable assertion, which moved to the stronger `ipc-handlers-phase02` case (net gain).
  - `boundaries.test` guard was rewritten because the old `channel: '...'` regex would have silently stopped matching. The new one has a positive control (`router.register('note:save'`).
  - `seqIds` to `randomIds` is a rename only.

## 2. Sandbox fix

- `chromiumSandbox: true` is set in the single launch site, `tests/e2e/fixtures.ts` `launchApp`. A grep of `tests`, `tools` and `.infinity-work/qa` finds no other `electron.launch` or spawn of Electron (`harness.ts` goes through `launchApp`). The only `--no-sandbox` mention is a CI-config unit test asserting its absence. `.infinity-work/cleanup/negative/sandbox-off.spec.ts` (outside the suite) intentionally launches the old way.
- The assertion checks OS evidence, not Electron flags. On Linux the renderer must have its own user and PID namespaces and `Seccomp: 2`. On Windows it uses `getAppMetrics().sandboxed`.
- I re-ran the negative control myself on WSLg (`qa-wsl-negative-control.log`). With the pre-cleanup launch options the test fails: `ownUserNamespace=false ownPidNamespace=false Seccomp=2`. With the fix (`qa-wsl-security.log`) it passes: `ownUserNamespace=true ownPidNamespace=true Seccomp=2`. Windows: `sandboxed=true integrity=untrusted`.
- Limitation, as documented by the implementer: on Windows `--no-sandbox` makes the app exit before a window, so the Windows check is positive evidence only.

## 3. Refactor quality

- Database-failed path: `index.ts` passes `services = null` to `registerIpcHandlers`. Every storage channel answers `INTERNAL "Storage is unavailable"` and app/capabilities channels still work. My new QA spec drives the real failed-upgrade app (legacy `notes` table) and checks 10 storage channels, plus `app:getInfo` (`startup.status = 'error'`) and `capabilities:get` (see the checks table).
- `tree:changed` broadcast: my spec subscribes in the renderer and sees the reasons `create, rename, pin, favorite, move, trash, restore, purge`. The trash event carries `trashedNoteIds` of length 1. Reasons and ordering match the services.
- Transactions: `runTx` is unchanged and moved to `transaction.ts`. `NoteWriter` still has a single immediate transaction. `onChange` is still emitted after commit. A stale save returns CONFLICT with one `conflict` draft and an unchanged revision, and a retry with the same requestId returns an identical ack (QA spec).
- Removed `fs.mkdirSync(logsDir)` in `index.ts` is safe: `createFileLogger` creates the directory itself (`logger.ts:29`).
- Minor, not blocking: the preload `call` is now unfrozen-then-frozen in a loop. Group and root objects are frozen as before, and the "bridge surface" spec confirms the frozen surface.

## 4. Checks

| # | Command | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Controller `npm run check` | passed (exit 0, traceability fails=0) | `.infinity-work/logs/cleanup-01-02/coordinator-check.log` |
| 2 | Controller `npm run build` | passed | `.infinity-work/logs/cleanup-01-02/coordinator-build.log` |
| 3 | Controller `npm run test:e2e` (Windows) | passed (76 passed, 1 Linux-only skip) | `.infinity-work/logs/cleanup-01-02/coordinator-test-e2e.log` |
| 4 | Playwright `tests/e2e/migration-failure.spec.ts tests/e2e/security.spec.ts` (Windows, Node 24.21 portable) | passed (14/14, includes sandbox test) | `.infinity-work/logs/cleanup-01-02/qa-win-migration-security.log` |
| 5 | Playwright `-c .infinity-work/qa/p02.config.ts` (all Phase 02 QA specs plus the new `p02-cleanup`) | one spec-defect failure and one spec-payload failure, both in QA specs, fixed and rerun (see 6 and 7) | `.infinity-work/logs/cleanup-01-02/qa-win-p02-all.log` |
| 6 | Rerun `p02-cleanup` and `p02-ui.spec.ts:78` | passed (3/3 and 1/1). The `p02-ui:78` failure was pre-existing: the same failure is in the Phase 02 QA logs. The test read the Details panel, which is closed by default. I adjusted only the QA spec | `.infinity-work/logs/cleanup-01-02/qa-win-p02-cleanup.log`, `.infinity-work/logs/cleanup-01-02/qa-win-p02-rerun.log` |
| 7 | New QA spec `p02-cleanup.spec.ts`: storage unavailable when the DB failed to open, `tree:changed` reasons, stale save and idempotent retry | passed (3/3) | `.infinity-work/logs/cleanup-01-02/qa-win-p02-cleanup.log` |
| 8 | WSLg (`wsl -d Ubuntu -u infinity`, `~/infinity-notes`, sources diffed identical to the repo): `npm run test:e2e -- tests/e2e/security.spec.ts tests/e2e/migration-failure.spec.ts` | passed (14/14), sandbox evidence `ownUserNamespace=true ownPidNamespace=true Seccomp=2` | `.infinity-work/logs/cleanup-01-02/qa-wsl-security.log` |
| 9 | WSL negative control `sandbox-off.spec.ts` (old launch options plus the new assertion) | failed as intended (assertion catches the unsandboxed renderer) | `.infinity-work/logs/cleanup-01-02/qa-wsl-negative-control.log` |
| 10 | Diff review (IPC schemas, migrations, settings keys, strings, tests per-spec counts) | passed (see sections 1 and 3) | this file |

The earlier Phase 02 hierarchy, stale and UI QA specs (`p02-hierarchy`, `p02-stale`, `p02-stale2`, `p02-ui`) passed unchanged against the refactored code (26 of 28 in the first run, with the 2 failures in rows 6 and 7 above resolved in the rerun). No fixture API change was needed.

## Not run

- Linux packaged build and packaged E2E (`package:linux`) and Linux full E2E re-run by QA: not repeated; the implementer logs show 77/77 on WSLg and Xvfb and the controller did not re-run them. Native GNOME/X11 cases are outside the user-selected validation scope.

## Issues

None blocking.

- Informational: a QA-only note that `p02-ui.spec.ts:78` previously failed for a QA spec reason (Details panel closed by default), unrelated to the cleanup. Fixed in the QA spec.
- Informational: the WSLg launch-exit flake (`X connection error`) the implementer recorded remains under watch and did not recur in my 14-test WSLg run.

## Blockers

None.

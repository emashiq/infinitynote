# Acceptance: cleanup of Phases 01–02

Acceptor: infinity-acceptor (Opus 5.5, high), 2026-10-08. Base: `1dda11f` (Phase 02). Scope: the uncommitted cleanup diff in `src`, `tests` and `tools` (`git diff HEAD -- src tests tools package.json`); the Phase 03 planner edits under `docs/` were not judged. Inputs: `docs/progress/cleanup-01-02.md` (implementer), `docs/progress/cleanup-01-02-qa.md` (QA, PASS), `docs/progress/phase-01-acceptance.md` and `phase-02-acceptance.md` (accepted baseline), and the logs in `.infinity-work/logs/cleanup-01-02/`.

## Decision: ACCEPTED

Product behavior and the accepted Phase 01–02 requirements are preserved. No test was weakened. The Linux E2E sandbox fix is real, and a negative control that fails without it backs it up. The refactor improves the structure: one service graph, one handler registration, router types derived from the schemas, and SQL moved into repositories. I found no new risk. Every final gate ran after the last source change, and I re-ran the Windows check, the full Windows E2E suite and the WSLg sandbox positive and negative controls myself.

## What I verified in the code (not only the reports)

- **IPC router** (`src/main/ipc/router.ts`): the dispatch order is unchanged: sender policy, JSON size limit, Zod parse of `payload ?? {}`, handler, dev-only response validation, envelope. Error codes and messages are unchanged. The schemas now come from `CHANNEL_SCHEMAS[channel]`, so a handler can no longer be paired with the wrong schema. `CHANNEL_SCHEMAS` entries are textually unchanged; only the annotation became `as const satisfies`.
- **Registration** (`src/main/ipc/register-handlers.ts`): all 31 channels are registered in one place. With `services === null`, every storage channel throws `AppError('INTERNAL', 'Storage is unavailable')`, the same text as the removed `need.ts` and the settings inline copy. App and capabilities channels stay storage-independent.
- **Service graph** (`src/main/main-services.ts`, `src/main/index.ts`): it builds the same nine services with the same dependencies. The lease manager still has no-op `requestRelease` and `emit` (Phase 02 single view), and the writer `emit` is still a no-op. The initial native theme now uses `settings.getInternal('appearance.theme')` plus `ThemeSetting.safeParse`. This is equivalent to the old `settings.get([...])` plus a literal check: same `readOne`, same enum. Capability detection reuses the display inputs collected at startup instead of collecting them again lazily. The inputs are process environment and switches, so the result is the same. The removed `fs.mkdirSync(logsDir)` is covered by `createFileLogger` (`logger.ts:29`).
- **TrashService and TrashRepo**: I compared them line by line with `1dda11f`.
  - Trashing marks folders, then notes, then the project, in the same order with the same SQL.
  - `trashProject`'s folder count now comes from `UPDATE ... .changes` instead of a prior `count(*)`. These are the same rows inside the same immediate transaction.
  - `restoreTarget` keeps the rule: a missing or trashed project goes to the Common root; otherwise the nearest live ancestor, with a 100-step guard.
  - `relocated` is still `moved || reanchored`.
  - Purge keeps the order: re-anchor survivors, delete reanchored flags, notes, folders leaf-first (40 rounds), projects, mark attachments unreferenced.
  - The invariant check still runs inside the transaction.
  - One difference: the batch uuid and the clock are now read before the NOT_FOUND check. The transaction rolls back and ids are random, so nothing observable changes.
- **NoteWriter**: the conflict order is unchanged: trashed, then stale (both become a conflict draft in the same transaction), then format mismatch. The other paths are also unchanged: the lease-lost draft outside the transaction, the ack cache before the transaction, emit and remember after commit. The SQL in `NotesRepo.writeContent` and `insertDraft` is byte-identical to the old inline SQL.
- **HierarchyService**: `requireLive` keeps the `inTrash` and `missing` message choice. `moveFolder`'s check order is unchanged: live, project, parent live, scope, cycle, depth, no-op. The only change is that the parent depth is read before the cycle check, which is a read-only query on existing rows. Invariant failures are no longer logged with their own prefix, but `runTx` logs the stack, which contains `invariant violated: …`, and still returns INTERNAL.
- **HomeService and SessionService**: the scope fallback, filters, limits and ordering are the same. The session states query is the same SQL behind `NotesRepo.states`.
- **Renderer**: only types and casts changed, plus these:
  - The `settings:changed` handler now validates the theme with `ThemeSetting` (same enum).
  - `buildPathIndex` receives DTO arrays directly (structurally a superset of the fields it needs).
  - `MoveDialog` no longer calls `report()` on success. That call was a no-op: it returns `true` and pushes no notice.
  - The `projectsGroup.childKeys` re-assignment in `tree-model.ts` was a genuine duplicate. The same assignment runs at line 86, and folders and notes never use the `projects` key as their parent.
- **Migrations, schema, packaging config**: no file under `src/main/db/migrations*`, `package.json` or the builder configuration changed.

## Tests not weakened

- I counted `expect(` (including `expect.poll`) and `test(`/`it(` calls in every changed test file at HEAD and in the working tree. They are equal everywhere except where tests were added:
  - `security.spec`: 21→22 expects, 10→11 tests (new OS-sandbox test).
  - `packaged.spec`: 17→18 expects (OS-sandbox assertion).
  - `boundaries.test`: 12→13 expects (positive control).
- No new `.skip`, `.only` or `.fixme`. The only skips are the existing `packaged.spec` environment guard and the Linux-only smoke test.
- Every `expect.poll` is awaited (grep finds no un-awaited use).
- `ipc-validation.test` gained `expect(handler).not.toHaveBeenCalled()` in the oversize case. The settings storage-unavailable assertion moved into the stronger `ipc-handlers-phase02` case, which covers 13 storage channels through the production `registerIpcHandlers`.
- The `boundaries.test` Phase 03 channel guard was rewritten for the new `register('channel', …)` syntax. It has a positive control, so it cannot silently match nothing.

## Sandbox fix (CL-1): genuine, with a meaningful failing control

- The fix is `chromiumSandbox: true` in `launchApp` (`tests/e2e/fixtures.ts`), the single Electron launch site of the suite.
- The new assertion `rendererSandbox(app)` reads OS evidence:
  - Linux: the renderer has its own user and PID namespaces compared with the main process, and `Seccomp: 2`.
  - Windows: `getAppMetrics().sandboxed`.
- It does not rely on `webPreferences.sandbox` or `--enable-sandbox`, which stay set under `--no-sandbox`. The implementer's matrix log shows that seccomp stays on under `--no-sandbox`, so the namespace checks are what discriminate.
- **Negative control:** `.infinity-work/cleanup/negative/sandbox-off.spec.ts` launches exactly like the old fixture and fails with `ownUserNamespace=false ownPidNamespace=false Seccomp=2`. Three independent runs agree: the implementer's, QA's, and my own rerun (`acceptor-wsl-sandbox.log`).
- **Positive control:** with the fix, the renderer reports `ownUserNamespace=true ownPidNamespace=true Seccomp=2` on WSLg and Xvfb, and `sandboxed=true integrity=untrusted` on Windows in both the dev and packaged builds.
- **Windows has no failing control.** Under `--no-sandbox` the app exits before its first window, so the Windows check is positive evidence only. This is recorded honestly.

## Gate timing (mtimes, local time +06:00)

- **Last source or test change:** `tests/e2e/packaged.spec.ts` and `security.spec.ts` at 21:23:24.
- **Implementer final gates, all later:**

  | Gate | Finished |
  | --- | --- |
  | `win-check` | 21:24:21 |
  | `win-build` | 21:24:25 |
  | `win-test-e2e` | 21:25:42 |
  | `win-package-current` | 21:26:19 |
  | `win-test-e2e-packaged` | 21:26:22 |
  | `wsl-sync` (`MIRROR_IDENTICAL`) | 21:27:01 |
  | `wsl-check` | 21:27:15 |
  | `wsl-build` | 21:27:18 |
  | `wsl-test-e2e-wslg` | 21:28:34 |
  | `wsl-test-e2e-xvfb` (DISPLAY=:99 confirmed in the app log line) | 21:29:44 |

- **Coordinator gates:** check, build and E2E at 21:32–21:33.
- **QA runs:** 21:37–21:39.
- `wsl-npm-ci` (21:20) ran before the final sync. That is acceptable because `package.json` and the lockfile did not change in the cleanup.

## Acceptor spot-runs

| Command | Result | Log |
| --- | --- | --- |
| `npm run check` (Windows) | exit 0: 222 unit, 126 integration, traceability ids=187 fails=0 | `.infinity-work/logs/cleanup-01-02/acceptor-check.log` |
| `npm run test:e2e -- --reporter=line` (Windows, `INFINITY_E2E_NODE` = portable Node 24.21.0; builds first) | exit 0: 76 passed, 1 skipped (Linux-only); `renderer sandbox: sandboxed=true integrity=untrusted` | `.infinity-work/logs/cleanup-01-02/acceptor-test-e2e.log` |
| WSL mirror check (`diff -rq` of `src`, `tests`, `tools` and `package.json` against `~/infinity-notes`) | identical | `acceptor-wsl-sandbox.log` (preceding check) |
| WSLg `npm run build`, then `security.spec` + `migration-failure.spec` | build 0; 14 passed; `ownUserNamespace=true ownPidNamespace=true Seccomp=2` | `.infinity-work/logs/cleanup-01-02/acceptor-wsl-sandbox.log` |
| WSLg negative control `sandbox-off.spec.ts` | 1 failed as intended (`ownUserNamespace=false ownPidNamespace=false Seccomp=2`) | `.infinity-work/logs/cleanup-01-02/acceptor-wsl-sandbox.log` |

Afterwards no `electron` process remained in WSL (`pgrep -c` printed 0).

## QA observation: the generic preload `call` forwards a stray argument

- **What changed:** the old `call0` methods always sent `{}`. The new generic `call` sends `args[0] ?? {}`.
- **Why it does not matter:**
  - The bridge types declare these methods as `() => …`, so typed renderer code cannot pass an argument.
  - I grepped `src/renderer` and found no bridge method passed as a bare callback (for example as an `onClick`), which could otherwise forward an event object.
  - If an argument did arrive, main parses it against the strict `Empty` schema and answers `VALIDATION_FAILED` without calling the handler. That is a stricter outcome than silently dropping it, and it fits the rule that main is the authority.
- **Decision:** not a defect, and no change is required.

## Follow-ups (non-blocking)

- **CL-F1 (Phase 09, Linux packaged and native):** `rendererSandbox` requires the renderer to have its own **user** namespace. That holds for Chromium's user-namespace sandbox, which WSL uses: its kernel has no `apparmor_restrict_unprivileged_userns`. On hosts that restrict unprivileged user namespaces (for example stock Ubuntu 24.04+ desktops), Chromium falls back to the SUID `chrome-sandbox` helper. The renderer then gets a new PID namespace but not its own user namespace, so the assertion would report a false failure. It cannot produce a false pass. When the Phase 09 Linux packaged E2E runs on such a host, record which sandbox mode is in use. If it is SUID, accept own-PID-namespace plus `Seccomp: 2` for that mode. Keep the negative control: under `--no-sandbox`, both namespace checks must stay false.
- **Linux packaging not rerun:** `npm run package:linux` and the Linux packaged E2E were not rerun for the cleanup. Packaging inputs are unchanged, and they stay Phase 09 gates, as recorded by the implementer.
- **Carried over unchanged:**
  - Phase 03 entry items: F-02-1, F-01-3 and D-048.
  - Phase 09: F-01-5, F-01-6 and the native-frame part of INF-SHELL-06.
  - Still open: F-02-2 and F-02-4.
  - F-02-3 (polling tab reads) is closed by this cleanup.
  - The WSLg `X connection error` launch flake stays under watch. It appeared once in a development run (`wsl-dev-security-wslg.log`) and not in the final 77/77 runs, QA's 14-test run or my 14-test run.
- **For the commit:** `.claude/agents/infinity-code-opus.md` is a new untracked agent definition created with this work. Include or exclude it deliberately when committing; it is not application code.

## Blockers

None.

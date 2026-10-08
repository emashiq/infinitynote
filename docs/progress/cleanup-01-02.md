# Cleanup of Phases 01–02 before Phase 03

Implementer: infinity-code-opus (Opus 5.5, high), 2026-10-08. Base: `1dda11f` (Phase 02). Host: Windows 11 Pro 10.0.26300, Node 24.15 (Playwright worker Node 24.21.0 via `INFINITY_E2E_NODE`). Linux: WSL2 Ubuntu 26.04.1 LTS, user `infinity`, Node 24.21.0, WSLg 1.0.73 (Weston, the app runs with `ozone=x11` through XWayland), plus Xvfb. Nothing was committed. The pack, `.claude/`, `CLAUDE.md`, the checkpoint and the Phase 03 planner documents were not edited.

## Summary

- Product behavior, the IPC channel catalogue and payload shapes, the database schema and migrations (checksums unchanged), settings keys and every user-visible string are unchanged.
- Main: the service graph moved out of `index.ts` into `createMainServices`; one `registerIpcHandlers` replaces nine nullable service variables and two copies of the "storage unavailable" helper; the IPC router is now typed per channel from `CHANNEL_SCHEMAS`, so handler requests and responses are checked by the compiler instead of being hand-annotated; raw SQL moved out of `TrashService`, `NoteWriter`, `HomeService` and `SessionService` into repositories; duplicated path-index, invariant and error-message code was consolidated.
- Shared and preload: `InfinityBridge` method types are derived from the channel schemas, `subscribe` is typed per event, and the preload object is type-checked against `InfinityBridge` (the `as unknown as InfinityBridge` cast is gone, so a missing bridge method is a compile error).
- Renderer: casts and dead code removed; no component or store behavior changed.
- Tests: the mandatory Linux E2E sandbox fix with a sandbox assertion that fails when the sandbox is off; Phase 01 specs moved onto the shared `useApp()` harness; shared IPC test helpers; F-02-3 (polling tab reads) done.
- Gates after the last change: Windows check, build, E2E (76 passed, 1 Linux-only skip), package and packaged E2E (2 passed); WSL check, build, E2E under WSLg (77/77) and Xvfb (77/77), all with the renderer sandbox verified on.

## Changes by area, with rationale

### Main process

| Change | Rationale |
| --- | --- |
| New `src/main/main-services.ts`: `MainServices` and `createMainServices({db, clock, ids, logger, onSettingsChanged, onTreeChanged})` | `index.ts` built nine services into nine `let x: X \| null` variables. The integration helper rebuilt the same graph by hand; it now calls `createMainServices`, so tests exercise the production wiring. |
| New `src/main/ipc/register-handlers.ts`: `registerIpcHandlers(router, {app, services})` | Registers every catalogue channel. With `services: null` (database failed to open) every storage channel answers `INTERNAL "Storage is unavailable"` through one accessor. Removed `handlers/need.ts` and the duplicate inline copy in `settings-handlers.ts`. |
| `ipc/router.ts`: `register(channel, handler, options?)` with `Handler<C> = (request: ChannelRequest<C>, ctx) => ChannelResponse<C>`; schemas are looked up from `CHANNEL_SCHEMAS` | Replaces `register({channel, ...CHANNEL_SCHEMAS[channel], handler})`, where `handler` took `payload: never` and every handler restated its request type by hand (unchecked against the schema). Handler files shrank to one line per channel. Runtime behavior (sender policy, size limit, Zod parse, dev response validation, envelope) is identical. |
| `capabilities:get` registered in `handlers/app-handlers.ts` (`AppHandlerDeps.getCapabilities`); `handlers/capabilities-handlers.ts` deleted | Both Phase 01 handler groups are the storage-independent ones; one 11-line file per channel was noise. |
| `index.ts`: wiring only (183 lines, was 233); capability inputs collected once; `ipcMain` passed without a cast; theme value validated with the shared `ThemeSetting` schema | Easier to extend in Phase 03 (section 8.10 of the Phase 03 plan now adds services in `createMainServices`). |
| `services/dto.ts` keeps only the row-to-DTO mappers plus `pathIndexFromRows` and `livePathIndex`; `runTx` moved to `services/transaction.ts`, `MSG` to `services/messages.ts` | `dto.ts` mixed mappers, transactions and messages. The identical six-line `buildPathIndex(rows.map(...))` block existed five times in main. |
| New `db/repositories/trash-repo.ts` (`TrashRepo`); `TrashService` rewritten on it (265 lines, was 363) | The service mixed batch logic with 20 inline SQL statements. Logic is unchanged: the batch-marking helper, `restoreTarget` (nearest live ancestor) and `reanchorSurvivors` (D-046) are now named steps. |
| `HierarchyRepo`: `pinnedNotes`, `countPinned`, `recentNotes`, `assertInvariants`; `reparentFolder` no longer re-parses its own JSON | Home queries left `HomeService`; the duplicated `checkInvariants` (hierarchy and trash) became one repository method. |
| `NotesRepo`: `getSaveState`, `writeContent`, `insertDraft`, `states` | `NoteWriter` and `SessionService` now use the repository. `NoteWriter.save` reads as lease check, ack cache, one transactional `write`; error codes and messages unchanged. |
| `HierarchyService`: `requireLive` helper; `moveFolder` reuses `assertLocation`; `repo` is private | Removed four copies of the live-row check and the duplicated project/parent validation in `moveFolder` (same checks, same order). |
| `services/app-error.ts`: `errorMessage`, `errorDetail` | Replaced eight copies of `err instanceof Error ? err.message : String(err)`. |

### Shared contracts and preload

| Change | Rationale |
| --- | --- |
| `contracts/channels.ts`: `CHANNEL_SCHEMAS` and `EVENT_SCHEMAS` declared `as const satisfies Record<...>`; new `ChannelInput<C>`, `ChannelRequest<C>`, `ChannelResponse<C>`, `EventPayload<C>` | The `Record<InvokeChannel, ChannelSchema>` annotation erased every schema type, which forced the casts above. |
| `contracts/bridge.ts`: methods typed as `Call<'channel'>` / `Query<'channel'>`; `subscribe<C>(channel, cb: (payload: EventPayload<C>) => void)` | One source of truth for request and response types; the renderer no longer casts event payloads. The runtime surface (`security.spec › bridge surface`) is unchanged. |
| `preload/index.ts`: one generic `call(channel)`; the bridge literal is typed `InfinityBridge`, then frozen at both levels | Removes `as unknown as InfinityBridge`. The forwarded payload is still `req ?? {}`. |
| `tree/paths.ts`: `PathIndex` type; `tree/tree-model.ts`: `TreeNode.location` is `LocationType`; dead `void common`, a duplicate `projectsGroup.childKeys` assignment and a type alias removed | Removed the `location as LocationType` casts in `locationOfNode` and `commands.ts`. |

### Renderer

- `state/app-services.ts`: reads `PUBLIC_SETTING_KEYS` instead of a hand-copied list; typed event subscriptions (theme validated with `ThemeSetting`); simpler `init`.
- `buildPathIndex(snapshot.projects, snapshot.folders)` directly in `live-note.ts`, `StickiesPage.tsx`, `tree-store.ts` (the DTOs already have the needed shape; three field-by-field copies removed).
- Casts removed: `NoteView` scroll position (narrowed by tab kind), `note-controller` save content (`as never`), `tree-store` trash call and error types (now `Result`/`ErrorEnvelope`).
- `NameDialog` and `TreePane` use the shared `normalizeName`; `Splitter` uses `TREE_MIN`/`TREE_MAX` for its ARIA range; `MoveDialog` drops a no-op `report()` call after success; `actions.createNoteAt` passes the location object as is.

### Tests

| Change | Rationale |
| --- | --- |
| `e2e/fixtures.ts`: `chromiumSandbox: true` and `rendererSandbox(app)` | Mandatory sandbox fix (see defect CL-1). |
| `security.spec`: new "renderer runs inside the OS sandbox"; `packaged.spec`: the same check on the packaged build | Asserts OS evidence, logged in the run output, on every host. |
| `security`, `smoke`, `migration-failure`, `packaged`, `visual` specs use `useApp()` from `harness.ts` | Five copies of userData/launch/teardown boilerplate removed; database reads after close use the harness `all/one/writeWhileClosed`. Every assertion kept. |
| F-02-3: 37 `expect(await tabLabels/activeTabLabel(...))` reads in 7 specs became `await expect.poll(...)` | Removes the non-polling race behind the `tabs.spec.ts:106` WSLg failure. Same expected values; no retries added. |
| New `integration/ipc-helpers.ts` (`fakeIpcMain`, `rendererEvent`) | Was duplicated in `ipc-validation.test` and `ipc-handlers-phase02.test`. |
| `ipc-handlers-phase02.test` registers through `registerIpcHandlers` | "registers every catalogue channel" now covers all 31 channels (was 27); the storage-unavailable case covers 13 storage channels and checks an app channel still works (was 2 channels; the settings case moved here from `ipc-validation.test`). |
| `ipc-validation.test`: new router API; the oversize-payload case also asserts the handler was not called | |
| `boundaries.test`: the Phase 03 channel guard scans all of `src/main/ipc` for the quoted names, with a positive control (`router.register('note:save'`) | The old regex `channel: '...'` would have silently stopped matching after the router change. |
| `integration/helpers.ts`: `seqIds` renamed `randomIds` | It never produced sequential ids. |

## Module rename and move map

No file was renamed. Deleted, added and moved symbols:

| Before | After |
| --- | --- |
| `src/main/ipc/handlers/need.ts` (`need`) | deleted; `use(key)` inside `src/main/ipc/register-handlers.ts` |
| `src/main/ipc/handlers/capabilities-handlers.ts` (`registerCapabilitiesHandlers`) | deleted; `capabilities:get` in `src/main/ipc/handlers/app-handlers.ts` (`AppHandlerDeps.getCapabilities`) |
| service construction in `src/main/index.ts` | `src/main/main-services.ts` (`createMainServices`, `MainServices`) |
| handler registration calls in `src/main/index.ts` | `src/main/ipc/register-handlers.ts` (`registerIpcHandlers`) |
| `runTx` in `src/main/services/dto.ts` | `src/main/services/transaction.ts` |
| `MSG` in `src/main/services/dto.ts` | `src/main/services/messages.ts` |
| inline SQL in `src/main/services/trash-service.ts` | `src/main/db/repositories/trash-repo.ts` (`TrashRepo`) |
| inline SQL in `note-writer.ts` and `session-service.ts` | `NotesRepo.getSaveState/writeContent/insertDraft/states` |
| inline SQL in `home-service.ts` | `HierarchyRepo.pinnedNotes/countPinned/recentNotes` |
| `checkInvariants` in hierarchy and trash services | `HierarchyRepo.assertInvariants` |
| `HandlerDef`, `ChannelSchema` (exported types) | `Handler<C>`, `RegisterOptions` (router); `ChannelInput/ChannelRequest/ChannelResponse/EventPayload` (channels) |
| fake IPC in two integration tests | `tests/integration/ipc-helpers.ts` |

Paths referenced by `docs/plans/phase-03.md` that this cleanup changed (all still exist; none moved):

| Path in the plan | What changed for Phase 03 |
| --- | --- |
| `src/main/ipc/router.ts` | `HandlerDef` no longer exists. The plan's "optional `measurePayload(payload): number` on `HandlerDef`" belongs in `RegisterOptions` (third argument of `router.register`), next to `maxPayloadBytes`. |
| `src/main/index.ts` | Section 8.10 service construction goes into `createMainServices` in `src/main/main-services.ts` (add the new services to `MainServices`); `index.ts` keeps window, protocol and lifecycle wiring (close/quit flush, `before-quit`). |
| `src/main/ipc/handlers/note-handlers.ts`, `hierarchy-handlers.ts`, `app-handlers.ts` (and the new `content-handlers.ts`, `attachment-handlers.ts`) | Register with `router.register('channel', (req, ctx) => ...)`; services arrive as non-null getters; add each new register call to `registerIpcHandlers`. `app-handlers.ts` now also owns `capabilities:get`. |
| `src/main/services/note-writer.ts`, `src/main/db/repositories/notes-repo.ts` | Content writes and drafts go through `NotesRepo.writeContent`/`insertDraft`; the save transaction is the private `write` method. |
| `src/main/services/hierarchy-service.ts` | `repo` is private; `note:create` with `format` changes `createNote` as planned. |
| `src/shared/contracts/channels.ts`, `bridge.ts`, `src/preload/index.ts` | New channels: add the schema to `CHANNEL_SCHEMAS`, a `Call<'x'>`/`Query<'x'>` member to `InfinityBridge` and a `call('x')` to the preload; the compiler then rejects a missing preload method. New events need an `EVENT_SCHEMAS` entry (payload type flows to `subscribe`). |
| `src/renderer/state/app-services.ts`, `src/renderer/notes/note-controller.ts`, `NoteView.tsx` | Typed `subscribe` payloads; small cast removals only. |
| `tests/e2e/{editor,tabs,visual,home}.spec.ts` | Tab-label reads poll (F-02-3); `visual.spec` uses `useApp()`. |
| `tests/integration/ipc-validation` (and the planned `ipc-handlers-phase03`) | Use `tests/integration/ipc-helpers.ts` and `registerIpcHandlers` like `ipc-handlers-phase02.test`. |

## Defects found

### CL-1 (medium; test validity and security evidence): Linux E2E ran without the Chromium namespace sandbox

- Cause: `_electron.launch` adds `--no-sandbox` on Linux unless `chromiumSandbox: true` is passed; `tests/e2e/fixtures.ts` never passed it, so every WSLg and Xvfb E2E run before this cleanup tested a less sandboxed app than users get. Windows was unaffected (Playwright adds the switch on Linux only).
- What was really off (measured, `wsl-sandbox-matrix.log`): with the pre-cleanup options the renderer shares the browser process's user and PID namespaces (layer-1 namespace sandbox off), while the seccomp-bpf filter (`Seccomp: 2`) and `--enable-sandbox` stay. So `webPreferences.sandbox`, the renderer's `--enable-sandbox` switch and even seccomp cannot reveal the problem, and `app.commandLine.hasSwitch('no-sandbox')` reported `false` although the switch was on the command line. The fixed launch gives the renderer its own user and PID namespaces.
- Repro: `.infinity-work/cleanup/negative/sandbox-off.spec.ts` launches exactly as the old fixture and applies the new assertion: fails with `ownUserNamespace=false ownPidNamespace=false Seccomp=2` (`wsl-sandbox-negative-control.log`, EXIT=1).
- Fix: `chromiumSandbox: true` in `launchApp`.
- Regression tests: `security.spec › renderer runs inside the OS sandbox` and the packaged spec call `rendererSandbox(app)`: on Linux the renderer must have its own user and PID namespaces and `Seccomp: 2`; on Windows Electron's process metrics must report the renderer `sandboxed`. Evidence: WSLg `ownUserNamespace=true ownPidNamespace=true Seccomp=2`, Xvfb the same, Windows dev and packaged `sandboxed=true integrity=untrusted`.
- Windows negative control: with `--no-sandbox` the app closes before its first window (`win-sandbox-negative-control.log`), so an unsandboxed renderer cannot reach the assertion there; the Windows check is positive evidence only.
- No product change was needed: production already calls `app.enableSandbox()` and sets `sandbox: true`.

No product defects were found in the Phase 01–02 code during the review. Known items stay with their owners: F-02-1 (flush before closing trashed-note tabs), F-01-3 and D-048 are Phase 03 entry items in the Phase 03 plan; F-01-5 and F-01-6 are Phase 09.

## Follow-ups addressed

- F-02-3: done (polling reads, above). The WSLg launch-exit flake remains under watch: one development run of `security.spec` alone on WSLg failed at "bridge surface" with the known `X connection error received` from a Chromium child (`wsl-dev-security-wslg.log`, recorded as a separate run, not retried); the final full WSLg and Xvfb runs passed 77/77.
- F-02-2 and F-02-4 not touched (planner documents and screenshot regeneration are outside this cleanup).

## Test counts

| Suite | Before (1dda11f) | After |
| --- | --- | --- |
| Unit (vitest) | 222 | 222 |
| Integration (vitest) | 126 | 126 (same count; two cases broadened, one assertion moved between files) |
| E2E listed | 78 (76 dev + 2 `@packaged`) | 79 (77 dev + 2 `@packaged`) |
| Windows E2E | 75 passed, 1 Linux-only skip | 76 passed, 1 Linux-only skip |
| WSLg / Xvfb E2E | 76 / 76 | 77 / 77 |
| Packaged E2E (Windows) | 2 | 2 |

## Commands, exit codes and logs

All logs are in `.infinity-work/logs/cleanup-01-02/`; each ends with `EXIT=<code>` (the Windows negative control ends with `exit=1`).

| Gate | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| Baseline | `npm run check` on 1dda11f | 0 | 222 unit, 126 integration, traceability fails=0 | `baseline-check.log` |
| Windows check | `npm run check` | 0 | 222 unit, 126 integration, ids=187 fails=0 warns=0 | `win-check.log` |
| Windows build | `npm run build` | 0 | | `win-build.log` |
| Windows E2E | `npm run test:e2e` (`INFINITY_E2E_NODE` = portable Node 24.21.0) | 0 | 76 passed, 1 skipped (Linux-only) | `win-test-e2e.log` |
| Windows package | `npm run package:current` | 0 | NSIS `Infinity-Notes-Setup-0.1.0-x64-unsigned.exe`, sha256 `f3fa4b7fafdda15c8c2a0240b53d2702f91425b917344cc4ca76b749af09318a` | `win-package-current.log` |
| Windows packaged E2E | `npm run test:e2e:packaged` | 0 | 2 passed; `sandboxed=true integrity=untrusted` | `win-test-e2e-packaged.log` |
| Windows negative control | `INFINITY_NOTES_E2E_ELECTRON_ARGS=--no-sandbox` playwright `-g "OS sandbox"` | 1 | app closed before its first window | `win-sandbox-negative-control.log` |
| WSL sync | rsync `--delete` from `/mnt/e/notecapt` to `~/infinity-notes` (excluding `node_modules`, `out`, `release`, test output, `.infinity-work`, `.git`), then `diff -rq` | 0 | `MIRROR_IDENTICAL` | `wsl-sync.log` |
| WSL install | `rm -rf node_modules out && npm ci && npm run setup:electron` | 0 | | `wsl-npm-ci.log` |
| WSL check | `npm run check` | 0 | 222 unit, 126 integration, fails=0 | `wsl-check.log` |
| WSL build | `npm run build` | 0 | | `wsl-build.log` |
| WSLg E2E | `npm run test:e2e` (DISPLAY=:0, WAYLAND_DISPLAY=wayland-0; app `ozone=x11`) | 0 | 77 passed; renderer own user/PID namespaces, Seccomp=2 | `wsl-test-e2e-wslg.log` |
| Xvfb E2E | `env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e` (xvfb-run, DISPLAY=:99) | 0 | 77 passed; same sandbox evidence | `wsl-test-e2e-xvfb.log` |
| WSL sandbox matrix | `.infinity-work/cleanup/negative/sandbox-matrix.spec.ts` | 0 | diagnostic only (see CL-1) | `wsl-sandbox-matrix.log` |
| WSL negative control | `.infinity-work/cleanup/negative/sandbox-off.spec.ts` | 1 | assertion fails as intended | `wsl-sandbox-negative-control.log` |
| WSL positive control | `security.spec -g "OS sandbox"` | 0 | passed | `wsl-sandbox-positive-wslg.log` |
| WSLg development run | `npm run test:e2e -- tests/e2e/security.spec.ts` (before the final probe) | 1 | 10 passed, 1 failed with the known XWayland `X connection error` (environmental) | `wsl-dev-security-wslg.log` |

Development runs `dev-check.log` and `dev-win-e2e.log` preceded the final gates. After the runs no `electron` process remained on WSL (`pgrep`) or Windows (`tasklist`). Three orphaned `electron.exe` E2E processes from an earlier session (started 20:31, parent gone, before this cleanup began) were found on Windows and stopped.

## Native cases not run

GNOME and X11 desktop sessions are outside the user-selected validation scope. `npm run package:linux` and the Linux packaged E2E were not run (packaging is unchanged; Phase 09). The native-frame part of INF-SHELL-06 stays pending for the Phase 09 matrix.

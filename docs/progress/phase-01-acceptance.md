# Phase 01 acceptance: Secure desktop foundation and persistence

Acceptor: infinity-acceptor (Opus HIGH), 2026-10-08. Hosts: Windows 11 Pro 10.0.26300 with Node v24.15.0 (installed) and a portable Node v24.21.0 used only for the Playwright runner. WSL2 Ubuntu 26.04.1 LTS with WSLg 1.0.73 (Weston), user `infinity`, Node v24.21.0. I wrote no application code. My own command logs are in `.infinity-work/logs/phase-01/acceptance/`.

## Decision: ACCEPTED

Every functional local gate in the Phase 01 pack passes on Windows and on the user-selected Linux environment (WSL2 Ubuntu + WSLg). I checked the code, the coordinator, implementer, QA and repair logs, and I re-ran the key gates myself. I found no placeholder scripts, weakened assertions, retries or disabled suites. The remaining items are native desktop cases already assigned to Phases 05 and 09, plus low-severity follow-ups. None of them blocks this phase.

## Acceptance criteria (pack phase 01)

| Criterion | Verdict | Evidence I checked |
| --- | --- | --- |
| `npm install` / `npm ci` pass | pass | `win-npm-install.log` and `win-npm-ls.log` (exit 0, no invalid peers). Clean `npm ci` passed on Windows (`win-final-npm-ci.log`, 556 packages) and in WSL (`wsl-npm-ci.log`). `.npmrc` sets `ignore-scripts=true` and `engine-strict=true`. |
| `check` / `build` pass | pass | `coordinator-check-2.log` and `coordinator-build-2.log` ran after both repairs (16:34; the last source/tool edit was 16:27), both exit 0: lint 0 warnings, typecheck for both configs, 86 unit and 56 integration tests, traceability `fails=0`. I re-ran unit and integration on Windows (`acceptance/acc-unit-integration.log`, 86 + 56 pass). I re-ran the full `npm run check` in WSL after re-syncing the current tree (`acceptance/acc-wsl-check.log`, exit 0). |
| A real Electron window starts through E2E | pass | `smoke.spec › starts a real window with temp userData` checks the page title, the h1, the native `BrowserWindow` title and a window count of 1. It passed in `coordinator-e2e.log`, in my Windows run (`acceptance/acc-e2e-node2421.log`: 23 passed, 1 Linux-only skipped, exit 0) and in my WSLg run (`acceptance/acc-wsl-e2e-wslg.log`: 24 passed, exit 0). |
| SQLite persists settings across relaunch | pass | `smoke.spec › setting survives relaunch`: the test clicks "Dark", quits, reads the DB row `{"v":1,"value":"dark"}` with `updated_at > 0`, relaunches, and asserts "Dark" is checked and `data-theme=dark`. `› invalid stored setting falls back` tampers the row, then asserts "System" is checked and the log line is written. The packaged equivalent passes on Windows and WSL (`win-test-e2e-packaged.log`, `wsl-test-e2e-packaged.log`, and my re-run `acceptance/acc-e2e-packaged.log`). |
| Migration failure is handled | pass | Code: `open-database.ts` probes read-only, refuses a newer schema before any write, takes a `db.backup()` pre-migration copy, and `migrate.ts` runs all steps in one IMMEDIATE transaction with `user_version` and `foreign_key_check`. E2E `migration-failure.spec` covers a legacy conflicting DB (byte-identical SHA-256, `user_version 0`, legacy row intact, exactly one openable pre-migration copy, Show data folder records `openPath(<ud>/data)`, Quit exits), a newer schema (unchanged, no `-wal`, no copy) and random bytes (unchanged). Integration covers rollback, the FK violation and retention of 3 copies. |
| Renderer cannot access arbitrary files or SQL | pass | Code: sandbox + contextIsolation + no nodeIntegration; renderer served from the privileged `infinity-app://renderer` scheme (D-035) with a contained-path handler; frozen 4-member bridge with no generic invoke; Zod-validated router with sender policy (top frame, registered webContents, renderer origin) and a 5 MiB limit; network guard. E2E `security.spec`: fetch, XHR and `<img>` of `file://` are blocked; the SQL-injection key gives `VALIDATION_FAILED` and the `settings` table is intact; attachment traversal (raw and `%2e%2e`), non-UUID and document kind all fail. QA's adversarial pass (`qa-adversarial.log`, `qa-wsl-spotcheck.log`) adds iframe, form, `import()`, WebSocket, `__proto__` and BigInt payloads, all rejected. The ESLint boundary test forbids `electron`, `fs` and `better-sqlite3` imports in the renderer. |
| Native module works on the current host (D-038: prebuilt N-API binary loads with no source rebuild) | pass | `verify:native` reported `ok:true` with all 12 self-test checks, SQLite 3.53.4, Electron 44.7.0, ABI 149 in: Windows dev (`win-verify-native-dev.log`), Windows packaged (`win-verify-native-packaged.log`, re-run by me in `acceptance/acc-verify-native-packaged.log`; packaged `.node` SHA `e21e5efd…` equals the node_modules prebuild), WSL dev, WSL linux-unpacked and the WSL AppImage (`wsl-verify-native-*.log`, SHA `6fd4292c…` equal). The tool fails if `node_modules/better-sqlite3/build` exists, so no source rebuild happened. |
| Second OS documented | pass (validated, not just documented) | See "WSL leg" below. |

Per-ID check (plan section 14.1): INF-FND-01, 03, 04, 05, 06, 07, 08, 09, 10, 12 and 13 are covered by the named test cases, and I read the assertions in `smoke.spec`, `security.spec`, `migration-failure.spec`, `scripts.test` and `verify-native.mjs` against the plan text. INF-FND-02 and 11 pass their E and R parts. Their N parts are pending (see the last section). BACKLOG statuses (`done`; 02 and 11 `in_progress`) are consistent with this.

## Decisions requested by the coordinator

### 1. Windows Playwright worker crash (0xC0000409)

**Adequately handled for Phase 01, with one follow-up.**

- The evidence supports the diagnosis. I recounted the logs:
  - `repair2-node2415-*`: 3 of 30 runs crashed (runs 3, 8, 21).
  - `repair2-node2421-*`: 0 of 30.
  - `repair2-final-*` (through `npm run test:e2e` with `INFINITY_E2E_NODE`): 0 of 20, every run "23 passed".
  - With a 10% per-run rate, 0 of 50 has a probability of about 0.5%.
  - The `DEBUG=pw:browser` trace (`repair2-diag-20.log`) shows the Electron app logging a normal startup and exiting with code 0. The Playwright worker is the process that dies.
  - It does not reproduce under WSL Node 24.21, and it does not reproduce in the packaged runs.
  - The product is not implicated.
- The handling is honest:
  - `playwright.config.ts` keeps `retries: 0`, and there are no `.only` or added skips.
  - `tools/run-e2e.mjs` only chooses which Node binary runs the Playwright CLI (`INFINITY_E2E_NODE`, default `process.execPath`). The global Node is not modified.
  - On Windows Node 24.x below 24.21 it prints a warning. I confirmed the warning appears with the default Node (`acceptance/acc-e2e-native-node2415.log`).
  - Failures still fail the gate.
- `engines` should **not** move to `>=24.21` now. With `engine-strict=true`, that would make `npm ci` fail on this host's installed Node 24.15, and upgrading the host's global Node is the user's call (CLAUDE.md: no unrelated global installs). The application itself runs on Electron's bundled Node 24.21. The defect only affects the test runner, and the opt-in override covers it.
- Follow-up F-01-1 (assigned to Phase 02, small tooling change, non-blocking):
  - Bump `.github/workflows/ci.yml` `actions/setup-node` from `'24.15.0'` to `'24.21.0'` so the unpushed CI does not inherit the flake.
  - Update the assertion in `tests/unit/ci-config.test.ts` (line 47).
  - Add a short DECISIONS entry recording "toolchain floor 24.15, E2E runner recommended 24.21 (INFINITY_E2E_NODE)".
  - If the user later upgrades the host Node to 24.21 or newer, raise the `engines` floor and drop the override.
- Controller rule until then: run Windows E2E gates with `INFINITY_E2E_NODE=E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe`. Treat a 0xC0000409 "worker process exited unexpectedly" on 24.15 as this known infrastructure flake, never as a pass.

### 2. WSL leg as the second OS

**It satisfies the second-OS requirement under the CLAUDE.md user decision (WSL2 Ubuntu 26.04 + WSLg is the Linux validation environment).**

Evidence:

- The environment is recorded (`wsl-env.log`): WSLg 1.0.73, Weston `2318fec…`, glibc 2.43, `XDG_SESSION_TYPE` unset.
- The build ran from the ext4 copy with its own `node_modules`, as the unprivileged user `infinity` and with the sandbox on (D-039).
- `npm ci`, `check`, `build`, `verify:native` (dev, packaged, AppImage), the full E2E under WSLg and the full E2E under Xvfb all passed.
- The AppImage and the `.deb` were built. `dpkg-deb --info` shows correct metadata.
- `test:e2e:packaged` passed.
- The cross-host packaging refusals exit 2.
- Results are labeled "WSLg (Weston), ozone x11" (the main.log line was captured in both runs), never GNOME.
- Because the repairs changed `tests/e2e/fixtures.ts`, `smoke.spec.ts`, `scripts.test.ts` and tools after the original WSL run, I re-synced and re-ran in WSL: E2E 24 passed, including the new closeApp regression test (`acceptance/acc-wsl-e2e-wslg.log`), and `npm run check` exit 0 (`acceptance/acc-wsl-check.log`).
- GNOME and X11 desktop sessions are `outside_validation_scope`, not passes.
- The forced `--ozone-platform=wayland` smoke run is informational and not a gate. 6 of 8 cases passed. 2 cases fail on Playwright `locator.check()` actionability under WSLg native Wayland. The same persistence flow through IPC passes under Wayland (`qa-wsl-wayland.log`). This is recorded as a pending native/Wayland case, not a defect.

### 3. Packaged build and E2E logs from before the final clean `npm ci`

**Sufficient. I re-ran the two packaged gates, so no re-package is needed.**

- No product input changed after packaging. The newest `src/`, `resources/`, `electron-builder.json`, `package.json` and lockfile edit is 15:39:45. Windows `package:current` ran at 15:40:18. Every later edit is under `tests/` or `tools/`.
- I compared `release/win-unpacked/resources/app.asar` with the current `out/` from the 16:34 rebuild. `out/main/index.js`, `out/preload/index.js`, `index.html` and both renderer assets are byte-identical (SHA-256 MATCH). `package.json` differs only by `scripts` and `devDependencies`, which electron-builder strips.
- `npm ci` reinstalls from the same lockfile. The packaged `.node` still equals the fresh `node_modules` prebuild by SHA-256 (`acceptance/acc-verify-native-packaged.log`, run after the clean `npm ci`).
- I re-ran `npm run test:e2e:packaged` against that build with the current fixtures: 2 passed, exit 0 (`acceptance/acc-e2e-packaged.log`).
- Linux packaged artifacts were built in the same tree state (15:45) from the same product sources.

## Code review notes (independent of QA)

- Scripts are real. `scripts.test` rejects echo, `exit 0` and `true` scripts and `passWithNoTests`. The `test:e2e:packaged` refusal case now always runs against an empty `INFINITY_RELEASE_DIR` (QA issue 3 fixed).
- Test hooks exist only when `!app.isPackaged && INFINITY_NOTES_E2E=1`. `packaged.spec` asserts they are absent and that the override is honored.
- `NoteWriter` and `LeaseManager` are constructed but not wired to IPC, as D-042 requires (Phase 03). Their behavior is covered by `revision.test` and `lease.test`.
- QA info item 5 is inaccurate but harmless. The 647 kB renderer chunk contains no TipTap or ProseMirror, because the renderer imports only React and local modules. Its size comes from the unminified production React build (electron-vite renderer defaults). See F-01-5.

## Non-blocking follow-ups (assigned)

| ID | Item | Phase |
| --- | --- | --- |
| F-01-1 | CI `node-version` to 24.21.0, update `ci-config.test`, DECISIONS note on the E2E runner Node (see decision 1) | 02 |
| F-01-2 | Attachment handler: add a `realpath` containment check (symlink escape; QA item 4) when attachments are first written | 04 |
| F-01-3 | Dedupe drafts when a CONFLICT is retried with the same `requestId` (QA item 6) | 03 |
| F-01-4 | Investigate Playwright input actionability under WSLg native Wayland (`--ozone-platform=wayland` radio `check()` timeout) once the Phase 02 shell exists. Keep the run informational | 02 (investigate), 09 (native matrix) |
| F-01-5 | Enable renderer minification and recheck bundle size before packaging gates | 09 |
| F-01-6 | electron-builder `desktopName` and `linux.syncDesktopName` (window association warning); Electron fuses (keep Playwright compatibility in mind) | 09 |

## Pending native cases (not run; not counted as passes)

- INF-FND-02 N: real desktop focus and raise behavior on a second launch. Phase 09 native matrix (Windows desktop, WSLg).
- INF-FND-11 N: a toast showing "Infinity Notes" under the packaged AppUserModelID. Phases 05 and 09.
- NSIS installer run, `.deb` install (`dpkg -i`) and installed-app launch. Phase 09 (INF-PKG).
- UI-driven theme persistence under WSLg native Wayland (see F-01-4).
- GNOME and X11 desktop sessions: outside the user-selected validation scope (CLAUDE.md, 2026-10-08). Recorded, never passed.

## Evidence reviewed

- Pack phase file, `docs/plans/phase-01.md` (sections 1, 14, 15, 16), `docs/progress/phase-01.md` (including Repair 1 and Repair 2), `docs/progress/phase-01-qa.md`, `docs/DECISIONS.md` D-035 to D-043, `docs/BACKLOG.md` INF-FND rows.
- Code: `src/main/index.ts`, `db/open-database.ts`, `db/migrate.ts`, `ipc/router.ts`, `ipc/sender-policy.ts`, `windows/*`, `services/network-guard.ts`, `app-paths.ts`, `test-hooks.ts`, `single-instance.ts`, `src/preload/index.ts`, `src/shared/csp.ts`, `src/renderer` imports, `tests/e2e/*`, `tests/unit/scripts.test.ts`, `tools/run-e2e.mjs`, `tools/lib/proc.mjs`, `tools/verify-native.mjs`, `package.json`, `.npmrc`, `electron-builder.json`, `electron.vite.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`.
- Logs in `.infinity-work/logs/phase-01/`: `coordinator-*`, `win-*`, `wsl-*`, `qa-*`, `repair1-*`, `repair2-*` (crash counts recomputed), and my own `acceptance/acc-unit-integration.log`, `acc-e2e-node2421.log`, `acc-e2e-native-node2415.log`, `acc-verify-native-packaged.log`, `acc-e2e-packaged.log`, `acc-wsl-e2e-wslg.log`, `acc-wsl-check.log`. All exit 0.

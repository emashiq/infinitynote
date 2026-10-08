# Phase 01 progress: Secure desktop foundation and persistence

Date: 2026-10-08. Implementer: infinity-code-medium (Sonnet 5.5, medium). Status: implemented. Not committed (coordinator owns that).

## 1. Summary

The offline Electron foundation is in place and green on Windows and on WSL Ubuntu: electron-vite project, pinned dependencies with committed lockfile, SQLite via prebuilt better-sqlite3 (no source rebuild), migration 001 with a transactional runner and pre-migration copy, versioned settings, hardened windows (custom `infinity-app://renderer` scheme, CSP, navigation/window.open/permission blocks, network guard), Zod-validated narrow IPC with sender validation, restricted `infinity-attachment` protocol, save-revision and writer-lease services (IPC for them is Phase 03), single instance lock, placeholder icons and stable AppUserModelID, CI YAML (not pushed), packaging (NSIS, AppImage, deb; all unsigned).

## 2. Hosts

- Windows 11 Pro 10.0.26300, Node 24.15.0, npm 11.12.1 (`win-env.log`).
- WSL: Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, glibc 2.43, Node 24.21.0, npm 11.19.0, WSLg 1.0.73, Weston 2318fecaeac1f1a2d5a7a042c34d931c71dae04c, user `infinity` (`wsl-env.log`). Build from the ext4 copy `~/infinity-notes`; node_modules never shared.
- Observed ozone (main.log `display` line): WSLg run `ozone=x11` (WAYLAND_DISPLAY set, DISPLAY=:0, XDG_SESSION_TYPE unset); Xvfb run `ozone=x11` (DISPLAY=:99, no Wayland); forced `--ozone-platform=wayland` run `ozone=wayland`. Results are WSLg (Weston), not GNOME.

## 3. Files

- Config: `.npmrc`, `.gitattributes`, `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `electron.vite.config.ts`, `electron-builder.json`, `.github/workflows/ci.yml`, `resources/icon.png|ico`.
- `src/shared`: app-identity, csp, contracts (channel-names, envelope, ids, app, settings, notes, channels, bridge), text/plain-text.
- `src/main`: index, app-paths, self-test-mode, single-instance, test-hooks, menu, env.d.ts; db (driver, better-sqlite3-driver, open-database, migrate, self-test, migrations/001_initial.sql + index + checksums.json, repositories settings/notes); services (clock, ids, logger, app-error, settings-service, note-writer, lease-manager, capabilities, shell-adapter, network-guard); ipc (router, sender-policy, event-bus, handlers app/settings/capabilities); windows (schemes, renderer-protocol, attachment-protocol, web-security, main-window, window-registry).
- `src/preload/index.ts`; `src/renderer` (index.html, main, App, bridge, env.d.ts, shell/FoundationScreen, startup/StartupErrorScreen, theme, styles).
- Tests: `tests/unit` (15 files incl. 3 renderer jsdom), `tests/integration` (8 files), `tests/e2e` (fixtures, smoke, security, migration-failure, native, packaged), `tests/support/png.ts`.
- Tools: `lib/proc.mjs`, `package.mjs`, `run-e2e.mjs`, `verify-native.mjs`, `dev-smoke.mjs`, `make-icon.mjs`, `gen-migration-checksums.mjs`, `check-traceability.mjs` (F-5 edit).
- Docs: `docs/BACKLOG.md` statuses and planned tests (section 9 below), this report.

## 4. Dependencies

All pins exactly as DECISIONS table (`--save-exact`); runtime `dependencies` = better-sqlite3 13.0.3, zod 4.6.5, luxon 3.7.2. `npm ls --all` exit 0 (`win-npm-ls.log`). `npm ci` from a deleted node_modules passed on Windows (`win-final-npm-ci.log`) and WSL (`wsl-npm-ci.log`); lockfile was generated once from clean, no regeneration needed. No `node_modules/better-sqlite3/build` on either host.

## 5. Commands (all logs in `.infinity-work/logs/phase-01/`)

| Command | Host | Exit | Log |
| --- | --- | --- | --- |
| npm install (pins) / setup:electron / npm ls --all | W | 0 | win-npm-install, win-setup-electron, win-npm-ls |
| npm ci, setup:electron (clean) | W | 0 | win-final-npm-ci, win-setup-electron-final |
| lint, typecheck, test:unit (86 tests), test:integration (56 tests) | W | 0 | win-lint, win-typecheck, win-test-unit, win-test-integration |
| npm run check | W | 0 | win-check, win-final-check |
| npm run build | W | 0 | win-build, win-final-build |
| dev-smoke | W | 0 | win-dev-smoke |
| test:e2e (22 passed, 1 Linux-only skipped) | W | 0 | win-test-e2e, win-final-test-e2e |
| verify:native (dev) / --packaged | W | 0 | win-verify-native-dev, win-verify-native-packaged |
| package:current (NSIS) | W | 0 | win-package-current |
| test:e2e:packaged (2 passed) | W | 0 | win-test-e2e-packaged |
| package:linux on Windows (refusal) | W | 2 (expected) | win-package-linux-refusal |
| traceability | W | 0 | win-traceability |
| git status / check-ignore | W | 0 | win-gitstatus |
| rsync, env | L | 0 | wsl-sync, wsl-env |
| npm ci, setup:electron, check, build | L | 0 | wsl-npm-ci, wsl-setup-electron, wsl-check, wsl-build |
| verify:native dev / --packaged / --appimage | L | 0 | wsl-verify-native-dev, -packaged, -appimage |
| test:e2e under WSLg (23 passed) | L | 0 | wsl-test-e2e-wslg |
| test:e2e under Xvfb (23 passed) | L-xvfb | 0 | wsl-test-e2e-xvfb |
| smoke forced wayland (informational) | L | 1 (2 failed, 6 passed) | wsl-test-e2e-wayland |
| package:linux (AppImage + deb) | L | 0 | wsl-package-linux |
| test:e2e:packaged (2 passed) | L | 0 | wsl-test-e2e-packaged |
| package:win on Linux (refusal) | L | 2 (expected) | wsl-package-win-refusal |
| dpkg-deb --info | L | 0 | wsl-deb-info |

Note: the full Windows package/verify/packaged-e2e chain was run before the final clean `npm ci`; after it only check, build, e2e and unit/integration were re-run (the packaged build in `release/` is from the same sources).

## 6. Requirement coverage

All INF-FND-01..13 assertions in plan section 14.1 are implemented by the tests listed there (file names match the plan). Result W / L / L-xvfb: 01, 03, 04, 05, 06, 07, 08, 09, 10, 13 pass; 12 passes in dev, packaged and AppImage on both hosts; 02 and 11 pass their E and R parts (N parts pending). BACKLOG statuses set accordingly (done; 02 and 11 in_progress).

## 7. Native-module proof

| Host / mode | SQLite | Electron / ABI | loadedBinary | SHA match | build/ absent |
| --- | --- | --- | --- | --- | --- |
| W dev | 3.53.4 | 44.7.0 / 149 | node_modules/better-sqlite3/prebuilds/win32-x64.node | n/a | yes |
| W packaged | 3.53.4 | 44.7.0 / 149 | release/win-unpacked/resources/app.asar.unpacked/.../win32-x64.node | e21e5efd... equal | yes |
| L dev | 3.53.4 | 44.7.0 / 149 | prebuilds/linux-x64.node | n/a | yes |
| L packaged | 3.53.4 | 44.7.0 / 149 | linux-unpacked/resources/app.asar.unpacked/.../linux-x64.node | 6fd4292c... equal | yes |
| L AppImage | 3.53.4 | 44.7.0 / 149 | /tmp/appimage_extracted_*/resources/app.asar.unpacked/.../linux-x64.node | 6fd4292c... equal (vs linux-unpacked) | yes |

## 8. Artifacts (unsigned local builds; none installed, installer install is Phase 09)

- Infinity-Notes-Setup-0.1.0-x64-unsigned.exe, 119109766 bytes, sha256 5174d6f02c510b4034de0c0caf94d613ed2be5eb5dffd6b61b4ccf9172779cf4.
- infinity-notes-0.1.0-x86_64-unsigned.AppImage, 135261221 bytes, sha256 3b76f642323409475bf36832b92a0401f4d5acfe125e1d9f91f33cfda63611c2.
- infinity-notes-0.1.0-amd64-unsigned.deb, 107396896 bytes, sha256 28ee84837e6fbc2c36ee93c467ed2bfe8298e32ba957495913c68528135051f7.

## 9. Follow-ups

F-2: `doc_key` AUTOINCREMENT + external-content FTS, `migrations.test › fts doc_key survives VACUUM`. F-3: fallback not needed, better-sqlite3 passes on both hosts. F-4: override honored when packaged, hooks off (`app-paths.test`, `packaged.spec`). F-5: `tools/check-traceability.mjs` check 3b, negative tests in `tests/unit/traceability.test.ts`. F-6: done by planner. F-1: assertions in the test names above.

## 10. Decisions added after planning

None.

## 11. Deviations

- Pre-migration copy file name uses milliseconds (`yyyymmddTHHMMSSmmmZ`) so repeated failing attempts within one second do not overwrite each other.
- Renderer jsdom tests use `react-dom/client` + `act` instead of a testing library (none is in the pinned table).
- `tsconfig.node.json` lib includes DOM only so Playwright `page.evaluate` callbacks type-check.
- `resolveContained`/`isInside` live in `app-paths.ts` and are shared by both protocol handlers.
- Not done: `docs/PRODUCT_SPEC.md` untouched as planned.

## 12. Issues found and fixed

- Medium: `openBetterSqlite` leaked the native handle when the first query failed on a non-database file (Windows could not delete the temp dir). Fixed by closing in the constructor path; regression is `migrations.test › unreadable database`.
- Low: containment regex was initially mangled by shell escaping so `../` escapes were accepted; caught by `app-paths.test` and `protocol.test`, fixed with a named regex.
- Low: Playwright locators stall after a cancelled navigation; the navigation test asserts via `evaluate` and main-process URL instead.

## 13. Not run or pending

- N parts of INF-FND-02 (real desktop focus) and INF-FND-11 (toast identity with packaged identity) remain for Phases 09 and 05.
- WSLg native-Wayland informational run (`--ozone-platform=wayland`): 2 of 8 smoke cases (`setting survives relaunch`, `invalid stored setting falls back`) fail because Playwright `locator.check()` on the radio times out under WSLg native Wayland (input actionability); window creation, security and DB cases pass. Not a gate; not investigated further.
- GNOME and X11 desktop sessions are outside the user-selected validation scope. `.deb` was built and inspected only, not installed.
- `scripts.test` refusal case for `test:e2e:packaged` without a build is skipped when `release/` already holds a packaged build.
- A Windows packaged-e2e rerun after the final clean `npm ci` was not repeated.

## 14. Known limitations

Temporary foundation screen (Phase 02 replaces it); fuses not set (Phase 09, note that disabling inspector arguments would break Playwright on packaged builds); `spellcheck` off; edits inside the last debounce window are Phase 03's concern; electron-builder warns `desktopName` is not set (window association, Phase 09).

## Repair 1

Scope: QA low issues from `docs/progress/phase-01-qa.md`.

### Changes
- `tools/lib/proc.mjs`: `packagedExePath()` honours optional `INFINITY_RELEASE_DIR` (default unchanged: `<repo>/release`).
- `tests/unit/scripts.test.ts`: the `test:e2e:packaged` refusal case no longer returns early when `release/` has a build. It points the script at an empty temp dir via `INFINITY_RELEASE_DIR` and always asserts exit 1, `No packaged build at` and the temp path. Verified passing with `release/` present and with `release/` temporarily renamed away (7/7 both times).
- `tests/e2e/fixtures.ts`: `closeApp` now also waits for the Electron child process to actually exit (`waitForExit`, SIGKILL after 10 s); added regression test `closeApp leaves no live Electron process` in `tests/e2e/smoke.spec.ts`.
- Item 3 (attachment handler path containment): not changed; carry to Phase 04.

### E2E worker crash (exit 3221226505 = 0xC0000409) investigation
It REPRODUCES intermittently. Every occurrence is "worker process exited unexpectedly" reported against a test with 0 ms duration, i.e. the Playwright Node worker dies between tests (different test each time: bridge surface, second instance focuses first, window.open denied, and QA's first smoke test). No stderr, no WER Application Error entry.
- Runs 1-6 of `npm run test:e2e` (`.infinity-work/logs/phase-01/repair1-e2e-run-{1..6}.log`): exit 0,0,1,0,0,0 (run 3 crash).
- Hypothesis A, Electron teardown race (closeApp not awaiting process exit): implemented the wait; crash still reproduced afterwards (`repair1-probe-2.log`, 1 of 3). Not the cause; the wait is kept as harmless hygiene with a regression test.
- Hypothesis B, better-sqlite3 loaded in the worker: ran 20 runs of the suite with better-sqlite3 never loaded (lazy require, DB-using tests excluded; `repair1-probe-nosql-{1..20}.log`): 1 crash in 20 (run 18, window.open denied). Not the cause; experiment reverted.
- Conclusion: the abort is in the Playwright Node worker process (fast-fail with no output), not in product code or the app process. Approx flake rate about 4 crashes in ~30 runs (~13%). Root cause not identified; no retries were added to hide it. Final full-suite run after the changes: `repair1-e2e-run-7.log` exit 0 (22 passed, 1 skipped Linux-only). A crash of this signature should be reported as an infrastructure flake, and rerun, by the controller.
- (An intermediate batch of 20 runs failed due to a bug in my first closeApp edit, `app.process()` throwing on a disposed app; fixed with try/catch and those logs discarded.)

### Commands
- `npx vitest run tests/unit/scripts.test.ts` (with and without release/): exit 0.
- `npm run test:e2e`: see above.
- `npm run check`: exit 0, log `.infinity-work/logs/phase-01/repair1-check.log` (56 unit/integration tests, traceability fails=0).

## Repair 2 (E2E worker crash root-cause)

### Diagnostics
- Run with `NODE_OPTIONS=--report-on-fatalerror --report-uncaught-exception --report-directory=...` and `DEBUG=pw:browser` (`repair2-diag-1..20.log`, crash on run 20). No Node report was written (the abort is a CRT fast-fail, not a V8 fatal error). The pw:browser trace is informative: the "0 ms" test attribution is misleading. The worker actually dies mid-launch, immediately after `<ws connecting> ws://127.0.0.1:<port>/devtools/browser/...` to Electron's CDP socket, before the connection completes. The Electron process, product code and DB are not involved. This also explains why the earlier teardown-race and better-sqlite3 hypotheses (Repair 1) did not help.
- Hypothesis 2, Node runtime (Playwright CLI and its worker run under a portable Node 24.21.0 from `.infinity-work/node-portable/`, global Node untouched), same command, 30 runs each:
  - Node 24.15.0: 3 crashes in 30 (10%) (`repair2-node2415-*.log`).
  - Node 24.21.0: 0 crashes in 30 (`repair2-node2421-*.log`).
  - Plus 20 further consecutive clean runs through `npm run test:e2e` with `INFINITY_E2E_NODE` set to 24.21 (`repair2-final-*.log`, all exit 0). Combined 50/50 clean on 24.21 versus about 10% (~7 of ~60 overall) on 24.15. WSL Node 24.21 also never showed it. Best-supported conclusion: a Node 24.15 Windows defect in the worker's WebSocket/network path to the Electron CDP endpoint, fixed by 24.21. The precise upstream Node change was not identified.
- Hypotheses 3 and 4 not pursued further: the crash occurs inside the worker before any close ordering, and workers=1 is required by the single-instance app; run-e2e.mjs contains no taskkill and no `process.exit` in the worker.

### Changes
- `tools/run-e2e.mjs`: Playwright now runs under `INFINITY_E2E_NODE` when set (default remains the current Node). On Windows with Node 24.x < 24.21 and no override it prints a warning pointing at the known crash. No retries added; failures are not masked.
- To use: download Node 24.21 zip, set `INFINITY_E2E_NODE=<path>\node.exe`, run `npm run test:e2e`. The project `engines` field is unchanged (>=24.15.0 <25) so the default flow still works but remains flaky on 24.15.
- Recommendation for controller: set `INFINITY_E2E_NODE` to `E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe` for Windows e2e gates; if a 0xC0000409 appears on 24.15, treat it as the known infrastructure flake.

### Commands
- `npm run check`: exit 0, `repair2-check.log`.

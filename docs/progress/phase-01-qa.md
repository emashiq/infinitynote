# Phase 01 QA report (infinity-qa, Sonnet 5.5 medium)

Date: 2026-10-08. Reviewed: plan section 14/14.1, implementation in src/, tests/, tools/, coordinator logs (check and build exit 0, renderer chunk 647.47 kB).

## Verdict: pass (local acceptance). Native N parts (INF-FND-02, INF-FND-11) remain pending for Phases 09 and 05; GNOME/X11 desktop outside scope.

## Checks

| Check | Command | Status | Evidence |
| --- | --- | --- | --- |
| Coordinator check/build | (read logs) | pass (exit 0) | .infinity-work/logs/phase-01/coordinator-check.log, coordinator-build.log |
| Windows e2e, run 1 | npm run test:e2e | fail (flake: Playwright worker crash code 3221226505 on first test, 21 passed, 1 skipped) | .infinity-work/logs/phase-01/qa-win-test-e2e.log |
| Windows e2e, reruns x2 | npm run test:e2e | pass (22 passed, 1 Linux-only skipped, each) | qa-win-test-e2e-rerun1.log, qa-win-test-e2e-rerun2.log |
| Adversarial renderer E2E (Windows) | npx playwright test -c .infinity-work/qa/playwright.qa.config.ts | pass | qa-adversarial.log |
| Theme persistence via IPC across relaunch (Windows) | same config, persist.qa.ts | pass | qa-win-persist.log |
| WSLg spot check: adversarial, persistence, security.spec (10) | wsl -u infinity, ~/infinity-notes | pass | qa-wsl-spotcheck.log |
| Forced --ozone-platform=wayland: adversarial + IPC persistence | same | pass (3 of 3) | qa-wsl-wayland.log |
| Forced wayland smoke.spec | npm run test:e2e -- smoke.spec.ts | 2 failed (UI radio check timeout), 6 passed; informational | qa-wsl-wayland.log |

Not repeated (already passing in coordinator/implementer logs): lint, typecheck, unit (86), integration (56), traceability.

Adversarial results (own spec .infinity-work/qa/adversarial.qa.ts): traversal via `..`, `%2e%2e`, `..%2f`, `..%5c`, other host, data/*.sqlite3 on infinity-app all 404 or error; attachment POST/unknown host fail; bridge not overwritable (`defineProperty` throws, still a function); no ipcRenderer/electron globals; null, array, string, `__proto__`, BigInt payloads gave VALIDATION_FAILED, function/deep nesting rejected by contextBridge; iframe cross-origin/blocked; anchor target=_blank, form post, window.open(file), location.replace(file), dynamic import(file), WebSocket all blocked; only one window and URL unchanged. Existing security.spec covers fetch/XHR/img of file:///, 6 MB payload LIMIT_EXCEEDED, SQL-injection key, attachment traversal (raw and encoded), non-image attachment.

Code review notes: migration runs in one IMMEDIATE transaction with user_version and FK check; e2e verifies byte-identical DB, one pre-migration copy and visible error for legacy, newer and unreadable DBs. NoteWriter checks lease then revision in an immediate transaction; stale and trashed saves keep content and store a draft; duplicate requestId is idempotent; lease take has timeout, revocation, wc-destroy and window binding (integration tests assert each). Single-instance covered by smoke "second instance focuses first". No skipped/only suites besides packaged.spec (requires packaged exe env) and the Linux-only test; scripts are real (no placeholder passes).

## Issues

1. Low, flake. Repro: first `npm run test:e2e` after a build on Windows. Expected: pass. Actual: Playwright worker exited with code 3221226505 (0xC0000409) during "starts a real window with temp userData"; two later runs passed. Not reproducible; cause unknown (likely Electron/GPU process startup). Suggest the implementer note it and watch for recurrence; no change required for acceptance.
2. Low, coverage. Wayland-forced smoke failures are a test-harness problem, not an app defect: the same persistence flow via IPC passes under native wayland (qa-wsl-wayland.log), and the failing step is Playwright `locator.check()` on the radio under WSLg Wayland. UI-driven theme persistence under native Wayland is thus unverified; record as pending native/Wayland.
3. Low. `tests/unit/scripts.test.ts` "test:e2e:packaged without a build" silently returns (reports pass) when release/ holds a build; it effectively does not run in this workspace. Already disclosed in progress doc section 13.
4. Info. Attachment handler checks lexical containment only (no realpath); a symlink inside attachments/ would escape. Files are app-written and paths come from DB CHECK-constrained rows, so exploitability is low; consider realpath in Phase 04 when attachments are written.
5. Info. Renderer bundle 647 kB is expected: React 19, TipTap/ProseMirror and zod are bundled before the foundation screen tree-shakes; the foundation App imports it. No action.
6. Info. After a CONFLICT, a retry with the same requestId is not cached and stores another draft (expected-ish; Phase 03 should dedupe drafts).

## Pending native cases
INF-FND-02 N (real desktop focus), INF-FND-11 N (toast identity), .deb install, installer run, GNOME/X11 desktop sessions, native Wayland UI-driven check.

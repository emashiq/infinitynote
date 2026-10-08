# Phase 01: Secure desktop foundation and persistence

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 01 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Scaffold or adapt Electron + React + TypeScript. Install pinned dependencies and lockfile, configure dev/build/native module rebuilding, and register a single-instance lock. Implement main-owned SQLite adapter, explicit transactional migrations, settings/repositories, managed attachment directory and test isolation. Secure BrowserWindow/preload/IPC/CSP and restricted protocol from the outset. Establish request validation, save revisions and writer-lease contracts before adding UI. Set up lint/typecheck/unit/integration and actual Electron E2E smoke. Implement all standard package scripts from ARCHITECTURE; scripts not yet applicable must report their real status, never silently pass. Add Windows/Ubuntu CI definitions but do not push them. Create app icon placeholder and stable Windows app identity so later notifications use packaged identity.

## Acceptance

npm install/ci and check/build pass; real Electron window starts through E2E; SQLite persists settings across relaunch; migration failure is handled; renderer cannot access arbitrary files/SQL; native-module rebuild works on the current host. Document the second OS as pending if unavailable.

## Output and progress

Write docs/plans/phase-01.md before implementing and docs/progress/phase-01.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

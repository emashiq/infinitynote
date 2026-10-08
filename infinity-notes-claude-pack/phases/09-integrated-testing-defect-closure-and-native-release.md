# Phase 09: Integrated testing, defect closure and native release

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 09 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Run the complete requirement-linked unit/integration/Electron E2E suites and realistic usage scenarios. Measure 10,000-note search, cold startup, image-heavy editor responsiveness, inactive tab memory and multiple sticky/widget cleanup. Inspect IPC/attachment/import boundaries and dependency compatibility; fix defects rather than silencing checks. Build current-host package and prepare/run Windows NSIS and Linux AppImage/.deb builds on their proper hosts. Verify packaged SQLite ABI, data persistence on update, install/launch, notification click, sticky movement, tray and sleep recovery. Record Windows, GNOME Wayland and X11 native matrix with real evidence; headless tests alone are insufficient. Produce docs/FINAL_REPORT.md, NATIVE_OS_MATRIX.md, RELEASE_CHECKLIST.md and end-user install/use/backup documentation. Do not push or publish builds. Missing external host/signing is clearly pending after all independent work finishes.

## Acceptance

All implementation checks pass; no critical/high data-loss, scheduler or security defects; current-host installer built and tested; other OS artifacts/native tests have evidence or are explicitly not_run. FINAL_REPORT uses complete only when native matrix and both OS packaging gates pass, otherwise ready_for_os_validation with concrete remaining steps. Never claim both OSes tested from one host.

## Output and progress

Write docs/plans/phase-09.md before implementing and docs/progress/phase-09.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

## Final organization gate

Follow CLEANUP_POLICY.md. Before final acceptance, prepare accurate app/user docs and verify README instructions and actual package scripts. After all phase/native acceptance succeeds, the coordinator/controller invokes finalize_docs.py, which archives the active pack and execution evidence to docs/development/ and generates the index. Avoid premature relocation while roles/controller are still reading the pack. Completion includes successful cleanup manifest and preserved evidence. If OS validation is pending, keep active files/checkpoints intact for resume.

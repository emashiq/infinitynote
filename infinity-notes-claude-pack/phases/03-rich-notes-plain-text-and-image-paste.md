# Phase 03: Rich notes, plain text and image paste

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 03 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Implement one shared editor surface with Tiptap open-source extensions, stable block IDs, heading/list/checklist/bold/italic/link/code/undo. Support separate plain-text document format with explicit lossy conversion warning and recoverable version. Add title editing, debounce/acknowledged autosave, revision conflict recovery and main-managed editing lease. Store pasted text/HTML through safe schema handling; accept clipboard bitmap, image files and imported documents into managed attachments. Insert restricted local image references, display resize controls if feasible without complex drag UI, enforce documented size limits and show loading/save/error feedback. Extract body text and reference data transactionally for search. Add version retention scaffolding. Ensure inactive tabs dispose editors and cached images are bounded.

## Acceptance

Formatting and images survive restart offline; original image file may be removed; Unicode text remains intact; unsafe HTML cannot execute; rename/tab close flush; competing save revisions cannot erase work; duplicate/pasted blocks have new IDs; plain-text conversion has restoreable source. Demonstrate one real note edit/paste/reload E2E flow.

## Output and progress

Write docs/plans/phase-03.md before implementing and docs/progress/phase-03.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

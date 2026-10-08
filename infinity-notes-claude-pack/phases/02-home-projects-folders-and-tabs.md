# Phase 02: Home, projects, folders and tabs

Planner: Opus HIGH. Implementer: Sonnet 5.5 LOW. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 02 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Build the compact FrameCapt-inspired shell with rail, top search/command entry, reusable Home tab, tree pane, tab strip, main document area and collapsible right pane. Implement Common scope, project/folder CRUD, nested directory/subdirectory management, moving items, cycle validation, trash/restore and recent/pinned summaries. Notes can be created at scope root or folder. Stickies can be assigned to Common or any project/folder even before floating is implemented. Support tab creation/switch/close/reopen/overflow and persisted session. Build quick actions and keyboard shortcuts with accessible focus. Use real SQLite-backed data, with synthetic fixtures only in tests. A temporary basic text area may be used until Phase 03 but saved notes must already have stable IDs and revisions.

## Acceptance

Create Common/project notes and multiple levels of folders; move/rename/restart and verify persistence; reject cycles; tabs restore without duplicates; close tab does not delete note; Home scopes reflect the same stored data. Visual check at 1100x720 and narrow size, keyboard-only tree/tabs.

## Output and progress

Write docs/plans/phase-02.md before implementing and docs/progress/phase-02.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

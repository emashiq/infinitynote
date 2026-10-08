# Phase 07: References, backlinks and fast retrieval

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 07 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Complete internal note/block reference picker, rich-text link nodes, source/target indexes and outgoing/backlink cards. Clicking a reference opens a tab and scrolls to its block when present. Handle target rename/move/trash/restore and missing block explicitly. Show active-note reminders/references in the right pane with compact sections and close controls. Implement SQLite FTS5 body/title search plus small title fuzzy matching if helpful, scope filters, highlighted safe snippets, pinned/favorites and Ctrl+K action palette. Debounce and cap results; avoid rendering all 10,000 notes. Support local attached document references through validated handoff. Add quick sticky creation with automatic scope inheritance and no forced project selection.

## Acceptance

Renames/moves preserve links and backreferences; duplicate content does not alias block IDs; deleted target/anchor shows recoverable state. Search indexing updates on content/move/delete/restore; large fixture returns bounded results with measured latency. Keyboard action opens exact note/tab without unsaved edit loss.

## Output and progress

Write docs/plans/phase-07.md before implementing and docs/progress/phase-07.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

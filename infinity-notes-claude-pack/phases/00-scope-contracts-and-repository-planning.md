# Phase 00: Scope, contracts and repository planning

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 00 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Inspect repository files, existing CLAUDE.md, runtime versions and the supplied reference. Preserve any work already present. Create docs/PRODUCT_SPEC.md, docs/UX_SPEC.md, docs/ARCHITECTURE.md, docs/DECISIONS.md and a traceable implementation backlog. Select supported dependency versions and target OS minimums by official documentation, with licenses and native SQLite compatibility recorded. Define one Home dashboard, Common/project hierarchy, nested folders, tab navigation, sticky window/editor reuse and the right context panel. Record reminder state transitions, recurrence/DST policy, notification delivery uncertainty, autosave/lease protocol, safe attachments, backup and platform capability fallbacks. Include a requirement ID for every user feature and map it to a phase/test. Merge repository instructions and add appropriate ignore entries. Do not implement feature code before these contracts are coherent.

## Acceptance

All requested desktop features are mapped; scope is explicitly small; state/data contracts resolve open routine choices; existing work preserved; no contradictory reminders or window promises. Phase 01 can implement without a new product-design discussion.

## Output and progress

Write docs/plans/phase-00.md before implementing and docs/progress/phase-00.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

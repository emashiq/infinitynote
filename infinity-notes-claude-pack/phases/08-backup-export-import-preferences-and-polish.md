# Phase 08: Backup, export/import, preferences and polish

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 08 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Implement versioned faithful portable backup: consistent SQLite snapshot, referenced attachments, hashes and manifest. Provide manual backup/export/import/restore UI with preflight validation, staging and rollback copy. Add Markdown/plain-text export with clear formatting limits and self-contained HTML only if simple. Validate archives against traversal, links, size and unsupported schema; remap imported IDs/references. Complete trash/version retention, recoverable versions and automatic backup option with local configurable destination. Add light/dark theme, reminder defaults/time zone/quiet hours, widget/window/tray/startup settings and keyboard help. Ensure startup autolaunch is capability checked and opt-in. Polish accessible labels, focus, high DPI, empty/error states and narrow layouts. Avoid adding sync/accounts or calendar integration.

## Acceptance

Back up an edited note with images while SQLite uses WAL; restore into temporary clean data and verify hashes/content/references/reminders. Failed restore leaves original data usable; malicious archive refused. Markdown/portable archive roundtrip expectations are documented. Settings persist, optional features default correctly, and keyboard-only primary flows work.

## Output and progress

Write docs/plans/phase-08.md before implementing and docs/progress/phase-08.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

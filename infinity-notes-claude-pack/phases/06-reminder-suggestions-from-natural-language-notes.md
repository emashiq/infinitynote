# Phase 06: Reminder suggestions from natural-language notes

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 06 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Add a local chrono-node adapter with explicit reference instant, selected zone and application rules for end-of-day/date-only/weekday phrases. Extract components then convert through the IANA-aware date library; do not treat a fixed offset as a recurrence zone. Detect candidates after idle in rich notes and stickies; provide selected-text Create Reminder too. Show unobtrusive chip plus editable confirmation with full date/time/zone/local conversion, title and source text. Require explicit Add before persistence. Handle multiple candidates, unsupported phrases, ambiguous numeric dates/zone abbreviations, past dates and DST selections. Persist confirmed reminder/source block identity, dedupe across edits/restarts, and offer explicit Update when source changes. Do not reparse relative text after restart to silently change due time. No API/LLM calls.

## Acceptance

All TEST_MATRIX frozen-clock examples pass; tomorrow EOD defaults to visible 17:00; date-only shows visible 09:00; selected-zone calendar arithmetic differs correctly near midnight; ambiguous text requests a choice. No reminder exists before confirmation; editing/deleting source and restart do not silently shift/duplicate reminders. E2E writes phrase -> preview -> confirm -> side panel -> notification source.

## Output and progress

Write docs/plans/phase-06.md before implementing and docs/progress/phase-06.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

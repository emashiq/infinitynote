# Phase 05: Time-zone reminders, notifications and widget

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 05 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Implement reminder/occurrence/delivery persistence, Clock abstraction, indexed bounded scheduler and notification adapter in main. Expose date/time/IANA-zone input and due chip/side panel. Implement initial alert, notification click/Open, app/widget Done and Snooze, follow-up defaults/presets/limits and daily/weekly recurrence. Distinguish dismissed toast, completed occurrence and recurring series. Add Today/Upcoming/Overdue/Completed page and an optional independent reminder widget with collapse/hide/source actions and capability-checked pin. One scheduler serves both windows. Handle restart/sleep/clock changes/quiet hours, transactional claims, uncertain dispatch and adapter failure with no storms. Existing zones stay stable after OS zone changes. Startup launch is optional. Tray fallback and “fully quit stops reminders” behavior must be clear in settings.

## Acceptance

Frozen-clock tests cover initial, follow-up, complete and snooze races, recurrence/DST, quiet hours, crash around dispatch, recovery and duplicate suppression; widget and main stay consistent. A real native notification opens the correct note on available desktop. Unsupported native action buttons degrade to app/widget actions without breaking functionality.

## Output and progress

Write docs/plans/phase-05.md before implementing and docs/progress/phase-05.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

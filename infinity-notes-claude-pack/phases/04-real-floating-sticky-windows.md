# Phase 04: Real floating sticky windows

Planner: Opus HIGH. Implementer: Sonnet 5.5 MEDIUM. QA: Sonnet 5.5 MEDIUM. Acceptance: Opus HIGH.

## Prerequisites

Read the product/architecture/test contracts, the previous accepted phase report and the actual repository. Phase 04 follows the manifest sequence; do not assume earlier implementation exists merely because a file describes it.

## Work

Create native BrowserWindow instances keyed by note ID with the same rich editor component. Implement Float, Dock/Open in App, header color/source badge, collapse, hide, resizing, pin/always-on-top capability check and optional restore-on-startup. Window close hides presentation only. Main window can close to tray while stickies remain usable; explicit Quit flushes/acknowledges drafts and exits all windows. Persist bounds where supported and clamp to reachable displays; handle display removal. Implement safe edit-control transfer between tab/sticky and broadcast revisions to read-only mirrors. Integrate trash handling and prevent duplicate windows/listeners. Use native OS frames or small tested drag regions that do not swallow editor controls. Linux Wayland limitations get an unobtrusive capability fallback; do not force X11.

## Acceptance

Open two independent stickies outside the main window, move/resize and edit; each maps to its original note; switching control cannot lose acknowledged text; hide/reopen/dock preserve content; project membership remains visible; app/tray/quit behavior is distinct. Verify current native environment and log pending Windows/Wayland/X11 cases.

## Output and progress

Write docs/plans/phase-04.md before implementing and docs/progress/phase-04.md after work with requirement coverage and exact verification evidence. Tests must exercise user behavior and failure cases. Make no placeholder pass scripts. Preserve all accepted functionality and local user files. If infrastructure is unavailable, finish independent work and identify the external pending case explicitly.

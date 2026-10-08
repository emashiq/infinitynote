# Implementation architecture

## Keep it one application

Electron main owns SQLite, attachments, reminder scheduling, OS integration and windows. React/TypeScript renders the main notebook, sticky and widget routes. A narrow typed preload bridge carries validated requests and subscriptions. Use a single package/repository, electron-vite or a supported equivalent, npm and electron-builder. Select and pin compatible dependency versions during Phase 00/01; commit a lockfile. One editor component based on Tiptap core/appropriate open-source extensions handles rich notes and stickies. Prefer ordinary CSS variables and accessible primitives rather than a giant UI framework.

Use better-sqlite3 in the main process if compatibility and rebuild checks pass, with simple explicit SQL migrations and SQLite FTS5. Keep its driver behind a small adapter. Rebuild/package native modules for the actual Electron ABI and both OS targets. Do not put SQLite in renderer contexts or introduce an ORM/service layer for every table. Use Zod or equivalent IPC validation. Use Luxon or another supported IANA-aware date library after checking DST behavior; chrono-node parses English candidate text. Editor and date libraries must work without external services and without paid add-ons.

Suggested paths: src/main/{db,services,windows,ipc}, src/preload, src/renderer/{shell,editor,stickies,reminders,settings}, src/shared/{contracts,types}, tests/{unit,integration,e2e}, docs. Window routes identify note/widget only through validated IDs. A Map tracks open sticky windows; one ReminderService handles all views. Use a single-instance lock and cleanly dispose IPC listeners and editor instances.

## Data model

| Entity | Essential fields |
| --- | --- |
| Project | id, name, createdAt, updatedAt, deletedAt |
| Folder | id, projectId nullable, parentId nullable, name, sortOrder, deletedAt |
| Note | id, projectId nullable, folderId nullable, title, format, contentJson/text, plainText, revision, stickyEnabled, color, pinned, createdAt, updatedAt, deletedAt |
| NoteVersion | id, noteId, revision, contentSnapshot, attachmentReferences, reason, createdAt |
| Attachment | id, managedRelativePath, hash, mime, sizeBytes, originalName, createdAt |
| NoteAttachment | noteId, attachmentId, optional blockId |
| NoteReference | id, sourceNoteId, sourceBlockId nullable, targetNoteId, targetBlockId nullable |
| Reminder | id, noteId, blockId nullable, title, zoneId, localSchedule, recurrenceRule, enabled, followupIntervalMinutes, maxFollowups |
| Occurrence | id, reminderId, dueAtUtc, originalLocalDateTime, state, snoozedUntilUtc, nextAlertAtUtc, followupsSent, revision, completedAt |
| AlertDelivery | occurrenceId, alertSequence, kind, claimedAt, outcome, dispatchedAt; unique delivery key |
| WindowState | noteId or widget key, bounds, displayHint, open, collapsed, alwaysOnTop |
| Settings | versioned key/value settings including tab session, defaults and quiet hours |

Null project means Common. Folder scope must match its project; moving a subtree updates all affected scopes transactionally. Make references foreign-key-aware while preserving deleted-target metadata for trash display. Read queries exclude soft deletes by default. Note content references managed attachment IDs rather than absolute paths. Relocate user-data folders without rewriting every note. Internal rich-text nodes carry stable UUID block IDs; regenerate duplicate IDs on paste/duplicate and preserve IDs across edits. Plain-text references can be note-level in V1 rather than fragile offsets.

## Autosave and multiwindow editing

Main is the authoritative writer. Debounce edits (~400ms) and flush on blur/tab close/window close with acknowledgments. IPC save includes noteId, baseRevision and requestId. Commit content, extracted text, FTS and references in one transaction. The writer returns the new revision and broadcasts it to every view. Never blindly overwrite a stale revision.

For this personal desktop app, avoid CRDTs: use a main-managed editing lease per note, with additional views initially read-only and a Take Edit Control action. Transfer control only after the prior writer flushes or its recoverable draft is persisted. Conflicts create a recoverable draft/version and explicit UI, never silently discard text. Main owns pending drafts so renderer crashes cannot erase already acknowledged edits. Flush/lease/revision logic needs integration tests. App termination can still lose the latest unacknowledged keystrokes; bounded recovery is stated honestly.

Images: main writes clipboard/import bytes to a temporary managed file, validates type/size and atomically renames, then transactionally registers it. Notes reference it through a restricted local protocol. Garbage collect only after checking all live/trash/version references and a retention grace period. Do not execute embedded HTML/SVG; sanitize or reject unsupported formats. Provide a user-friendly oversized-image message and configurable bounded limits rather than freezing the editor.

## IPC and desktop boundaries

Context isolation on, Node integration off, sandboxed renderers where compatible, restrictive CSP, narrowly defined bridge methods and sender validation. No arbitrary file read/write, shell execution or SQL from renderer. Register a safe protocol restricted to known attachment IDs, prevent path traversal, limit payload sizes, validate navigation and external links. OS external handoff permits approved http/https and user-selected local documents; never shell-interpolate their paths. Clipboard HTML is sanitized through the editor schema and explicit defense for unsupported elements. These protections are implementation requirements, not an additional product UI.

## Reminders and clocks

Use a Clock interface and notification adapter so unit/integration tests simulate time and OS delivery. Main uses an indexed next-alert query and bounded wake-up timer, recalculating after sleep/resume, clock changes, settings changes and restart. Do not create one long timer per reminder. Store UTC instants plus IANA zone/local recurrence rule. For a daily/weekly series, generate occurrences transactionally with a unique reminder+scheduled-instant key. Preserve each pending occurrence and apply a documented backfill policy; do not generate thousands of old alerts.

Claim a delivery transactionally before OS dispatch. Notifications are external side effects, so exactly-once delivery across process crashes is impossible: prefer avoiding duplicate dispatch, record uncertain claims, show pending/overdue reminders in the app/widget, and never mark a reminder completed merely because delivery was attempted. Distinguish adapter failure and unsupported actions. Recovery must not loop or exhaust follow-up counts accidentally. Follow-up count increments on the chosen documented dispatch policy; user completion/snooze wins through revision/transaction checks even if a tick runs concurrently.

Quiet hours are in an explicitly chosen zone. Nonexistent DST times: offer the first valid instant after the gap; ambiguous times: preview/select the earlier/later occurrence, with earlier as a disclosed default. Relative-duration reminders use instant arithmetic; “tomorrow 9am” uses calendar arithmetic. OS zone changes affect local display/default for new reminders, not existing reminder zones.

## Backup and restoration

User data lives under app.getPath('userData') in a documented app subfolder, never under the installation directory. Backup consists of a consistent SQLite snapshot (backup API/checkpoint-safe method), referenced attachments and a versioned manifest with hashes. Pause writes as needed, stage and verify before replacing on restore, keep a rollback copy. Never copy a live .db alone and omit WAL. Import enforces size limits, rejects traversal/symlinks and remaps note/block IDs and references as needed. Plain-text/Markdown export may be lossy; portable JSON archive is the faithful format. Trash/version retention is documented and configurable.

## Test and build commands to implement

`npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run check`, `npm run build`, `npm run package:current`, `npm run package:win`, `npm run package:linux`.

`check` runs lint, typecheck and deterministic unit/integration tests. E2E launches the actual Electron app with temporary userData; renderer-only browser tests are insufficient for IPC/windows. Run Electron E2E under an appropriate virtual display on Linux CI when needed. Do not disable Chromium sandbox in production to make CI pass. Native notifications need real desktop sessions and are recorded separately.

Set up Windows and Ubuntu CI definitions locally without pushing/publishing. Include ABI rebuild, build, tests, artifact collection and explicit limitations for headless notification checks. Performance fixtures: 10,000 text notes, 100 projects, ten open tabs, ten floating stickies, 1,000 reminders. Proposed targets on a documented ordinary machine: startup <3s, search p95 <300ms, no lost acknowledged saves; memory is measured and reported rather than assigned a fictional universal target. Test UI responsiveness on an image-heavy note and inactive editor disposal. These are engineering targets, not premeasured claims.

## Autonomous finishing and file organization

Follow CLEANUP_POLICY.md after the final acceptance gate. Continue planning, coding, testing and repair without phase confirmation prompts. Organize prompts/plans/progress/evidence under docs/development/, keep active README/CLAUDE instructions at root, create docs/INDEX.md and preserve application source, tests, data, backups and installers. Do not clean active checkpoints while blocked or waiting for native OS validation. Both launcher and sequential workflows invoke finalize_docs.py after verified completion.

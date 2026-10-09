# Phase 07 acceptance: References, backlinks and fast retrieval

Acceptor: infinity-acceptor (Opus 5.5, high), fast mode (CLAUDE.md 2026-10-09: no separate QA; focused review of code and logs; full suites not re-run). Date: 2026-10-09. Base: HEAD 979526c (Phase 06). Out of scope for this review: in-flight title-bar caption-colour changes (`src/main/windows/main-window.ts`, header CSS, titlebar spec).

## Decision

**Accepted.** Every Phase 07 acceptance criterion has working code and a test that ran green in the final Windows gate logs. No placeholder, skipped or weakened gate was found.

## Logs read (`.infinity-work/logs/phase-07/`)

| Log | Result |
| --- | --- |
| final-check.log | EXIT=0: lint, typecheck, unit 85 files / 627 passed, integration 41 files / 375 passed + 1 skipped (Linux-only symlink case, pre-existing), traceability ids=187, Phase 07 rows 16, fails=0 |
| final-build.log | EXIT=0 |
| final-test-e2e.log | EXIT=0: 200 passed, 1 skipped (`smoke.spec` Linux main.log line, Linux-only), 7.4 min. Includes references.spec (5 cases), search.spec (3), palette.spec pending edit, stickies.spec quick sticky scope |
| dev-search-p95.log | EXIT=0: search.test 6/6; p95 10.8 ms, median 7.4 ms over 40 queries at 10,000 notes, unscoped queries capped at 50 |
| final-traceability-after-docs.log | EXIT=0, fails=0 |

## Acceptance criteria

| Criterion | Code reviewed | Evidence | Verdict |
| --- | --- | --- | --- |
| Renames/moves preserve links and backrefs | References keyed by note/block UUID (`note_references`), titles and paths resolved live in `ReferenceService` | integration references.test rename/move; e2e references.spec trashed target (live rename) | pass |
| Duplicate content does not alias block IDs | `normalizeRichDoc` drops a repeated block ID (first kept); a copied note's IDs are not targets of the original's backlinks | integration references.test duplicate content; unit doc-schema.test repeated block ID; Phase 03 paste guard still green | pass |
| Deleted target/anchor shows recoverable state | Outgoing state `ok/blockMissing/trashed/missing`; `BEFORE DELETE ON notes` trigger keeps the purged title; panel Restore and Search | integration references.test trashed target, unknown target; e2e references.spec trashed target | pass |
| Search index updates on content/move/delete/restore | FTS5 triggers from migration 001 on title/plain_text/deleted_at; scope and tags filtered via `notes` join, so moves apply immediately | integration search.test index lifecycle | pass |
| Large fixture bounded results with measured latency | `MAX_SEARCH_RESULTS = 50` enforced in contract (request and response) and SQL `LIMIT`; debounce 150 ms | search.test p95 (10,000 notes): 10.8 ms p95 on the dev machine | pass (release measurement again in Phase 09, INF-PERF-03) |
| Keyboard action opens exact note/tab without unsaved-edit loss | Palette activates the existing tab; pending typing flushed | e2e palette.spec open with pending edit (DB text saved, 3 tabs, editor text intact) | pass |

## Specific checks requested

- **Snippet highlighting cannot inject HTML.** SQLite wraps hits in U+0002/U+0003 control markers; `parseMarked` splits into `{text, hit}` segments; `Highlighted.tsx` renders each as a React text child (`<mark>`/`<span>`). No new `innerHTML`/`dangerouslySetInnerHTML` sink in the renderer (only the pre-existing paste sanitizer). FTS operators are neutralized by quoting each word in `toFtsQuery`. Covered by unit snippet.test, integration search.test (markup returned as text, operators not interpreted) and e2e search.spec (`<img onerror>` payload shown as text, no `img`/`b` elements, `__pwned` undefined).
- **File hand-off refuses executables/scripts and never shell-interpolates.** `AttachmentHandoff` requires the note to link the attachment, takes the path only from the stored row, checks containment via `containedAttachmentFile` (lstat rejects symlinks, realpath of both root and file), and opens only allowlisted document/image extensions (`isOpenableExtension`); everything else is refused with a notice and logged. Calls are `shell.openPath` / `shell.showItemInFolder` with a path argument, no command string. Sticky windows may call the two channels, and the router's D-064 own-note check applies. Covered by integration handoff.test (exe refused and never launched, unlinked, missing, junction escape, OS failure) and e2e references.spec.
- **Reference index in the same save transaction.** `ContentIndexer.index` (called from `note-content.ts` inside the write transaction) now calls `ReferencesRepo.replaceForSource`. integration references.test "a stale save changes no reference" asserts a rejected (CONFLICT) save leaves `note_references` untouched.
- **Guard tests changed from "absent" to "present".** `boundaries.test`, `contracts.test`, `ipc-validation.test`, `security.spec` now assert the seven channels exist, in order, with exact counts (78 invoke, 12 events), and still assert that `note:trashed`, `sticky:removeSticky` and `attachment:importImageBytes` are absent. The bridge surface stays an exact list. The sticky allowlist grew by exactly the two hand-off channels (35 to 37) and is enumerated. `contracts-phase06.test` dropped its total-length assertion, but `contracts.test` asserts the new total. `doc-schema.test` "keeps every supported node" now uses distinct IDs because repeated IDs are dropped by design, and a dedicated test covers that rule. Nothing was weakened.
- **Migrations 001-006 untouched.** `git diff HEAD -- src/main/db/migrations/` shows only `index.ts` (version 7 appended) and `checksums.json` (key 7 added). Migration 007 is new and STRICT, the target is intentionally not an FK, and the unique index plus the purge trigger match D-098.

## Observations (not defects)

- A note body containing literal U+0002/U+0003 characters would show a spurious highlight in a snippet. This is cosmetic only, because segments are still text.
- A noteRef label longer than 200 characters is stored as an empty label rather than truncated. Note titles are capped at 200, so the picker never produces one.
- The hand-off allowlist includes `zip`. Opening an archive shows its contents and launches nothing.

## Not run in this phase (recorded for Phase 09)

WSL/WSLg E2E, Xvfb, forced Wayland, packaging and packaged E2E. Real OS application launch for `shell.openPath` and `showItemInFolder` was exercised only through the recording test adapter. The release search-latency measurement is INF-PERF-03.

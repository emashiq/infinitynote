# Phase 07 progress: References, backlinks and fast retrieval

Implementer: infinity-code-opus (Opus 5.5, high), fast mode (CLAUDE.md 2026-10-09: no separate planner or QA). Plan pointer: `docs/plans/phase-07.md`. Logs: `.infinity-work/logs/phase-07/`. Decisions: D-098.

## Plan

- Migration `007_references_tags.sql` (D-051 allocation; 001-006 untouched): `note_references` (source FK cascades; target not an FK so it survives purge; unique per source block and target; `BEFORE DELETE ON notes` trigger keeps the purged title), `tags`, `note_tags`. `LATEST = 7`.
- Document schema: inline atom `noteRef {noteId, blockId|null, label, excerpt|null}`; `normalizeRichDoc` drops repeated block IDs (INF-REF-07); `collectNoteRefs`. Plain text includes the label.
- Main: `ContentIndexer` rewrites references inside the save transaction; `ReferenceService` (outgoing with `ok|blockMissing|trashed|missing`, backlinks, picker blocks); `SearchService` + `SearchRepo` (FTS5 quoted prefix words, bm25 title 10:1, 1-2 character title substring, scope and tag filters, cap 50, `{text, hit}` segments); `TagService`; `AttachmentHandoff` (linked, contained, allowlisted types only; Show in folder never launches).
- IPC (appended, 78 invoke channels, no event): `refs:list`, `notes:pick`, `search:query`, `tags:list`, `tags:set`, `attachment:open`, `attachment:showInFolder` (the last two also for stickies, own note only).
- UX: More and palette "Link to note…" two-step picker; reference chips with live titles, unavailable state, click opens a tab and reveals the block; Details panel Outgoing references, Backlinks (Restore/Search for broken links), Tags, docked close control; palette Pinned/Favorites, full-text results with safe highlights, Filters (scope, tag), debounce 150 ms; file chips Open / Show in folder; trashed/missing note tabs offer Search. Quick sticky (Ctrl+Shift+N) keeps the existing scope inheritance (D-069), verified end to end.
- Tests per ID: REF-01 e2e picker; REF-02 integration block ref + unit schema + e2e; REF-03 e2e backlinks; REF-04 e2e scroll to block; REF-05 integration rename/move + e2e; REF-06 integration + e2e trashed target; REF-07 integration duplicate content + unit; REF-08 integration handoff + e2e; REF-09 e2e quick sticky scope; SRCH-01..05 integration search (incl. 10,000-note p95) + unit snippet + e2e search; SRCH-06 e2e palette pending edit; HIER-11 integration tags + e2e tag filter. Gate once at the end: check, build, test:e2e (Windows, Node 24.21 runner).

## Summary

Notes can link to other notes or to one paragraph of another note through a searchable picker; links are stable IDs indexed in the same transaction as the content. The Details panel lists outgoing references and backlinks; a renamed or moved target keeps its links, and a trashed, purged or changed target shows a clear, recoverable state (Restore, Search) instead of redirecting. Ctrl+K searches titles and bodies (Bangla included) with highlighted snippets, scope and tag filters, pinned and favorite notes, and opens the exact tab without losing typing. Attached files open through a validated hand-off that never launches programs. Tags (at most 20 per note) are edited in the Details panel.

## Hosts

- Windows 11 Pro 10.0.26300; Node 24.15.0 (lint, typecheck, unit, integration, build); E2E runner Node 24.21.0 (`INFINITY_E2E_NODE`, portable); Electron 44.7.0.
- No WSL, Xvfb, forced-Wayland or packaging runs in this phase (fast mode; all deferred to Phase 09).

## Files

- Migration: `src/main/db/migrations/007_references_tags.sql` (new), `index.ts`, `checksums.json` (only key 7 added).
- Shared: `contracts/{references,search,tags}.ts` (new); `contracts/{attachments,bridge,channel-names,channel-roles,channels}.ts`; `editor/doc-schema.ts` (noteRef, duplicate-ID rule, `collectNoteRefs`); `editor/text-blocks.ts` (new); `search/segments.ts` (new); `text/plain-text.ts`; `attachments/names.ts` (`isOpenableExtension`).
- Main: repositories `references-repo.ts`, `search-repo.ts`, `tags-repo.ts` (new), `attachments-repo.ts` (`isLinked`), `hierarchy-repo.ts` (`scopeFilter` exported with a column); services `reference-service.ts`, `search-service.ts`, `tag-service.ts`, `attachment-handoff.ts`, `attachment-files.ts` (new; the containment check now shared with `windows/attachment-protocol.ts`), `content-indexer.ts`, `shell-adapter.ts` (`showItemInFolder`); `ipc/handlers/retrieval-handlers.ts` (new), `attachment-handlers.ts`, `register-handlers.ts`; `main-services.ts`; `index.ts` (shell adapter before the services); `test-hooks.ts` (records `showItemInFolder`); preload.
- Renderer: editor `note-ref.ts`, `NoteRefView.tsx`, `ReferencePicker.tsx` (new), `extensions.ts`, `file-attachment.ts`, `FileChipView.tsx`, `NoteEditor.tsx`, `Toolbar.tsx`, `content.ts` (`EditorHost.noteId`), `editor-services.ts` (`ReferenceHost`); palette `CommandPalette.tsx`, `Highlighted.tsx`, `quick-notes.ts` (new); panel `PanelSection.tsx`, `ReferencesSection.tsx`, `TagsEditor.tsx` (new), `ContextPanel.tsx`, `InfoSection.tsx`, `RemindersSection.tsx` (both now on PanelSection); `notes/NoteView.tsx`; `shell/Shell.tsx`; state `app-services.ts`, `commands.ts`, `palette-actions.ts`, `ui-store.ts`; styles `components.css`, `editor.css`.
- Tests (new): `tests/integration/{references,search,tags,handoff,ipc-handlers-phase07}.test.ts`, `tests/unit/renderer/{snippet.test.tsx,quick-notes.test.ts}`, `tests/e2e/{references,search}.spec.ts`; additions to `tests/e2e/{palette,stickies}.spec.ts`, `tests/unit/doc-schema.test.ts`, `tests/unit/renderer/editor/doc-drift.test.ts` (noteRef), `tests/integration/migrations.test.ts` (migration 007 block).
- Tests (updated for the new phase, no assertion weakened): schema version 6 to 7 (`migrations.test`, `migrations-checksum.test`, `smoke.spec`, `packaged.spec`); the Phase 07 boundary guards now require the seven channels instead of their absence (`boundaries.test`, `contracts.test`, `contracts-phase06.test` sticky allowlist 35 to 37, `ipc-validation.test` catalogue sentinel `note:trashed`, `security.spec` bridge surface); fake shells gain `showItemInFolder`; the palette input is now "Type a command or search notes" (7 files); `doc-schema.test` "keeps every supported node" uses distinct block IDs (a repeated ID is now dropped by design); `palette-actions.test` lists "Link to note…"; renderer fake bridge gains the new channels.
- Docs: `docs/DECISIONS.md` (D-098), `docs/ARCHITECTURE.md` (sections 4, 11, 12), `docs/UX_SPEC.md` (Phase 07 copy), `docs/BACKLOG.md` (16 rows done), `docs/plans/phase-07.md`, this report.

## Requirement coverage

| ID | Evidence (tests that ran) | Status |
| --- | --- | --- |
| INF-REF-01 | e2e/references.spec › picker (More → Link to note…, title search, Whole note, DB row, palette action, Escape inserts nothing); integration/ipc-handlers-phase07.test › main channels | done |
| INF-REF-02 | integration/references.test › block ref (outgoing and backlink rows, label in plain text); unit/doc-schema.test › note references; e2e/references.spec › scroll to block (block picked in the picker, DB `target_block_id`) | done |
| INF-REF-03 | e2e/references.spec › backlinks (Backlinks and Outgoing references lists, opening a backlink, empty state, panel close); integration/references.test › block ref, trashed source drops out | done |
| INF-REF-04 | e2e/references.spec › scroll to block (chip click activates the Design tab, `.reveal-block` is the target paragraph and in the viewport) | done |
| INF-REF-05 | integration/references.test › rename/move (title and path follow; backlinks follow a moved source); e2e/references.spec › trashed target (rename updates the chip and panel live) | done |
| INF-REF-06 | integration/references.test › trashed target (trashed with batch, restore, blockMissing, purged keeps the last title, unknown target); e2e/references.spec › trashed target (chip unavailable, opens the note's own Trash state with Search, panel Restore, purged "no longer exists" with Search prefilled) | done |
| INF-REF-07 | integration/references.test › duplicate content (a copy with the same IDs is not a backlink target; a repeated ID inside one note is dropped); unit/doc-schema.test › repeated block ID; unit/renderer/editor/block-ids.test (Phase 03 paste guard, still green) | done |
| INF-REF-08 | integration/handoff.test › opens a linked document; › blocked extensions (exe refused, never launched, Show in folder allowed); › unlinked, missing, junction-escape and OS failure; integration/ipc-handlers-phase07.test › sticky own-note only; e2e/references.spec › attached documents (Open pdf → openPath, Open exe → notice, Show in folder) | done |
| INF-REF-09 | e2e/stickies.spec › quick sticky scope (Ctrl+Shift+N from a note in Alpha › Plans files the sticky there; from Home All → Common; no dialog) | done |
| INF-SRCH-01 | integration/search.test › Bangla, prefix; e2e/search.spec › highlighted snippets (Bangla prefix hit marked) | done |
| INF-SRCH-02 | integration/search.test › index lifecycle (edit, trash, restore, move, rename) | done |
| INF-SRCH-03 | integration/search.test › scope filter and tag filter; e2e/search.spec › tag filter (Filters → Tag, Search in Work/Common) | done |
| INF-SRCH-04 | unit/renderer/snippet.test › no HTML injection (segments render as text, no elements, no script); integration/search.test › snippets carry markup as text; e2e/search.spec › highlighted snippets | done |
| INF-SRCH-05 | integration/search.test › p95 (10,000 notes, 100 projects, 40 queries, every unscoped query returns exactly 50, bound 1,000 ms); measured p95 below; palette debounce 150 ms (`SEARCH_DEBOUNCE_MS`) | done (release target measured again in Phase 09, INF-PERF-03) |
| INF-SRCH-06 | e2e/palette.spec › open with pending edit (typing then Ctrl+K → other note: text saved; body search finds it with `<mark>`; Enter re-activates the same tab, 3 tabs, text intact); e2e/search.spec › pinned and favorite notes | done |
| INF-HIER-11 | integration/tags.test (normalization, contract max 20, live counts, unused tags removed, trashed note refused); e2e/search.spec › tag filter (add, invalid, remove in the panel; filter in the palette) | done |

Search latency (INF-SRCH-05), `integration/search.test › p95`, Windows 11 development machine, in-process better-sqlite3: **p95 10.8 ms, median 7.4 ms** over 40 queries (10 terms × 4 rounds, half scoped to a project) at 10,000 notes with 40-word bodies; every unscoped query returned exactly 50 results (`.infinity-work/logs/phase-07/dev-search-p95.log`, EXIT=0, run after the final E2E; an earlier development run measured p95 10.0 ms, median 7.2 ms). The test also passed inside final-check.log against its 1,000 ms regression bound.

## Commands and results

| Step | Command | Log | Result |
| --- | --- | --- | --- |
| Targeted integration | `npx vitest run --project integration tests/integration/{migrations,references,search,tags,handoff,ipc-handlers-phase07}.test.ts` | console | all passed after fixes (see below) |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/references.spec.ts` | dev-references-1..3.log | 1: 3/5 (test expectations: backlink context, trashed chip label); 2: 4/5 (trashed tab label is "Untitled", assertion moved to the tab id); 3: 1/1 |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/search.spec.ts tests/e2e/palette.spec.ts tests/e2e/stickies.spec.ts -g …` | dev-search-1.log, dev-search-2.log | 1: 4/6 (filter `<select>` options matched `getByRole('option')`; filters moved behind a "Filters" toggle); 2: 5/5 |
| Final check | `npm run check` | final-check.log | EXIT=0: lint, typecheck, unit 85 files / 627 tests, integration 41 files / 375 passed + 1 skipped (pre-existing Linux-only symlink case), traceability fails=0 |
| Final build | `npm run build` | final-build.log | EXIT=0 |
| Final E2E | `INFINITY_E2E_NODE=…\node-v24.21.0-win-x64\node.exe npm run test:e2e` | final-test-e2e.log | EXIT=0: 200 passed, 1 skipped (`smoke.spec › Linux: main.log records the display and ozone line`, Linux-only), 7.4 min; no Electron process left afterwards (`tasklist` count 0) |

After the final E2E only this report was edited; `node tools/check-traceability.mjs --repo .` then gave EXIT=0, fails=0 (final-traceability-after-docs.log).

## Issues found and fixed during the phase

- I7-01: the first full `npm run check` failed typecheck because `tests/unit/snippet.test.tsx` sat outside the JSX test folder; moved to `tests/unit/renderer/snippet.test.tsx` (BACKLOG reference updated).
- I7-02: palette filter `<select>` options are `option` roles, so existing tests that took the first `option` in the palette picked "All notes". The filters now sit behind a "Filters" toggle (compact by default; "Filters (n)" shows active filters), and the new tests scope to the Results listbox.
- I7-03: backlink context and picker text now include reference labels ("Agreed in Design"), via `textBlocksOf`, while reminder anchors keep `richBlockText` (labels excluded, offsets unchanged).
- I7-04: the "Link to note…" palette request opened the picker from an effect (lint `set-state-in-effect`); it now adjusts state during render and consumes the request in an effect.

## Title bar caption area (user-reported defect, D-097 amendment)

- Report: the background behind the OS caption buttons (titleBarOverlay) does not match the title bar.
- Evidence before the fix (built app, Windows 11, OS apps theme dark (`AppsUseLightTheme=0`), 100 % scale; OS screen captures with PowerShell `CopyFromScreen` of the window rect, pixels sampled at x=300 (bar), W-90 and W-4 (caption area); `.infinity-work/logs/phase-07/titlebar/before-osdark.{json,log}` and `before-*.png`):
  - The fill was identical in app light, app dark and app system: #ffffff / #17181d in the bar and the caption area, also after a live theme switch.
  - At y=43 the bar shows its 1 px bottom border (#e4e6ee light, #30333d dark), but the caption area showed the fill colour. The 44 px overlay covered the border, so the separator line stopped at the buttons and the caption area read as a separate block.
  - The first probe run (`before.json`) seemed to show a light bar under a dark overlay in "system" mode. That was Playwright's default `prefers-color-scheme: light` emulation; the re-run with `colorScheme: null` showed no colour mismatch.
- Fix:
  - The design tokens moved to `src/shared/theme/tokens.css`, one source of truth for the renderer's CSS and for main, with a new token `--header-border: 1px`.
  - Main reads the tokens as raw text (`src/shared/theme/tokens.ts` `themeTokens`). The overlay is now `color: --bg`, `symbolColor: --text`, `height: --header-h - --header-border` (43 px), so the border runs under the buttons.
  - The bar's CSS uses `var(--header-border)`. Vitest loads that one CSS file as text (`vitest.config.ts` `css.include`). The test hooks record every overlay the window applies.
- Evidence after the fix (`after-scale100|125|150.{json,log}` and `after-*.png`):
  - At 100 %, the bar and both caption columns are equal on every sampled row, border row included (#e4e6ee / #30333d), for app light, dark and system (OS dark).
  - The same holds both after a live switch and after a restart with the stored theme.
  - The same holds with `--force-device-scale-factor=1.25` and `1.5` (no 1 px rounding gap).
  - The pixel at W-4, y=2 is the Windows window-frame edge and differs from the fill before and after the fix.
- Tests:
  - `tests/unit/main-window-options.test.ts`: overlay 43 px, and the colours equal the tokens; the header CSS uses the same tokens.
  - `tests/unit/theme-tokens.test.ts` (new).
  - `titlebar.spec` › "the caption-button overlay matches the bar in each theme and stops above its bottom border": main's applied overlay equals the bar's computed background, text colour and height above the border, for dark → light → dark.
- Commands:
  - `node tools/run-e2e.mjs tests/e2e/titlebar.spec.ts`: titlebar-spec.log, 4 passed, EXIT=0.
  - The titlebar, shell and smoke specs: theme-specs.log, 22 passed, 1 Linux-only skip, EXIT=0, 0 Electron processes left.
  - `npm run check`: `titlebar/check.log`, EXIT=0 (unit 86 files / 630 tests; integration 375 + 1 skipped; traceability fails=0).
- Not run:
  - OS light theme: the user's Windows theme was not changed. "App theme different from the OS theme" is covered by app light on OS dark.
  - Native 125 %/150 % display scaling: the scaling was simulated with `--force-device-scale-factor`.
  - The full E2E suite was not re-run after this fix, per the coordinator's direction to run only the affected specs. Its earlier run (final-test-e2e.log) predates this change.

## Known limits and pending cases

- A reference chip whose target is not live shows the title it was inserted with (the panel shows the target's last title from main). A note tab opened for a trashed note is labelled "Untitled" in the tab strip (existing Phase 02 behavior); the tab content says "This note is in Trash" with Restore and Search.
- Sticky windows show reference chips as labels only (no tabs to open); their file chips open through the same hand-off for their own note.
- Not run in this phase (fast mode): WSL/WSLg E2E, Xvfb, forced Wayland, packaging and packaged E2E; all in Phase 09. The native OS hand-off (`shell.openPath`, `showItemInFolder`) is exercised through the recording test adapter; opening a real document in its OS app is a Phase 09 native case.

# Phase 06 acceptance: Reminder suggestions from natural-language notes (plus D-097 custom title bars)

Acceptor: infinity-acceptor (Opus 5.5, high), 2026-10-09. HEAD = `edb40c6` (Phase 05). Fast mode (CLAUDE.md, 2026-10-09): there was no separate QA pass. I reviewed the code and the logs. I did not re-run the full suites, and no spot-run was needed. I wrote no application code.

## Decision: accepted

The Phase 06 acceptance criteria are implemented and asserted by real tests. The Windows gate ran after the last source and test change and passed:

- check: unit 620, integration 349 + 1 skipped, traceability fails=0
- build
- E2E: 190 passed, 1 Linux-only skip

The two test edits made after the first E2E run fix locators or races. They do not weaken any assertion. The Linux evidence (WSLg E2E, packaged E2E) was recorded before the title-bar change (D-097). Fast mode says WSL runs once, in Phase 09, so the post-title-bar Linux and packaged runs move to the Phase 09 matrix. Under the rule for phases 00 to 08, this means the phase is accepted.

## What was read

- Pack: `phases/06-reminder-suggestions-from-natural-language-notes.md`. Repository docs: PRODUCT_SPEC section 6 (frozen-clock contract), CLAUDE.md (Fast mode, Custom title bar), `docs/plans/phase-06.md`, `docs/progress/phase-06.md`.
- Code: migration `006_reminder_sources.sql`; `ipc/handlers/suggestion-handlers.ts`; `ReminderService.createFromSource`, `updateFromSource`, `linkedReminder` and `checkReference`; the contracts in `suggestions.ts` and `channels.ts` (all strict zod); the preload diff; `main-window.ts` (titleBarOverlay, follows nativeTheme); `AppMenuBar.tsx`; the drag-region CSS in `shell.css`, `stickies.css` and `widget.css`; `StickyHeader.tsx` (× calls the existing `actions.hide`).
- Tests: `tests/unit/nlp-parse.test.ts` (C1-C22 and P rows), `tests/e2e/nlp.spec.ts`, `tests/e2e/titlebar.spec.ts`, and the diff of every modified existing test (30 files; only `contracts-phase05` has more deletions than insertions, explained below).

## Gates and freshness

The last source change was `src/renderer/styles/shell.css` at 13:26:49. The last test change was `tests/e2e/{paste,tree}.spec.ts` at 13:39:11. `find src tests -newer final-test-e2e.log` returns nothing.

| Gate | Host | Exit | Result | Log (`.infinity-work/logs/phase-06/`) | Time |
| --- | --- | --- | --- | --- | --- |
| `npm run build` | Windows | 0 | renderer and main bundles | final-build.log | 13:31 |
| `npm run test:e2e` (first run) | Windows | 1 | 188 passed, 2 failed (I6-07, I6-08) | final-test-e2e-run1.log | 13:38 |
| tree.spec and paste.spec after the fixes | Windows | 0 | 19 passed | final-repair-tree-paste.log | 13:40 |
| `npm run test:e2e` | Windows | 0 | 190 passed, 1 skipped (smoke › Linux ozone line); includes all 17 nlp.spec cases and 3 titlebar.spec cases | final-test-e2e.log | 13:40-13:47 |
| `npm run check` | Windows | 0 | lint, typecheck, unit 83 files / 620 passed, integration 36 files / 349 passed + 1 skipped, traceability ids=187 fails=0 | final-check.log | 13:47 |
| Electron processes left | Windows | 0 | 0 | final-electron-left.log | 13:38 |
| Pre-title-bar: package:current, verify:native, test:e2e:packaged | Windows | 0 | 5 passed, including the bundled-parser case | pre-titlebar-final-*.log | before D-097 |
| Pre-title-bar WSL: check, build, WSLg E2E, Xvfb E2E, package:linux, packaged E2E | WSL2 Ubuntu 26.04.1, WSLg 1.0.73 (Weston) | 0 | WSLg 186 passed + 2 Windows-only skips; packaged 5 passed | wsl-*.log | before D-097 |

## Acceptance criteria review

| Criterion | Evidence | Verdict |
| --- | --- | --- |
| All TEST_MATRIX / PRODUCT_SPEC section 6 frozen-clock rows | `nlp-parse.test.ts` asserts each row's date, time and exact UTC instant against reference 2026-10-08T07:00Z: C1-C6, C7-C15 (full weekday table, including last Friday past), C16 (03/04: `needsChoice [order, meridiem]`, then 2027-04-03T11:00Z with Use next year), C17 (Oct 1 stays 2026, past), C18 (CST: `needsChoice [zone, meridiem]`, then 22:00Z), C19/C20 (NY Oct 8 13:00Z vs Dhaka Oct 9 03:00Z), C21 gap 07:00Z, C22 fold 05:30Z/06:30Z. The restart row is covered by integration `suggestions` and E2E INF-SUG-07. | met |
| tomorrow EOD visibly 17:00; date-only visibly 09:00 | C1/C5 disclosures; E2E full flow card text "17:00 (default end of day)"; E2E disclosure case | met |
| Selected-zone arithmetic near midnight | C19/C20, P-rows for "at 9am" in both zones; E2E card fields (zone change re-reads the phrase) | met |
| Ambiguous text needs a choice | C16, C18; E2E choice-required cases (order, meridiem, CST) gate Add | met |
| No reminder exists before an explicit Add | E2E cancel: Cancel and Escape leave reminders, occurrences and sources empty, and the text is unchanged. Integration: 10 refused creates. Main only writes in `createFromSource`, called from an explicit IPC request. | met |
| No reparse shift after restart | A reminder stores date, time, zone and occurrence `due_at_utc`. The source row keeps `reference_instant_utc`, and main never re-parses. E2E: restart with the clock moved to the next day keeps 2026-10-09T03:00Z and shows Overdue. | met |
| Dedupe across edits and restarts | `linkedReminder` returns `existing: true` for the same note, block, ordinal and normalized phrase. Dismissals are stored with a dedupe key. E2E: after a restart and edits on both lines, there are no candidates and still one reminder. | met |
| Update on source change | `source_state` changed/missing. E2E: the panel shows "text … changed" and the chip label says so, but the occurrence does not move until Update. After Update it is 2026-10-16T03:00Z and the source is "next Friday". Keep current time detaches the source. | met |
| Past dates visible | C17, the last Friday row, E2E "past date stays past" (Add anyway, no notification) | met |
| DST selection | C21/C22, P36 (Nov 2 = 14:00Z, not 13:00Z), E2E DST choices (fold later 06:30Z, gap 2027-03-14T07:00Z) | met |
| No network or LLM | The boundaries test checks that `chrono-node/en` is imported only in `shared/nlp/parse.ts`, main imports neither the parser nor chrono, and there are no fetch, XHR, WebSocket, http(s) or net imports in nlp or the suggestion UI. `package.json` and `package-lock.json` are unchanged. The bundle evidence shows English vocabulary only. | met |
| E2E phrase → preview → confirm → panel → notification source | `nlp.spec › full flow`: the source row has the exact span 23-46, `reference_instant_utc` and `origin`. The notification is clicked through the test hook and opens the note, reveals the block and puts the selection in it. | met (the real OS toast is the Phase 05/09 native path) |

## Specific checks requested

- **The two test fixes do not weaken anything.**
  - `tree.spec › Common protected` now looks for menu items only inside the context menu (`getByRole('menu').getByRole('menuitem')`). It expects the same list, and the banned-item checks are unchanged. The old locator also picked up the new menubar items File, View and Help. Those items are correct ARIA, so this is a locator fix.
  - `paste.spec › copied blocks get new IDs` now waits until both DOM IDs are non-null before it reads them. Every later assertion is unchanged.
- **The other changes to existing tests are contract moves, not removals.**
  - `contracts-phase05`: the 67-channel total moved to the Phase 06 contract test, and the exact slice 50-67 stays.
  - `ipc-handlers-phase05`: `zones:list` and `reminder:create` left the sticky forbidden list. They now have positive own-note tests and a FORBIDDEN test for another note. `reminder:update` and `reminder:delete` stay forbidden.
  - The window-option tests were updated for frameless windows, and they assert the new properties.
- **The Asia/Dhaka guard exemption is narrow.** `boundaries.test.ts` removes exactly one anchored line, `^  BST: [['Europe/London'], ['Asia/Dhaka']],$`, and only in `shared/nlp/abbreviations.ts`. Any other Asia/Dhaka literal in that file or in any other file still fails.
- **Drag regions do not swallow controls.**
  - `.app-header` is `drag`. Its `button`, `input` and `.menubar` are `no-drag`, and the dropdown menu renders inside `.menubar` with `<button>` items.
  - In the sticky header and the widget header, buttons (and inputs in the sticky) are `no-drag`.
  - `titlebar.spec` asserts the computed `-webkit-app-region` for the header, menubar, search box, header action buttons, sticky header and its buttons, and widget header.
  - Limitation: on Windows, CDP-dispatched clicks do not go through the OS hit test. Real mouse drag and click on the OS caption area is therefore a native Phase 09 case.
- **The menus work from the keyboard.** Alt alone focuses File. Left and Right move between menus. Down or Enter opens a menu. Enter runs an item, and Escape closes the menu and returns focus to the menubar button. The Help dialogs open and close. `role=menubar`, `menuitem`, `menuitemradio` with `aria-checked`, and `aria-keyshortcuts` are all asserted.
- **Sticky × works.** The E2E test clicks "Close sticky" and the sticky window list becomes empty. A unit test checks that × calls `actions.hide` once. It uses the existing `sticky:hide` channel.
- **No new unvalidated IPC.** The title bar adds no channel. The OS draws the caption buttons (`titleBarOverlay`), and `setTitleBarOverlay` follows `nativeTheme` in main. Phase 06 adds four invoke channels, each with a strict zod request and response. The sticky allowlist adds five channels, all limited to the sticky's own note by the router's ownership rule. `updateFromSource`, `update` and `delete` stay main-only.

## Follow-ups by phase

- **Phase 09 (native, WSL once per fast mode):**
  - Re-run WSL check, WSLg E2E and `package:linux` with packaged E2E on the post-D-097 code. The current Linux evidence predates the title bar.
  - Re-run Windows `package:current` and `test:e2e:packaged` after D-097.
  - Check `titleBarOverlay` on Linux/WSLg (that caption buttons are drawn, or a documented fallback) and frameless sticky and widget dragging on WSLg/Weston.
  - Check, with a real mouse on Windows 11, that the caption buttons respond and that dragging by the bar and double-click-to-maximize work.
- **Phase 09 (carried over):** A05-F2 and A05-F5 from Phase 05; the real OS toast for a suggestion-created reminder (Phase 05 path).
- **Phase 07/08:** none blocking. The known limitations (English only, recurrence words not interpreted, suggestions only for text edited in the current session) are documented product behavior.

## Pending native cases (not claimed as passed)

- WSLg/Weston: the title bar and frameless windows after D-097, and the packaged AppImage/.deb after D-097.
- Windows: native caption-button hit testing and the frameless drag behavior under a real pointer; the NSIS package after D-097.
- GNOME Wayland and X11 sessions are outside the user-selected validation scope. They are not recorded as passes.

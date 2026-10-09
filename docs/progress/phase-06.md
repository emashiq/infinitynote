# Phase 06 progress: Reminder suggestions from natural-language notes

Implementer: infinity-code-opus (Opus 5.5, high). Plan: `docs/plans/phase-06.md`. Logs: `.infinity-work/logs/phase-06/`.

## Checkpoints

- Checkpoint S0 done 2026-10-09 — gates: S0-preflight.log, S0-check.log (EXIT=0; unit 527, integration 328 + 1 skipped) — files: none (HEAD edb40c6, `chrono-node/en` resolves to `dist/cjs/locales/en/index.js`)
- Checkpoint S1 done 2026-10-09 — gates: S1-check.log (EXIT=0; unit 579, integration 328 + 1 skipped) — files: src/shared/nlp/{constants,types,abbreviations,source-text,title,parse,resolve-candidate}.ts, src/shared/time/{format,resolve,zones}.ts, aliases.config.ts, electron.vite.config.ts, vitest.config.ts, tests/unit/{nlp-parse,nlp-source-text,boundaries}.test.ts. TypeScript resolves the `chrono-node/en` typings through the package exports; Vite's resolver does not (D-096 alias).
- Checkpoint S2 done 2026-10-09 — gates: S2-checksums.log (only key 6 added), S2-frozen.log (EXIT=0), S2-check.log (EXIT=0; unit 580, integration 344 + 1 skipped), S2-build.log (EXIT=0), S2-test-e2e.log (smoke, migration-failure, reminders: 23 passed, 1 skipped Linux-only; EXIT=0) — files: migration 006 + index + checksums; repositories reminder-sources-repo, dismissals-repo; services reminder-sources, reminder-anchors, reminder-service, suggestion-service, content-indexer; main-services, index.ts (startup prune), test-hooks; contracts reminders (source DTO, messages), suggestions, settings (3 keys); tests migrations, migrations-checksum, settings, trash, suggestions (new), contracts-phase02/05, smoke/packaged schemaVersion 6, integration helpers (reopen, edit).
- Checkpoint S3 done 2026-10-09 — gates: S3-check.log (EXIT=0; unit 588, integration 349 + 1 skipped), S3-build.log (EXIT=0), S3-test-e2e.log (full suite 168 passed, 1 Linux-only skip, 5.9 min; EXIT=0; no electron left) — files: contracts channel-names (71), channels, bridge, channel-roles (sticky +5), preload; main ipc/handlers/suggestion-handlers.ts, register-handlers; tests contracts-phase06 (new), ipc-handlers-phase06 (new), contracts/boundaries/ipc-validation guards moved to Phase 07 names, contracts-phase05 (slice 50-67 exact, total moved to Phase 06), ipc-handlers-phase05 (sticky ownership replaces the forbidden zones:list/reminder:create rows), ipc-validation sticky allowlist, security.spec bridge surface and sticky listDismissed own/other, renderer fake bridge.
- Checkpoint S4 done 2026-10-09 — gates: S4-check.log (EXIT=0; unit 606, integration 349 + 1 skipped), S4-build.log (EXIT=0), S4-test-e2e.log (full suite 168 passed, 1 Linux-only skip, 6.2 min; EXIT=0) — files: renderer reminders/{ReminderFields,ReminderDialog (uses the extracted fields, unchanged behavior),SuggestionCard,suggestion-form,card-request,suggestion-context}.ts(x), editor/{block-text,suggestion-requests,NoteEditor,Toolbar,editor-services}.ts(x), notes/{NoteView,NoteDialogs}.tsx, stickies/StickyView.tsx, ui/DialogHost.tsx, state/{ui-store,core-services}.ts, styles/reminders.css; tests unit/renderer/{suggestion-card.test.tsx, editor/block-text.test.ts (the R6-06 drift case against Tiptap getJSON)}, reminder-dialog.test (unchanged, green).
- Checkpoint S5 2026-10-09 — gates: S5-check.log (EXIT=0; unit 618, integration 349 + 1 skipped), S5-build.log (EXIT=0), S5-test-e2e.log (EXIT=1: 167 passed, 1 failed — `visual.spec › sticky read-only banner and trash state` passed its body, then its teardown timed out: the app ignored two quit requests and stayed alive). Diagnosis in "Issues found and fixed" (I6-01): the stalled app's `main.log` (saved as S5-stuck-app-main.log) shows `uncaughtException TypeError: This database connection is busy executing a query` from `StickyManager.prepareQuit` inside `before-quit`, i.e. the F04-A2 inspector-interrupt race hitting `closeApp`'s direct `app.quit()`; the orphaned Electron process (5 processes) was stopped. The test passed 16/16 in isolation against the same build (S5-repro-sticky-trash.log, S5-repro2-sticky-trash.log). Fix: E2E quits requested on a fresh macrotask (`fixtures.ts closeApp`, `editor.spec`, `editor-flow.spec`). The full suite reruns at the S6 gate. Files: editor/{suggestions,suggestion-detector,SuggestionBar,NoteEditor,extensions,suggestion-requests}.ts(x), reminders/{suggestion-memory,suggestion-context}.ts, styles/{editor,reminders}.css; tests unit/renderer/editor/suggest-detect.test.ts (detection, suppression, memory, budgets, bar text).
- Checkpoint S6 done 2026-10-09 — gates: S6-check.log (EXIT=0; unit 619, integration 349 + 1 skipped), S6-build.log (EXIT=0), S6-test-e2e.log (EXIT=1: 186 passed, 1 failed — `reminders.spec › settings explain the lifecycle…`: `getByLabel('From')` also matched the new switch "Suggest reminders from dates in notes"; the locator is now exact, same assertion; S6-repair-reminders.log 11 passed). The S5 teardown stall did not recur (0 Electron processes left). Files: editor/reminder-chips.ts (`sourceChanged`, `chipLook`), reminders/{note-reminders,ReminderChipBar,reminders-store (keepSource),SuggestionCard}.ts(x), panel/RemindersSection.tsx (changed and missing source rows, Update from text…, Keep current time), editor/{content,suggestion-requests (updateRequestFromText),NoteEditor (phraseText; card opens after the menu returns focus)}.ts(x), notes/note-controller.ts (phraseText), stickies/StickyView.tsx (Open in app to update), pages/ReminderSettings.tsx, styles/reminders.css; tests unit/renderer/editor/reminder-chips.test.ts, support/editor-source.ts, e2e reminders.spec locator.
- Checkpoint S7 (specs) 2026-10-09 — logs S7-dev-nlp-1.log (13/17: `<q>` quotes are CSS-only; focus returned to the More button after the card, I6-02; Ctrl+End not yet read by ProseMirror in the long note), S7-dev-nlp-2.log (15/17), S7-dev-nlp-3.log (nlp.spec 17 + 2 Phase 06 visual cases, 19 passed, screens in screens/win). Files: tests/e2e/{nlp-ui.ts,nlp.spec.ts}, visual.spec (2 cases, 8 screens), packaged.spec (bundled parser case), fixtures/editor/editor-flow (fresh-task quit, I6-01). Release gates ran as the pre-title-bar gate set (pre-titlebar-final-*.log).
- Checkpoint S8 done 2026-10-09 — WSL leg on the Phase 06 code before the title-bar change (logs `wsl-*.log`): env, sync (MIRROR_IDENTICAL), deps (chrono-node 2.10.2, luxon 3.7.2), check (unit 619, integration 350), build, WSLg E2E 186 passed + 2 Windows-only skips (ozone x11), Xvfb E2E 186 + 2, visual 20, package:linux, packaged E2E 5; all EXIT=0, electron left 0. Forced Wayland not run (coordinator direction).
- Checkpoint title bar 2026-10-09 — user direction via the coordinator (D-097): main window without OS title bar (app bar with File/View/Help, centered search, OS caption buttons via titleBarOverlay), frameless stickies and widget, sticky × close. Targeted logs titlebar-targeted-1.log (titlebar, shell, stickies, widget, keyboard, a11y-keyboard, visual: 58 passed), titlebar-targeted-2.log (layout fix: 32 passed). Per the coordinator, WSL, Xvfb, Wayland and packaging were not rerun after this change.
- Checkpoint S9 done 2026-10-09 — BACKLOG statuses and planned tests, this report, UX_SPEC (one new error string; D-097 title bars), DECISIONS D-096 and D-097; traceability EXIT=0.

## Summary

Phase 06 adds reminder suggestions from English note text, entirely on this computer: a chrono-node (English only) adapter with an explicit reference instant and zone, edit-triggered idle detection with dotted underlines and a suggestion bar in tabs and stickies, More → "Create reminder from text", a confirmation card that writes nothing before Add, persisted sources with dedupe, explicit Update or Keep for edited phrases, dismissals, migration 006, four IPC channels and three settings. The user's title-bar change (D-097) was implemented at the end of the phase. Agent: infinity-code-opus (Opus 5.5, high), 2026-10-09.

## Hosts

- Windows 11 Pro 10.0.26300; Node 24.15.0 (build, unit, integration); E2E runner Node 24.21.0 (`INFINITY_E2E_NODE`, portable); Electron 44.7.0.
- WSL2 Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, npm 11.19.0, WSLg 1.0.73 (Weston, Sha 23e4d92dd13d1a614357e30c4b5a96f9981abc2c); observed ozone x11 under WSLg; Xvfb with WAYLAND_DISPLAY and DISPLAY unset. User `infinity`, sandbox on, own `~/infinity-notes` mirror.

## Files

- Shared: `src/shared/nlp/{constants,types,abbreviations,source-text,title,parse,resolve-candidate}.ts` (new); `contracts/suggestions.ts` (new); `contracts/{reminders,channel-names,channels,bridge,channel-roles,settings}.ts`; `time/{format,resolve,zones}.ts`.
- Main: migration `006_reminder_sources.sql`, `migrations/index.ts`, `checksums.json` (key 6 only); `repositories/{reminder-sources-repo,dismissals-repo}.ts` (new); `services/{reminder-sources,suggestion-service}.ts` (new); `services/{reminder-service,reminder-anchors,content-indexer}.ts`; `main-services.ts`; `index.ts` (startup prune; no OS menu); `test-hooks.ts`; `ipc/handlers/suggestion-handlers.ts` (new), `ipc/register-handlers.ts`; `windows/{main,sticky,widget}-window.ts` (D-097); `menu.ts` removed (D-097); preload `index.ts`.
- Renderer: `editor/{block-text,suggestions,suggestion-detector,suggestion-requests,SuggestionBar}.ts(x)` (new); `editor/{NoteEditor,Toolbar,extensions,content,editor-services,reminder-chips}.ts(x)`; `reminders/{card-request,suggestion-form,suggestion-context,suggestion-memory,SuggestionCard,ReminderFields}.ts(x)` (new); `reminders/{ReminderDialog,note-reminders,reminders-store,ReminderChipBar}.ts(x)`; `panel/RemindersSection.tsx`; `notes/{NoteView,NoteDialogs,note-controller}.ts(x)`; `stickies/{StickyView,StickyHeader}.tsx`; `ui/{DialogHost,Menu}.tsx`; `state/{ui-store,core-services,shortcuts}.ts`; `pages/ReminderSettings.tsx`; `shell/{Header,AppMenuBar (new),HelpDialogs (new)}.tsx`; styles `editor`, `reminders`, `shell`, `stickies`, `widget`, `components`.
- Build: `aliases.config.ts` (new), `electron.vite.config.ts`, `vitest.config.ts` (D-096).
- Tests new: unit `nlp-parse`, `nlp-source-text`, `contracts-phase06`, `renderer/suggestion-card`, `renderer/editor/{suggest-detect,block-text}`; integration `suggestions`, `ipc-handlers-phase06`; E2E `nlp-ui.ts`, `nlp.spec.ts`, `titlebar.spec.ts`. Updated tests are listed in the checkpoints (contract changes only; assertions kept or strengthened).

## IPC as implemented

71 invoke channels (`reminder:createFromSuggestion`, `reminder:updateFromSource`, `suggestion:dismiss`, `suggestion:listDismissed` after `autostart:set`), 12 events (none added). Sticky allowlist adds `zones:list`, `reminder:create`, `reminder:createFromSuggestion`, `suggestion:dismiss`, `suggestion:listDismissed` (own note only, router ownership rule); `reminder:updateFromSource`, `reminder:update`, `reminder:delete` stay main-only; widget allowlist unchanged. The title-bar change adds no channel (D-097). Matches plan section 6.

## Commands

| Command | Host | Exit | Duration | Log |
| --- | --- | --- | --- | --- |
| preflight, `npm run check` | Windows | 0 | 30 s | S0-preflight.log, S0-check.log |
| `npm run check` per step | Windows | 0 | ~30 s | S1-check.log … S6-check.log |
| checksum generation; frozen 001-005 diff | Windows | 0 | <1 s | S2-checksums.log, S2-frozen.log |
| `npm run build` per step | Windows | 0 | ~5 s | S2-build.log … S6-build.log |
| focused E2E (smoke, migration-failure, reminders) | Windows | 0 | 38 s | S2-test-e2e.log |
| full `npm run test:e2e` at S3, S4, S5, S6 | Windows | 0, 0, 1, 1 | 5.9, 6.2, 9.1, 7.4 min | S3-/S4-/S5-/S6-test-e2e.log (failures in Issues) |
| repro and repairs | Windows | 0 | — | S5-repro-sticky-trash.log, S5-repro2-sticky-trash.log, S6-repair-reminders.log |
| `nlp.spec` development runs | Windows | 1, 1, 0 | ~1.2 min | S7-dev-nlp-1/2/3.log |
| pre-title-bar gates: check, build, test:e2e (187 passed, 1 skip), package:current, verify:native --packaged, test:e2e:packaged (5), deps unchanged, electron left 0 | Windows | 0 | 29 s, 5 s, 7.3 min, 28 s, 1 s, 53 s | pre-titlebar-final-*.log |
| WSL leg (S8) | WSL | 0 | ~7 min per E2E run | wsl-*.log |
| title-bar targeted E2E | Windows | 0 | 2.3 min, 42 s | titlebar-targeted-1.log, -2.log |
| final gate: check, build, test:e2e | Windows | see Final gate | | final-check.log, final-build.log, final-test-e2e.log |

## Requirement coverage

Windows results are from the final gate; Linux results are from the WSL leg on the Phase 06 code before the title-bar change (which does not touch parsing, suggestion or reminder code).

| ID | Assertions run (file › case) | Windows | Linux (WSLg, Xvfb) | Status |
| --- | --- | --- | --- | --- |
| INF-NLP-01 | unit/nlp-parse › local and deterministic parsing; unit/boundaries › natural-language parsing is local and English-only; dependency review below | pass | pass | done |
| INF-NLP-02 | unit/nlp-parse › C19/C20, P30/P31, P34-P36 (Nov 2 9am NY = 14:00Z, not 13:00Z), C18 | pass | pass | done |
| INF-NLP-03 | unit/nlp-parse › C1, C2, C6, P1-P4 | pass | pass | done |
| INF-NLP-04 | unit/nlp-parse › C5, P4/P5; e2e/nlp.spec › disclosure | pass | pass | done |
| INF-NLP-05 | unit/nlp-parse › C3, P16, P25 | pass | pass | done |
| INF-NLP-06 | unit/nlp-parse › C4, P18-P23 (P23 14:00Z) | pass | pass | done |
| INF-NLP-07 | unit/nlp-parse › C7-C15, P38, bare weekday never past | pass | pass | done |
| INF-NLP-08 | unit/nlp-parse › C16, P15, P26-P28; suggestion-card › choices gate Add; e2e/nlp.spec › choice required (2027-04-03T11:00Z) | pass | pass | done |
| INF-NLP-09 | unit/nlp-parse › C18, P30-P32; suggestion-card › zone abbreviation; e2e/nlp.spec › choice required (CST) (22:00Z) | pass | pass | done |
| INF-NLP-10 | unit/nlp-parse › C15, C17, P7, P24, P26; e2e/nlp.spec › past date stays past | pass | pass | done |
| INF-NLP-11 | unit/nlp-parse › P33; e2e/nlp.spec › two phrases | pass | pass | done |
| INF-NLP-12 | unit/nlp-parse › P39; e2e/nlp.spec › unsupported text offers manual entry | pass | pass | done |
| INF-NLP-13 | unit/nlp-parse › C19/C20, P37; suggest-detect › suppression (reference date) | pass | pass | done |
| INF-NLP-14 | unit/nlp-parse › P39 (Bangla, French, German); unit/boundaries; copy review below | pass | pass | done |
| INF-SUG-01 | suggest-detect (idle, document and undo unchanged, meta-only, composition, abort, touched spans, setting off, plain, budgets); e2e/nlp.spec › underline, text unchanged; › sticky suggestion; › large note typing stays responsive | pass | pass | done |
| INF-SUG-02 | e2e/nlp.spec › selection (span 18-31, origin selection; two paragraphs refused); block-text | pass | pass | done |
| INF-SUG-03 | suggestion-card; e2e/nlp.spec › card fields (NY 21:00Z, Your time Sat 03:00, weekly); › DST choices (06:30Z; 2027-03-14T07:00Z) | pass | pass | done |
| INF-SUG-04 | integration/suggestions › cancel creates nothing (10 refused creates); e2e/nlp.spec › cancel creates nothing | pass | pass | done |
| INF-SUG-05 | integration/suggestions › source stored | pass | pass | done |
| INF-SUG-06 | integration/suggestions › dedupe after restart, prune, 500 cap; suggest-detect › suppression; e2e/nlp.spec › dedupe after restart | pass | pass | done |
| INF-SUG-07 | integration/suggestions › next-day restart same instant; e2e/nlp.spec › restart next day keeps the instant | pass | pass | done |
| INF-SUG-08 | integration/suggestions › source changed state; e2e/nlp.spec › source edit requires update | pass | pass | done |
| INF-SUG-09 | integration/suggestions › block deleted; › undo of a delete re-reads the source state | pass | pass | done |
| INF-SUG-10 | e2e/nlp.spec › full flow | pass | pass | done |
| F-7 | PRODUCT_SPEC section 6 is the contract (D-095); test titles cite it | pass | pass | — |
| A05-F1 | D-087 clarification (no code) | — | — | — |
| A05-F3 | migrations-checksum › accepted migrations 1 to 5 are frozen; S2-frozen.log | pass | pass | — |
| INF-SHELL-06 (reworded, D-097) | main-window-options; e2e/titlebar.spec; visual screens | pass | not run (direction) | in_progress (native part Phase 09) |

Screens: `.infinity-work/logs/phase-06/screens/win/` (nlp-underline-bar-light/dark, suggestion-card, suggestion-card-choices, suggestion-card-dst, panel-source-changed, sticky-suggestion, settings-reminders-phase06, and the re-taken shell and sticky screens with the new title bars) and `screens/wslg/` (before the title bar). Page screenshots do not contain the OS-drawn caption buttons.

## Parsing evidence

- Rules table with actual outputs: `.infinity-work/logs/phase-06/parsing-evidence.md` (62 rows from the shipped parser; e.g. C1 → 2026-10-09 17:00, 2026-10-09T11:00:00.000Z, disclosure endOfDay; C16 → needsChoice [order, meridiem]; C18 → needsChoice [zone, meridiem]; P36 → 2026-11-02T14:00:00.000Z; P39 → no candidate).
- Dependency review: `src` imports chrono only as `chrono-node/en` in `shared/nlp/parse.ts`; main imports neither chrono nor the parser; no `fetch`, `XMLHttpRequest`, `WebSocket`, `http(s)` or `net` in `shared/nlp` or the suggestion UI; no AI SDK; `package.json` and `package-lock.json` unchanged (pre-titlebar-final-deps-unchanged.log EXIT=0).
- Bundle: `bundle-evidence.log` — English casual vocabulary present, no other chrono locale (the only "demain"/"mañana" strings are Luxon JSDoc). `packaged.spec › packaged build suggests a reminder from text` passed on Windows and Linux (before the title bar).
- Copy (INF-NLP-14): Settings says "Suggestions understand English dates and times only. Your text is read on this computer and is not sent anywhere."; nothing claims other languages.

## Performance

- Unit (jsdom): one keystroke in a 10,000-paragraph note → 1 block parsed, pass 5.3 ms (limit 50 ms); a 12,000-paragraph paste over 64 KiB → 0 parses; an edit in a 6,000-character paragraph → one parse of at most 609 characters.
- E2E large note (2,000 paragraphs, 200 with dates; 40 keys at 30 ms): text exact, exactly one underline, longest `longtask` 0 ms (none recorded) on Windows, WSLg and Xvfb.

## Decisions after planning

D-096 (implementation decisions: Vite alias for `chrono-node/en`; BST row exception in the zone boundary test; touch rule; live offsets; changed-source Update by block; update pre-selection; choice groups stay visible; `Choices.fold`; paragraph origin; noSource message; undo resync; drift test location). D-097 (custom title bars, user direction).

## Issues found and fixed

- I6-01 (Medium, test harness): S5 run, `visual.spec › sticky read-only banner and trash state` passed, then the app ignored two quits (5 Electron processes; stopped). `main.log` (S5-stuck-app-main.log): `uncaughtException … This database connection is busy executing a query` in `StickyManager.prepareQuit` — the F04-A2 inspector-interrupt race through `closeApp`'s direct `app.quit()`. Fix: E2E quits run on a fresh macrotask (`fixtures.ts`, `editor.spec`, `editor-flow.spec`). Regression: all later full suites, no stall, 0 Electron left.
- I6-02 (Medium, product): after the card opened from More closed, focus went to the More button, not the editor at the phrase (menu close and card mount committed together). Fix: NoteEditor opens the card on the next task with the editor focused. Regression: `nlp.spec › DST choices`.
- I6-03 (Low): the card's phrase used `<q>` (CSS-only quotes); now literal “…”. Regression: `nlp.spec › selection`, `› card fields`.
- I6-04 (Low, test): "Suggest reminders from dates in notes" made `getByLabel('From')` ambiguous; locator exact, same assertion.
- I6-05 (Low, product): a pass replaced every phrase of the block it read; now only overlapping phrases (D-096). Regression: `suggest-detect › typing again restarts the idle timer…`.
- I6-06 (Low, title bar): at 1100 px the menu bar clipped "Help"; layout `auto minmax(0, 1fr) auto` with centered search. Regression: titlebar-targeted-2.log screens.

## Not run or pending

- Per the coordinator's direction after the title-bar request: no WSL, Xvfb, forced-Wayland or packaging rerun after D-097 (Linux evidence: `wsl-*.log`, before it). Forced Wayland was not run in Phase 06.
- Native (Phase 09 matrix): OS caption buttons from titleBarOverlay, frameless dragging on real desktops, A05-F2 and A05-F5. A real toast for a suggestion-created reminder is the Phase 05 path (not re-claimed). GNOME and X11: outside the validation scope.

## Final gate (Windows, after the last change)

| Command | Exit | Duration | Log |
| --- | --- | --- | --- |
| `npm run check` (unit 620, integration 349 + 1 skipped, traceability 0 fails) | 0 | 26 s | final-check.log |
| `npm run build` | 0 | 5 s | final-build.log |
| `npm run test:e2e`, first run | 1 | 7.0 min | final-test-e2e-run1.log: 188 passed, 2 failed (I6-07, I6-08) |
| repair run: tree.spec, paste.spec | 0 | 39 s | final-repair-tree-paste.log (19 passed) |
| `npm run test:e2e` | 0 | 6.9 min | final-test-e2e.log: 190 passed, 1 Linux-only skip |
| Electron processes left | 0 | — | final-electron-left.log (0) and 0 after the last run |
| `git diff --exit-code package.json package-lock.json` | 0 | — | dependencies unchanged |

- I6-07 (Low, test, title bar): `tree.spec › Common protected` collected every page `menuitem`, which now includes the menubar items File, View and Help (correct ARIA for a menubar); the locator is scoped to the context menu, same expected list.
- I6-08 (Low, test race): `paste.spec › copied blocks get new IDs` read the DOM block IDs once two paragraphs existed but before the load-time ID pass stamped them (`[null, null]`; it passed in the six earlier full runs on Windows and WSL). It now waits until both IDs are present; the assertions are unchanged.

## Known limitations

English only; recurrence words ("every Monday") are not interpreted (the card's Repeat sets them); ranges use their start; "3/4"-style fractions may be offered as dates; day-part times are fixed defaults; suggestions appear only for text edited in the current window session; dismissals expire with their reference date; reminders still fire only while the app runs.

# Release 0.4.0 progress

Implementer: infinity-code-opus. Plan: `docs/plans/release-0.4.0.md`. Version, CHANGELOG release section, commit, push, tag and release stay with the coordinator. No Electron window opened on the Windows desktop: Windows ran only lint, typecheck, unit, integration, traceability and build; every Electron start ran in WSL (user `infinity`, `~/infinity-notes`, own `node_modules`, lockfile unchanged) under Xvfb through `.infinity-work/wsl-040.sh` (`DISPLAY`, `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE` unset, so the runner wraps itself in `xvfb-run`). Logs: `.infinity-work/logs/release-0.4.0/`.

## Plan

- **Run A**: F1 zoom, F2 Word/spreadsheet/PowerPoint turned off by a setting (default off), F3 math results. Targeted tests while working, E2E for the three features plus the affected existing specs in WSL Xvfb, Windows `check` and `build` on the final tree.
- **Run B**: F4 AI actions on a selection, then the full gate (full WSL E2E, Linux packaging, packaged E2E).

## Run A

### Decisions

- **D-186 (zoom).** Main owns it (`WindowZoom`): one level per kind (main, all stickies, widget) in the main-only setting `window.zoom`, applied with `setZoomFactor` on every page load. All windows share one origin, so they are created with `zoomMode: 'isolated'` (verified: a sticky at 125 % leaves the main window at 100 %). Keys go from the renderer as `window:zoom` (bubble phase, after viewers); Ctrl+wheel that the page did not take arrives as Electron's `zoom-changed`, so pages keep passive wheel scrolling. Viewers with their own zoom (PDF, Word, PowerPoint, web page) take keys (capture phase) and Ctrl+wheel (non-passive listener) inside them; the web page viewer got a zoom control. There is no separate image viewer in the app; images follow the window zoom.
- **D-187 (Office off).** New public key `documents.office`, default false (a new key, so upgrades read off without a migration). Main refuses with FORBIDDEN: blank creation, import (picker filter and by name, re-checked at add), Open in Infinity Notes from notes, save/restore (covers workbooks), workbook read/save, copy of a version, Save a copy. Opening, export, system app, search, versions, trash, backups and exports are unchanged. The renderer hides the New entries (File menu, palette, tree menu), hides Open in Infinity Notes for Office chips, and shows `OfficeOffPanel` (Open with the system app, Save a copy… = export of the saved file, Turn on in Settings with the switch focused) without loading the viewer chunk.
- **D-188 (math research and evaluator).** Own tokenizer + Pratt parser + evaluator in `src/shared/calc/` (no eval/Function; a test reads the sources), dates via Luxon and the existing `readTypedDate` (refactored out of `parseTypedDate`), results formatted to re-parse. Editor extension `CalcResults` with a widget-decoration ghost, Tab/Enter accept, Esc dismiss, Insert mode on "=", `calcResult` mark in the shared schema.
- **D-189 (recalculation).** After a local edit touching a block with "=", if the variable-definition signature changed, marked results that read variables are rewritten in one transaction outside undo history, only by the editing view; results without variables and results that lost their value are left alone.

### Files

- Shared: `src/shared/zoom.ts` (new), `src/shared/calc/{values,tokenize,parse,evaluate,calculator}.ts` (new), `src/shared/editor/calc-result-mark.ts` (new), `contracts/{windows,settings,channel-names,channels,channel-roles,bridge}.ts`, `documents/{kinds,messages}.ts`, `editor/{schema,doc-schema}.ts`, `time/typed-date.ts`.
- Main: `windows/window-zoom.ts` (new), `windows/{secure-window,main-window,sticky-window,widget-window}.ts`, `ipc/handlers/window-handlers.ts`, `ipc/register-handlers.ts`, `index.ts`, `documents/document-service.ts`, `documents/spreadsheet/spreadsheet-service.ts`, `services/file-picker.ts`; `src/preload/index.ts`.
- Renderer: `zoom/{zoom-input,use-zoom-keys,use-viewer-zoom,window-zoom-store}.ts` (new), `editor/calc/{calc-lines,calc-results}.ts` (new), `documents/OfficeOffPanel.tsx` (new), `settings/DocumentSettings.tsx` (new), `App.tsx`, `shell/{Header,AppMenuBar,GlobalShortcuts}.tsx`, `state/{app-services,core-services,commands,palette-actions,shortcuts,ui-store}.ts`, `palette/CommandPalette.tsx`, `settings/{KeyboardSettings,NotesSettings}.tsx`, `pages/SettingsPage.tsx`, `tree/actions.ts`, `documents/DocumentView.tsx`, `documents/{pdf/PdfViewer,docx/DocxViewer,pptx/PptxViewer,pptx/PptxStage,pptx/PptxToolbar,html/HtmlViewer}.tsx`, `editor/{extensions,editor-services,file-attachment,file-link}.ts`, `editor/{NoteEditor,FileChipView,FileLinkView}.tsx`, `stickies/{StickyApp.tsx,sticky-services.ts}`, `widget/WidgetApp.tsx`, `ui/Switch.tsx`, `styles/{shell,documents,editor}.css`.
- Docs: `docs/DECISIONS.md` (D-186..D-189), `docs/ARCHITECTURE.md` (IPC row, windows, documents, math), `docs/USER_GUIDE.md` (Zoom, Math results, Office documents), `website/docs.html` (Zoom, Math results, Office documents setting, shortcut rows; the outdated "Documents cannot be locked" note removed), `CHANGELOG.md` (`[Unreleased]`).

### Tests

- New unit: `calc.test.ts` (25), `zoom.test.ts` (9), `renderer/editor/calc-results.test.ts` (12).
- New integration: `office-documents.test.ts` (7), `window-zoom.test.ts` (3).
- New E2E: `zoom.spec.ts` (3), `office-documents.spec.ts` (3), `math-results.spec.ts` (2).
- Updated: unit `documents-ui.test` (+5: Office panel, live switch, menus, web page zoom), `tree-pane.test` (both Office states), `palette-actions.test` (+1), `contracts*.test` (160 invoke channels, 16 events, new settings keys), `main-window-options.test` (`zoomMode`), `document-versions.test`, `document-lock-ui.test` (Office on), fake bridge and editor test support; integration helpers (test services turn Office on unless `office: false`; `NO_DESKTOP.zoom`), `ipc-validation`, `ipc-handlers-phase04`, `session.test` (`office: false`); E2E harness option `settings`, document specs set `documents.office: true`, `tree.spec` (off menu), `security.spec` (bridge list). No test was skipped or weakened.
- E2E note: DevTools' synthetic wheel events carry no wheel notches, so Chromium never raises `zoom-changed` for them; `zoom.spec` emits Electron's `zoom-changed` to test main's handling (viewer Ctrl+wheel is driven with real synthetic wheels).

### Commands run

| Where | Command | Result | Log |
| --- | --- | --- | --- |
| WSL Xvfb | `zoom.spec` (first run) | 2 passed, 1 failed (synthetic Ctrl+wheel cannot raise `zoom-changed`; test changed to emit it) | `a-e2e-zoom-1.log` |
| WSL Xvfb | `zoom`, `office-documents`, `math-results` specs | 7 passed, 1 failed (test moved the caret with keys before ProseMirror read the selection) | `a-e2e-new-1.log`, `a-e2e-debug-1..3.log`, `a-e2e-math-2.log` |
| WSL Xvfb | `math-results.spec --repeat-each 5` after the caret fix | 10 passed | `a-e2e-math-3.log` |
| WSL Xvfb | 19 affected existing specs | 130 passed | `a-e2e-affected-1.log` |
| Windows (final tree) | `npm run check` | lint 0, typecheck, unit 146 files / 1162 passed, integration 67 files / 601 passed + 2 skipped (pre-existing), traceability fails=0 warns=0, EXIT 0 | `a-win-check-final.log` |
| Windows (final tree) | `npm run build` | EXIT 0 (main renderer chunk 1,565.58 kB) | `a-win-build-final.log` |
| WSL Xvfb (final tree) | sync; 3 new + 19 affected specs | MIRROR_IDENTICAL; 138 passed, EXIT 0 | `a-sync-final.log`, `a-e2e-final.log` |

### Not run

- Full WSL E2E suite, WSL `npm run check`, `package:linux` and packaged E2E: Run B's full gate. Windows Electron E2E: GitHub Actions only.
- Real mouse-wheel zoom over a page (Chromium's notch path) and touchpad pinch: not reproducible from Playwright; covered by the emitted event and unit tests of `WindowZoom`.
- No dependency was added (`npm run notices` unchanged).

## Run B

F4 AI actions on a selection, then the full gate. No Electron window on the Windows desktop: Windows ran lint, typecheck, Vitest, traceability, build and the notices check only; every Electron start ran in WSL under Xvfb through `.infinity-work/wsl-040.sh`.

### Decisions

- **D-190 (AI threads).** Off by default (`ai.enabled`). An action is a comment thread of kind `ai` on the comment anchors (migration 016 with checksum; 001–015 untouched): messages are `comments` rows with a role and a JSON `meta` (engine, model, file names and sizes, cost, session; the first question also its action, words, whole-item flag and file references). Migration 016 rebuilds `comments` (answers up to 100,000 characters, keys kept for `comments_fts`) and recreates its triggers and the lock checks with `meta`; a locked item's meta is sealed like the body. Main refuses while off, before the engine's one-time notice is confirmed, for locked notes and documents (even while unlocked), plain notes, Office documents and files that are not the item's. `ai:ask` returns the running thread at once; `ai:wait` resolves when the answer or error is stored. Stickies use the AI channels for their own note only (checked in the handlers).
- **D-191 (API engines).** `@anthropic-ai/sdk` 0.133.0 and `openai` 7.33.0, pinned, bundled into main as lazy chunks, imported only in `src/main/ai/engines/` (lint rule and a test). Anthropic: `beta.messages.stream` + `finalMessage()`, no `thinking`, `output_config.effort` (default medium), server-side refusal fallbacks (`server-side-fallback-2026-07-01`, `fallbacks: 'default'`, typed by the pinned SDK), refusal and `max_tokens` read. OpenAI: Responses API, `store: false`, default model `gpt-5.5` (the SDK README's). Each request runs on `aiRequestFetch` (only `https://api.anthropic.com` / `https://api.openai.com`, only until the action ends).
- **D-192 (CLI engines).** Claude Code: `-p --output-format json --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config [--model] [--resume]`; the model is the `modelUsage` entry that cost most (a real run lists Claude Code's housekeeping Haiku first). Codex: `exec [resume] [-i img]… --json --skip-git-repo-check [-m] -c sandbox_mode=read-only [-s read-only] [thread] -` (`exec resume` has no `--sandbox`). The prompt goes only on stdin; arguments are checked as plain tokens; `.cmd` shims run through `cmd.exe /d /s /c` with the quoted shim and checked arguments (Node refuses batch files without a shell; shims were not resolved to their scripts because Claude Code's starts a native exe and Codex's a Node script). Per-thread folder `<tmp>/infinity-notes-ai/<threadId>`, fresh for each turn with only the attached copies, always removed; the same path each turn so sessions resume. Stop and the timeout kill the process tree (`taskkill /T /F`, Linux process group); quitting stops every run.
- **D-193 (keys).** `safeStorage`-encrypted in `<userData>/ai-keys.json` (outside `data/`: never in the database, backups, exports or logs); Linux `basic_text` counts as not encrypted, so no key is stored there. Renderers learn only whether a key is stored.
- **D-194 (follow-ups).** A tool resumes its own session when it answered last; otherwise the conversation is sent again (the first question rebuilt from the current anchored text, the whole item and the item's files, then answers and questions without errors, same-role turns joined). Picked files go only with the first question.

### Files

- Shared: `ai/{engines,actions,limits}.ts`, `contracts/ai.ts` (new); `contracts/{comments,settings,channel-names,channels,channel-roles,bridge}.ts`.
- Main: `ai/{ai-service,ai-context,ai-prompt,ai-workdir,ai-keys,ai-meta}.ts`, `ai/engines/{engine,cli-process,cli-locate,claude-code,codex,anthropic-api,openai-api}.ts`, `ipc/handlers/ai-handlers.ts`, `db/migrations/016_ai_threads.sql` (new); `db/migrations/{index.ts,checksums.json}`, `db/repositories/{comments-repo,linked-files-repo,search-repo}.ts`, `comments/{comment-service,comment-cipher}.ts`, `locks/note-crypto.ts`, `portability/{portable-format,portable-export,portable-import}.ts`, `services/{search-service,network-guard,file-picker}.ts`, `ipc/register-handlers.ts`, `main-services.ts`, `app-paths.ts`, `test-hooks.ts`, `index.ts`; `preload/index.ts`.
- Renderer: `ai/{ai-request,answer-blocks}.ts`, `ai/{AskAiDialog,AiThreadView}.tsx`, `settings/AiSettings.tsx`, `stickies/{sticky-ai.ts,StickyAiPanel.tsx}`, `styles/ai.css` (new); `comments/{comments-store,note-comment-host,document-comment-host}.ts`, `editor/comments/comment-marks.ts`, `editor/{editor-services,note-actions,code-fences}.ts`, `editor/{FormatBubble,NoteEditor}.tsx`, `documents/pdf/pdf-comments.ts`, `documents/html/HtmlViewer.tsx`, `panel/CommentsSection.tsx`, `pages/SettingsPage.tsx`, `settings/fields.tsx`, `state/{app-services,core-services,commands,palette-actions,shortcuts,ui-store}.ts`, `stickies/{sticky-services.ts,StickyView.tsx}`, `main.tsx`.
- Build and tooling: `package.json`, `package-lock.json` (two SDKs), `eslint.config.mjs` (SDKs main-only), `THIRD_PARTY_NOTICES.md` (regenerated).
- Docs: `docs/DECISIONS.md` (D-190..D-194), `docs/ARCHITECTURE.md` (IPC row, AI section), `docs/USER_GUIDE.md` (AI actions), `website/docs.html` (AI actions section, shortcut row), `CHANGELOG.md` (`[Unreleased]`).

### Tests

- Fakes: `tests/fixtures/ai/fake-ai-tool.mjs` (one script for `claude` and `codex`: logs each run, answers like the real tool, modes answer/error/garbage/hang/slow) and `tests/support/fake-ai-tools.ts` (`.cmd` shims on Windows, executable scripts elsewhere). Integration services default to an empty PATH and a refusing API transport; the E2E hooks find tools only in `INFINITY_NOTES_TEST_AI_PATH` and refuse API traffic, so no test reaches a real service.
- New unit: `ai-engines.test` (11: arguments, output parsing incl. failures, shim invocation and refused arguments, stdin, abort, locate, transport guard, block order), `ai-prompt.test` (10: names, delivery, prompt, conversation, sessions, meta, keys, `basic_text`), `renderer/editor/ai-actions.test` (9: answer blocks, Insert/Replace, shortcut and menu, store flow, Ask AI panel and notice, follow-up, filter, off/no key, sticky), `renderer/ai-settings.test` (2).
- New integration: `ai-actions.test` (17: migration 015→016, Claude Code run and folder, resume and engine switch, attachments, picked files and limits, failures, Stop and timeout killing the tree, Test and chosen program, Codex with images and resume, Anthropic and OpenAI on a fake transport incl. refusal, cut answer, 401 and 429, off and notice, locked note sealing and refusal, documents incl. locked, delete while running and trash, export and import), `ipc-handlers-ai.test` (3: sticky ownership, validation, comment channels refusing AI threads).
- New E2E: `ai-actions.spec` (5: Ctrl+Shift+I with the notice, anchored thread, resumed follow-up, Insert below; Codex from the note menu; locked note refused; a sticky; Settings switch and Test).
- Updated: `contracts*.test` (174 invoke channels, 62 sticky channels, new settings keys), `app-identity.test` (the SDKs allowed only as pinned main-only bundles), `palette-actions.test`, `migrations-checksum.test` (LATEST 16), `app-paths.test`, `renderer/document-comments.test`, the fake bridge, integration helpers and `ipc-validation.test`, E2E `security.spec` (bridge `ai`), `comments.spec` (`selectText` moved to `editor-ui.ts` and shared). No test was skipped or weakened.
- Real smoke (optional, no Electron): the provider code ran the installed Claude Code 2.1.293 and codex-cli 0.162.1 on Windows through their `.cmd` shims; each read a copied file in the per-thread folder and answered, and the follow-up resumed the session after the folder was removed and made again (`b-real-cli-smoke-win.log`; about $0.08 of Claude usage).

### Commands run

| Where | Command | Result | Log |
| --- | --- | --- | --- |
| Windows | targeted `vitest` while working | AI unit and integration files green | (console) |
| WSL Xvfb | `ai-actions.spec` first run | 3 passed, 1 failed (a right-click landed on the formatting bubble; the test now opens the note menu with Shift+F10) | `b-e2e-ai-1.log` |
| WSL Xvfb | `ai-actions.spec` | 4 passed, then 5 passed with the sticky test | `b-e2e-ai-2.log`, `b-e2e-ai-3.log` |
| Windows | real CLI smoke (Node, no window) | Claude Code and Codex answered and resumed | `b-real-cli-smoke-win.log` |
| Windows (final tree) | `npm run check` | lint 0, typecheck, unit 150 files / 1197, integration 69 files / 621 + 2 skipped (pre-existing), traceability fails=0 warns=0, EXIT 0 | `b-win-check-final.log` |
| Windows (final tree) | `npm run build` | EXIT 0 (the SDKs in two lazy main chunks) | `b-win-build-final.log` |
| Windows (final tree) | `npm run notices -- --check` | up to date, EXIT 0 | `b-win-notices-check.log` |
| WSL (final tree) | sync; `npm ci`; `npm run setup:electron` | MIRROR_IDENTICAL; EXIT 0; EXIT 0 | `b-wsl-sync-final.log`, `b-wsl-npm-ci-final.log`, `b-wsl-setup-electron-final.log` |
| WSL (final tree) | `npm run check` | unit 150 / 1197, integration 69 / 623, traceability 0/0, EXIT 0 | `b-wsl-check-final.log` |
| WSL Xvfb (final tree) | `npm run test:e2e` (full) | 320 passed, 2 skipped (Windows-only tray tests), no retries, EXIT 0, 13.3 min | `b-wsl-e2e-full-1.log` |
| WSL (final tree) | `npm run package:linux` | AppImage and .deb built, EXIT 0 | `b-wsl-package-linux.log` |
| WSL Xvfb (final tree) | `npm run test:e2e:packaged` | 8 passed, EXIT 0 | `b-wsl-e2e-packaged.log` |

### Not run

- The API engines against the real Anthropic and OpenAI APIs (no keys used; the SDKs ran on a fake transport). The real CLI smoke in WSL (Windows only). Windows Electron E2E: GitHub Actions only. Storing an API key in WSL: no keyring there (`basic_text`), so key storage is refused as designed.

## Repairs (acceptance 1)

The acceptance (`release-0.4.0-acceptance.md`) rejected F4 with three major and six minor findings. Each one is repaired in structure and recorded as D-195.

No test was skipped or weakened:
- The changed expectations are the new Claude Code arguments, `/v:off` in the shim command line, UUID session values in the fixtures and the work-file numbering.
- The two new `skipIf(win32)` cases check POSIX file modes and symlinks, which Windows does not have. They ran in WSL.

### Findings, changes and tests

**M1. Claude Code's reads were not confined to the working folder.**
- Change:
  - `claudeArgs` now passes `--restricted` and no longer passes the blanket `--allowedTools Read,Glob,Grep`.
  - `--tools Read,Glob,Grep`, `--permission-mode dontAsk` and `--strict-mcp-config` are kept.
  - Codex has no option that confines reads, and a real run read a file outside its folder under `-s read-only`.
  - So the first-use notice now says what each tool may read. It uses new `access` and `transcripts` fields in `AI_ENGINE_INFO` through `aiNotice`.
  - The user guide, the website and the changelog say the same: Claude Code reads only the copies in its folder; Codex may not change files but can read other files the account can read.
- Tests:
  - Unit `ai-engines.test` checks the exact arguments, with no `allowedTools`.
  - Integration and E2E `ai-actions` check the arguments.
- Real smoke (`r1-real-cli-confinement-win.log`), Claude Code 2.1.293 with the app's arguments:
  - It read `1-note.txt` inside the folder (`NOTE=pineapple`).
  - Read and Grep on the canary in another temp folder were both denied (`permission_denials`, `CANARY=DENIED`).
  - A control run with the arguments from before the repair leaked the canary (`CANARY=CANARY-ec54cf81`).
- Codex probe (`r1-real-codex-read-probe-win.log`): codex-cli 0.162.1 under `-s read-only` printed the outside canary.

**M2. The working folders sat in the shared `/tmp`.**
- Change:
  - The work root is now `<userData>/ai-work` (`DataPaths.aiWorkDir`). It is outside `data/`, so it is never in backups or exports.
  - `ensurePrivateRoot` runs before each turn:
    - It creates the root with mode 0700.
    - It refuses a link or anything that is not a folder.
    - On POSIX it refuses a root owned by another uid and narrows a wider mode to 0700.
  - Thread folders are made 0700 (non-recursive) and copies 0600.
- Tests:
  - Unit `ai-workdir.test`:
    - modes 0700/0600, and a 0777 root narrowed (POSIX);
    - a root owned by another account refused, with nothing run;
    - a root that is not a folder refused;
    - a symlinked root refused (POSIX).
  - Integration: the run's folder is under `paths.aiWorkDir`.
  - E2E: the folder's parent is `ai-work`.

**M3. Working folders were left behind after a quit or crash.**
- Change:
  - `AiService.removeLeftoverWorkDirs()` runs synchronously when the services are created (`createMainServices`) and removes the whole root.
  - `stopAll()` (on will-quit) aborts the runs and then removes the root synchronously, as a best effort.
  - A file that a killed tool still holds on Windows is left for the next start.
- Tests (integration):
  - A leftover folder with a copy is gone once the services start, and the log says so.
  - Quitting during a hanging run removes the folder at once on POSIX, and the run ends as stopped.

**m1. Session values and `.cmd` paths.**
- Change:
  - `isSessionId` checks the UUID shape, which both tools use.
  - `StoredAiMeta.sessionId` reads any other value as null.
  - The parsers keep only UUID sessions and threads.
  - `sessionArg` refuses a non-UUID before it reaches argv.
  - `optionValue` refuses a model or image value that starts with `-`.
  - `SAFE_CMD_PATH` refuses `"`, `%`, `!`, `^` and control characters.
  - The shim runs as `cmd.exe /d /v:off /s /c`.
- Tests:
  - Unit `ai-engines.test`:
    - `--dangerously-…`, `-s` and non-UUID values are refused for both tools;
    - flags given as a model or image are refused;
    - non-UUID sessions in tool output are dropped;
    - bad shim paths are refused, while `Program Files (x86)\A & B` still works.
  - Unit `ai-prompt.test`: crafted stored sessions read as none, and `lastSession` returns null.

**m2. Follow-up race.**
- Change:
  - `followUp` reserves the thread in `starting` before its first await and releases it in `finally`.
  - `start()` registers the run before that release.
- Test (integration): two follow-ups are sent at once. The second is refused with CONFLICT and only one run starts; a later follow-up runs.

**m3. Files were renumbered after a resume.**
- Change:
  - `AiContext.gather` returns `PlacedFile`s:
    - the item's files keep their place in the thread's file list, from 1;
    - picked files come after them;
    - the whole document is 0.
  - `deliverFiles` names the copies by place.
- Tests:
  - Unit `ai-prompt.test`: names stay the same across turns.
  - Integration: when one attachment is removed before a resumed follow-up, the other is still `2-plan.txt`.

**m4. Redirects went past the API guard.**
- Change: `aiRequestFetch` passes `redirect: 'error'`.
- Test: unit `ai-engines.test` checks that the transport receives `redirect: 'error'`, even when the caller asked to follow redirects.

**m5. The CLIs' own transcripts.**
- Change: the notice and the docs say that Claude Code keeps `~/.claude` and Codex keeps `~/.codex`, and that the app cannot remove them when a note is locked later.
- Tests: unit and E2E compare the notice with `aiNotice(...)`.

**m6. `graphify-out/`.**
- No change in the repository. The coordinator excludes it locally.

### Files

- Main: `ai/{ai-workdir,ai-service,ai-context,ai-prompt,ai-meta}.ts`, `ai/engines/{engine,claude-code,codex,cli-process}.ts`, `services/network-guard.ts`, `app-paths.ts`, `main-services.ts`, `index.ts`.
- Shared: `ai/engines.ts` (the notice).
- Tests:
  - unit `ai-workdir.test.ts` (new), `ai-engines.test.ts`, `ai-prompt.test.ts`, `app-paths.test.ts`;
  - integration `ai-actions.test.ts`, `hierarchy-helpers.ts`;
  - E2E `ai-actions.spec.ts`.
- Docs: `docs/DECISIONS.md` (D-195; D-192 text updated), `docs/ARCHITECTURE.md`, `docs/USER_GUIDE.md`, `website/docs.html`, `CHANGELOG.md`.
- Smoke (git-ignored): `.infinity-work/smoke/ai-confinement-smoke.ts`.

### Commands run

| Where | Command | Result | Log |
| --- | --- | --- | --- |
| Windows (Node, no Electron) | Real confinement smoke (`ai-confinement-smoke.mjs`: the app's code with the installed `claude.cmd` and `codex.cmd`) | `CLAUDE_CONFINED=true (control leaked=true)`, `SMOKE_RESULT=PASS`, work root left empty; about $0.07 of Claude usage | `r1-real-cli-confinement-win.log` |
| Windows (no Electron) | Codex read probe (`codex exec --json --skip-git-repo-check -c sandbox_mode=read-only -s read-only -`, asked to `Get-Content` a file outside its folder) | The canary was read: Codex does not confine reads | `r1-real-codex-read-probe-win.log` |
| Windows | Targeted `vitest` on the new tests with each fix reverted | 3 failed (follow-up race, names after resume, startup sweep); the tests catch the defects. The fixes were restored | (console) |
| Windows | `npm run check` | First run: lint error (`no-control-regex` in `SAFE_CMD_PATH`, changed to `\p{Cc}`). Second run: lint 0, typecheck, unit 151 files / 1204 + 2 skipped (POSIX-only), integration 69 / 625 + 2 skipped (pre-existing), traceability fails=0 warns=0, EXIT 0 | `r1-win-check.log` |
| Windows | `npm run build` | EXIT 0 | `r1-win-build.log` |
| WSL | sync | MIRROR_IDENTICAL | `r1-wsl-sync.log` |
| WSL | `npm run check` | unit 151 / 1206, integration 69 / 627, traceability 0/0, EXIT 0 | `r1-wsl-check.log` |
| WSL Xvfb | `ai-actions.spec` | 5 passed | `r1-wsl-e2e-ai.log` |
| WSL | Sync after the E2E assertion was added, then `ai-actions.spec` | MIRROR_IDENTICAL; 5 passed | `r1-wsl-sync-2.log`, `r1-wsl-e2e-ai-2.log` |
| WSL Xvfb | `npm run test:e2e` (full) | 320 passed, 2 skipped (Windows-only tray tests), no retries, EXIT 0, 13.4 min | `r1-wsl-e2e-full.log` |

### Not run

- Linux packaging and the packaged E2E. No packaging configuration changed. The startup changes are the work-root path and the synchronous sweep in `createMainServices`, and every dev E2E start exercises both.
- The real CLI smoke in WSL: the tools are installed on Windows only.
- The API engines against live services.
- Windows Electron E2E: GitHub Actions only.

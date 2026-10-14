# Release 0.4.0 plan: zoom, Office documents off, AI actions on a selection, math results

Requested by the user on 2026-10-14 (CLAUDE.md, "v0.4.0 feature batch"), to be developed and released autonomously. Coordinator: Opus. All application code is written by `infinity-code-opus`, one run at a time; acceptance by `infinity-acceptor`. Progress: `docs/progress/release-0.4.0.md`. Decisions continue from D-186 in `docs/DECISIONS.md`.

Work happens in the git worktree `C:\Users\emash\orca\workspaces\notecapt\zoom-in-feature-docs-spreadsheet-pptx-disable-headless-ai-attach-like-claude-openai` (branch `emashiq/zoom-in-feature-docs-spreadsheet-pptx-disable-headless-ai-attach-like-claude-openai`), not in `E:\notecapt`. Logs go to `.infinity-work/logs/release-0.4.0/` in the worktree.

## Ground rules (unchanged from 0.3.x)

- Free and open-source dependencies only, free for any use including commercial (MIT/ISC/BSD/Apache-2.0/MPL-2.0); pinned exactly; `npm run notices` updated. Prefer what is already bundled (luxon, chrono-node, zod).
- Main owns writes, files, processes and network; IPC narrow and Zod-validated (`src/shared/contracts`); renderers never get API keys or spawn processes.
- **Never open an Electron window on the Windows desktop.** On Windows run only `npm run lint`, `npm run typecheck`, targeted `vitest`, `npm run check`, `npm run build`. Everything that starts Electron runs in WSL under Xvfb via `.infinity-work/wsl-040.sh` (from PowerShell: `wsl -d Ubuntu -u infinity -- bash /mnt/c/Users/emash/orca/workspaces/notecapt/zoom-in-feature-docs-spreadsheet-pptx-disable-headless-ai-attach-like-claude-openai/.infinity-work/wsl-040.sh <log> sync` then `... <log> run npm run test:e2e -- <spec>`; after dependency changes `... <log> run npm ci`). Windows E2E runs on GitHub Actions.
- Clean, well-structured code that reads like the surrounding code; tests alongside (unit, integration, E2E); no skipped or weakened tests; record every command that ran.

## F1 Zoom in / zoom out

- Window zoom like a browser: **Ctrl+= / Ctrl++ / Ctrl+Numpad+** zoom in, **Ctrl+- / Ctrl+Numpad-** zoom out, **Ctrl+0** actual size, **Ctrl+mouse wheel**. Steps 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 %.
- Main applies it (`webContents.setZoomFactor`) and persists it per window kind: main window, stickies (one shared value), widget. Restored on window creation and on reload.
- The custom title bar's **View** menu gets Zoom in, Zoom out, Actual size with their shortcuts; a small "125%" indicator appears in the title bar when the zoom is not 100% (click = actual size). Keyboard settings and the shortcuts help list them; the command palette has the three commands.
- Inside a viewer that has its own zoom (PDF, Word, PowerPoint, HTML, images) Ctrl+wheel and the zoom keys zoom that viewer's content while the pointer/focus is in it (as browsers do in their PDF viewer). Add a zoom control to the viewers that lack one (HTML viewer at least).
- No conflict with existing editor shortcuts (check the keymap; Ctrl+- / Ctrl+= must not be bound elsewhere).

## F2 Word, spreadsheet and PowerPoint turned off

- A setting **Office documents (Word, spreadsheets, PowerPoint)**, default **Off** (also off for existing users after the upgrade). The code stays in the repository and works again when the setting is on.
- When off:
  - No "New Word document / New spreadsheet / New presentation" anywhere (tree menus, new-item menus, palette, Home, slash menu, empty states).
  - Adding or importing a .docx, .pptx, .xlsx or .csv file keeps it as a normal file attachment or linked file (opened with the system app), the way other file types are handled; "Open in Infinity Notes" is not offered for those kinds.
  - Existing documents of those kinds stay in the tree, search, backups and exports (no data is deleted). Opening one shows a calm panel: "Word, spreadsheet and PowerPoint editing is turned off" with **Open with the system app**, **Save a copy…** and **Turn on in Settings**. The heavy viewer chunks are not loaded.
  - PDF and HTML documents are unaffected.
- Main enforces it too: creating a blank docx/xlsx/pptx and saving Office bytes are refused with a clear error while the setting is off.

## F3 Math results (like Apple Notes Math Notes)

Research summary (D-188): Apple Notes evaluates a line that ends with "=", shows the answer as a suggestion that Return inserts (Format > Math Results: Insert results / Suggest results / Off), supports variables defined above ("Lunch = 25"), recalculates dependent results when a variable changes, and follows standard precedence. Soulver/Numi-style tools add percentages, units and dates. No JS library covers notepad math with dates under a permissive license (mathjs: Apache-2.0, large, no dates and a much wider surface than needed; fcal: small and unmaintained). Decision: a small, purpose-built evaluator in `src/shared/calc/` (tokenizer + Pratt parser + evaluator, no `eval`/`Function`), dates through luxon and the existing typed-date parser.

- Expressions: numbers (`1200`, `1,200.50`, `1.2e3`), `+ - * × / ÷ ^ mod`, parentheses, unary minus, functions `sqrt abs round floor ceil min max log ln sin cos tan` (degrees noted in docs), constants `pi`, `e`.
- Percentages (Soulver semantics): `20% of 50` = 10, `50 + 10%` = 55, `50 - 10%` = 45, `10% * 30` = 3.
- Variables: a line `name = expression` (Latin letters, digits, underscore, spaces inside a name are not allowed) defines a variable usable on lines below it in the same note/sticky; later definitions override earlier ones.
- Dates and durations: `today`, `tomorrow`, `yesterday`, `now`, ISO dates, typed dates (`14-10-2026`, `14/10/2026`, `14.10.2026`, `10/14/2026` using the OS date order like D-184), month-name dates (`Oct 14 2026`, `14 October 2026`, `Dec 25`), durations (`3 days`, `2 weeks`, `5 months`, `1 year`, `4 hours`, `30 min`). `date - date` = days (shown as `286 days`; `weeks`/`months` on request with `in weeks`), `date ± duration` = date, `duration ± duration`, `duration * number`. Example: `25-12-2026 - today =` → `72 days`; `today + 3 weeks =` → `Nov 4, 2026`.
- Trigger: the text of a paragraph, list item, heading or table cell before the caret ends with `=` (optionally followed by spaces) and the part before `=` is an expression that contains an operator, function, percentage, date or duration (a bare number or plain words never trigger; `name = …` defines a variable instead). Never inside code blocks, inline code, diagrams or math blocks.
- UX: the answer appears as muted ghost text right after the caret; **Tab** or **Enter** inserts it, **Esc** dismisses, typing continues normally. Results are inserted with a `calcResult` mark; when a variable above changes, marked results below that depend on it update (one transaction, not added to undo history, deterministic so collaborating editor windows agree). The setting **Math results: Suggest (default) / Insert automatically / Off** lives in Notes settings; stickies share the editor and the setting.
- Output formatting re-parses: numbers up to 10 significant digits with trailing zeros trimmed and no grouping; dates in a month-name form the parser reads back; durations as `N days` (or the requested unit).
- Unit tests cover the evaluator thoroughly (precedence, percentages, variables, dates across DST and month ends, leap years, errors, rejection of non-expressions, very long input bounds); editor tests cover trigger rules and accept/dismiss; an E2E spec types in a note and a sticky.

## F4 AI actions on a selection (Claude and OpenAI, headless)

The user's request: "Headless AI action Claude + OpenAI, attach for action analysis and have those data with particular thread on specific part." This overrides the old "no embedded AI" rule for this opt-in feature (user decision 2026-10-14).

- **Off by default.** Settings → **AI** enables it and picks the engine. Engines:
  1. **Claude Code (headless)** — runs the installed `claude` CLI: `claude -p --output-format json` with the prompt on stdin, in a fresh empty temporary working directory that contains only copies of the attached files, with tools restricted to reading that directory (verify the exact flags against `claude --help`; use `--permission-mode dontAsk` and an allow-list of read-only tools; no Bash/Edit/Write/Web tools). Parse `result`, `session_id`, `total_cost_usd`, `is_error`. Follow-ups use `--resume <session_id>`.
  2. **OpenAI Codex (headless)** — runs the installed `codex` CLI: `codex exec --json --sandbox read-only --skip-git-repo-check -C <tempdir> -` with the prompt on stdin (verify against `codex exec --help`). Parse the JSONL events (`thread.started` → `thread_id`, `item.completed` with an `agent_message` item → text, `turn.failed`/`error`). Follow-ups use `codex exec resume <thread_id>`.
  3. **Anthropic API** — the official `@anthropic-ai/sdk` in main, model default `claude-opus-5-5` (choices `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`), adaptive thinking (omit `thinking`), `output_config.effort` from a setting (default `medium`), streaming with `finalMessage()`, check `stop_reason` (`refusal` → a clear message), typed SDK errors. Server-side fallbacks for refusals per the SDK docs (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`) if the pinned SDK supports it. Images and PDFs attached as content blocks; other files as extracted text.
  4. **OpenAI API** — the official `openai` SDK in main (Responses API), model as a text setting with a current default taken from the SDK's README.
- CLI paths: found on PATH (on Windows `claude.cmd` / `codex.cmd` — spawn safely without passing user text through a shell: prompt only on stdin, arguments fixed), with an optional path override in settings and a **Test** button that reports the version or the error. Timeout (default 5 minutes, setting) and **Stop** (kills the process tree). Temp directories are always removed.
- API keys: entered in Settings, stored encrypted with Electron `safeStorage` under userData (never in the database, backups, exports or logs); the renderer only learns whether a key is set. The network guard allows only `api.anthropic.com` / `api.openai.com` from main, only for an AI request.
- **Action on a specific part.** Select text in a note or sticky (or a block), or a part of a PDF/HTML document (page or selected text), then **Ask AI…** (selection bubble, context menu, palette, Ctrl+Shift+I or a free shortcut). A compact panel offers presets — **Analyze**, **Summarize**, **Explain**, **Action items**, **Find problems** — and a free prompt. **Attach**: the selection is always included; optionally the whole note/document, the note's file attachments, linked files and documents, and files picked from disk (size limits; images/PDFs passed as files to CLIs and as content blocks to APIs; text extracted otherwise).
- **Threads on that part.** Each action creates an **AI thread anchored to the selected part**, built on the v0.3.0 comment threads and anchors (note block IDs + quote; document anchors) with a thread kind `ai` (migration 016, checksum added, earlier migrations untouched), storing per message: role (you / assistant / error), text, engine, model, session/thread id for resume, attachment names and sizes (not their bytes), cost when reported, timestamps. The anchored text gets a distinct AI highlight; the comments side panel shows AI threads with an AI badge and a filter (All / Comments / AI). In a thread: follow-up questions continue the same session, **Insert below**, **Replace selection**, **Copy**, **Delete thread**. Threads move, trash, restore, back up and export with their item like comments.
- **Locked items.** No AI action on a locked note, sticky or document; locking an item seals its AI threads exactly like its comments; plaintext copies are scrubbed per the lock rules.
- First use shows a one-time notice naming what is sent where ("The selection and the attached files are sent to Claude Code on this computer / to Anthropic's API …").
- Tests never call real services: fake `claude`/`codex` executables (Node scripts) on PATH for unit/integration/E2E, a mocked SDK transport or local HTTP server for the API engines. One optional real smoke run with the installed CLIs may run headless from a Node script (no Electron window); record it if run.

## Runs

- **Run A** (`infinity-code-opus`): F1 zoom, F2 Office off, F3 math results; targeted tests; E2E specs for them run in WSL.
- **Run B** (`infinity-code-opus`): F4 AI actions; then the full gate: Windows `npm run check` + `npm run build` + notices check; WSL sync, `npm ci` if dependencies changed, `npm run check`, full `npm run test:e2e`, `npm run package:linux`, `npm run test:e2e:packaged`.
- **Acceptance** (`infinity-acceptor`): reviews code and logs, spot-runs what it doubts (Windows non-window gates, WSL Xvfb E2E), writes `docs/progress/release-0.4.0-acceptance.md`.
- **Repairs** (`infinity-code-opus`) until accepted.
- **Release** (coordinator): version 0.4.0, `CHANGELOG.md`, user guide, website docs (Zoom, Math results, AI actions, Office setting), commit, push `HEAD:main` (fast-forward only, never force), tag `v0.4.0`, watch CI, release and pages workflows.

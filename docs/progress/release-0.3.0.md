# Release 0.3.0 progress

Plan: [docs/plans/release-0.3.0.md](../plans/release-0.3.0.md). Each run appends its plan notes, results and the commands it ran.

## Run 0 status so far (checkpoint for a restart)

Done: migration 011 and repositories; DocumentStore, DocumentFiles, DocumentService (create blank, import copy/link, Open in Infinity Notes, open, save with revision and on-disk checks, versions, Save a copy, system app); trash, hierarchy, search, Home, session, backup/restore and portable export/import coverage; document and HTML protocols, frame-navigation and clipboard-permission policy, CSP; 15 `document:*` channels, preload and bridge; renderer tree, tabs, DocumentView with lazy viewer registry, HTML viewer, import dialog, palette, Home, menus, file-chip "Open in Infinity Notes"; fixtures generator and `tests/fixtures/documents`; unit, integration and E2E (not run) tests; spikes for F3/F4/F5 run in scratch.

Remaining at this checkpoint: pdf.js API name check, DECISIONS (D-118 onward), ARCHITECTURE update (also unblocks `csp.test` "directive list"), final Run 0 report section, final gate (lint, typecheck, unit, integration, traceability, build).

## Run 0

Implementer: infinity-code-opus. Scope: F1 documents foundation, F6 HTML viewer, library spikes for F3/F4/F5, document fixtures. The checkpoint above is superseded: everything it listed as remaining is done.

### Plan notes

- Documents are their own tree items (not notes): migration 011, a content-addressed blob store under `data/documents/`, linked documents reuse `linked_files` (D-118).
- Main owns every write: `DocumentService` (create, import, Open in Infinity Notes, open, save, versions, Save a copy, OS hand-off), `DocumentStore` (blobs, GC), `DocumentFiles` (the one file lookup for the service and the protocols) (D-118, D-119).
- Bytes reach viewers only through `infinity-document://<id>/` (ranges for pdf.js); HTML through `infinity-html://<id>/` in a scriptless sandboxed frame (D-120).
- Later runs add a viewer chunk to `DOCUMENT_VIEWERS` and a text extractor to `DOCUMENT_TEXT_EXTRACTORS`; the tab, save, conflict and flush plumbing exists (D-121).

### Changed and added files

- Main: `db/migrations/011_documents.sql`, `index.ts`, `checksums.json`; repositories `documents-repo.ts`, `document-blobs-repo.ts`, `document-versions-repo.ts`, `trash-repo.ts`, `hierarchy-repo.ts`, `linked-files-repo.ts`, `search-repo.ts`, `portable-repo.ts`; `documents/` (`document-service.ts`, `document-store.ts`, `document-files.ts`, `document-check.ts`, `ooxml-package.ts`, `blank-documents.ts`, `file-writes.ts`, `text-encoding.ts`, `text/document-text.ts`, `text/office-xml-text.ts`, `text/html-text.ts`, `text/entities.ts`); services `stored-files.ts` (shared containment, durable writes, temp sweeps; used by attachments too), `keyed-queue.ts`, `save-paths.ts`, `hierarchy-service.ts`, `trash-service.ts`, `search-service.ts`, `home-service.ts`, `session-service.ts`, `maintenance.ts`, `file-picker.ts`, `dialog-adapter.ts`, `attachment-service.ts`, `attachment-files.ts`, `dto.ts`, `retention-policy.ts`; portability `backup-manifest.ts`, `backup-writer.ts`, `restore.ts`, `portable-format.ts`, `portable-export.ts`, `portable-import.ts`, `portability-service.ts`; windows `document-protocol.ts`, `web-policy.ts`, `web-security.ts`, `schemes.ts`; `ipc/handlers/document-handlers.ts`, `register-handlers.ts`; `main-services.ts`, `index.ts`, `app-paths.ts`.
- Shared: `documents/kinds.ts`, `documents/limits.ts`, `documents/messages.ts`; contracts `documents.ts`, `hierarchy.ts`, `channels.ts`, `channel-names.ts`, `bridge.ts`, `search.ts`, `home.ts`, `session.ts`, `portability.ts`; `tree/tree-model.ts`, `tabs/tab-session.ts`, `csp.ts`, `app-identity.ts`. Preload `index.ts`.
- Renderer: `documents/` (`document-controller.ts`, `viewer-registry.ts`, `DocumentView.tsx`, `html/HtmlViewer.tsx`, `html/html-source.ts`); `state/document-commands.ts`, `tabs-store.ts`, `tree-store.ts`, `ui-store.ts`, `commands.ts`, `current-location.ts`, `palette-actions.ts`, `app-services.ts`, `notice-store.ts`; `tabs/TabPanel.tsx`, `TabStrip.tsx`; `tree/TreeRow.tsx`, `TreePane.tsx`, `TreeContextMenu.tsx`, `actions.ts`; `ui/DocumentKindIcon.tsx`, `ui/copy-text.ts`, `ui/DialogHost.tsx`; `home/RecentSection.tsx`, `QuickActions.tsx`; `palette/CommandPalette.tsx`; `shell/AppMenuBar.tsx`; `editor/FileChipView.tsx`, `FileLinkView.tsx`, `file-attachment.ts`, `file-link.ts`, `NoteEditor.tsx`, `editor-services.ts`; `styles/documents.css`, `main.tsx`.
- Tools and fixtures: `tools/make-document-fixtures.mjs`, `tests/fixtures/documents/sample.{pdf,docx,pptx,xlsx,csv,html}`, `.gitattributes`.
- Tests added: unit `document-text.test`, `document-check.test`, renderer `state/documents-state.test`, `documents-ui.test`; integration `documents.test`, `document-protocol.test`, `document-portability.test`, `ipc-handlers-documents.test`, `document-helpers.ts`, migration 011 case in `migrations.test`; E2E `documents.spec.ts` (written, not run). Updated for the contract changes (document counts, `trashedDocumentIds`, format 2, schema 11, CSP, catalogue of 124 channels, palette and tree menus): `trash`, `hierarchy`, `import`, `import-security`, `backup`, `restore`, `sticky-service`, `versions`, `ipc-handlers-phase02`, `ipc-validation`, `contracts`, `contracts-phase04`, `csp`, `migrations-checksum`, `palette-actions`, `tab-session`, `tree-model`, renderer `quick-notes`, `current-location`, `tree-commands`, `tree-pane`, `support/fake-bridge.ts`.
- Docs: `ARCHITECTURE.md` (data model, migrations, hierarchy, tabs, IPC catalogue row D-118, documents and protocols, search, archives, CSP and permissions), `DECISIONS.md` D-118..D-127. `THIRD_PARTY_NOTICES.md` regenerated with no change (no new runtime dependency).

### Library spikes (scratch: `%TEMP%/claude/E--notecapt/<session>/scratchpad/spikes`, not in the repo)

| Feature | Choice | License | Evidence |
| --- | --- | --- | --- |
| F3 grid | `@fortune-sheet/react` 1.0.4 | MIT (deps MIT, Apache-2.0) | React 19 peer ok, no remote resources; one `new Function` in row insert, to be replaced by a build-time transform (D-123) |
| F3 files | `exceljs` 4.4.0 in main, npm overrides `unzipper@0.12.5`, `uuid@11.1.1` | MIT; tree clean after overrides (`buffers@0.1.1` without license removed), `npm audit` 0 | Node round trip keeps formulas, fonts, colors; CSV read; streaming reader works with the override; rewrites the package (D-123) |
| F4 | `@portone/docx-editor` 0.6.7 | Apache-2.0 (deps MIT/ISC) | Node core round trip byte-identical when untouched; an edit changes only `word/document.xml`, header kept (D-124) |
| F5 | `pptx-glimpse` 5.3.1 (fallback `pptx-svg` 0.6.6) | MIT (resvg-wasm MPL-2.0, PNG only) | SVG render without diagnostics; text edit changes only the edited slide; untouched save identical (D-125) |
| F2 | `pdfjs-dist` 6.4.299, `pdf-lib` 1.17.1 | Apache-2.0, MIT | API names in D-126 |

Rejected (license rule or fitness): SheetJS (Pro styles, stale npm build), Univer (paid xlsx I/O), Handsontable, AG Grid Enterprise, jspreadsheet CE (Pro tier), x-spreadsheet (unmaintained), `@eigenpal/docx-js-editor` (deprecated, Google Fonts), `pptx-browser` (Google Fonts fetch).

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 112 files, 848 tests passed |
| `npx vitest run --project integration` | 54 files, 499 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; `HtmlViewer` is its own chunk |
| `npm run notices` | no change |
| `node tools/make-document-fixtures.mjs` | wrote the six fixtures |

Logs: `.infinity-work/logs/release-0.3.0/run0-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window; `documents.spec.ts` runs in WSL under Xvfb and on CI at the end of the release.

### Left for later runs

- Run 1: PDF viewer and editor, PDF text extractor, the CSP choice for pdf.js wasm decoders (D-126).
- Run 2: Fortune-sheet with the `new Function` transform, ExcelJS with the overrides, "Simplified on save" list (D-123).
- Run 3: DOCX editor (D-124); Run 4: PPTX (D-125), including where the editing session runs.
- A version list UI for documents comes with the editing viewers (service and IPC exist, D-119).
- Native behavior not verified on Windows by rule: the sandboxed frame, `will-frame-navigate` blocking, CORS on the custom scheme, the clipboard permission; covered by `documents.spec.ts` at the end of the release.

## Run 1 status so far (checkpoint for a restart)

Done: `pdfjs-dist` 6.4.299 and `pdf-lib` 1.17.1 installed (devDependencies, pinned, bundled); design fixed: text extraction in a main worker thread (pdfjs legacy build), worker CSP header for `pdfjs/` assets with `'wasm-unsafe-eval'` only there, new channels `document:pickPdf` and `document:createBeside`, deep-link target store in the tabs store.

Remaining: main extractor and runner, renderer viewer module, CSP and protocol changes, tests, docs (DECISIONS D-128 onward, ARCHITECTURE, USER_GUIDE), gate.

## Run 1 status so far (second checkpoint)

Done: PDF text worker (`src/main/documents/text/pdf-text.ts`, `pdf-text-runner.ts`, `DocumentText` injected into DocumentService and portable import), `document:pickPdf` and `document:createBeside`, CSP (`worker-src 'self'`, `PDF_WORKER_CSP` on `pdfjs/`), renderer protocol MIME types, pdf.js asset plugin (`pdfjs-assets.config.ts`), build entry `pdf-text`, asarUnpack; renderer viewer module `src/renderer/documents/pdf/` (session, toolbar, thumbnails with selection and drag, outline, find bar, password prompt, page operations with pdf-lib), deep-link targets in the tabs store, Ctrl+F for document tabs; fixtures `sample-pages.pdf`, `sample-protected.pdf`, `sample-damaged.pdf`; unit `pdf-text`, `pdf-pages`, `csp`, `document-text`; integration `pdf-documents`, `ipc-handlers-documents`, `protocol`. Lint, typecheck and build pass.

Remaining: renderer unit tests (selection, messages, toolbar helpers, targets), E2E spec `pdf.spec.ts`, notices, docs (DECISIONS D-128..D-133, ARCHITECTURE, USER_GUIDE), full unit/integration/traceability gate, final Run 1 report.

## Run 1

Implementer: infinity-code-opus. Scope: F2 PDF viewer and editor. Both "Run 1 status so far" checkpoints above are superseded by this section.

### Plan notes

- Viewer module `pdf` in the registry (`src/renderer/documents/pdf/`, one lazy chunk plus pdf.js's viewer chunk); pdf.js run-time files shipped under `out/renderer/pdfjs/`; WebAssembly allowed only in the pdf.js worker by a per-file CSP header (D-128).
- PDF text for search in a main worker thread with the pdf.js legacy build, injected into DocumentService and portable import as `DocumentText` (D-129).
- pdf.js annotation editor and pdf-lib page operations on in-tab bytes; Save through the tab's `document:save` (revision, versions, linked originals) (D-130, D-131).
- Two new main-window channels: `document:pickPdf` (main's dialog, checked bytes for "Insert pages from a PDF") and `document:createBeside` ("Extract pages") (D-131). Deep links: `tabs.openDocument(id, {target: {page}})` (D-132).

### Built

- Viewing: continuous scroll, thumbnails (lazy rendering), outline panel, page number box, zoom out/in and Fit width / Fit page / Automatic / 50-400 %, Rotate view, find bar (highlight all, next/previous, match case, whole words, Ctrl+F through the app command), text selection and copy, links that open nothing (outline web links offer Copy link), light/dark chrome with white pages.
- Editing: Select / Highlight / Add text / Draw / Add image tools with a color for highlight, text and drawing; Save button and Ctrl+S, "Unsaved changes" status, flush on leaving/closing the tab and quitting (`setUnsaved`), conflicts through the tab's Reload / Save a copy.
- Pages menu and thumbnails: rotate left/right, move up/down (Alt+Up/Down), drag to reorder, insert blank page, insert pages from a PDF (main pick, 25 MB), extract pages to a new PDF next to the source, delete (never the last page). Password-protected PDFs: prompt in the viewer, password kept only in the tab's memory, page operations refused with a message. Damaged PDFs: clear message.
- Search: PDF body text (first 1,000 pages, 500,000 characters, files up to 100 MB) through the worker; protected PDFs index the title only.

### Changed and added files

- Dependencies: `pdfjs-dist` 6.4.299, `pdf-lib` 1.17.1 (devDependencies, exact); `package-lock.json`; `THIRD_PARTY_NOTICES.md` regenerated (pdfjs-dist, pdf-lib, pako, tslib, @pdf-lib/standard-fonts, @pdf-lib/upng); `tools/third-party-notices.mjs` leaves out the never-packaged optional `@napi-rs/canvas`.
- Build and packaging: `electron.vite.config.ts` (main entry `pdf-text`, renderer plugin), `pdfjs-assets.config.ts` (new), `electron-builder.json` (asarUnpack for the worker and character maps), `eslint.config.mjs` (`tests/**/*.mjs` as Node files).
- Main: `documents/text/pdf-text.ts`, `pdf-text-runner.ts`, `pdfjs-worker.d.ts` (new); `documents/text/document-text.ts` (`DocumentText`, `documentTextExtractors`); `documents/document-service.ts` (`pickPdf`, `createBeside`, injected text); `portability/portable-import.ts`, `portability-service.ts`; `main-services.ts`, `index.ts` (worker location); `ipc/handlers/document-handlers.ts`; `windows/renderer-protocol.ts` (MIME types, worker CSP).
- Shared: `csp.ts` (`worker-src 'self'`, `PDF_WORKER_CSP`), `documents/pdf-assets.ts`, `documents/targets.ts` (new), `documents/limits.ts`, `documents/messages.ts`, contracts `documents.ts`, `channels.ts`, `channel-names.ts`, `bridge.ts`; preload `index.ts`.
- Renderer: `documents/pdf/` (`PdfViewer.tsx`, `pdf-session.ts`, `pdfjs.ts`, `pdf-pages.ts`, `page-selection.ts`, `pdf-messages.ts`, `PdfToolbar.tsx`, `PdfThumbnails.tsx`, `PdfOutline.tsx`, `PdfFindBar.tsx`, `PdfPasswordPrompt.tsx`), `styles/pdf.css` (new); `documents/viewer-registry.ts`, `DocumentView.tsx`, `html/HtmlViewer.tsx`; `state/tabs-store.ts`, `ui-store.ts`, `commands.ts`; `ui/copy-text.ts`.
- Fixtures: `tools/make-document-fixtures.mjs` (PDF writer with outline and RC4 encryption), `tests/fixtures/documents/sample-pages.pdf`, `sample-protected.pdf`, `sample-damaged.pdf` (`sample.pdf` unchanged byte for byte), `tests/fixtures/workers/silent-worker.mjs`, `exiting-worker.mjs`.
- Tests: unit `pdf-text.test`, `pdf-pages.test`, renderer `pdf-viewer.test` (new); updated `csp.test`, `contracts.test` (126 channels), `document-text.test`, `document-check.test`, renderer `documents-ui.test`, `state/documents-state.test`, `support/fake-bridge.ts`; integration `pdf-documents.test` (new), updated `ipc-handlers-documents.test`, `protocol.test`, `hierarchy-helpers.ts` (real PDF worker from source); E2E `tests/e2e/pdf.spec.ts` (new, written, not run).
- Docs: `DECISIONS.md` D-128..D-133 (and D-126 status), `ARCHITECTURE.md` (PDF paragraph, IPC row D-131, CSP, packaging), `USER_GUIDE.md` (PDF documents).

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact pdfjs-dist@6.4.299 pdf-lib@1.17.1` | added 8 packages; `npm audit` reports only the existing electron-builder `sprintf-js` chain |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 115 files, 874 tests passed |
| `npx vitest run --project integration` | 55 files, 509 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; `PdfViewer` (895 kB) and `pdf_viewer` (172 kB) are their own chunks, the main chunk grew by about 1 kB; `out/main/pdf-text.js` is separate and `out/main/index.js` contains no pdf.js; `out/renderer/pdfjs/` has the worker, wasm, cmaps, standard fonts and ICC files |
| built worker under plain Node (`out/main/pdf-text.js` on `sample-pages.pdf`) | returned the three pages' text |
| `npm run notices`, `node tools/third-party-notices.mjs --check` | regenerated; check passes |
| `node tools/make-document-fixtures.mjs` | wrote the fixtures; `sample.pdf` identical to Run 0 |

Logs: `.infinity-work/logs/release-0.3.0/run1-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window.

### Not verified here (native, for the end-of-release E2E in WSL/Xvfb and CI)

- Chromium applying `PDF_WORKER_CSP` to the module worker and the WebAssembly decoders running there; pdf.js page rendering, text layer, find highlights, annotation editing and the Chromium file chooser for image stamps (`pdf.spec.ts`).
- The PDF text worker inside packaged Electron main (unpacked from the asar; pdf.js must detect Node in an Electron worker thread). Under plain Node and vitest it runs (unit and integration tests); if it failed in the package, PDFs would be indexed by title only and the main log would show `kind=pdf error=...`.

### Left open

- Print/export of the unchanged bytes and a version list UI for documents (service and IPC exist since Run 0) were not part of this run's task list; Save a copy is offered on conflicts only.

## Run 2 status so far (checkpoint for a restart)

Done: `@fortune-sheet/react` 1.0.4 and `exceljs` 4.4.0 installed (devDependencies, exact); npm `overrides` scoped to their parents (`exceljs` → `unzipper@0.12.5`, `uuid@11.1.1`; `@fortune-sheet/core` → `uuid@11.1.1`, since its `uuid@8` has GHSA-w5hq-g745-h8pq); the root `uuid@14.0.2` of Tiptap is unchanged; `npm audit` lists only the existing electron-builder `sprintf-js` chain. Design fixed: an app-owned workbook model (`src/shared/documents/workbook.ts`, Zod, bounded) converted from and to xlsx/csv in a main worker thread (ExcelJS bundled into `out/main/workbook.js`), FortuneSheet in the renderer, narrow channels `document:readWorkbook`/`document:saveWorkbook`, and versions/export channels for the shared Versions panel.

Remaining: everything else (main conversion and worker, service and channels, renderer viewer, Vite patch of `new Function`, Versions panel, tests, docs, gate).

## Run 2 status so far (second checkpoint)

Done: shared workbook model and limits (`src/shared/documents/workbook.ts`, messages), `DocumentTarget` sheet/cell; main workbook worker (`src/main/documents/spreadsheet/`: xlsx read/write with ExcelJS, CSV with separator/encoding/BOM/line-ending round trip, Excel colors, package feature scan, task dispatcher, worker entry built as `out/main/workbook.js`, runner on a shared `services/worker-task.ts` that the PDF text runner now uses too), `SpreadsheetService`, macro-enabled packages refused, worksheet values in search text, channels `document:readWorkbook`, `document:saveWorkbook`, `document:copyVersion`, `document:export`, version bytes on `infinity-document://<id>/?version=<id>`; FortuneSheet build patch (`fortune-sheet-patch.config.ts`); renderer `SpreadsheetViewer` (FortuneSheet, find bar, Save/Ctrl+S, unsaved flush, Simplified-on-save dialog, deep links, read-only), model adapter `fortune-model.ts`, shared `DocumentFindBar` (PDF find bar on it), Versions panel and Export a copy in `DocumentView`, PDF viewer read-only for versions; unit tests `workbook-convert`, `workbook-csv`, `fortune-sheet-patch`, updated `document-text`. Built worker verified under plain Node. Lint and typecheck pass.

Remaining: renderer unit tests (adapter, borders, find, Versions panel), integration tests (spreadsheet save/version/round trip through services, IPC, protocol versions), E2E specs `spreadsheet.spec.ts` and versions (written, not run), contracts/channel counts, docs (DECISIONS D-134..D-141, ARCHITECTURE, USER_GUIDE), notices, full unit/integration/traceability/build gate, final Run 2 report.

## Run 2

Implementer: infinity-code-opus. Scope: F3 spreadsheet viewer and editor (xlsx, csv) and the shared document version history UI. Both "Run 2 status so far" checkpoints above are superseded by this section.

### Plan notes

- An app-owned, bounded workbook model (`src/shared/documents/workbook.ts`) is the only thing that crosses IPC; main converts files to and from it with ExcelJS in a worker thread that shares no module with main's bundle (D-134). CSV/TSV keep separator, encoding, BOM and line endings (D-135).
- FortuneSheet in a lazy renderer chunk, with only the tools whose results the model keeps; its `new Function` is replaced at build time (D-139, D-140). Parts the model drops are listed before the first save; macro-enabled packages are never documents (D-136).
- Versions panel, read-only version view (`?version=` on the document protocol), restore, save as copy and Export a copy for every editing kind (D-141). Deep links `{sheet, row, col}` (D-137); worksheet values in search (D-138).

### Built

- Spreadsheet tab for `.xlsx` and `.csv`: FortuneSheet grid with formulas and recalculation, sheets (add, rename, copy, delete, color, hide, reorder), formatting toolbar (number formats, font, size, bold, italic, underline, strike, colors, fill, borders, merge/unmerge, alignment, wrap, rotation), insert/delete/hide/resize rows and columns, freeze, sort, filter, notes, undo/redo, copy (HTML table and TSV) and paste (Ctrl+V) with the system clipboard; the app's find bar (Ctrl+F, Match case, Whole cell); Save button and Ctrl+S, "Unsaved changes", flush on leaving, closing and quitting; "Simplified on save" banner and confirmation dialog; CSV values-only hint; read-only mode for versions; deep links to a sheet and cell.
- Main: workbook worker (`out/main/workbook.js`), `SpreadsheetService` (read current or a version, bounded and validated again; save through `DocumentService.save`), package feature scan, macro refusal for all OOXML kinds, worksheet values in the search text, `DocumentService.copyVersion`, `exportCopy`, `fileOf`; `DocumentFiles.resolveVersion`; version bytes on `infinity-document://<id>/?version=<id>`; shared `runWorkerTask` (the PDF text runner now uses it); `copyNewFileDurably` shared by the store and the export.
- Renderer: Versions panel and Export a copy in the document header, version banner (Restore this version, Save as copy, Back to the current version), unsaved edits saved before a version is opened or restored; `DocumentFindBar` shared by the PDF and spreadsheet viewers; the PDF viewer read-only for versions (no tools, page operations or Save).

### Changed and added files

- Dependencies: `@fortune-sheet/react` 1.0.4, `@fortune-sheet/core` 1.0.4, `exceljs` 4.4.0 (devDependencies, exact, bundled); scoped `overrides` (`exceljs` → `unzipper@0.12.5`, `uuid@11.1.1`; `@fortune-sheet/core` → `uuid@11.1.1`); `package-lock.json` (Tiptap's `uuid@14.0.2` unchanged); `THIRD_PARTY_NOTICES.md` regenerated; `tools/third-party-notices.mjs` reads the legacy `licenses` field (jstat, MIT).
- Build and packaging: `fortune-sheet-patch.config.ts` (new), `electron.vite.config.ts` (main entry `workbook`, commonjs `ignore` for the S3 client, renderer plugin), `electron-builder.json` (asarUnpack `out/main/workbook.js`).
- Shared: `documents/workbook.ts`, `documents/workbook-messages.ts` (new); `documents/targets.ts`, `documents/messages.ts`, `app-identity.ts` (`documentVersionUrl`), contracts `documents.ts`, `channels.ts`, `channel-names.ts`, `bridge.ts`; preload `index.ts`.
- Main: `documents/spreadsheet/` (`a1.ts`, `csv.ts`, `excel-colors.ts`, `xlsx-read.ts`, `xlsx-write.ts`, `workbook-task.ts`, `workbook-convert.ts`, `workbook-worker.ts`, `workbook-runner.ts`, `workbook-package.ts`, `spreadsheet-service.ts`; new), `services/worker-task.ts` (new), `services/stored-files.ts`, `documents/document-service.ts`, `document-files.ts`, `document-store.ts`, `document-check.ts`, `file-writes.ts`, `text/document-text.ts`, `text/office-xml-text.ts`, `text/pdf-text-runner.ts`, `windows/document-protocol.ts`, `ipc/handlers/document-handlers.ts`, `ipc/register-handlers.ts`, `main-services.ts`, `index.ts`.
- Renderer: `documents/spreadsheet/` (`SpreadsheetViewer.tsx`, `fortune-model.ts`, `sheet-find.ts`, `spreadsheet-config.ts`; new), `documents/versions/DocumentVersionsPanel.tsx`, `documents/DocumentFindBar.tsx`, `styles/spreadsheet.css` (new); `documents/DocumentView.tsx`, `document-controller.ts`, `viewer-registry.ts`, `pdf/PdfViewer.tsx`, `pdf/PdfToolbar.tsx`, `pdf/PdfFindBar.tsx`, `styles/documents.css`, `styles/pdf.css`.
- Tests: unit `workbook-convert.test`, `workbook-csv.test`, `fortune-sheet-patch.test`, renderer `spreadsheet-model.test`, `document-versions.test` (new); updated `document-text.test`, `contracts.test` (130 channels), renderer `documents-ui.test`, `support/fake-bridge.ts`; integration `spreadsheets.test` (new), updated `ipc-handlers-documents.test`, `hierarchy-helpers.ts` (in-process workbook converter); E2E `tests/e2e/spreadsheet.spec.ts` (new, written, not run; includes the Versions and Export coverage), `pdf.spec.ts` (find count selector `.document-find-count`).
- Docs: `DECISIONS.md` D-134..D-141 (and the D-123 status), `ARCHITECTURE.md` (IPC row, spreadsheets and versions paragraphs, CSP note, packaging), `USER_GUIDE.md` (Spreadsheets; Versions and copies of documents).

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact @fortune-sheet/react@1.0.4 exceljs@4.4.0 @fortune-sheet/core@1.0.4` (with scoped overrides) | installed; `npm ls buffers` empty; `npm audit`: only the existing electron-builder `sprintf-js` chain (8 moderate, as in Run 1) |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 120 files, 929 tests passed |
| `npx vitest run --project integration` | 56 files, 518 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; `SpreadsheetViewer` is its own chunk (2.78 MB, CSS 51 kB); the main renderer chunk is 1,290 kB (Run 1: 1,284 kB); `out/main/workbook.js` (2.28 MB) is separate and `out/main/index.js` has no ExcelJS; the spreadsheet chunk has no `new Function("d"` and has the patched splice helper |
| built worker under plain Node (`out/main/workbook.js`: read `sample.xlsx`, write it, read `sample.csv`) | all three answered ok |
| `npm run notices`, `node tools/third-party-notices.mjs --check` | regenerated; check passes; every listed license is MIT, ISC, Apache-2.0, BSD-3-Clause, 0BSD, MIT AND Zlib, MPL-2.0 OR Apache-2.0, or MIT OR GPL-3.0 (jszip, taken as MIT) |

Logs: `.infinity-work/logs/release-0.3.0/run2-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window; `spreadsheet.spec.ts` runs in WSL under Xvfb and on CI at the end of the release.

### Not verified here (native, for the end-of-release E2E)

- FortuneSheet rendering, cell entry by click and keyboard, row insertion from the context menu under the real CSP, copy (FortuneSheet's `execCommand('copy')` from its own hidden element) and paste of HTML tables through Chromium's clipboard, the Simplified-on-save dialog, closing a tab with edits, the Versions panel and Export a copy in a real window (`spreadsheet.spec.ts`). The E2E selectors for FortuneSheet's overlay and context menu were written from its 1.0.4 sources and may need adjusting on the first run.
- The workbook worker inside packaged Electron (unpacked from the asar, like the PDF text worker); under plain Node and vitest it runs.

### Left open

- Print for documents (D-141) was not built: each kind needs its own print path (the pdf.js print service, a printable grid). Proposed for Run 7.
- Deep links to a sheet and cell (D-137) are implemented in the viewer but have no UI entry until links (F9, Run 5), so no test covers them yet.
- New cells typed in the grid show in FortuneSheet's default font (Times New Roman in its English font list) and are saved without a font, so Excel shows its own default (D-140).

## Run 3 status so far (checkpoint for a restart)

Done: `@portone/docx-editor` 0.6.7 installed (devDependency, exact; adds only `fflate` 0.8.3, MIT; ProseMirror peers resolve to the hoisted copies of `@tiptap/pm`); package re-checked (Apache-2.0 LICENSE, no remote fonts, no eval; one `fetch` for pasted `http(s)`/`blob:` images, which the CSP and network guard refuse; images drawn as `data:` URLs, so the renderer CSP needs `img-src data:`); spike in Node with jsdom: untouched round trip of `sample-rich.docx` identical in every part, an edit changes only `word/document.xml`. Fixture `sample-rich.docx` (headings, lists, table, picture, page break, header, footer, footnote, comment) added to the generator. Main: content-type macro refusal for all OOXML kinds (`document-check.ts`), Word text extractor with table rows as tab-separated lines plus endnotes and comments (`wordXmlText`). `DocumentTarget` gains `{heading}` and `{paragraph}`. Unit tests for both pass.

Remaining: renderer `docx` viewer module (editor, find plugin, targets, messages, CSS), registry and Versions, CSP `data:` images, unit/integration/E2E tests, docs (DECISIONS D-142.., ARCHITECTURE, USER_GUIDE), notices, gate.

## Run 3 status so far (second checkpoint)

Done: renderer `src/renderer/documents/docx/` (`DocxViewer.tsx` on `@portone/docx-editor` with the app toolbar, Save/Ctrl+S, unsaved flush, page break, read-only mode with zoom, find bar plugin `docx-find.ts`, deep links `docx-targets.ts`, `docx-export.ts`, `docx-messages.ts`, `DocxPreview.tsx` read-only fallback with `docx-preview` 0.4.1 in a shadow root), `styles/docx.css`, registry entry and Versions for docx, renderer CSP `img-src … data:`; `fflate` 0.8.3 as a direct devDependency for tests. Unit `docx-viewer.test.tsx` (14, real editor in jsdom), `document-text`, `document-check`, `csp` pass; integration `docx-documents.test.ts` (5) passes.

Remaining: E2E `docx.spec.ts`, notices, docs (DECISIONS D-142..D-148, ARCHITECTURE, USER_GUIDE), lint/typecheck/full unit+integration/traceability/build gate, final Run 3 report.

## Run 3

Implementer: infinity-code-opus. Scope: F4 Word document (.docx) viewer and editor. Both "Run 3 status so far" checkpoints above are superseded by this section.

### Plan notes

- `docx` viewer module in the registry (`src/renderer/documents/docx/`, one lazy chunk) on `@portone/docx-editor` 0.6.7 (D-124): the editor writes the edited document into the package it opened, so untouched parts keep their bytes; Save goes through the existing `document:save` (no new IPC channel) (D-142).
- Main: the Office package check also refuses macro content types (D-143); the Word extractor reads table rows as lines, endnotes and comments (D-145).
- Files the editor refuses open read-only with the reason for its stable error code and, for a readable package, a `docx-preview` rendering in a shadow root (D-144). Find is a consumer ProseMirror plugin under the app's find bar (D-145); links get `{heading}` and `{paragraph}` targets (D-146). Comments are the editor's OOXML comments (D-147). Pictures are `data:` URLs, so the renderer CSP allows `data:` images (D-148).

### Built

- Word tab: page layout with page guides, header and footer shown, zoom (editor toolbar; app zoom list in read-only versions), editing text, paragraph styles and headings, font family and size, bold, italic, underline, strikethrough, text color, highlight, alignment, spacing, numbered and bulleted lists, indents, tables (insert, rows, columns, merge, split, cell styles), pictures (Insert image with the system file chooser, paste, resize), links, footnotes, comments, undo and redo (the editor's toolbar and right-click menus); the app's row with **Page break**, **Find** (Ctrl+F, Match case, Whole words, Enter/Shift+Enter), the status (**Unsaved changes**, **Saving…**, **Read-only**, a refused edit's reason) and **Save** (Ctrl+S); flush on leaving, closing and quitting; Versions panel and Export a copy (D-141) for Word; read-only versions; refusal messages per error code and save-problem messages; a placeholder banner; deep links to a heading or paragraph; Ctrl+K stays the app search inside the page; light/dark chrome with white pages; the page is a labelled multi-line textbox.
- Main: content-type macro refusal for docx, xlsx and pptx; Word search text with table rows as tab-separated lines, headers, footers, footnotes, endnotes and comments.
- Fixture: `sample-rich.docx` (headings, numbered and bulleted lists, table, inline PNG picture, page break, header, footer, footnote, comment), generated by `tools/make-document-fixtures.mjs` (the other fixtures unchanged).

### Changed and added files

- Dependencies (devDependencies, exact, bundled): `@portone/docx-editor` 0.6.7 (Apache-2.0; adds `fflate` 0.8.3, MIT), `docx-preview` 0.4.1 (Apache-2.0; its `jszip` 3.10.2 was already in the tree), `fflate` 0.8.3 as a direct devDependency (tests read and write packages with it), `@types/jsdom` 30.0.0 (MIT, types only, for the integration test's XML parser); `package.json`, `package-lock.json`; `THIRD_PARTY_NOTICES.md` regenerated (adds @portone/docx-editor, docx-preview, fflate).
- Main: `documents/document-check.ts` (macro content types), `documents/ooxml-package.ts` (`CONTENT_TYPES` shared), `documents/text/office-xml-text.ts` (`wordXmlText`; the unused Word vocabulary and tab option removed), `documents/text/document-text.ts` (Word parts).
- Shared: `csp.ts` (`img-src … data:`), `documents/targets.ts` (`{heading}`, `{paragraph}`).
- Renderer: `documents/docx/` (`DocxViewer.tsx`, `DocxPreview.tsx`, `docx-find.ts`, `docx-targets.ts`, `docx-export.ts`, `docx-messages.ts`; new), `styles/docx.css` (new), `documents/viewer-registry.ts` (docx entry), `documents/DocumentView.tsx` (Versions for docx).
- Tools and fixtures: `tools/make-document-fixtures.mjs` (binary parts, content-type defaults, PNG writer, `docxRich`), `tests/fixtures/documents/sample-rich.docx` (new).
- Tests: unit renderer `docx-viewer.test.tsx` (new, 15: the real editor in jsdom), `support/fixtures.ts` (new); updated unit `document-text.test` (Word XML, rich fixture), `document-check.test` (macro content types), `csp.test` (img-src), renderer `documents-ui.test` (registry has docx; the no-viewer case uses a presentation); integration `docx-documents.test.ts` (new, 5); E2E `tests/e2e/docx.spec.ts` (new, 7, written, not run).
- Docs: `DECISIONS.md` D-142..D-148 (and the D-124 status), `ARCHITECTURE.md` (Word paragraph, package check, CSP), `USER_GUIDE.md` (Word documents; Versions now lists Word).

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact @portone/docx-editor@0.6.7`, `docx-preview@0.4.1`, `fflate@0.8.3`, `@types/jsdom@30.0.0` | installed; `npm audit`: only the existing electron-builder `sprintf-js` chain (8 moderate, as in Runs 1-2) |
| spike under Node with jsdom (`run3-spike.log`) | untouched export of `sample-rich.docx` identical in every part; an inserted run changes only `word/document.xml`; no export problems |
| `node tools/make-document-fixtures.mjs` | wrote the fixtures, `sample-rich.docx` 4,861 bytes |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 121 files, 949 tests passed |
| `npx vitest run --project integration` | 57 files, 523 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; `DocxViewer` 479 kB (CSS 28 kB) and `DocxPreview` 174 kB are their own chunks; the main renderer chunk is 1,291.5 kB (Run 2: 1,290 kB) and holds no editor code; the Word chunk has no eval, `new Function` or remote URL; the preview chunk has jszip's unreachable `setImmediate` string fallback only (D-144) |
| `npm run notices`, `node tools/third-party-notices.mjs --check` | regenerated; check passes |

Logs: `.infinity-work/logs/release-0.3.0/run3-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window; `docx.spec.ts` runs in WSL under Xvfb and on CI at the end of the release.

### Not verified here (native, for the end-of-release E2E)

- The editor under the real CSP in Chromium: pictures drawn from `data:` URLs, the page guides, header and footer bands, the comments rail and menus positioned on screen, the Chromium file chooser behind Insert image, clipboard paste of text and pictures, keyboard typing and IME in the contenteditable page, the editor toolbar's selectors used by `docx.spec.ts` (written from the 0.6.7 sources; they may need adjusting on the first run).
- Saved files opened in Microsoft Word and LibreOffice (the tests check the package parts and re-import with the editor, not Word itself).

### Left open and deviations

- Comments: the run asked for read-only comments until F8; the editor has no edit mode with read-only comments, so its OOXML comments stay writable under the author "Infinity Notes" (D-147). F8 can build on this for Word documents.
- Find searches the body only (headers, footers and notes are separate editor stories); Ctrl+K search covers them through the extractor.
- Links inside a Word document open nothing (the editor's link card **Open** is refused by main's `window.open` policy); there is no Copy link in the card.
- Print for documents remains open (D-141, proposed for Run 7).

## Run 4 status so far (checkpoint for a restart)

Done: `pptx-glimpse` 5.3.1 and `@pptx-glimpse/document` 0.16.0 installed (devDependencies, exact; `npm audit` unchanged: only the electron-builder `sprintf-js` chain); licenses re-checked (pptx-glimpse, @pptx-glimpse/document, @pptx-glimpse/editor, fast-xml-parser and its helpers, opentype.js MIT; `@resvg/resvg-wasm` MPL-2.0 used only for PNG output, never initialized; @xmldom/xmldom 0.9.12 and rtf.js 3.0.9, MIT, are bundled inside pptx-glimpse's dist); probes in scratch: untouched writes are identical in every part, a text edit or a move changes only that slide, slide duplicate/delete/move/add touch only the slide list parts plus the new or removed slide and notes parts, placeholders without their own `a:xfrm` cannot be moved by the library, speaker notes are raw parts only; fixture `sample-rich.pptx` (placeholders, mixed runs, picture, notes, transition, chart) added to the generator (`sample.pptx` unchanged byte for byte).

Design: the editing session runs in the renderer on `@pptx-glimpse/document`'s immutable source model with app-owned undo/redo, SVG slides from `renderPptxSourceModelToSvg` shown as `data:` images, and a small OOXML layer (text bodies, notes, missing transforms) applied to written bytes and read back; Save goes through `document:save`; no new IPC.

Remaining: everything in code, tests and docs.

## Run 4 status so far (second checkpoint)

Done: renderer `src/renderer/documents/pptx/` (package bounds and macro refusal, OOXML layer for text bodies, notes and inherited transforms, notes reading and writing with a new notes master when missing, model queries, editing session with history and SVG drawing, find, picture sniffing, stage with frames, handles, snapping, keyboard moves and in-place text editing, thumbnails with drag and keyboard reordering, notes pane, presentation mode, toolbar, messages, CSS), registry entry and Versions for pptx, `{slide}` deep-link target, main search text in slide-list order with each slide's notes, `THIRD_PARTY_NOTICES.md` with the packages bundled inside pptx-glimpse (tool change), build checked (no resvg, WebAssembly, eval or remote URL in the `PptxViewer` chunk). Unit `pptx-editor.test` (15) and `pptx-viewer.test` (14) pass; lint and typecheck pass.

Remaining: main text unit tests, integration (save/version round trip, preservation through DocumentService), E2E `pptx.spec.ts`, docs (DECISIONS D-149.., ARCHITECTURE, USER_GUIDE), full gate, final Run 4 report.

## Run 4

Implementer: infinity-code-opus. Scope: F5 PowerPoint (.pptx) viewer and editor. Both "Run 4 status so far" checkpoints above are superseded by this section.

### Plan notes

- `pptx` viewer module in the registry (`src/renderer/documents/pptx/`, one lazy chunk). The editing session runs in the renderer on the immutable source model of `@pptx-glimpse/document` with an app-owned undo/redo history; slides are drawn as SVG by `pptx-glimpse` and shown as `data:` images; Save goes through the existing `document:save` (no new IPC channel) (D-149).
- What the library does not edit is a small OOXML layer applied to the written package and read back: text bodies (runs keep `a:rPr`), whole-shape formatting, positions of placeholders that inherit theirs, speaker notes (new notes slides and, when missing, a notes master) (D-150).
- Bounds and macro refusal before parsing in the renderer (D-153); a banner for content shown simplified or not at all (D-154); `{slide}` deep links, find over drawings and notes, search text in slide-list order with notes (D-152); notices for code bundled inside pptx-glimpse (D-155).

### Built

- PowerPoint tab: slide thumbnails (listbox; arrows, Home, End; Alt+Up/Down moves; Ctrl+D duplicates; Delete deletes, never the last slide; drag and drop), the slide view with zoom (Fit, 50-200 %), frames for every drawing on the slide (select, drag with snapping to the slide's edges and center, Alt to place freely, eight resize handles; Tab/Shift+Tab, arrows, Alt+arrows, Shift+arrows, Enter, Delete, Escape, Page Up/Down on the focused slide; a live region names the selection), in-place text editing in text boxes and placeholders (runs keep their formatting, Enter makes paragraphs, plain-text paste; Bold, Italic, Underline, font size and text color for the selection or a whole selected shape; Ctrl+B/I/U), speaker notes (view and edit), New slide (same layout, after the current one), Duplicate and Delete slide, Text box, Picture (PNG/JPEG up to 16 MB from the Chromium file chooser or the clipboard; pasted text becomes a text box), Undo and Redo (Ctrl+Z, Ctrl+Y), Find (Ctrl+F; drawings and notes; Match case, Whole words; the slide of the match is shown and the match outlined), presentation mode (F5 or Present; over the whole window; Right/Down/Page Down/Space/Enter/N/click forward, Left/Up/Page Up/Backspace/P/right-click back, Home/End, a counter, Esc back to the editor at that slide), Save and Ctrl+S, "Unsaved changes", flush on leaving, closing and quitting, Versions panel and read-only versions, Export a copy (D-141), deep links to a slide, refusal messages (too large, unreadable or zip-bomb-shaped, macros, too many slides), the not-shown banner (transitions, animations, media, SmartArt, charts, embedded objects, ink).
- Main: PowerPoint search text in the presentation's slide order, each slide followed by its notes (`presentation-text.ts`), part names shared with the editor (`src/shared/documents/opc-paths.ts`).
- Registry: every kind now has a viewer, so `DOCUMENT_VIEWERS` is a complete record and the tab's "no viewer" fallback is gone.

### Changed and added files

- Dependencies (devDependencies, exact, bundled): `pptx-glimpse` 5.3.1, `@pptx-glimpse/document` 0.16.0 (MIT; they bring `@pptx-glimpse/editor` 0.6.0, `fast-xml-parser` 5.11.2 with `fast-xml-builder`, `strnum`, `anynum`, `is-unsafe`, `xml-naming`, `path-expression-matcher`, `@nodable/entities`, `opentype.js` 1.3.4 with `tiny-inflate` and `string.prototype.codepointat`, all MIT, and `@resvg/resvg-wasm` 2.6.2, MPL-2.0, unused: PNG output only); `package.json`, `package-lock.json`; `THIRD_PARTY_NOTICES.md` regenerated; `tools/third-party-notices.mjs` (packages bundled inside a shipped package), `tools/vendored-licenses/xmldom-xmldom.txt`, `tools/vendored-licenses/rtf.js.txt` (new).
- Shared: `documents/presentation.ts`, `documents/opc-paths.ts` (new), `documents/targets.ts` (`{slide}`).
- Main: `documents/text/presentation-text.ts` (new), `documents/text/document-text.ts` (plans may read parts; PowerPoint reading order).
- Renderer: `documents/pptx/` (`PptxViewer.tsx`, `PptxStage.tsx`, `PptxThumbnails.tsx`, `PptxNotes.tsx`, `PptxPresenter.tsx`, `PptxToolbar.tsx`, `pptx-session.ts`, `pptx-package.ts`, `pptx-xml.ts`, `pptx-notes.ts`, `pptx-model.ts`, `pptx-find.ts`, `pptx-image.ts`, `pptx-render.ts`, `pptx-messages.ts`, `stage-geometry.ts`, `text-edit.ts`; new), `styles/pptx.css` (new), `documents/viewer-registry.ts` (pptx entry, complete record), `documents/DocumentView.tsx` (Versions for pptx; the no-viewer branch removed).
- Tools and fixtures: `tools/make-document-fixtures.mjs` (shared PresentationML pieces, `pptxRich`), `tests/fixtures/documents/sample-rich.pptx` (new, 11,562 bytes); every other fixture byte for byte unchanged (regenerated into scratch and compared).
- Tests: unit renderer `pptx-editor.test.ts` (15) and `pptx-viewer.test.tsx` (14) (new), unit `document-targets.test.ts` (4, new), updated `document-text.test.ts` (reading order, notes, a moved slide, relationship forms), renderer `documents-ui.test.tsx` (registry has every kind; a presentation opens in its viewer); integration `pptx-documents.test.ts` (6, new); E2E `tests/e2e/pptx.spec.ts` (9, new, written, not run).
- Docs: `DECISIONS.md` D-149..D-155 (and the D-125 status), `ARCHITECTURE.md` (PowerPoint paragraph, registry, CSP note), `USER_GUIDE.md` (PowerPoint presentations; Versions lists PowerPoint).

### Preservation evidence (tests on generated fixtures)

- Untouched save: every part identical (`pptx-editor.test`, `pptx-documents.test` after a reopen).
- Text edit of one run: only `ppt/slides/slide1.xml` changes, the bold run keeps `b="1"` (unit and integration, through `DocumentService.save`).
- Moving a placeholder (inherited position) and resizing a picture: only that slide changes.
- Duplicate, move, add, delete slides and notes on a slide without notes: changed parts are exactly `[Content_Types].xml`, `ppt/_rels/presentation.xml.rels`, `ppt/presentation.xml`, the new slide and notes parts with their relationships, and the relationships of the slide that got notes; all other slides, notes, the chart, media, themes and `docProps/app.xml` keep their bytes. Undoing back to the original order gives a package identical to the original in every part.
- Notes on a deck without a notes master: a notes master (with a copy of the theme) is added and survives later duplicate and add-slide operations.

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact pptx-glimpse@5.3.1`, `@pptx-glimpse/document@0.16.0` | installed; `npm audit`: only the existing electron-builder `sprintf-js` chain (8 moderate, as in Runs 1-3) |
| probes under Node in scratch (`p1`-`p3`) | untouched write identical; text edit or move changes one slide; slide operations touch only list parts and the slides and notes involved; placeholders without `a:xfrm` refused by the library; notes are raw parts |
| `node tools/make-document-fixtures.mjs` (and `--out` scratch, compared) | wrote the fixtures; `sample.pptx` and all others unchanged byte for byte |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 124 files, 983 tests passed |
| `npx vitest run --project integration` | 58 files, 529 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; `PptxViewer` 686.7 kB (CSS 4.4 kB) is its own chunk with `opentype.module` 173 kB unused beside it; the main renderer chunk is 1,291.4 kB (Run 3: 1,291.5 kB) and holds no presentation code; the chunk has no `resvg`, `WebAssembly`, eval or `new Function`, one `fetch` (the document's own bytes) and no remote URL (`run4-chunk-scan.log`) |
| `npm run notices`, `node tools/third-party-notices.mjs --check` | regenerated; check passes; every listed license is MIT, ISC, Apache-2.0, BSD-3-Clause, 0BSD, MPL-2.0, MIT AND Zlib, MPL-2.0 OR Apache-2.0 or MIT OR GPL-3.0 (jszip, taken as MIT) |

Logs: `.infinity-work/logs/release-0.3.0/run4-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window; `pptx.spec.ts` runs in WSL under Xvfb and on CI at the end of the release.

### Not verified here (native, for the end-of-release E2E)

- Slides drawn as `data:` SVG images under the real CSP and their look in Chromium with the system's fonts (Calibri falls back to what the OS has), pointer dragging and resizing with pointer capture, the contenteditable text editor in Chromium (Enter splitting spans with their attributes, which the unit test simulates, IME, native undo inside the editor), the Chromium file chooser behind Picture, clipboard paste of pictures and text, HTML5 drag and drop in the slide list, presentation mode over the window. The E2E selectors were written from the components and may need adjusting on the first run.
- Saved files opened in PowerPoint and LibreOffice (the tests check package parts and read them back with the library, not PowerPoint itself).

### Left open and deviations

- Formatting in place applies bold, italic, underline, size and an RGB color; fonts, alignment, bullets and other paragraph formatting are kept but not edited. Shapes inside groups are moved with their group only. Tables, charts and SmartArt can be moved and deleted but their content is not edited.
- Presentation mode is a full-window overlay inside the app (the task allowed this), not the OS full screen; speaker notes are not shown in it.
- Comments on slides (F8) are not part of this run.

## Run 5 status so far (checkpoint for a restart)

Done (F9 links): shared `docRef` node and an `alias` on `noteRef` and `docRef` (`src/shared/editor/nodes.ts`, `doc-schema.ts`, `inline-text.ts`), math node schemas `mathInline`/`mathBlock` (views not yet), migration 012 `document_references` with the purge snapshot trigger, `ReferencesRepo` document methods, indexing in `ContentIndexer` (same save transaction), `ReferenceService` document outgoing and `documentBacklinks`, `links:search` (fuzzy, `src/shared/search/fuzzy.ts`) and `refs:documentBacklinks` channels, `LinkPicker` (notes and documents, places in documents via `targetFromInput`, "Create note “…”"), `LinkTrigger` (`[[`, Ctrl+Shift+L, Ctrl+Shift+K links the selection; Ctrl+K stays search), `DocRef` chip, panel rows for document links, document Details panel with Backlinks, Markdown and portable remap for `docRef`; tests `tests/unit/links.test.ts`, `tests/unit/renderer/editor/links.test.tsx`, `tests/integration/document-links.test.ts`, a lock case in `locks.test.ts`; label updates in unit and E2E specs.

Remaining: F7 Mermaid + F11.1 highlighting, F11.2 math views/input rules, F11.3-5 (outline, counts, PDF/print), F11.6 check, spreadsheet default font, `links.spec.ts`/`mermaid.spec.ts`/`extras.spec.ts`, docs (D-156..), full gate.

## Run 5 status so far (second checkpoint)

Done since the first checkpoint: dependencies `mermaid` 11.17.2 (12.x pulls in elkjs, EPL-2.0, so not used), `katex` 0.19.0 (pinned; `overrides` gives mermaid the same copy, 0.16.x has advisory GHSA-238p-pmpm-9mq7), `lowlight` 3.3.0, `highlight.js` 11.12.0, `@tiptap/extension-code-block-lowlight` and `@tiptap/extension-code-block` 3.31.4; F11.1 highlighted code block with language picker (`src/renderer/editor/code/`); F7 Mermaid preview in the code block view (lazy `mermaid-render` chunk, strict, SVG labels, shown as a `data:` image, bounds 20,000 chars / 1,000 edges / 5 s, Copy as SVG/PNG, Edit/Preview, follows the theme; `src/renderer/editor/diagram/`); F11.2 math nodes, input rules, KaTeX node view (lazy chunk) and Markdown `$…$`/`$$…$$`; F11.3 outline section, F11.4 word/character count under the note (`EditorHandle` is observable, `useEditorDoc`); F11.5 main-built HTML page (`note-html.ts`, `note-document.ts`), `export:noteDocument` and `note:print` channels, hidden-window printer (`windows/html-printer.ts`, JavaScript off, never shown), File menu and palette entries; tests `code-diagram.test.tsx`, `math.test.tsx`, `note-documents.test.ts`.

Remaining: spreadsheet default font, F11.6 check, unit tests for outline/counts, E2E specs (written, not run), notices, docs (D-156..D-164), full gate.

## Run 5

Implementer: infinity-code-opus. Scope: F7 Mermaid diagrams, F9 links by key and shortcut, F11 short extras, and the spreadsheet default font. Both "Run 5 status so far" checkpoints above are superseded by this section.

### Plan notes

- Links to documents get their own table (migration 012 `document_references`) beside `note_references`, the same indexing in the save transaction and the same purge snapshot trigger; a new `docRef` node; an `alias` on both link nodes for a linked selection (D-156).
- One link picker over notes and documents with fuzzy ranking in main, places in documents typed by kind, "Create note"; keys `[[`, Ctrl+Shift+L, Ctrl+Shift+K (Ctrl+K stays search) (D-157).
- The code block stays StarterKit's node in the shared schema; the renderer's highlighted code block (lowlight) has the same spec and a view with the language picker and, for `mermaid`, the diagram (D-158, D-159). Math as two atom nodes with TeX only (D-161).
- Exports are built in main from the stored note; the renderer contributes only drawn diagrams, embedded as `data:` images; PDF and print in a hidden window created by main (D-163).

### Built

- F9: `[[`/Ctrl+Shift+L/Ctrl+Shift+K and the note menu, slash menu and palette open the picker (notes and documents with kind icon and path, keyboard navigation, paragraphs and headings of notes, pages/slides/sheet cells/headings of documents, "Create note “…”"); document chips with live title, kind and place that open the document at the place; missing or trashed targets keep their label and show the missing state; outgoing document links in the note Details panel with Restore/Search; document tabs get a Details panel (Info, Backlinks); backlinks from locked notes show no context.
- F7: Mermaid blocks with Edit/Preview, inline errors, theme following, bounds (20,000 characters, 1,000 edges, 5 s), Copy as SVG and Copy as PNG; in tabs, stickies and read-only views; Markdown keeps the fence, HTML/PDF/print show the drawing.
- F11.1 highlighting for 26 languages with a picker; F11.2 inline and block math (input rules, slash menu, click to edit, TeX in search, `$…$`/`$$…$$` in Markdown, MathML in HTML/PDF); F11.3 live outline; F11.4 word/character count and reading time under the note; F11.5 Export note as HTML/PDF and Print note (File menu and palette); F11.6 was already complete from Run 0 (documents in search with kind icons and snippets; checked, no change).
- Spreadsheets: cells without a font use the system sans font instead of Times New Roman; saving writes no font for them (D-164).

### Changed and added files

- Dependencies (devDependencies, exact): `mermaid` 11.17.2, `katex` 0.19.0 (with `overrides` so mermaid uses it), `lowlight` 3.3.0, `highlight.js` 11.12.0, `@tiptap/extension-code-block-lowlight` 3.31.4, `@tiptap/extension-code-block` 3.31.4; `package.json`, `package-lock.json`, `THIRD_PARTY_NOTICES.md` regenerated, `tools/third-party-notices.mjs` (license read from the file for khroma).
- Shared: `editor/nodes.ts` (`docRef`, `mathInline`, `mathBlock`, `alias`), `editor/doc-schema.ts` (new nodes, bounds, `collectDocRefs`), `editor/schema.ts`, `editor/inline-text.ts` (new), `editor/code-languages.ts` (new), `documents/targets.ts` (`describeTarget`, `targetFromInput`, `columnLetters`), `search/fuzzy.ts` (new), `text/plain-text.ts`, `editor/text-blocks.ts`, `text/text-stats.ts` (new), `contracts/references.ts`, `contracts/portability.ts`, `contracts/channel-names.ts`, `contracts/channels.ts`, `contracts/bridge.ts`.
- Main: `db/migrations/012_document_references.sql` (new), `migrations/index.ts`, `checksums.json`, `db/repositories/references-repo.ts`, `services/content-indexer.ts`, `services/reference-service.ts`, `services/palette-service.ts`, `ipc/handlers/retrieval-handlers.ts`, `palette-handlers.ts`, `portability-handlers.ts`, `portability/markdown.ts`, `portability/remap.ts`, `portability/note-html.ts`, `note-document.ts`, `write-file.ts` (new), `portability/note-export.ts`, `portability/portability-service.ts`, `windows/html-printer.ts` (new), `main-services.ts`, `index.ts`; `preload/index.ts`.
- Renderer: `editor/LinkPicker.tsx` (new; replaces `ReferencePicker.tsx`, deleted), `link-trigger.ts`, `doc-ref.ts`, `DocRefView.tsx` (new), `NoteRefView.tsx`, `NoteEditor.tsx`, `extensions.ts`, `editor-services.ts`, `editor-handle.ts`, `note-actions.ts`, `outline.ts`, `use-editor-doc.ts` (new), `code/` (`languages.ts`, `code-block.ts`, `CodeBlockView.tsx`), `diagram/` (`diagram.ts`, `diagram-limits.ts`, `mermaid-render.ts`, `diagram-export.ts`, `use-diagram.ts`, `export-diagrams.ts`), `math/` (`math.ts`, `MathView.tsx`, `math-render.ts`, `katex-render.ts`), `theme/use-applied-theme.ts`, `panel/ReferencesSection.tsx`, `ContextPanel.tsx`, `DocumentDetails.tsx`, `OutlineSection.tsx` (new), `notes/NoteView.tsx`, `NoteStats.tsx` (new), `state/app-services.ts`, `commands.ts`, `palette-actions.ts`, `portability-commands.ts`, `shortcuts.ts`, `ui-store.ts`, `shell/AppMenuBar.tsx`, `documents/spreadsheet/fortune-model.ts`, `SpreadsheetViewer.tsx`, `styles/editor.css`, `styles/components.css`.
- Tests: unit `links.test.ts`, `renderer/editor/links.test.tsx`, `code-diagram.test.tsx`, `math.test.tsx`, `outline-stats.test.ts` (new); updated `doc-schema.test.ts`, `contracts.test.ts`, `migrations-checksum.test.ts`, `palette-actions.test.ts`, `renderer/editor/note-menus.test.ts`, `renderer/editor/support.ts` (`mountEditor`), `renderer/support/fake-bridge.ts`, `renderer/spreadsheet-model.test.ts`; integration `document-links.test.ts`, `note-documents.test.ts` (new), updated `locks.test.ts`, `restore.test.ts`, `documents.test.ts`, `hierarchy-helpers.ts` (fake printer); E2E `links.spec.ts`, `mermaid.spec.ts`, `extras.spec.ts` (new, written, not run), label updates in `references.spec.ts` and `note-view.spec.ts`.
- Docs: `DECISIONS.md` D-156..D-164, `ARCHITECTURE.md` (sections 3, 4, 12, 13), `USER_GUIDE.md`.

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact` of the six packages, then `katex@0.19.0` with the override | installed; `npm ls katex`: one copy, 0.19.0; `npm audit`: only the existing electron-builder `sprintf-js` chain (8 moderate), the katex 0.16 advisory removed by the pin (`run5-audit.log`) |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 129 files, 1015 tests passed |
| `npx vitest run --project integration` | 60 files, 541 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; main renderer chunk 1,464 kB (Run 4: 1,291 kB; +173 kB for highlighting and the new editor code); `mermaid-render` 647 kB, KaTeX 262 kB (+25 kB CSS) and Mermaid's diagram chunks load lazily; no `eval` or `new Function` in any new chunk (only the pre-existing `DocxPreview`), no remote URL beyond documentation strings |
| `npm run notices`, `node tools/third-party-notices.mjs --check` | regenerated; check passes; new licenses MIT, ISC, BSD-3-Clause (highlight.js), Unlicense (robust-predicates, D-160) |

Logs: `.infinity-work/logs/release-0.3.0/run5-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window.

### Not verified here (native, for the end-of-release E2E in WSL/Xvfb and CI)

- Mermaid drawing in Chromium under the real CSP (jsdom tests use a stub renderer), the `data:` SVG image and PNG copy (canvas, clipboard permission), KaTeX fonts in the app, `[[` and the shortcuts through real key events, the hidden window's PDF and the system print dialog (integration uses a fake printer). The E2E selectors were written from the components and may need adjusting on the first run.

### Left open and deviations

- Ctrl+K keeps opening search; linking a selection is Ctrl+Shift+K (recorded in D-157).
- Places in documents are typed (page, slide, sheet!cell, heading text) rather than chosen from a list of the document's headings or sheets; CSV and HTML documents link as a whole.
- The diagram time limit reports a slow drawing but cannot stop Mermaid's work on the main thread.
- Exported HTML/PDF shows note and document links as their text (no in-file links), like Markdown.

## Run 6 status so far (checkpoint for a restart)

Done (F8 comments on notes): migration 013 (`comment_threads`, `comments`, `comments_fts`, purge triggers, locked-note plaintext guards), `CommentsRepo`, `CommentService` (list, create, reply, edit, delete reply, delete thread, resolve/reopen), comment cipher (locked notes sealed with the note key, sealed on lock and opened on lock removal), quote sync on every content write, comment search hits, portable export/import of threads (marks remapped), the shared `comment` mark with normalizer rules (thread ID required, one run per thread, no HTML parse rule so copies never alias), editor highlights and Ctrl+Alt+M, bubble "Comment", palette "Add comment", `CommentsStore` and note host, Comments section in the Details panel; 9 new channels incl. `graph:build`/`graph:local`; tests `tests/unit/comments.test.ts`, `tests/unit/renderer/editor/comments.test.tsx`, `tests/integration/comments.test.ts` (all green), catalogue/palette/tree/restore test updates. Graph: main model builder, repo and service, renderer store, layout (d3-force 3.0.0, d3-quadtree 3.0.1 pinned), canvas, list view, page, local graph section, rail/palette/tree entries written; graph tests pending.

Remaining: graph unit/integration tests, document comments (PDF, spreadsheet, pptx, docx, HTML hosts), E2E specs (written, not run), docs (D-165..), notices, full gate.

## Run 6 status so far (second checkpoint)

Done since the first checkpoint: graph tests `tests/unit/graph.test.ts` (model builder incl. 2,000/5,000 perf, layout tick budget, settling, hit tests, view math, search, frame loop) and `tests/integration/graph.test.ts` (scopes incl. folder subtree, kind/tag/orphan filters, trash, locked by title only, file edges, local depth 1-3), all green.

Remaining: document comments (viewer hosts), E2E specs (written, not run), docs (D-165..), notices, full gate.

## Run 6

Implementer: infinity-code-opus. Scope: F8 comments (notes first, then documents) and F10 the relation graph. Both "Run 6 status so far" checkpoints above are superseded by this section.

### Plan notes

- Comments are threads with comments (migration 013), single user, anchored per item kind; a note's thread is a `comment` mark in the shared schema with no HTML parse rule and one run per thread in the normalizer, so copies never alias a thread (D-165, D-166).
- Locked notes: comments are encrypted with the note key rather than disabled; guard triggers like D-111 (D-167). Search, backups and portable exports carry comments; Markdown/HTML/PDF exports do not (D-168).
- Documents use app-side anchors through one viewer hook; the sidebar opens the document at a thread's place like a link (D-169).
- Graph: one bounded read in main, a pure model builder, d3-force on a canvas in 8 ms slices that stop when settled, a list view for the keyboard (D-170).

### Built

- F8 notes: Comment in the formatting bubble, Ctrl+Alt+M and palette "Add comment" open a composer in the new Comments section of the Details panel (the panel opens if hidden); saved threads mark and highlight the text (open threads only, the selected one stronger, a flash on reveal); Open/Resolved filter with counts, replies, edit, delete reply, delete thread with a confirmation, resolve/reopen, click to select and flash the text, "Text removed" with the last quote for orphaned threads; quotes follow edits; undo never removes a comment mark; pasted copies carry no thread.
- F8 documents: PDF (selected text area on its page or the page shown; numbered markers and outlined areas on the pages, redrawn as pdf.js redraws), spreadsheet (selected cell; sidebar names it and selects it), PowerPoint (slide and selected shape, selected again on reveal), Word (paragraph at the cursor, next to the editor's own Word comments), HTML (text selected in Source, revealed there).
- F8 storage: locked-note comments sealed and unsealed with the lock, guard triggers, comment search hits ("Comment: …" snippets), Trash/restore/purge with the item, backups, portable export/import with remapped marks.
- F10: Graph tab (rail, palette "Open graph", tree menus of Common, projects and folders) with scope, kind, tag and unlinked filters, title search, canvas with pan/zoom/drag/hover neighbors/click to open, keyboard (arrows, + and -, 0, Enter), List view, legend, light/dark colors, truncation note; Local graph (depth 1-3) in note and document Details panels.

### Changed and added files

- Dependencies (devDependencies, exact): `d3-force` 3.0.0, `d3-quadtree` 3.0.1, `@types/d3-force` 3.0.10, `@types/d3-quadtree` 3.0.6 (the d3 packages dedupe with Mermaid's copies); `package.json`, `package-lock.json`, `THIRD_PARTY_NOTICES.md` regenerated.
- Shared: `comments/anchors.ts` (new), `contracts/comments.ts` (new), `contracts/graph.ts` (new), `editor/comment-mark.ts` (new), `editor/doc-schema.ts` (comment marks, `CommentRuns`, `collectCommentAnchors`), `editor/schema.ts`, `contracts/channel-names.ts`, `contracts/channels.ts`, `contracts/bridge.ts`, `contracts/session.ts` (`page:graph`).
- Main: `db/migrations/013_comments.sql` (new), `migrations/index.ts`, `checksums.json`, `db/repositories/comments-repo.ts` (new), `comments/comment-cipher.ts`, `comment-quotes.ts`, `comment-service.ts` (new), `graph/graph-model.ts`, `graph-repo.ts`, `graph-service.ts` (new), `ipc/handlers/comment-handlers.ts` (new), `ipc/register-handlers.ts`, `main-services.ts`, `services/note-content.ts`, `services/search-service.ts`, `db/repositories/search-repo.ts`, `locks/lock-service.ts`, `locks/lock-purge.ts`, `locks/note-crypto.ts`, `portability/portable-format.ts`, `portable-export.ts`, `portable-import.ts`, `remap.ts`; `preload/index.ts`.
- Renderer: `comments/comments-store.ts`, `note-comment-host.ts`, `document-comment-host.ts` (new), `editor/comments/comment-marks.ts` (new), `editor/extensions.ts`, `editor/editor-services.ts`, `editor/NoteEditor.tsx`, `editor/FormatBubble.tsx`, `panel/CommentsSection.tsx` (new), `panel/ContextPanel.tsx`, `notes/NoteView.tsx`, `graph/` (`graph-store.ts`, `graph-layout.ts`, `graph-draw.ts`, `graph-search.ts`, `frame-loop.ts`, `GraphCanvas.tsx`, `GraphList.tsx`, `GraphPage.tsx`, `LocalGraphSection.tsx`, all new), `documents/viewer-registry.ts`, `documents/DocumentView.tsx`, `documents/pdf/pdf-comments.ts` (new), `pdf/pdf-session.ts`, `pdf/PdfViewer.tsx`, `documents/spreadsheet/SpreadsheetViewer.tsx`, `documents/pptx/PptxViewer.tsx`, `documents/docx/DocxViewer.tsx`, `docx/docx-targets.ts`, `documents/html/HtmlViewer.tsx`, `html/source-anchors.ts` (new), `state/app-services.ts`, `commands.ts`, `palette-actions.ts`, `tabs-store.ts`, `tabs/TabPanel.tsx`, `tabs/TabStrip.tsx`, `shell/Rail.tsx`, `tree/TreeContextMenu.tsx`, `styles/comments.css`, `styles/graph.css` (new), `main.tsx`.
- Tests: unit `comments.test.ts`, `graph.test.ts`, `renderer/editor/comments.test.tsx`, `renderer/document-comments.test.ts` (new); updated `contracts.test.ts`, `migrations-checksum.test.ts`, `palette-actions.test.ts`, `renderer/tree-pane.test.tsx`, `renderer/editor/support.ts`, `renderer/support/fake-bridge.ts`, `renderer/docx-viewer.test.tsx`, `renderer/pptx-viewer.test.tsx`; integration `comments.test.ts`, `graph.test.ts` (new), `restore.test.ts` (schema downgrade drops the comment tables); E2E `comments.spec.ts`, `graph.spec.ts` (new, written, not run).
- Docs: `DECISIONS.md` D-165..D-170, `ARCHITECTURE.md` (sections 3, 4, 11, 12, 13), `USER_GUIDE.md` (Comments, Graph, Details panel).

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm install --save-dev --save-exact d3-force@3.0.0 d3-quadtree@3.0.1 @types/d3-force@3.0.10 @types/d3-quadtree@3.0.6` | installed, deduped with Mermaid's d3 (`npm ls`); `npm audit`: the existing 8 moderate (electron-builder chain), nothing new (`run6-install.log`, `run6-audit.log`) |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 133 files, 1050 tests passed |
| `npx vitest run --project integration` | 62 files, 560 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; main renderer chunk 1,513.57 kB (Run 5: 1,464 kB; +50 kB for comments, the graph and d3-force); no `eval(` or `new Function(` in it |
| `npm run notices`, `node tools/third-party-notices.mjs --check` | regenerated; check passes; new licenses ISC (d3-force, d3-quadtree) and MIT (types) |

Logs: `.infinity-work/logs/release-0.3.0/run6-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e` and any Electron window.

### Not verified here (native, for the end-of-release E2E in WSL/Xvfb and CI)

- Canvas drawing, pointer and wheel interaction and the layout in Chromium (jsdom has no canvas; the layout and view math are unit-tested), PDF markers over real pdf.js pages and text-layer selections, FortuneSheet selection reads, the HTML Source selection in Chromium, Ctrl+Alt+M through real key events, the comment flash animation. The E2E selectors were written from the components and may need adjusting on the first run.

### Left open and deviations

- Word: app-side paragraph comments sit next to the editor's own OOXML comments (D-147); the sidebar does not list the Word comments (the editor's panel does).
- PDF comments are not written into the file (app-side), so other PDF readers do not see them; spreadsheet comments are not written as xlsx cell notes, and the grid shows no indicator (sidebar only).
- Comments hold plain text without links, so they are not graph edges.
- The local graph refreshes when the tree changes (renames, moves, Trash) and when the section opens; a link added by a save shows the next time.
- Marks of threads the note no longer lists (a version restored after its thread was deleted) stay in the text without a highlight.

## Run L status so far (checkpoint for a restart)

Done (main side of F12): contracts (`lock:create`, `lock:setPin`, `sticky:lockStatus|reveal|activity|blur|setPin`, event `sticky:lockState`, `StickyState.locked`, `LockStatus.pin`, setting `locks.blurStickySeconds`), migration 014 `note_pins` (FK to `note_locks`, cascade), `PinsRepo`, `pin-verifier.ts`, `attempt-backoff.ts` (shared with LockService), `reveal-timers.ts`, `sticky-locks.ts` (`StickyLockService`), `ipc/sticky-gate.ts` (content channels of a blurred locked sticky refused in main), `LockService.create` / `setPin` / PIN on lock, the sticky rule of D-111 lifted, `NoteVault.onKeyChange`, `CollabHub.release`, sticky manager window hooks; existing tests updated and green (locks, sticky-service, ipc-validation, restore, contracts, migrations-checksum).

Remaining: renderer (create-locked dialog and entry points, sticky blur and unlock panel, activity reporter, PIN dialogs, settings), new unit/integration tests, E2E spec (written, not run), docs (D-171..), gates.

## Run L status so far (second checkpoint)

Done since the first checkpoint: renderer (create-locked dialog from File menu, palette, Home tiles, tree menus and the Stickies page; sticky blur panel with PIN/password/Windows Hello, `NoteController.conceal`, throttled activity reporter, header lock icon, Blur now and Set/Change PIN, PIN section in Lock settings, "Blur locked stickies after" setting), tests `tests/unit/sticky-locks.test.ts`, `tests/unit/renderer/state/sticky-locks.test.tsx`, `tests/integration/locked-stickies.test.ts`; unit 135 files and integration 63 files green.

Remaining: E2E spec (written, not run), docs (D-171..), traceability, build.

## Run L

Implementer: infinity-code-opus. Scope: F12 (notes and stickies created locked; locked stickies with PIN, reveal and blur). Both "Run L status so far" checkpoints above are superseded by this section.

### Plan notes

- Create locked: one main-side transaction (`HierarchyService.createNote(..., lockWith)`) inserts a content-less row and its lock, so nothing plaintext ever exists (D-171).
- Locked stickies amend D-111's "never floats" (D-172). The reveal lives in main per sticky window; a gate in front of every sticky content channel refuses a blurred locked sticky, so the blur is not cosmetic. The blur timer uses the injectable reminder clock (the E2E fake clock) and the vault's key-change events cover Lock now, Lock all, auto-lock, screen lock, suspend and quit.
- PIN: a scrypt verifier in migration 014 that never touches the data key; it works only while the key is in memory; backoff shared with passwords; five strikes need the password (D-173).

### Built

- New locked note / New locked sticky: File menu, palette, Home tiles, tree menus (Common, projects, folders), Stickies page; one dialog (password twice, no-recovery tick, Windows Hello where available, optional sticky PIN). A note opens unlocked in a tab; a sticky floats revealed.
- Lock note… on a sticky keeps it floating (optional PIN in the dialog); Float as sticky works for locked notes.
- Sticky window of a locked note: header with a lock mark; blurred frosted placeholder (no editor mounted, no content requested); PIN field while the key is in memory, otherwise password (with the reason) and Windows Hello; "Use the password" switch; Blur now and Set/Change PIN… in the sticky menu.
- Blur after "Blur locked stickies after" (Settings > Notes and attachments: 30 s, 1, 2, 5 min; default 1 min) without interaction (keys, clicks, wheel, pointer moves over the text, reported at most every 5 s); at once on Blur now, window close and any key drop; edits saved first (`CollabHub.release`; Blur now also flushes the editor).
- PIN section in Lock settings… of a locked sticky. Stickies page: lock icon, no text.

### Changed and added files

- Shared: `contracts/locks.ts` (PIN and blur constants, messages, `LockCreateRequest`, `LockSetPinRequest`, `StickyRevealRequest`, `StickyLockState`, `LockStatus.pin`; `sticky`/`noFloat` messages removed), `contracts/stickies.ts` (`locked`), `contracts/settings.ts` (`locks.blurStickySeconds`), `contracts/channel-names.ts`, `channels.ts`, `channel-roles.ts` (sticky allowlist, `STICKY_CONTENT_CHANNELS`), `bridge.ts`; `preload/index.ts`.
- Main: `db/migrations/014_sticky_pins.sql` (new), `migrations/index.ts`, `checksums.json`, `db/repositories/pins-repo.ts` (new), `locks/pin-verifier.ts`, `attempt-backoff.ts`, `reveal-timers.ts`, `sticky-locks.ts` (new), `locks/lock-service.ts` (create, setPin, PIN on lock, sticky rule lifted, shared backoff), `locks/note-vault.ts` (`onKeyChange`), `services/collab-hub.ts` (`release`), `services/hierarchy-service.ts` (`lockWith`), `services/sticky-service.ts`, `windows/sticky-manager.ts` (window hooks), `ipc/sticky-gate.ts` (new), `ipc/handlers/lock-handlers.ts`, `ipc/register-handlers.ts`, `main-services.ts`, `desktop.ts`, `index.ts`.
- Renderer: `stickies/StickyLockPanel.tsx`, `stickies/activity-reporter.ts` (new), `stickies/sticky-services.ts`, `StickyView.tsx`, `StickyHeader.tsx`, `notes/LockDialogs.tsx` (shared new-lock form, `CreateLockedDialog`, `PinSection`), `notes/lock-form.ts`, `notes/note-controller.ts` (`conceal`), `notes/NoteView.tsx`, `state/commands.ts`, `state/palette-actions.ts`, `state/ui-store.ts`, `ui/DialogHost.tsx`, `shell/AppMenuBar.tsx`, `home/QuickActions.tsx`, `tree/TreeContextMenu.tsx`, `pages/StickiesPage.tsx`, `settings/NotesSettings.tsx`, `styles/stickies.css`, `styles/components.css`.
- Tests: new `tests/unit/sticky-locks.test.ts` (8), `tests/unit/renderer/state/sticky-locks.test.tsx` (9), `tests/integration/locked-stickies.test.ts` (13), `tests/e2e/locked-stickies.spec.ts` (3 specs, written, not run); updated `tests/integration/hierarchy-helpers.ts`, `locks.test.ts`, `sticky-service.test.ts`, `ipc-validation.test.ts`, `restore.test.ts`, `tests/unit/contracts*.test.ts`, `migrations-checksum.test.ts`, `palette-actions.test.ts`, `renderer/tree-pane.test.tsx`, `renderer/sticky-header.test.tsx`, `renderer/support/fake-bridge.ts`.
- Docs: `DECISIONS.md` D-171..D-173 (D-111's scope rule marked replaced), `ARCHITECTURE.md` (sections 3, 4, 14), `USER_GUIDE.md` (locked notes, Locked stickies, the honest PIN explanation).

### Commands run (Windows, no window opened)

| Command | Result |
| --- | --- |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npx vitest run --project unit` | 135 files, 1067 tests passed |
| `npx vitest run --project integration` | 63 files, 573 passed, 2 skipped (pre-existing skips) |
| `npm run check:traceability` | fails=0 warns=0 |
| `npm run build` | pass; main renderer chunk 1,524.88 kB (Run 6: 1,513.57 kB); no `eval(` or `new Function(` in it |

Logs: `.infinity-work/logs/release-0.3.0/runL-*.log`. Not run by rule: `npm run dev`, `npm run test:e2e`, Playwright and any Electron window.

### Not verified here (native, for the end-of-release E2E in WSL/Xvfb and CI)

- The blur panel's look (frosted lines, `backdrop-filter`) and the PIN dialog in Chromium; real pointer and wheel events feeding the activity reporter; the fake-clock blur inside a running app (`locked-stickies.spec.ts`, selectors written from the components); Windows Hello prompts (fake verifier only, as D-113).

### Left open and deviations

- A new locked sticky opens revealed (the password was just typed); floating an existing locked note, or a sticky restored at startup, opens blurred.
- The PIN backoff and the blur deadlines use the reminder clock (the system clock outside E2E), the vault's idle timeout keeps the app clock, as before.
- Reminders of a locked sticky need no change: the D-112 wording follows `notes.locked`, already covered by `scheduler.test`.

## Run 7 status so far (checkpoint for a restart)

Implementer: infinity-code-opus. Windows gate passed (check, build, notices --check, audit = the 8 known electron-builder moderates). WSL synced (`rsync` to `/home/infinity/infinity-notes`), `npm ci`, `setup:electron`, `build` pass; WSL `check` had 2 unit failures under load (graph tick budget, a lazy HTML viewer chunk in `documents-ui.test`; the latter fixed with a `dom.until` wait). Xvfb invisibility probed (`DISPLAY=:99` from `xvfb-run`, no Wayland). E2E under Xvfb: `documents.spec` and `pdf.spec` pass after fixes (HTML frame reloads after a refused link; PDF dirty flag after reopening with a tool on; PDF save waits for a page change and the focus survives reloads; stale spec selectors). Next: spreadsheet, docx, pptx, links, mermaid, extras, comments, graph, locked-stickies, then the full suite.

## Run 7 status so far (second checkpoint)

E2E under Xvfb passing: documents, pdf, spreadsheet, pptx, docx, comments, graph; fixing links, mermaid (code block), extras (toasts), locked-stickies (search response shape). App defects fixed so far: HTML frame left on Chromium's error page after a link click; PDF "Unsaved changes" stuck after a save with a tool on; PDF Ctrl+S during/after a page change lost (save waits for the change; focus survives reloads); spreadsheet status live region hidden when empty; pptx save failed after moving a shape twice (one transform edit per shape); pptx new text box never opened its editor (stale part XML), so typed spaces pressed the toolbar button again; pptx focus returns to the slide after text editing and after presenting; Ctrl+S in a document tab with the focus outside the viewer.

## Run 7 status so far (third checkpoint)

All eleven new specs pass under Xvfb individually (`run7-e2e-batch4.log`, `run7-e2e-batch5.log` and earlier). Full suite run 1 (`run7-e2e-full-1.log`, 293 tests) in progress; stale expectations in older specs being fixed (Home tiles, PDF chip "Open … in Infinity Notes" names, selection races in comments/docx/links). Docs: D-174, D-175, ARCHITECTURE (protocols), USER_GUIDE (web pages section).

## Run 7 status so far (fourth checkpoint)

Full suite run 1: 282 passed, 9 failed, 2 skipped (`run7-e2e-full-1.log`); all nine were stale expectations in older specs (v0.3.0 bridge surface, Home tiles, rail Graph button, Common/folder menus, search response `documents`, the PDF chip's second "Open … in Infinity Notes" button) or the selection race in `comments.spec`; fixed, and those nine files re-run: 59 passed (`run7-e2e-refix.log`). Windows `package:win` built the installer (not run). Next: full suite runs 2 and 3, then Linux packaging and packaged E2E.

## Run 7

Implementer: infinity-code-opus. Scope: the end-of-implementation test gate of release 0.3.0 and defect repairs. The four "Run 7 status so far" checkpoints above are superseded by this section. No Electron window was opened on the Windows desktop: Windows ran only non-window gates; every Electron start ran in WSL (user `infinity`, `/home/infinity/infinity-notes`, ext4 copy synced with `rsync --delete`, own `node_modules`) as `env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE …`, so `tools/lib/proc.mjs` wrapped the runner in `xvfb-run` (probed: `INFINITY_XVFB_WRAPPED=1 DISPLAY=:99`, no `WAYLAND_DISPLAY`, `Xvfb :99 -screen 0 1280x1024x24`; the app logs `session=x11 ozone=x11`).

### Defects found by the first E2E runs and fixed (app code)

- HTML viewer: a click on an external link left Chromium's error page in the frame (the app page's `frame-src` refuses the navigation before main's `will-frame-navigate` sees it). The frame now remounts on a second load and says "Links in a saved page do not open. Copy them from Links." (D-175; `HtmlViewer.tsx` `PageFrame`). A sandboxed page's meta refresh was checked to be refused, so no reload loop.
- PDF: after a save with a tool on (Add text), "Unsaved changes" stayed: pdf.js stores editors made for the file's own annotations as a change. Such a change is dropped once a page's editors exist and nothing would be saved; an edit of an existing annotation counts once it can be undone (`pdf-session.ts`).
- PDF: Ctrl+S right after a page change saved nothing: the save ran while the bytes reloaded, and the reload (disabled toolbar, thumbnails removed) dropped the focus to the page body. A save now waits for the page change under way; the viewer holds the focus while it reloads and gives it back to the control last used, or the thumbnail of the page shown (`PdfViewer.tsx`).
- Document tabs: Ctrl+S did nothing once the focus had left the viewer (closed menus, editors, presentation). The tab saves the viewer's edits on Ctrl+S when no viewer handled it; flushes are joined (D-174; `DocumentView.tsx`).
- PowerPoint: a shape moved twice (a drag, then arrow nudges) could not be saved ("The document could not be saved."): the library takes one transform edit per shape until written; an earlier move is now written first (`pptx-session.ts` `withoutTransformEdit`).
- PowerPoint: a new text box never opened its text editor (its part XML was read before the pending add was written), so typed text stayed out and each typed space pressed the focused Text box button again, adding boxes. Any pending edit is now written before a part is read (`currentPartXml`).
- PowerPoint: Esc out of a text box and leaving presentation mode dropped the focus; the slide gets it back (the editor's blur ends the editing), and presentation mode returns it to where it was opened (`PptxStage.tsx`, `PptxPresenter.tsx`).
- Spreadsheet: the save status live region was `display: none` when empty, so it left the accessibility tree between saves; it now stays rendered like the other viewers' status (`SpreadsheetViewer.tsx`, `spreadsheet.css`).

### Spec corrections (the spec was wrong; no assertion weakened, nothing skipped)

- Stale since later runs: `documents.spec` (every kind has a viewer: a new presentation opens in it, instead of "no viewer"), `home.spec` (six tiles), `shell.spec` (Graph on the rail), `tree.spec` and `a11y-keyboard.spec` (Common and folder menus with locked, document and graph items; the keyboard walk now steps to "New folder"), `security.spec` (the v0.3.0 bridge surface: `comments`, `document`, `graph`, `links`, `export.noteDocument`, `lock.create/setPin`, `note.print`, `refs.documentBacklinks`, `sticky.activity/blur/lockStatus/reveal/setPin`), `locks.spec` and `locked-stickies.spec` (search responses carry `documents`), `files.spec` and `references.spec` (a PDF chip has "Open report.pdf" and "Open report.pdf in Infinity Notes"; exact names).
- Written against the wrong mechanism: `spreadsheet.spec` and `extras.spec` queued save paths on the open-dialog queue (now `queueSave`); `spreadsheet.spec` read HTML with the removed `clipboard.readHTML` (shared `clipboardHtml` helper on Electron's web-style clipboard, also used by `rich-formatting.spec`); FortuneSheet's context menu acts on a click, not Enter; `pdf.spec` selected a page with Enter (which shows a page) before Shift+click (now a click); `docx.spec` counted ProseMirror's separator images (now `img.docx-editor-img`) and had an ambiguous "Alignment" name; `mermaid.spec` typed "```const", which names the language `const` (now "``` " first), and clicked an "Edit" button that is "Preview" while the new block is being edited (now Preview, then Edit, asserting the source hides and shows); `links.spec` expected notes before an equally matching, newer document (ranking is by match, then recency), pressed Enter before the results arrived, and double-clicked beside the text; `extras.spec` used a strict toast locator with two toasts.
- Races a person never hits: an editor reads a selection on the asynchronous `selectionchange` event, so a toolbar button or shortcut sent in the same instant acts on the old selection. A shared `selectionChange` helper (and the same wait inside `comments.spec`'s `selectText`) waits for that event (`docx.spec` Shift+Home before Bold, `links.spec` Shift+End before Ctrl+Shift+K, `rich-formatting.spec` Ctrl+End after Ctrl+A before pasting a table: when the paste won that race it replaced the whole note, which failed run 2 once); `pdf.spec`/`documents.spec` searches wait for the background text extraction before searching.

### Unit tests added or changed

- `tests/unit/renderer/support/dom.tsx` `until` (waits for a lazily imported viewer chunk; fixed the WSL-only failure of `documents-ui.test` › HTML viewer under load); `documents-ui.test` new case: a second frame load remounts the frame with the same URL and sandbox and notifies.
- `pptx-editor.test`: a picture moved three times saves its last place and only its slide changes; a new text box's text is readable at once.

### Commands run

All logs under `.infinity-work/logs/release-0.3.0/`.

| Where | Command | Result | Log |
| --- | --- | --- | --- |
| Windows (start) | `npm run check` | lint 0 warnings, typecheck, unit 135 files / 1067 passed, integration 63 files / 573 passed + 2 skipped (pre-existing), traceability fails=0 warns=0 | `run7-win-check.log` |
| Windows (start) | `npm run build`; `node tools/third-party-notices.mjs --check`; `npm audit` | pass (main chunk 1,524.88 kB); notices up to date; 8 moderate (the known electron-builder chain via sprintf-js), nothing new | `run7-win-build.log`, `run7-win-notices.log`, `run7-win-audit.log` |
| WSL (start) | `npm ci`, `npm run setup:electron`, `npm run check`, `npm run build` | ci/setup/build pass; check: unit 2 failed / 1065 passed (`graph.test` tick budget 65 ms > 50 ms once under the parallel run; `documents-ui.test` HTML frame not yet loaded) | `run7-wsl-npm-ci.log`, `run7-wsl-setup-electron.log`, `run7-wsl-check.log`, `run7-wsl-build.log` |
| WSL Xvfb | new specs one by one (`documents`, `pdf`, `spreadsheet`, `docx`, `pptx`, `links`, `mermaid`, `extras`, `comments`, `graph`, `locked-stickies`) | iterated to all passing (`run7-e2e-batch4.log` 17/18 then `run7-e2e-batch5.log` 5/5, earlier batches as fixed) | `run7-e2e-*.log` |
| WSL Xvfb | `npm run test:e2e` (full, run 1) | 282 passed, 9 failed, 2 skipped (all nine stale expectations or the selection race; fixed) | `run7-e2e-full-1.log` |
| WSL Xvfb | the nine failed files again | 59 passed | `run7-e2e-refix.log` |
| WSL Xvfb | full run 2, first attempt | stopped at 71/293 after the HTML viewer test failed once (the race fixed in `PageFrame`) | `run7-e2e-full-2-aborted.log` |
| WSL Xvfb | HTML viewer test `--repeat-each 10` | 10 passed | `run7-e2e-html-repeat.log` |
| WSL Xvfb | full run 2 | 290 passed, 1 failed (`rich-formatting.spec` › tables: the select-all/Ctrl+End selection race; fixed), 2 skipped | `run7-e2e-full-2.log` |
| WSL Xvfb | tables test `--repeat-each 10` | 10 passed | `run7-e2e-tables-repeat.log` |
| WSL | `npm run check` (final tree) | lint, typecheck, unit 1069 passed, integration 575 passed, traceability fails=0 | `run7-wsl-check-final.log` |
| WSL | `npm run package:linux` | pass: `infinity-notes-0.2.0-amd64-unsigned.deb`, `infinity-notes-0.2.0-x86_64-unsigned.AppImage` (version stays 0.2.0 until the release step) | `run7-linux-package.log` |
| WSL Xvfb | `npm run test:e2e:packaged` | 8 passed; sandbox `mode=user-namespace` | `run7-e2e-packaged.log` |
| WSL Xvfb | full run 3 (final tree) | 291 passed, 0 failed, 2 skipped (the two Windows-only tray cases in `lifecycle.spec`, D-067) | `run7-e2e-full-3.log` |
| Windows (final) | `npm run check` | lint 0 warnings, typecheck, unit 135 files / 1069 passed, integration 573 passed + 2 skipped, traceability fails=0 warns=0 | `run7-win-check-final.log` |
| Windows (final) | `npm run build`, notices `--check` | pass (main chunk 1,525.31 kB; no `eval(`/`new Function(` in it); notices up to date | `run7-win-build-final.log` |
| Windows | `npm run package:win` (built, not run) | pass: `release/Infinity-Notes-Setup-0.2.0-x64-unsigned.exe` | `run7-win-package.log` |

### Not run (native, outside this computer's allowed scope)

- Native WSLg session runs (they open windows on the Windows desktop; this release uses Xvfb only), so compositor-dependent window behavior was not re-checked under WSLg; Xvfb has no window manager, tray host or notification server (the specs that need them take the existing unsupported paths).
- Windows Electron E2E, unpackaged and packaged, and `verify:install:win`: on GitHub Actions (`ci.yml`, release workflow), never on this computer. The Windows installer was built (`package:win`) but not installed or launched.
- Windows Hello prompts (fake verifier only, D-113), real OS notifications and the tray, the system print dialog (integration uses a fake printer), IME input.

### Left open

- Lazy loading of the highlight.js grammars (main chunk 1,525 kB) was not done: the TipTap lowlight plugin recomputes decorations only on document changes, so grammars arriving later would leave visible code blocks unhighlighted until the next edit; doing it cleanly needs a plugin of our own. Document print per kind was skipped (optional).
- `graph.test` › "a step keeps to its time budget …" asserts one layout tick of 2,000 nodes under 50 ms; under the full parallel unit run in WSL one tick measured 65 ms once (it passes alone and on Windows). Kept as is (a timing assertion is not loosened); see the WSL check results above.
- `graph.spec` (finding a node by hovering a grid over the canvas) takes about 30 s under Xvfb.

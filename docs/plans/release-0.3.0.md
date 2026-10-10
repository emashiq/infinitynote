# Release 0.3.0 plan: documents, diagrams, comments, links and the relation graph

Requested by the user on 2026-10-10 (CLAUDE.md, "v0.3.0 feature batch"). Coordinator: Opus. All application code is written by `infinity-code-opus`, one run at a time; acceptance by `infinity-acceptor`. Progress: `docs/progress/release-0.3.0.md`. Decisions continue from D-118 in `docs/DECISIONS.md`.

## Ground rules for every run

- Free and open-source only. Allowed licenses: MIT, ISC, BSD, Apache-2.0, MPL-2.0 (unmodified files). No commercial, "pro", source-available, AGPL/GPL-only, or dual-licensed-with-commercial-features packages; no library that phones home (telemetry, license checks, CDN fonts). Every new dependency is pinned exactly, its license recorded in `THIRD_PARTY_NOTICES.md` (`npm run notices`), and bundled locally; the app stays fully offline (the network guard must keep refusing requests).
- Clean architecture: main owns file I/O, writes, revisions and versions; renderers get bytes through the existing protocol style or validated IPC and return edited bytes or models through narrow Zod-validated IPC. Heavy viewers are lazy-loaded chunks so startup time does not regress.
- Untrusted files: size limits checked before parsing, zip entries bounded (count, uncompressed total, ratio) for OOXML, PDF scripting disabled (`enableScripting: false`, `isEvalSupported: false`), HTML shown only in a scriptless sandboxed frame with a CSP that blocks all network and scripts. Saved bytes are re-validated in main (magic number / container structure, size).
- Tests are written alongside the code (unit, integration, E2E specs), but **no Electron window is ever launched on the Windows desktop during implementation runs** (the user keeps using this computer). During runs: `npm run lint`, `npm run typecheck`, targeted `vitest` files, `npm run build`. Anything that opens windows (E2E, visual checks, screenshots) runs only in WSL under Xvfb (see Testing). The full gate runs once at the end (Run 7).
- Keep CLAUDE.md's existing product rules (no backend, accounts, sync, collaboration or embedded AI).

## Feature scope

### F1 Documents as first-class items (foundation)
A new tree item, the document, lives in Common, projects and folders next to notes, opens in a tab, can be favorited, moved, trashed and restored, and shows on Home and in search.
- Migration 011: `documents(id, project_id, folder_id, title, kind 'pdf'|'docx'|'pptx'|'xlsx'|'csv'|'html', storage 'managed'|'linked', blob_id NULL → document_blobs, linked_file_id NULL → linked_files, revision, size_bytes, favorite, created_at, updated_at, deleted_at, trash_batch_id)`, `document_blobs(id, sha256 UNIQUE, relative_path, size_bytes, created_at, unreferenced_since)`, `document_versions(id, document_id, revision, blob_id, reason, created_at)`, `documents_fts` with extracted text (title + body text from PDF/DOCX/PPTX/XLSX/CSV/HTML, extracted in main or by the viewer and sent back, capped).
- Create: "New document / spreadsheet / presentation" (blank .docx/.xlsx/.pptx generated from a minimal valid template), "Import file…" (copy or link, reusing the v0.2.0 copy/link choice and 25 MB copy limit). A file attachment or linked file in a note gets "Open in Infinity Notes" for supported kinds.
- Save: managed documents write a new content-addressed blob, bump revision and keep the previous blob as a version (retention like note versions, GC with the 7-day grace). Linked documents save back to the original file atomically (temp file + rename in the same folder) after the main checks from D-115, keeping the previous bytes as a managed version when within the copy limit; if the original changed on disk since it was opened, the user chooses Reload or Save a copy.
- Backup/export/import include managed documents and their blobs; linked documents carry link records only (like linked files).
- Locked notes are unaffected; documents are not lockable in v0.3.0 (documented).

### F2 PDF viewer and editor
`pdfjs-dist` (Apache-2.0) viewer: continuous scroll, thumbnails, zoom, fit width/page, rotate view, find in document, page navigation, text selection/copy, outline. Editing with the pdf.js annotation editor: highlight, free text, ink/draw, image stamp, saved with `saveDocument()`. Page operations with `pdf-lib` (MIT): rotate, delete, reorder (thumbnail drag), insert blank page, merge pages from another PDF, extract pages to a new document. Print/export unchanged bytes.

### F3 Spreadsheet viewer and editor (xlsx, csv)
A free spreadsheet grid (preferred `@fortune-sheet/react` MIT; the implementer may choose another permissively licensed grid after a short spike, recorded as a decision) with multiple sheets, formulas, cell formatting (font, color, fill, borders, number formats, alignment), merges, column/row sizes, freeze panes, sort/filter where the grid supports it. Import/export of .xlsx through a permissive library in main (preferred `exceljs` MIT; SheetJS only from its Apache-2.0 tarball if chosen) with a documented feature mapping; CSV/TSV read and write. Unsupported workbook features are preserved where the library allows and listed in a "Simplified on save" notice otherwise.

### F4 Word document viewer and editor (docx)
Prefer an OOXML-native editor that writes untouched parts back unchanged: spike `@portone/docx-editor` (Apache-2.0) and `@eigenpal/docx-js-editor` (MIT) on real sample files (headings, lists, tables, images, headers/footers, comments). Fallback: `docx-preview` (Apache-2.0) for faithful viewing plus editing through the shared Tiptap editor with `mammoth` (BSD-2) import and `docx` (MIT) export, marked "Editing simplifies formatting" before the first save. Required: view with page layout, edit text and basic formatting (bold/italic/underline, headings, lists, tables, images, alignment, fonts and colors), save .docx that Word/LibreOffice open.

### F5 Presentation viewer and editor (pptx)
Spike permissive candidates (`pptx-svg` MIT, `pptx-glimpse` MIT, `pptx-browser` MIT) for rendering fidelity and editing on sample decks; record results. Required: slide thumbnails + main slide view, presentation mode (full-screen in the main window, arrow keys, Esc), edit text in text boxes, move/resize shapes, add/delete/duplicate/reorder slides, insert image and text box, speaker notes view, save .pptx that PowerPoint/LibreOffice open, with untouched slide XML preserved. If no candidate edits safely, build a minimal OOXML-preserving editor on top of the best renderer (edits limited to text runs, shape transforms and slide list).

### F6 HTML read-only viewer
`.html`/`.htm` documents shown in a sandboxed iframe (`sandbox` without `allow-scripts`, `allow-same-origin`, forms or popups), served by a dedicated scheme with `Content-Security-Policy: default-src 'none'; img-src data: <self scheme>; style-src 'unsafe-inline' <self scheme>` and nosniff; relative images inside the same imported file are not resolved (a single file only) unless embedded as data URLs. Toggle "Source" shows highlighted read-only source. Links open nothing by default; external links offer "Copy link".

### F7 Mermaid diagrams in notes
A `mermaid` code block (slash menu "Diagram", or a code block with language `mermaid`) renders the diagram below/instead of the code with Edit/Preview toggle, error message on invalid syntax, light/dark themes, `securityLevel: 'strict'`, no network. Works in note tabs and stickies, renders in Markdown export as a ```mermaid fence and in HTML/PDF export as SVG. Copy diagram as SVG/PNG.

### F8 Comments
Anchored comments for notes and documents, single user (no accounts): select text in a note (or a table cell) → "Comment" (bubble button, Ctrl+Alt+M) creates a highlighted `comment` mark referencing a thread; threads have replies, edit, delete, resolve/reopen. A comments sidebar lists open/resolved comments for the current item; clicking scrolls to the anchor. Documents: PDF comments as pdf.js-compatible popup/text annotations at a page position (so other readers see them) or app-side anchors; spreadsheet comments on cells (written as xlsx cell notes when supported); docx comments through the editor when it supports OOXML comments, otherwise app-side anchors by paragraph; pptx comments per slide (app-side). Storage: `comments(id, thread_id, target_kind 'note'|'document', target_id, anchor JSON, body, resolved_at, created_at, updated_at, deleted_at)`; anchors survive edits (block IDs for notes); orphaned anchors show "Text removed" with the quote. Locked notes: comments are encrypted with the note or disabled while locked (choose and document; no plaintext leak).

### F9 Links by key and shortcut
Typing `[[` in a note opens a link picker over notes and documents (fuzzy title search, path shown, create-new option); `Ctrl+K` with a selection links the selection; `Ctrl+Shift+L` opens the picker. Link targets: note, note heading/block, document, document page/slide/sheet where the viewer supports deep links. References are generalized to documents (`note_references` gains `target_document_id` or a new `item_references` table; migration in 011/012), backlinks panel lists notes linking to the current note or document, rename/move keeps links, missing targets show the existing missing state.

### F10 Project relation graph
A Graph page (rail entry and command palette, per project or all): nodes are notes and documents (shape/color by kind, size by degree), edges are references, document embeds/attachments and comments-with-links. Force layout (`d3-force` ISC or `cytoscape` MIT — both already transitive through mermaid), pan/zoom, search highlight, filter by project/folder/kind/tag, hover neighbor highlight, click opens the item, orphan toggle, local graph (current item, depth 1-3) in the note details drawer. Performance target: 2,000 nodes / 5,000 edges interactive.

### F11 Short extras (from research; each small)
1. Code syntax highlighting in code blocks (`@tiptap/extension-code-block-lowlight` + `lowlight`, MIT) with a language picker.
2. Math: inline `$…$` and block `$$…$$` with KaTeX (MIT), rendered in notes and exports.
3. Outline: a headings outline in the note details drawer with click-to-scroll.
4. Word and character count plus reading time in the note status area.
5. Export a note to PDF (Electron `printToPDF`, offline) and print.
6. Document text in global search (from F1's `documents_fts`) with kind icons.

### F12 Locked from creation, and locked stickies (user addition, 2026-10-10)
1. **Create locked.** "New locked note" and "New locked sticky" (new-item menu, tree context menu, palette, Home) ask for the password first (same rules as D-111: twice, 8+ characters, no-recovery tick, optional Windows Hello per D-113), then create the note already locked, so its content is never stored in plaintext, not even an empty first save, version or draft.
2. **Locked stickies.** This changes D-111's rule "a locked note never floats as a sticky": a locked note may float. A locked sticky shows its header (title, color, project label) and a fully blurred body with an unlock field.
   - Reveal with a **PIN** (4-8 digits, set when the sticky is locked or later in its menu) while the note's key is unlocked for the session, or with the password or Windows Hello. The PIN is a quick re-reveal only. On disk it is stored as a scrypt verifier (never wrapping the data key), so guessing it from the files reveals nothing. When the key is not in memory (after start, the auto-lock timeout, OS lock or suspend, Lock now), the password or Windows Hello is needed, and the dialog says so. PIN attempts have the same backoff; 5 wrong PINs in a row require the password.
   - **Blur after 1 minute.** A revealed locked sticky goes back to full blur 1 minute after the last interaction in it (typing, clicking, scrolling or hovering over its body). The setting "Blur locked stickies after" (30 s, 1, 2 or 5 minutes, default 1 minute) lives in Lock settings. It also blurs at once on OS lock or suspend, on "Lock now", and when the key is dropped. While blurred, the text is not in the DOM: it is unmounted, not just CSS-blurred, so the blur is not cosmetic. The blur is a styled placeholder (blurred lines or a frosted panel).
   - Live sync with an open tab keeps working while revealed. Reminders of a locked sticky keep the D-112 notification wording.
3. Docs: DECISIONS (amend D-111 scope rule by a new decision), USER_GUIDE, tests: unit for the PIN verifier and blur timer, integration for create-locked (no plaintext anywhere, including the FTS index and versions), E2E specs for the locked-sticky reveal → blur → PIN → password flows using the fake clock.

## License rule (user, 2026-10-10)
Everything used must be free for any use, including commercial use, at no cost: no paid, "pro", trial, per-seat or non-commercial-only licenses (e.g. Handsontable, AG Grid Enterprise, Highcharts, Nutrient/PSPDFKit, Apryse, Syncfusion, OnlyOffice/Univer pro features, CC-BY-NC). Allowed licenses as above.

## Run sequence

| Run | Scope | Agent |
| --- | --- | --- |
| 0 | F1 foundation + F6 HTML viewer + library spikes for F3/F4/F5 (decisions recorded) | infinity-code-opus |
| 1 | F2 PDF | infinity-code-opus |
| 2 | F3 Spreadsheets | infinity-code-opus |
| 3 | F4 DOCX | infinity-code-opus |
| 4 | F5 PPTX | infinity-code-opus |
| 5 | F7 Mermaid, F9 links, F11 extras | infinity-code-opus |
| 6 | F8 comments, F10 graph | infinity-code-opus |
| L | F12 locked from creation, locked stickies with PIN and 1-minute blur | infinity-code-opus |
| 7 | Full test gate (below), defect repairs, docs, website, CHANGELOG, version 0.3.0 | infinity-code-opus |
| A | Acceptance review; spot runs only where in doubt | infinity-acceptor |
| R | Repairs from acceptance, then release | infinity-code-opus / coordinator |

## Testing (end of implementation, without interrupting the user)

- Windows, no windows opened: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run check:traceability`, `npm run build`, `npm run package:win`.
- Linux in WSL as user `infinity` from `~/infinity-notes` (ext4 copy, own `node_modules`), **forced onto Xvfb** so nothing appears on the Windows desktop: `env -u DISPLAY -u WAYLAND_DISPLAY npm run test:e2e` (the runner wraps itself in `xvfb-run`), plus `npm run check`, `npm run package:linux`, packaged E2E under Xvfb. Native WSLg runs are not used in this release (they open windows on the desktop); recorded as not run.
- Windows Electron E2E (unpackaged and packaged) runs on GitHub Actions (`ci.yml` via `workflow_dispatch` on a pushed release branch, then the release workflow), not on this computer.
- New fixtures under `tests/fixtures/documents/` (small generated PDF, DOCX, PPTX, XLSX, CSV, HTML files created by scripts with the same permissive libraries, not copied from proprietary sources).
- Each feature gets E2E coverage: open, edit, save, reopen and verify bytes/content; trash/restore; search hit; link and backlink; comment create/resolve; graph renders and opens an item; HTML viewer blocks scripts and network.

## Release

After acceptance: version 0.3.0, CHANGELOG, USER_GUIDE, website (features, docs, screenshots taken under Xvfb), THIRD_PARTY_NOTICES; commit `Release v0.3.0: …`, push `master:main`, tag `v0.3.0`, watch the release and pages workflows (same permission as v0.1.0/v0.2.0; never force-push).

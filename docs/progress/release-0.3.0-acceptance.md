# Release 0.3.0 acceptance

Acceptor: infinity-acceptor (Opus, high effort), 2026-10-10. Branch `release/v0.3.0`, commit `8462d87` (diff `fb41102..8462d87`: 428 files, +41,468/-2,823). Fast-mode acceptance (CLAUDE.md): I reviewed the code and the logs, and spot-ran only the parts I had doubts about. Windows E2E is running separately on GitHub Actions (run 38059580351). I did not wait for it, and it is not part of this evidence.

## Verdict

**Accepted with follow-ups.** One must-fix item (M1, below) has to be repaired in Run R before the release is tagged. It is small and local. Re-checking it needs only the targeted integration test, not a new acceptance pass. The release-step items (R-1..R-3) are still open, and that is expected: the plan schedules them after acceptance.

Every feature the user asked for exists and works end to end. Nothing is a stub, and there are no TODO-only paths and no skipped, `.only` or `.fixme` tests. The 47 removed `expect` lines in the test diff are all contract updates (new `documents` counts, `trashedDocumentIds`, the bridge surface, menu entries, the D-111 sticky rule the user lifted). None was weakened. One (`/^Open report\.pdf/` with `toHaveCount(0)`) is now stricter.

## Requirement coverage (user requests, CLAUDE.md "v0.3.0 feature batch")

| Request | Status | Where (code / evidence) |
| --- | --- | --- |
| PDF viewer + editor | done | `src/renderer/documents/pdf/` (pdf.js 6.4 viewer, annotation editor, pdf-lib page ops); `pdf.spec`, `pdf-documents.test` |
| PPTX viewer + editor | done | `src/renderer/documents/pptx/` (pptx-glimpse SVG, OOXML layer that preserves parts); `pptx.spec`, `pptx-editor.test`, `pptx-documents.test` |
| DOCX viewer + editor | done | `src/renderer/documents/docx/` (@portone/docx-editor, docx-preview fallback); `docx.spec`, `docx-viewer.test` |
| Spreadsheet viewer + editor | done | FortuneSheet renderer + ExcelJS worker in main (`src/main/documents/spreadsheet/`); `spreadsheet.spec`, `workbook-*.test` |
| Mermaid in notes | done | `src/renderer/editor/diagram/` (strict, bounded, `data:` image); `mermaid.spec`, `code-diagram.test` |
| Read-only HTML viewer | done | `HtmlViewer.tsx` (`sandbox=""`), `infinity-html:` + `HTML_DOCUMENT_CSP`; `documents.spec` (spot-run, see below) |
| Comments on specific items | done | migration 013, `CommentService`, note marks, PDF/sheet/slide/paragraph/HTML-source anchors; `comments.spec`, `comments.test` |
| Links by key / shortcut | done | `[[`, Ctrl+Shift+L, Ctrl+Shift+K (Ctrl+K stays search, D-157); migration 012; `links.spec`, `document-links.test` |
| Project relation graph | done | `src/main/graph/`, `src/renderer/graph/` (d3-force, canvas, list view, local graph); `graph.spec`, `graph.test` |
| Short research extras | done | highlighting, KaTeX math, outline, counts, Export HTML/PDF and Print, document search; `extras.spec` |
| Note/sticky created locked | done | `LockService.create` + `HierarchyService.createNote(…, lockWith)` in one transaction, no plaintext row; `locked-stickies.test` › never stores the content in plaintext (spot-run E2E) |
| Locked sticky, PIN, 1-minute blur | done | `StickyLockService`, `sticky-gate.ts`, `pin-verifier.ts`, migration 014, unmounted blur panel; `locked-stickies.spec` (spot-run) |
| Free-for-any-use licenses | done | see License audit |
| No windows on the user's desktop | done | Run 7 logs: Windows ran only non-window gates; E2E ran in WSL under `xvfb-run` (`session=x11`, `DISPLAY=:99`) |

Recorded deviations, which I accept as follow-ups: PDF and spreadsheet comments are app-side only (the plan allowed this as the alternative); Word's own OOXML comments sit beside the app's paragraph threads (D-147); there is no per-kind print for documents (D-141); presentation mode is a window overlay without speaker notes.

## Findings by severity

### Medium

**M1. Print/Export as PDF writes a locked note's plaintext to disk in app data, and nothing cleans it up after a crash.** (Must fix before release.)
- `src/main/portability/note-document.ts:59` decrypts the note through the vault (`deps.vault.serialized(row)`).
- `src/main/windows/html-printer.ts:18-20` then writes the full HTML page to `data/export-tmp/<uuid>.html` (`src/main/index.ts:216`) and `loadFile`s it. The file is removed in `finally`, but no startup sweep covers `export-tmp/`: only `documents/tmp` and the attachment tmp are swept (`grep sweepStaleFiles`).
- Failure scenario: the user unlocks a locked note and chooses **Print note…**. While the system print dialog is open (the call waits for it), the plaintext note sits on disk at rest. If the app is killed, crashes or the machine loses power during the dialog, the file stays in `data/export-tmp/` forever. Even on the normal path, the deleted file's blocks still hold the plaintext. This breaks the locked-note promise ("content is encrypted at rest", D-111/D-171) on a path where the user never chose to write a file. For Export-as-PDF the output file is the user's own choice, but the temp copy in app data is not.
- Repair: serve the page from memory instead of a file. For example, a one-off handler on a private `session.fromPartition('print-…')` (`ses.protocol.handle`), still JavaScript off, never shown, under the page CSP. A `data:` URL does not work here: Chromium caps URLs at 2 MB and pages may embed up to 100 MB of images. Also sweep any leftover `data/export-tmp/*` at startup. Add an integration assertion that no file appears under `export-tmp` while a locked note is printed or exported.

### Low (acceptable follow-ups)

- **L1. A reused blob can be collected between `commit` and the row that uses it.** `src/main/documents/document-store.ts` `commit` returns an existing blob found by SHA-256 without clearing `unreferenced_since`. The document row is inserted only after text extraction, which awaits (the PDF worker can take up to 60 s). Scenario: a blob has been unreferenced for more than 7 days (its document was purged), and the same file is imported again just as maintenance runs `collect`. The blob row and file are deleted, and the insert then fails its FK, so the import or save errors out. No user data is lost, but it fails spuriously. Repair: set `unreferenced_since = NULL` inside `commit` when a blob is reused.
- **L2. Wall-clock assertion in the unit gate.** `tests/unit/graph.test.ts:95-108` requires one 2,000-node tick under 50 ms and each frame within budget + 5 ms. It failed once under parallel load in WSL (`run7-wsl-check.log`, 65 ms). GitHub-hosted runners are slower, so this can fail CI or the release workflow without any code defect. If run 38059580351 or the release run trips on it, move it to a perf-tagged or serial test with a CI-aware budget, and record that as a decision. Do not delete it.
- **L3. No zip bounds before the Word editor parses in the renderer.** `src/renderer/documents/docx/` hands bytes to `@portone/docx-editor` (fflate) without the renderer-side preflight that `pptx-package.ts` applies. Main checks `OOXML_LIMITS` (10,000 entries, 1 GiB declared total, ratio 200) at import, on open of linked files and on every save, so the remaining exposure is a lying-header zip exhausting the sandboxed renderer's memory (a DoS of that tab only). Follow-up: reuse the pptx `withinBounds` check for docx.
- **L4. FortuneSheet ships without a license file.** `THIRD_PARTY_NOTICES.md:651` says "No license file is included; its package.json declares MIT". That is acceptable, but add the upstream copyright line to `tools/vendored-licenses/`, as was done for xmldom and rtf.js.
- **L5. The plan named `enableScripting: false` / `isEvalSupported: false`.** pdf.js 6.4 has no `isEvalSupported`. Scripting stays off because `PDFViewer` gets no scripting manager, the sandbox bundle is not shipped, `externalLinkEnabled = false`, and the worker CSP blocks JS eval (D-128). I verified this in `pdf-session.ts:102-116` and `pdfjs.ts:37-49`. No action needed. It is noted because the plan's wording differs from the implementation.

### Checked and found sound (no action)

- **Protocols serve by ID only.** `document-protocol.ts:49-72` accepts only `<uuid>/` plus an optional `version=<uuid>`. The file always comes from the stored row through `DocumentFiles` (blob containment, `isUsableLinkPath`, regular file). Responses carry `nosniff`, `no-store`, `default-src 'none'`, and CORS for the renderer origin only. The HTML scheme serves the current HTML kind only, with no relative resources.
- **HTML sandbox and CSP.** The frame has `sandbox=""` (`HtmlViewer.tsx:170`). `HTML_DOCUMENT_CSP` allows no script and no network and includes the `sandbox` directive. `will-frame-navigate` allows only app-initiated `infinity-html:` (`web-policy.ts:168`). The only permission granted is `clipboard-sanitized-write`, to the app origin. `openExternal` refuses HTML.
- **CSP changes.** D-128 adds `'wasm-unsafe-eval'` only in `PDF_WORKER_CSP`, which is applied only under `pdfjs/` (`renderer-protocol.ts`). D-148 adds `img-src data:` page-wide, which is inert for SVG in `<img>`. Script, connect (`'self' infinity-document:`), frame and worker sources stay narrow. The chunk scan finds no `eval(`/`new Function(` except jszip's unreachable `setImmediate` string fallback in `DocxPreview` (blocked by CSP anyway). FortuneSheet's `new Function` is patched out at build time.
- **Untrusted Office/PDF input.** `isDocumentOfKind` checks content, never the name. There is a zip preflight, macro parts and macro content types are refused (`document-check.ts`), and the same check runs again on every save before the rename (`file-writes.ts`). Parsing runs in workers with heap limits and timeouts (`worker-task.ts`). The workbook model is Zod-validated again after the worker.
- **IPC.** All 30+ new channels have strict Zod schemas (`contracts/documents.ts`, `comments.ts`, `graph.ts`, `locks.ts`). Document, comment and graph channels are main-window only. Sticky windows get five lock channels. `gateStickyContent` (`sticky-gate.ts`) refuses every `STICKY_CONTENT_CHANNELS` call from a blurred locked sticky in main. Reveal, blur and activity are bound to `ctx.webContentsId`, not to request data (`lock-handlers.ts:39-48`, `ownWindow`).
- **Linked write-back.** Size and mtime must equal what was opened, otherwise CONFLICT. The previous bytes are kept as a version when they fit. Writes go to a temp file in the same folder, are checked, and are renamed; mode bits are kept and in-use files map to CONFLICT. Saves run one at a time per document (`KeyedQueue`), and the revision is checked twice.
- **Locks.** Create-locked inserts the row with null content and the sealed empty doc in the same transaction (`hierarchy-service.ts:189-198`, `lock-service.ts:233-253`). The PIN is a scrypt verifier with its own salt and bounded parameters, never derived from or wrapping the data key (`pin-verifier.ts`). PINs work only while the key is in memory. The shared backoff applies and five strikes require the password. Strikes clear on any `vault.put`, password unlock included. Comments are sealed with the note key and bound to note/id, guard triggers in 013 refuse plaintext, and `comments_fts` is optimized in the scrub. Portable export leaves out locked notes' comments. No password, PIN or comment text reaches any log line.
- **Data safety.** Migrations 011-014 are append-only. The checksums of 1-10 are unchanged, and STRICT tables have CHECKs, FKs and purge triggers. Backup format 2 adds document blobs (format 1 still accepted) and restore verifies the blob rows against the manifest. Portable export and import carry managed bytes, link records and remapped threads. Trash, restore and purge cover documents (purge deletes rows only, never a linked original), and blob GC uses the 7-day grace and is paused while busy.
- **Offline.** There are no CDN or font URLs in the chunks: the remaining URLs are documentation strings or namespaces. The network guard is unchanged.

## License audit

I scanned every `package-lock.json` entry that is new or changed against `fb41102` (220+ packages): MIT 162, ISC 35, BSD-3-Clause 9, Apache-2.0 7, 0BSD 1, Unlicense 1 (robust-predicates), MPL-2.0 1 (`@resvg/resvg-wasm`, unused and unmodified). Three needed a closer look and are fine:

- `jstat` is MIT through the legacy `licenses` field.
- `khroma` is MIT through its license file.
- `jszip` is "MIT OR GPL-3.0-or-later", taken under MIT. `pako` is "MIT AND Zlib".

The license files of `@portone/docx-editor` (Apache-2.0), pptx-glimpse and its packages, exceljs, docx-preview, mermaid and katex were all read. There is nothing GPL-only, AGPL, EPL, non-commercial, "pro" or unlicensed: mermaid 12 was rejected because it pulls in elkjs (EPL-2.0), and SheetJS Pro, Univer, Handsontable and similar were rejected by the spikes. `THIRD_PARTY_NOTICES.md` is up to date (`--check` re-run). `npm audit` shows only the 8 moderate findings already known in the build-time electron-builder chain.

## Logs reviewed (`.infinity-work/logs/release-0.3.0/`)

- `run7-e2e-full-3.log`: 291 passed, 2 skipped (Windows-only tray cases), EXIT 0.
- `run7-e2e-packaged.log`: 8 passed, renderer and sticky sandbox `mode=user-namespace`.
- `run7-win-check-final.log`: unit 135 files / 1,069 passed, integration 573 passed + 2 pre-existing skips, traceability fails=0.
- `run7-wsl-check-final.log`: integration 575 passed, traceability fails=0.
- `run7-win-build-final.log`: build plus notices up to date.
- `run7-linux-package.log`: .deb and AppImage, still versioned 0.2.0.
- `run7-win-audit.log`: the 8 known moderates.
- Runs 0-6 and L gate logs: lint, typecheck, unit, integration, traceability and build each passed per run.

## Spot runs by the acceptor

| Where | Command | Result |
| --- | --- | --- |
| Windows (no window) | `npx vitest run` on 11 files: integration `locked-stickies`, `comments`, `document-protocol`, `documents`, `locks`, `migrations`, `document-portability`, `ipc-handlers-documents`; unit `csp`, `sticky-locks`, `document-check` | 11 files, 139 tests passed |
| Windows (no window) | `npm run lint`, `npm run typecheck`, `node tools/third-party-notices.mjs --check` | pass, 0 warnings; notices up to date |
| Windows | scan of `out/renderer/assets/*.js` for `eval(`/`new Function(` and CDN hosts | only the jszip fallback in `DocxPreview` (see above); no CDN or font hosts |
| Windows | license scan of the lockfile diff (node script) | see License audit |
| WSL (`~/infinity-notes`, user `infinity`), Xvfb | `env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE npm run test:e2e -- tests/e2e/locked-stickies.spec.ts tests/e2e/documents.spec.ts` | build, then 8 passed (17.1 s): HTML sandbox/no script/no network; create-locked with no plaintext; blur after a minute → PIN → password after Lock now; five wrong PINs require the password |

Before the WSL run I compared SHA-1 hashes of `sticky-locks.ts`, `document-protocol.ts`, `HtmlViewer.tsx` and `locked-stickies.spec.ts` with the Windows tree, and they matched. No window opened on the Windows desktop and WSLg was not used.

Not run by me: the full E2E suite (Run 7 ran it three times, and its logs back that up), Windows E2E (on GitHub Actions), native WSLg, Windows Hello prompts, the real print dialog.

## Must be repaired before release (Run R)

1. **M1:** Print/Export-PDF must not write a locked note's plaintext to `data/export-tmp/`. Serve the page from memory, sweep `export-tmp` at startup, and add an integration assertion. Re-run `note-documents.test` plus lint and typecheck.

Release-step items the plan schedules after acceptance (also required before tagging):

- **R-1:** `package.json` version 0.3.0 (still 0.2.0), then rebuild the packages.
- **R-2:** a `CHANGELOG.md` 0.3.0 entry (none yet) and the website feature/docs pages updated for 0.3.0 (`website/` was last changed in v0.2.0).
- **R-3:** confirm that GitHub Actions run 38059580351 (Windows E2E, unpackaged and packaged) is green before tagging. If `graph.test`'s timing assertion fails there, handle it as described in L2.

## Acceptable follow-ups (after 0.3.0)

- L1: clear `unreferenced_since` when a blob is reused.
- L2: CI-aware graph perf test, if needed.
- L3: renderer zip preflight for docx.
- L4: FortuneSheet copyright text in notices.
- The recorded deviations: app-side PDF and sheet comments, per-kind document print, speaker notes in presentation mode, lazy highlight.js grammars (main chunk 1,525 kB).

## Re-check after Run R (coordinator, 2026-10-10)

- M1 fixed (D-176): print and PDF export are served from memory; `export-tmp` swept at startup; integration and E2E tests prove no plaintext file is written.
- CI: run 38062233684 on `release/v0.3.0` passed on windows-2025 and ubuntu-24.04 (check, build, native self-test, full E2E, packaging, packaged self-test and packaged E2E). The three Windows-only E2E failures of run 38059580351 are fixed (D-181); the graph timing test is deterministic (D-177).
- Follow-ups L1, L3 and L4 fixed (D-178..D-180). Remaining recorded deviations are listed in the CHANGELOG known limitations.
- Verdict: accepted for release v0.3.0.

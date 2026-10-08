# Phase 03 plan: Rich notes, plain text and image paste

Planner: infinity-planner (Opus 5.5, high), 2026-10-08. Implementer: infinity-code-medium (Sonnet 5.5, medium), one agent at a time, resumable at every checkpoint in section 14. QA: infinity-qa. Acceptance: infinity-acceptor.

Phase contract: `infinity-notes-claude-pack/phases/03-rich-notes-plain-text-and-image-paste.md`. Requirement IDs (23): INF-TABS-07, INF-KEY-04, INF-EDIT-01 to INF-EDIT-14, INF-SAVE-01 to INF-SAVE-06, INF-SEC-01. Decisions added by this plan: D-051 to D-058 (`docs/DECISIONS.md`).

Acceptance to demonstrate (phase file): formatting and images survive restart offline; the original image file may be removed; Unicode text stays intact; unsafe HTML cannot execute; rename and tab close flush; competing save revisions cannot erase work; duplicated and pasted blocks get new IDs; plain-text conversion has a restorable source; one real note edit, paste and reload E2E flow (`tests/e2e/editor-flow.spec.ts`).

---

## 1. Inputs read and actual repository state

Read: root `CLAUDE.md`; pack `PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `TEST_MATRIX.md` (Editor and Persistence rows), phase 03 file; `docs/PRODUCT_SPEC.md`, `UX_SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md` (to D-050), `BACKLOG.md`; `docs/progress/phase-01-acceptance.md`, `phase-02.md`, `phase-02-qa.md`, `phase-02-acceptance.md`; `docs/plans/phase-02.md`; the code listed below.

Actual state at commit `1dda11f` (Phase 02 accepted):

- Main: `NoteWriter` (`src/main/services/note-writer.ts`) does lease check, revision check, `note_drafts` on stale/trashed/lease-lost, ack cache by `requestId` (successes only), `extractPlainText`, FTS through triggers. It does not validate rich content, does not link attachments, writes no versions and its `emit` is a no-op in `index.ts`. `LeaseManager` has `acquire/release/take/verify/webContentsDestroyed`; `requestRelease` is a no-op in `index.ts`. `NoteReader.open` returns content. `createAttachmentHandler` serves image rows by UUID with containment by `path.resolve` only (no realpath). `index.ts` has no window-close or quit flush.
- IPC: catalogue in `src/shared/contracts/channel-names.ts` (31 invoke channels, events `settings:changed`, `tree:changed`); router measures every payload with `JSON.stringify` (unusable for binary payloads); `CHANNEL_SCHEMAS` in `channels.ts`; frozen preload bridge; `security.spec › bridge surface` asserts the exact key set; `boundaries.test` and `contracts.test` assert that the Phase 03 names `lease:take`, `note:revision`, `note:lease`, `lease:release-request`, `note:convertFormat` are absent.
- Renderer: `NoteController` maps a textarea string to paragraphs (`textToDoc`); documents with other node types open read-only (`isTextareaCompatible`, `READONLY_FORMAT`); `TempTextEditor` is a textarea labelled "Note text". `TabsStore.closeNoteTabs` disposes with `{flush:false}` (F-02-1). `TabPanel` mounts only the active `NoteView`.
- Data: migrations 001-003 (`LATEST = 3`). `note_versions`, `note_drafts`, `attachments`, `note_attachments` exist in 001 and are unused.
- Dependencies: every Phase 03 package is already installed at its pin: `@tiptap/{core,react,pm,starter-kit,extension-list,extension-unique-id,extension-image,extensions}` 3.31.4, `dompurify` 3.4.16 (devDependencies, bundled into the renderer by Vite). `npm view` on 2026-10-08: `@tiptap/core` latest 3.31.4 (MIT), `dompurify` latest 3.4.16, `@tiptap/extension-unique-id` depends on `uuid ^14`, `@tiptap/extension-link` on `linkifyjs ^4.3.3`; both are in the lockfile.
- Tests: `tests/e2e/{editor,tabs,visual,keyboard,note-live,home}.spec.ts` use the textarea (`getByLabel('Note text')` with `toHaveValue`) and `seed.saveText` (a separate `viewId` in the same document that acquires, saves and releases).
- Host note: 24 `electron.exe` processes from `E:\notecapt\node_modules\electron\dist` started 15:48-16:24 on 2026-10-08 (before this plan) are still running. The planner did not touch them. The coordinator may close them before the Windows gates; they hold no lock on fresh temp userData.

### 1.1 Planner probes (logs in `.infinity-work/logs/phase-03/`, sources in `.infinity-work/probes/phase-03/`)

| Probe | Result |
| --- | --- |
| `planner-probe-clipboard-win.log` (Windows 11), `-wslg.log` (WSLg 1.0.73, ozone x11), `-xvfb.log` (Xvfb `:99`, ozone x11) | Electron 44.7.0 has no `clipboard.writeImage`/`readImage`; the API is async: `await clipboard.write([new ClipboardItem({'image/png': new Blob([png],{type:'image/png'})})])`, `await clipboard.has('image/png')`. After seeding from main, both `webContents.paste()` and a synthesized Ctrl+V delivered a paste event to a sandboxed, context-isolated page with one `image/png` File (`image.png`) for the bitmap, or `text/html` plus `text/plain` for HTML, on all three hosts. A `Uint8Array` passed through `contextBridge` and `ipcRenderer.invoke` arrived in main as `Uint8Array` with the PNG magic. `DataTransfer.files` read after the first `await` in the handler was empty, so files must be captured synchronously. |
| `planner-probe-tiptap.log` (Node 24.15 + jsdom 30.1.2, Tiptap 3.31.4) | UniqueID assigns missing IDs in a create-time transaction (`addToHistory:false`, fires `onUpdate`); a split gives the new paragraph a new ID and the original keeps its ID; inserting a copy of an existing block keeps the duplicate ID (gap); `view.pasteHTML` without a DOM paste event keeps foreign IDs; the stock Image extension turns `<img src="http://...">` into a node with a remote `src`; `<script>` and `onerror` are dropped by the schema; Link with an http/https-only `isAllowedUri` drops `javascript:`; `setContent` is undoable. jsdom has no `ClipboardEvent`; `view.pasteHTML(html, new window.Event('paste'))` works. |

These results are recorded in D-053 and D-054.

## 2. Follow-ups incorporated

| ID | Item | Where in this plan |
| --- | --- | --- |
| F-02-1 (mandatory entry) | `closeNoteTabs` must flush, so main stores the `trashed` conflict draft; show the recovered-draft notice; regression test asserting a `note_drafts` row | Step S1 (section 10.2), tests U `tabs-store.test`, E `conflict.spec › trashed while editing keeps a draft` |
| F-02-2 | Migration allocation docs | Done by the planner in this commit: ARCHITECTURE section 3, D-044 status, new D-051, BACKLOG W02-02/W04-01/W05-01/W06-02/W07-01. Traceability re-run: `fails=0` |
| F-02-3 | `tabs.spec` non-polling reads to `expect.poll`/`toHaveText`; no retries | Step S1 (section 12.5) |
| F-02-4 | Regenerate Windows screenshots on the current tree | Step S7 visual run to `.infinity-work/logs/phase-03/screens/win/` (all Phase 02 and new cases) |
| F-01-3 | Dedupe drafts when a conflicted save is retried with the same `requestId` | Step S1 (section 8.1), integration `revision.test › retried conflict reuses the draft` |
| F-01-2 | Attachment handler realpath containment | Lands early because Phase 03 is the first writer of attachments (D-054). Step S3, integration `protocol.test › junction or symlink escape refused` |
| Phase 00 F-1 | Each ID restated as explicit assertions | Section 12.1 |
| D-048 gap | Flush on window close and quit | `FlushCoordinator` (section 8.8), E `editor.spec › flush on window close`, `› flush on quit` |

## 3. Ownership, order and file boundaries

### 3.1 Rules

- One implementer (MEDIUM) owns every path below for the whole phase. Work strictly in the step order of section 14; every step ends green (its gate) and with a checkpoint line in `docs/progress/phase-03.md`, so a resumed agent starts at the first step without a checkpoint.
- No dependency changes: `package.json` and `package-lock.json` stay byte-identical (gate `git diff --exit-code`).
- Never weaken an existing assertion. Specs that used the textarea are updated to the editor with equal or stronger checks (section 12.5). `retries: 0` stays. No `.only`, no new `.skip` except an explicit platform condition with a recorded reason.
- Accepted migrations are never edited; no new migration (D-051).
- Product code never forces an ozone platform, never calls `win.focus()`/`show()` as a test workaround, never disables the sandbox.

### 3.2 Files created (C), modified (M), deleted (D)

Shared (pure, unit tested, importable by main and renderer; no Node or DOM APIs):

| Path | C/M | Content |
| --- | --- | --- |
| `src/shared/editor/doc-schema.ts` | C | `normalizeRichDoc(doc): RichDocLike` (throws `DocSchemaError`), `collectAttachmentRefs(doc): {attachmentId, blockId}[]`, constants `BLOCK_ID_TYPES`, `RICH_NODE_TYPES`, `RICH_MARK_TYPES`, `IMAGE_SIZES` (section 9.1) |
| `src/shared/text/plain-text.ts` | M | Add `fileAttachment` (its `name` as its own line), `image` (no text), `horizontalRule` (block break) |
| `src/shared/text/textarea-doc.ts` | M | `textToDoc(text, opts?: {id?: () => string})`; S6 deletes `isTextareaCompatible` |
| `src/shared/attachments/sniff.ts` | C | `sniffImage(bytes): {ok:true, mime, ext, width, height} \| {ok:false, reason:'unsupported'\|'truncated'\|'tooManyPixels'}` |
| `src/shared/attachments/limits.ts` | C | Defaults (20/50 MB, ranges), `MAX_MEGAPIXELS = 100`, `MAX_FILES_PER_ACTION = 20`, `IMPORT_CONCURRENCY = 2`, `IMPORT_WAIT_ON_FLUSH_MS = 10000`, exact message builders (section 9.8) |
| `src/shared/attachments/names.ts` | C | `sanitizeOriginalName`, `extensionFor(name)`, `documentMime(ext)`, `formatBytes(n)` |
| `src/shared/url-policy.ts` | C | `parseExternalUrl(raw): {ok:true, href} \| {ok:false}`: http/https only, no username/password, host required, at most 2048 characters |
| `src/shared/versions/retention.ts` | C | `AUTO_VERSION_INTERVAL_MS = 600000`, `AUTO_VERSION_MAX_AGE_MS = 30 days`, `AUTO_VERSION_MAX_COUNT = 100`, `selectAutoVersionsToPrune(rows, now)` |
| `src/shared/contracts/notes.ts` | M | Section 6.1 |
| `src/shared/contracts/attachments.ts` | C | Section 6.1 |
| `src/shared/contracts/hierarchy.ts` | M | `NoteCreateRequest.format` optional |
| `src/shared/contracts/app.ts` | M | `AppFlushedRequest`, `AppFlushRequestEvent`, `ShellOpenExternalRequest/Response` |
| `src/shared/contracts/settings.ts` | M | Keys `attachments.imageMaxMb`, `attachments.documentMaxMb` (section 7) |
| `src/shared/contracts/{channel-names,channels,bridge}.ts` | M | Section 6 |

Main:

| Path | C/M | Content |
| --- | --- | --- |
| `src/main/services/content-indexer.ts` | C | Section 8.2 |
| `src/main/services/note-content.ts` | C | `writeNoteContent(tx args)`: the one place that updates `notes` content, plain text (FTS via triggers), revision and links (section 8.3) |
| `src/main/services/note-writer.ts` | M | Normalize, index, auto version, F-01-3 conflict cache, `faults` seam (section 8.1) |
| `src/main/services/version-service.ts` | C | Section 8.4 |
| `src/main/services/draft-service.ts` | C | Section 8.5 |
| `src/main/services/format-service.ts` | C | Section 8.6 |
| `src/main/services/attachment-service.ts` | C | Section 8.7 |
| `src/main/services/dialog-adapter.ts` | C | `DialogAdapter.showOpenFiles({windowId, kind})`; real implementation uses `dialog.showOpenDialog` |
| `src/main/services/shell-adapter.ts` | M | Add `openExternal(url): Promise<void>` |
| `src/main/services/lease-manager.ts` | M | `webContentsReset(wcId)` (section 8.9) |
| `src/main/services/flush-coordinator.ts` | C | Section 8.8 |
| `src/main/windows/attachment-protocol.ts` | M | realpath and symlink checks (F-01-2) |
| `src/main/windows/main-window.ts` | M | Options `onCloseRequest`, `onRendererGone`, `onNavigated` (no service imports) |
| `src/main/windows/window-registry.ts` | M | `get(webContentsId)` |
| `src/main/ipc/event-bus.ts` | M | `sendTo(webContentsId, channel, payload)` |
| `src/main/ipc/router.ts` | M | Optional `measurePayload(payload): number` on `HandlerDef` |
| `src/main/ipc/handlers/note-handlers.ts` | M | `lease:take`, `note:convertFormat` |
| `src/main/ipc/handlers/content-handlers.ts` | C | `versions:list|restore`, `drafts:list|resolve` |
| `src/main/ipc/handlers/attachment-handlers.ts` | C | `attachment:importBytes|importFromDialog` |
| `src/main/ipc/handlers/app-handlers.ts` | M | `app:flushed`, `shell:openExternal` |
| `src/main/ipc/handlers/hierarchy-handlers.ts`, `services/hierarchy-service.ts`, `db/repositories/notes-repo.ts` | M | `note:create` with `format` |
| `src/main/index.ts` | M | Wiring (section 8.10) |
| `src/main/test-hooks.ts` | M | Section 8.11 |

Preload: `src/preload/index.ts` (M): new namespaces and methods, still frozen at every level, no generic invoke.

Renderer:

| Path | C/M/D | Content |
| --- | --- | --- |
| `src/renderer/editor/extensions.ts` | C | `richExtensions(deps)`, `plainExtensions(deps)` (section 9.1) |
| `src/renderer/editor/block-id-guard.ts` | C | Section 9.2 |
| `src/renderer/editor/managed-image.ts`, `ImageView.tsx` | C | Section 9.3 |
| `src/renderer/editor/file-attachment.ts`, `FileChipView.tsx` | C | Section 9.3 |
| `src/renderer/editor/task-toggle.ts` | C | Ctrl+Enter toggles `taskItem.checked` |
| `src/renderer/editor/sanitize.ts` | C | Section 9.4 |
| `src/renderer/editor/paste.ts` | C | `createPasteProps(deps)`: `handlePaste`, `handleDrop`, `transformPastedHTML` (section 9.4) |
| `src/renderer/editor/uploader.ts` | C | `AttachmentUploader` (section 9.5) |
| `src/renderer/editor/content.ts` | C | `toSavable(json)`, `isUserEdit(tr)`, meta keys |
| `src/renderer/editor/find.ts`, `find-core.ts`, `FindBar.tsx` | C | Section 9.6 |
| `src/renderer/editor/link.ts`, `LinkDialog.tsx`, `LinkBar.tsx` | C | Section 9.7 |
| `src/renderer/editor/Toolbar.tsx` | C | Section 9.9 |
| `src/renderer/editor/NoteEditor.tsx` | C | Section 9.10 |
| `src/renderer/editor/editor-registry.ts` | C | Live editor count, `document.documentElement.dataset.liveEditors` |
| `src/renderer/styles/editor.css` | C | Section 9.11; imported in `main.tsx` |
| `src/renderer/notes/note-controller.ts` | M (rewrite) | Section 10.1 |
| `src/renderer/notes/NoteView.tsx` | M | Section 10.4 |
| `src/renderer/notes/NoteBanners.tsx`, `CompareDialog.tsx`, `VersionsDialog.tsx`, `ConvertDialog.tsx` | C | Section 10.4 |
| `src/renderer/notes/TempTextEditor.tsx` | D | Replaced (D-053) |
| `src/renderer/state/tabs-store.ts` | M | F-02-1 and failure rule (section 10.2) |
| `src/renderer/state/app-services.ts` | M | Events, settings keys, editor settings store (section 10.3) |
| `src/renderer/state/{commands,shortcuts,palette-actions,ui-store,tree-store,notice-store}.ts` | M | `note.find`, `note.newPlain`, Ctrl+F, focus request `noteFind`, `createNote` format, notice copy helpers |
| `src/renderer/tabs/TabPanel.tsx` | M only if needed | Keep: only the active `NoteView` mounts |

Tests: section 12. Tools: none changed. Docs: `docs/progress/phase-03.md`, `docs/BACKLOG.md` (Status and Planned tests columns only).

## 4. Dependencies

No additions, removals or version changes. Everything needed is already pinned and installed (section 1). Explicitly not added: `@tiptap/extension-bubble-menu`/`floating-menu` (would need `@floating-ui`), lowlight or any syntax highlighter, any table extension, any Pro or cloud package, any image-processing library (dimensions come from header sniffing; Chromium decodes). `uuid` arrives transitively with UniqueID; the app passes its own `generateID` (`crypto.randomUUID`).

## 5. Migrations

None (D-051). `LATEST` stays 3; smoke and packaged specs keep `schemaVersion 3`; `migrations-checksum.test` unchanged. Used existing tables: `note_versions` (reasons `auto|conversion|conflict|restore`), `note_drafts` (`conflict|lease_lost`, `resolved_at`), `attachments` (`kind image|document`, `unreferenced_since`), `note_attachments(note_id, attachment_id, block_id)`.

## 6. Contracts and IPC (D-052)

### 6.1 Schemas (Zod 4, strict objects; `Uuid` from `ids.ts`)

`notes.ts` additions and changes:

```ts
ConflictDetails = strictObject({ currentRevision, draftId: Uuid.optional(), reason: enum(['stale','trashed']) })   // draftId optional: content operations store no draft
ContentOpBase = { noteId: Uuid, viewId: Uuid, leaseToken: Uuid, baseRevision: int>=0, requestId: Uuid }
NoteConvertRequest = strictObject({ ...ContentOpBase, targetFormat: enum(['rich','plain']), confirmLossy: literal(true).optional() })
  .superRefine(targetFormat === 'plain' requires confirmLossy === true)
NoteContentResponse = strictObject({ noteId, revision, format, content: union([RichDoc, string]), versionId: Uuid.nullable(), updatedAt: int })
VersionReason = enum(['auto','conversion','conflict','restore','import'])
VersionSummary = strictObject({ id, revision, format, reason: VersionReason, createdAt: int, preview: string.max(200), attachmentCount: int>=0 })
VersionsListRequest = strictObject({ noteId, limit: int 1..200 optional })        // default 100
VersionsListResponse = strictObject({ versions: array(VersionSummary) })
VersionsRestoreRequest = strictObject({ ...ContentOpBase, versionId: Uuid })      // -> NoteContentResponse
DraftSummary = strictObject({ id, reason: enum(['conflict','lease_lost']), baseRevision, format, title: string.nullable(), createdAt, plainText: string.max(20000), truncated: boolean })
DraftsListRequest = strictObject({ noteId }); DraftsListResponse = strictObject({ drafts: array(DraftSummary).max(20) })
DraftsResolveRequest = discriminatedUnion('action', [
  strictObject({ action: literal('restore'), ...ContentOpBase, draftId: Uuid }),
  strictObject({ action: literal('dismiss'), noteId: Uuid, draftId: Uuid }) ])
DraftsResolveResponse = strictObject({ resolved: literal(true), content: NoteContentResponse.nullable() })   // null for dismiss
AppFlushRequestEvent = strictObject({ flushId: Uuid })
```

`attachments.ts`:

```ts
AttachmentKind = enum(['image','document'])
AttachmentDto = strictObject({ id, kind, mime: string.max(100), sizeBytes: int>=0, originalName: string.max(255).nullable(), width: int>=1 nullable, height: int>=1 nullable })
Bytes = custom<Uint8Array>(v => v instanceof Uint8Array && v.byteLength >= 1)
AttachmentImportBytesRequest = strictObject({ kind: AttachmentKind, originalName: string.max(255).optional(), bytes: Bytes })
AttachmentImportBytesResponse = strictObject({ attachment: AttachmentDto })
AttachmentImportDialogRequest = strictObject({ kind: AttachmentKind })
AttachmentImportDialogResponse = strictObject({ canceled: boolean, imported: array(AttachmentDto).max(20), rejected: array(strictObject({ name: string.max(255), code: string, message: string })).max(100) })
```

`app.ts`: `AppFlushedRequest = strictObject({ flushId: Uuid })` (response `Empty`); `ShellOpenExternalRequest = strictObject({ url: string.min(1).max(2048) })`, response `strictObject({ opened: literal(true) })`.

`hierarchy.ts`: `NoteCreateRequest = strictObject({ location, sticky, title?, format: enum(['rich','plain']).optional() })`. A plain note is created with `content_text = ''`, `content_json = NULL`.

`NoteSaveRequest` is unchanged; main now normalizes rich content (section 8.1).

### 6.2 Channels added in Phase 03 (INVOKE_CHANNELS order appended)

| Channel | Request | Response | Errors |
| --- | --- | --- | --- |
| `lease:take` | `LeaseTakeRequest` | `LeaseTakeResponse` | `CONFLICT` (transfer in progress or requester closed), `FORBIDDEN` |
| `note:convertFormat` | `NoteConvertRequest` | `NoteContentResponse` | `LEASE_REQUIRED`, `CONFLICT {currentRevision, reason:'stale'}`, `NOT_FOUND`, `VALIDATION_FAILED` |
| `versions:list` | `VersionsListRequest` | `VersionsListResponse` | `NOT_FOUND` |
| `versions:restore` | `VersionsRestoreRequest` | `NoteContentResponse` | as convert |
| `drafts:list` | `DraftsListRequest` | `DraftsListResponse` | `NOT_FOUND` |
| `drafts:resolve` | `DraftsResolveRequest` | `DraftsResolveResponse` | restore: as convert; both: `NOT_FOUND` for an unknown or already resolved draft of that note |
| `attachment:importBytes` | `AttachmentImportBytesRequest` | `AttachmentImportBytesResponse` | `LIMIT_EXCEEDED`, `UNSUPPORTED`, `VALIDATION_FAILED`, `INTERNAL` |
| `attachment:importFromDialog` | `AttachmentImportDialogRequest` | `AttachmentImportDialogResponse` | `INTERNAL` (per-file problems go to `rejected`) |
| `shell:openExternal` | `ShellOpenExternalRequest` | `{opened:true}` | `FORBIDDEN` "This link cannot be opened" |
| `app:flushed` | `AppFlushedRequest` | `Empty` | `VALIDATION_FAILED` for an unknown flush or a wrong sender |

Payload limits: default 5 MiB JSON. `attachment:importBytes` registers `measurePayload = p => (p?.bytes instanceof Uint8Array ? p.bytes.byteLength : 0) + byteLength(JSON.stringify({...p, bytes: null}))` (a `JSON.stringify` throw gives `VALIDATION_FAILED`) and `maxPayloadBytes = 200 MiB + 64 KiB`; the service enforces the configured limit. `note:save` keeps `MAX_CONTENT_BYTES + 65536`.

Events (EVENT_CHANNELS): `note:revision` and `note:lease` (broadcast to every registered window), `lease:release-request {noteId}` and `app:flush-request {flushId}` (sent with `eventBus.sendTo` to one `webContents`). `note:trashed` is Phase 04 (D-052).

### 6.3 Bridge (`window.infinity`, frozen)

```
app{getInfo, quit, showDataFolder, flushed}   attachment{importBytes, importFromDialog}   capabilities{get}
drafts{list, resolve}   folder{...}   home{summary}   item{setFavorite}   lease{acquire, release, take}
note{create, move, open, rename, save, setPinned, trash, convertFormat}   palette{searchTitles}   project{...}
session{get, set}   settings{get, set}   shell{openExternal}   trash{...}   tree{list}   versions{list, restore}
subscribe('settings:changed'|'tree:changed'|'note:revision'|'note:lease'|'lease:release-request'|'app:flush-request', cb)
```

## 7. Settings registry

Add public keys (version 1): `attachments.imageMaxMb` (`z.number().int().min(1).max(100)`, default 20) and `attachments.documentMaxMb` (`int 1..200`, default 50). They are public so Phase 08 adds only UI (INF-PREF-05). The renderer reads them at init and follows `settings:changed`. A fresh launch still writes no settings row (existing `security.spec` assertion).

## 8. Main services

### 8.1 `NoteWriter.save` (order matters; INF-SAVE-01..03, F-01-3)

1. Serialize; over `MAX_CONTENT_BYTES` gives `LIMIT_EXCEEDED` "This note is too large to save (over 5 MB). Remove some content to keep editing safely." (nothing stored).
2. Test fault seam (`faults?.beforeSave()`, installed only by test hooks) may throw `INTERNAL`.
3. Lease verify: `forbidden` gives `FORBIDDEN`. `lost`: if `conflicts.get(noteId, requestId)` exists rethrow that same error; else insert a `lease_lost` draft, cache `{code:'LEASE_REQUIRED', details:{draftId}}`, throw.
4. `acks.get(noteId, requestId)` returns the cached ack.
5. `conflicts.get(noteId, requestId)` rethrows the cached `CONFLICT` (same `draftId`); no second draft (F-01-3).
6. Rich: `normalizeRichDoc(content)`; `DocSchemaError` gives `VALIDATION_FAILED` "This note contains content that cannot be saved" (nothing stored). Plain: the string as is.
7. `BEGIN IMMEDIATE`: read `format, revision, deleted_at, content_json, content_text`. Trashed: draft `conflict`, result `CONFLICT {reason:'trashed', draftId}`. Stale: draft `conflict`, `CONFLICT {reason:'stale', draftId}`. Format mismatch: `VALIDATION_FAILED`. Otherwise `versions.maybeAuto(row, now)`, then `writeNoteContent({noteId, format, content: normalized, title: req.title ?? null, expectedRevision: row.revision, now})`.
8. Commit; cache ack (last 100 per note) or conflict (last 100 per note); emit `note:revision {noteId, revision, sourceViewId: viewId}` only on success.

The conflict cache is an in-memory `Map<noteId, Map<requestId, AppError>>` with the same 100-entry bound as the ack cache.

### 8.2 `ContentIndexer.index(noteId, format, content, now)` (inside the caller's transaction)

- `plainText = extractPlainText(format, content)`.
- `refs = format === 'rich' ? collectAttachmentRefs(content) : []`, deduplicated by `(attachmentId, blockId)`.
- Keep refs whose `attachmentId` exists in `attachments` (chunks of 500 in `IN (...)`); log a warning count for unknown IDs (the node stays; the protocol answers 404 and the view shows "Image unavailable").
- `DELETE FROM note_attachments WHERE note_id = ?`; insert the kept refs.
- `UPDATE attachments SET unreferenced_since = NULL WHERE id IN (kept)`.
- For IDs that were linked before this write and are no longer linked by any note: `UPDATE attachments SET unreferenced_since = ? WHERE id = ? AND unreferenced_since IS NULL AND NOT EXISTS (SELECT 1 FROM note_attachments WHERE attachment_id = attachments.id)`.
- Returns `{plainText, attachmentIds}`. Phase 07 adds reference extraction here.

### 8.3 `writeNoteContent` (single writer of note content)

`UPDATE notes SET format = ?, content_json = ?, content_text = ?, plain_text = ?, title = COALESCE(?, title), revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`; 0 changed rows throws (caller already checked; this is a guard). Calls the indexer first so a failure aborts the whole transaction. Returns `{revision, updatedAt}`. Used by `NoteWriter`, `FormatService`, `VersionService.restore`, `DraftService.restore`.

### 8.4 `VersionService` (D-056, INF-SAVE-06)

- `snapshot(row, reason, now)`: insert `note_versions(id, note_id, revision = row.revision, format, content_snapshot, attachment_ids = JSON of collectAttachmentRefs ids, reason, created_at)`.
- `maybeAuto(row, now)`: when `row.revision >= 1`, the stored content has non-empty plain text or at least one attachment, and no `auto` version of this note has `created_at > now - AUTO_VERSION_INTERVAL_MS`: snapshot `auto`, then prune that note's `auto` versions per `selectAutoVersionsToPrune` (older than 30 days, or beyond the newest 100).
- `list(noteId, limit=100)`: newest first; `preview` is the first 200 characters of `extractPlainText` of the snapshot; `attachmentCount` from `attachment_ids`.
- `restore(req, ctx)`: content-op guard (section 8.6), snapshot current content `restore`, write the version's format and content (rich content re-normalized), return `NoteContentResponse` with `versionId` = the new `restore` snapshot ID. Title unchanged.

### 8.5 `DraftService`

- `list(noteId)`: unresolved drafts, newest first, at most 20; `plainText` = `extractPlainText(draft.format, parsed content)` truncated to 20,000 characters with `truncated`.
- `restore(req)`: content-op guard; the draft must belong to the note and be unresolved; snapshot current content `conflict`; write the draft's format and content (rich re-normalized; a draft that fails normalization gives `VALIDATION_FAILED` and is left unresolved); apply `draft.title` if not null; set `resolved_at = now`; return `NoteContentResponse`.
- `dismiss({noteId, draftId})`: sets `resolved_at`; no lease needed. Rows are never deleted in Phase 03 (Phase 08 retention and GC).

### 8.6 `FormatService.convert` and the content-op guard

Guard for convert, version restore and draft restore (all inside `BEGIN IMMEDIATE`): lease `verify` must be `ok` (`lost` gives `LEASE_REQUIRED` without a draft, since no user content was submitted; `forbidden` gives `FORBIDDEN`); note exists and is live (`NOT_FOUND`, trashed `NOT_FOUND` with the trashed details); `baseRevision == revision` else `CONFLICT {currentRevision, reason:'stale'}`. Results are cached by `(noteId, requestId)` like acks.

Convert:
- `rich -> plain` requires `confirmLossy: true` (schema). Snapshot `conversion` (rich content and its attachment IDs). New content = `extractPlainText('rich', doc)`. `note_attachments` for the note become empty through the indexer.
- `plain -> rich`: snapshot `conversion` (plain). New content = `textToDoc(text, {id: ids.uuid})` so block IDs are persisted from the start.
- Same format: `VALIDATION_FAILED`.
- Emits `note:revision`. Response `versionId` = the `conversion` snapshot.

### 8.7 `AttachmentService` (D-054; INF-EDIT-08/09/10/14)

`importBytes({kind, originalName, bytes})`:
1. Limit from settings (`imageMaxMb` or `documentMaxMb`); over it: `LIMIT_EXCEEDED` with the exact message (section 9.8). Nothing written.
2. Image: `sniffImage(bytes)`; `unsupported`/`truncated`: `UNSUPPORTED` "This image type is not supported. Use PNG, JPEG, GIF or WebP."; `tooManyPixels` (width x height over 100,000,000): `UNSUPPORTED` "This image is too large to display. Use an image under 100 megapixels." Document: `ext = extensionFor(originalName)` (`[a-z0-9]{1,10}` lowercased, else `bin`), `mime = documentMime(ext)` (small fixed map, default `application/octet-stream`).
3. `sha256`. Existing row with that hash: return it; if it is a `document` and this is a valid image import, `UPDATE kind='image', mime=<sniffed>` (promotion). No file written.
4. `id = randomUUID()`; `rel = attachments/<id[0..2]>/<id>.<ext>`; write `attachments/tmp/<id>.part` with `open('wx')`, `write`, `sync`, `close`; `mkdir` the target directory; `rename` (same volume); on Linux `fsync` the directory (best effort).
5. Transaction: `INSERT INTO attachments (..., unreferenced_since = now)`. A `UNIQUE(sha256)` race: delete the new file and return the existing row. Any other failure: delete the file (and the `.part`) and throw `INTERNAL` "The image could not be added." or "The file could not be added."
6. Return `AttachmentDto` (`width`/`height` from the sniff; `null` for documents).

`importFromDialog({kind}, {webContentsId})`: `DialogAdapter.showOpenFiles` (parent = the sender's window; image filter `png, jpg, jpeg, gif, webp`; documents unfiltered; multi-select); canceled gives `{canceled:true, imported:[], rejected:[]}`. At most 20 paths are processed (the rest rejected with "Only the first 20 files were added."). Per path: `lstat` must be a regular file (symlinks resolved with `realpath` first, directories rejected), `size` checked against the limit before reading, then `readFile` and `importBytes`. Failures go to `rejected` with the per-file message.

`sweepTmp(now)` at startup deletes `attachments/tmp/*` entries older than 1 hour.

Protocol (F-01-2): after the existing `isInside` check, `lstat(abs)` must not be a symbolic link, and `realpath(abs)` must be inside `realpath(<dataDir>/attachments)` (root realpath cached per handler); otherwise 404 and a warning. Headers unchanged (`no-store`, `nosniff`, CSP `default-src 'none'`).

### 8.8 `FlushCoordinator` (INF-SAVE-01, D-055)

```ts
new FlushCoordinator({ sendTo, ids, timers, timeoutMs = 2000, logger })
flush(wcIds: number[]): Promise<{ acked: number[]; timedOut: number[] }>   // one flushId per webContents; resolves when all acked or each timed out
ack(wcId: number, flushId: string): boolean                                  // false for unknown id or wrong sender
```

Each call logs `flush: requested=<n> acked=<n> timedOut=<n>` (E2E reads it). Wiring:
- Main window `close`: unless `allowClose` or `quitting`, `preventDefault`, `await coordinator.flush([wcId])`, set `allowClose`, `win.close()`.
- `app.on('before-quit')`: unless `quitting`, `preventDefault`, `await coordinator.flush(all registered)`, set `quitting`, `app.quit()`.
- A renderer that never answers costs at most 2000 ms. `pagehide` flushing in the renderer stays as a second line.

### 8.9 Leases (INF-SAVE-04, D-055)

- `LeaseManager.webContentsReset(wcId)`: revoke every lease held by that `webContents` (tokens into `revoked`, emit `note:lease {holderViewId:null}`), delete its `viewId` bindings, finish pending takes whose requester or holder was in it. `webContentsDestroyed` calls it.
- Called from `main-window` hooks on `render-process-gone` and on main-frame cross-document `did-navigate`.
- `requestRelease(holder, noteId)` uses `eventBus.sendTo(holder.webContentsId, 'lease:release-request', {noteId})`, or the fake view in test mode (section 8.11).
- `emit` broadcasts `note:lease`. Behavior of `acquire`, `take`, `release`, `verify` is otherwise unchanged; a second `viewId` in the same live document still gets `granted:false`.
- Crash: on `render-process-gone` with a reason other than `clean-exit`, log `renderer-gone reason=<r>` and reload the main window after 500 ms, at most 3 times in 60 s.

### 8.10 `index.ts` wiring

Construct in order: `ContentIndexer`, `VersionService`, `NoteWriter` (with indexer, versions, `emit: e => eventBus.broadcast('note:revision', e)`), `DraftService`, `FormatService`, `AttachmentService` (settings, dialog adapter, paths), `LeaseManager` (`requestRelease`, `emit` real), `FlushCoordinator`. Register the new handlers. Call `attachments.sweepTmp(now)` after the database opened. `ShellAdapter.openExternal` = `shell.openExternal(href)` after `parseExternalUrl`; never through a shell command line.

### 8.11 Test hooks (only `!app.isPackaged && INFINITY_NOTES_E2E === '1'`)

`globalThis.__infinityTest` gains:
- `shellCalls` entries `{op:'openExternal', url}` (the real `shell.openExternal` is never called under hooks).
- `dialogQueue: string[][]` consumed by the test `DialogAdapter` (empty queue means canceled).
- `failSaves: number` (the next N `note:save` calls throw `INTERNAL` through `faults.beforeSave`).
- `importDelayMs: number` (awaited at the start of `importBytes`, for the "Adding image…" state).
- `flushLog` (each coordinator result).
- `fakeView`: a second view with `viewId` fixed and `webContentsId = -1000`, backed by the real `LeaseManager` and `NoteWriter`: `acquire(noteId)`, `release(noteId)`, `take(noteId)`, `save(noteId, text)` (`textToDoc`, current DB revision as base; returns `{ok, code?, revision?, draftId?}`), `releaseBehavior: 'release' | 'ignore'` (default `release`: answers a release request by releasing at once), and `forceWrite(noteId, text, {emit})` which bumps the revision through `writeNoteContent` without a lease to simulate an external writer (used only by the stale-conflict E2E).
`packaged.spec` keeps asserting `__infinityTest` is absent in the packaged build.

## 9. Renderer editor (`src/renderer/editor/**`)

### 9.1 Schema and extensions (D-053)

Rich (`richExtensions`):
- `StarterKit.configure({ heading: {levels:[1,2,3]}, link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: [], defaultProtocol: 'https', isAllowedUri: u => parseExternalUrl(u).ok, HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow' } }, undoRedo: { depth: 200 } })`.
- `TaskList`, `TaskItem.configure({ nested: true })`, `TaskToggle` (Mod-Enter).
- `ManagedImage`, `FileAttachment` (section 9.3).
- `UniqueID.configure({ types: BLOCK_ID_TYPES, generateID: () => crypto.randomUUID() })` with `BLOCK_ID_TYPES = ['paragraph','heading','codeBlock','blockquote','listItem','taskItem','image','fileAttachment']`; `BlockIdGuard` after it.
- `Placeholder.configure({ placeholder: 'Start writing…' })`, `FindExtension`.

Plain (`plainExtensions`): `StarterKit.configure({...})` with every option set to `false` except `document`, `paragraph`, `text` and `undoRedo` (do not import the transitive `@tiptap/extension-*` packages directly; they are not project dependencies), plus `Placeholder` and `FindExtension`. Content: `textToDoc(string)` in, `docToText(json)` out. No block IDs (note-level references only in V1).

Shared normalizer `normalizeRichDoc` (also used by the drift test):

| Node | Attributes kept (others dropped) |
| --- | --- |
| `doc` | none |
| `paragraph`, `blockquote`, `listItem` | `id` |
| `heading` | `id`, `level` 1-3 (else reject) |
| `codeBlock` | `id`, `language` (string up to 32 or null) |
| `bulletList`, `taskList`, `horizontalRule`, `hardBreak` | none |
| `orderedList` | `start` (integer at least 0), `type` (string up to 8 or null) |
| `taskItem` | `id`, `checked` (boolean) |
| `image` | `id`, `attachmentId` (UUID, required), `alt` (up to 500 or null), `size` (`small\|medium\|full`, default `medium`), `width`, `height` (integers 1-100000 or null) |
| `fileAttachment` | `id`, `attachmentId` (UUID, required), `name` (1-255), `sizeBytes` (integer at least 0), `mime` (up to 100) |
| `text` | `text` (string), `marks` |

Marks: `bold`, `italic`, `strike`, `underline`, `code`, `link` (`href` only, kept when `parseExternalUrl(href).ok`, otherwise the mark is dropped and the text kept). An invalid `id` value becomes absent. Unknown node or mark type, a node without `type`, depth over 64 or more than 100,000 nodes: `DocSchemaError`. `normalizeRichDoc` is idempotent.

### 9.2 `BlockIdGuard` (D-053, INF-EDIT-06)

- `props.transformPasted(slice, view)`: return the slice unchanged when `view.dragging?.move` is true (an internal move keeps IDs); otherwise rebuild it with `id = null` on every node of `BLOCK_ID_TYPES` (UniqueID then assigns fresh IDs). This does not depend on a DOM `paste` event, so `view.pasteHTML` in jsdom and real paste behave the same.
- `appendTransaction(trs, oldState, newState)`: run only if some step of a doc-changing transaction is a `ReplaceStep`/`ReplaceAroundStep` whose slice contains a node with a non-null `id`. Then count IDs over `newState.doc`; for each ID seen more than once keep the occurrence whose position maps back (`mapping.invert()`) to a non-deleted position that had that ID in `oldState.doc`, or the first one if none did, and `setNodeMarkup` a fresh UUID on the others. Meta `addToHistory: false`, `infinity:persist: true`.

### 9.3 Image and file nodes (INF-EDIT-08/09/11/14)

`ManagedImage` = `Image.extend({ name: 'image', inline: false, group: 'block', draggable: true, atom: true })` with attributes from section 9.1 plus renderer-only `uploadToken` (`rendered: false`, never saved). `parseHTML`: only `img[data-attachment-id]` with a UUID value (our own copies between notes); anything else is never an image node. `renderHTML`: `<img data-attachment-id src="infinity-attachment://<id>" alt width height class="img-<size>">`. React node view `ImageView`: uploading (`uploadToken` set): a box sized from `width/height` with "Adding image…"; loaded: `<img loading="lazy" decoding="async">`; `onError`: "Image unavailable" box with the alt text; selected: accent outline.

`FileAttachment` atom (`group: 'block'`): attributes from section 9.1 plus `uploadToken`; `parseHTML` `div[data-file-attachment-id]`; view `FileChipView`: lucide `FileText` icon, name, `formatBytes(sizeBytes)`, "Adding file…" while uploading. The chip has no open action in Phase 03 (Phase 07 adds OS handoff).

Image size presets (CSS): `small` max-width 240 px, `medium` max-width 480 px, `full` max-width 100 %; never wider than the natural width. New images default to `medium`. With an image `NodeSelection` the toolbar shows a radio group "Image size" (Small, Medium, Full width); choosing one runs `updateAttributes({size})` (an undoable user edit).

### 9.4 Paste, drop and sanitizing (INF-EDIT-07..10)

`handlePaste(view, event)`: first, synchronously, `files = Array.from(event.clipboardData?.files ?? [])`.
1. Files present: `preventDefault`; plain note with any image file: notice "Plain-text notes cannot contain images. Convert to rich text to add images." and stop; otherwise `uploader.insertFiles(files, view.state.selection.from)`; return true.
2. Plain note: insert `text/plain` as paragraphs (`textToDoc`), return true (HTML is ignored).
3. Rich note with `text/html`: return false and let ProseMirror parse; `transformPastedHTML` sanitizes first.

`sanitizePastedHtml(html, {onDataImage})` (DOMPurify, default `window`):
- `FORBID_TAGS`: `script, style, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, link, meta, base, svg, math, template, video, audio, source, track, canvas, noscript`.
- `FORBID_ATTR`: every `on*` (DOMPurify default) plus `style`, `srcset`, `formaction`, `background`, `ping`.
- `ALLOWED_URI_REGEXP`: `^(?:https?:|data:image/(?:png|jpeg|gif|webp);base64,)`.
- Hook `uponSanitizeElement` for `img`: `data:image/(png|jpeg|gif|webp);base64` gives `<img data-upload-token="<token>">` and calls `onDataImage(token, mime, base64)`; `http(s)` gives `<a href="<src>">Image: <alt or host></a>`; any other `src`: removed. Remote resources are never requested.
- Keeps the attributes the schema parses: `data-id` (removed later by `BlockIdGuard`), `data-attachment-id`, `data-file-attachment-id`, `data-type`, `data-checked`, `href`.
`ManagedImage.parseHTML` also accepts `img[data-upload-token]` as an uploading image; after the paste transaction the uploader imports each stashed data image and completes or removes the node.

`handleDrop(view, event, slice, moved)`: when `moved` is false and `event.dataTransfer.files.length > 0`: capture files synchronously, `preventDefault`, position from `view.posAtCoords`, same rules as paste; return true. Otherwise default behavior.

### 9.5 `AttachmentUploader` (INF-EDIT-08..10, loading feedback, bounded memory)

- `insertFiles(files, pos)`: at most 20 files (notice for the rest); per file decide kind (`image/png|jpeg|gif|webp` and `image/*` give `image`, else `document`); check `file.size` against the limit before reading (message, nothing inserted); insert an uploading node with a fresh `uploadToken` (and `width/height` null) at `pos`; enqueue.
- Queue concurrency 2; the bytes of a file are read (`file.arrayBuffer()`) only when its job starts and dropped right after the IPC call. Pending tokens live in a `Map` that is emptied as jobs finish; no blob or data URLs are created.
- Success: find the node with that `uploadToken`; `setNodeMarkup` with `attachmentId`, `width`, `height`, `alt` (original name without extension, or "Pasted image"), `name`, `sizeBytes`, `mime`, `uploadToken: null`; meta `addToHistory:false`, `infinity:persist:true`. If the node is gone (undo, deletion), do nothing.
- Failure: delete the node (same meta) and show the main error message as a notice.
- `pending()`, `waitIdle(ms)`; `dispose()` stops accepting completions.

### 9.6 Find in note (INF-KEY-04, D-058)

`find-core.ts`: `findMatches(doc, query): {from, to}[]` (escaped literal, `new RegExp(q, 'giu')` per textblock, at most 1,000). `FindExtension`: plugin state `{query, matches, index}`, decorations `find-match` and `find-match-current`, commands `setFindQuery`, `findNext`, `findPrevious`, `clearFind`; matches are recomputed on doc change. `FindBar`: text field "Find in note", counter "<i> of <n>" or "No results", buttons "Previous match", "Next match", "Close find"; Enter and Shift+Enter navigate with wrap and select the match (scrolled into view); Escape clears decorations, closes the bar and focuses the editor with the current match selected. Ctrl+F (global shortcut, active note tab only) opens it through `ui.requestFocus({target:'noteFind', noteId})`; with a selection, the selected text (up to 200 characters, one line) prefills the field. Works in read-only and plain notes; it never changes content.

### 9.7 Links (INF-SEC-01)

`LinkDialog` (title "Link", field "Address"; Save validates with `parseExternalUrl`, error "Use an address that starts with http:// or https://"; "Remove link" when editing; Cancel). `LinkBar` appears in the toolbar row when the selection is inside a link: the address (text), "Open link", "Edit link", "Remove link". Opening happens only through "Open link" or Ctrl+Click (`editorProps.handleClick` with `event.ctrlKey` on a link mark), each calling `bridge.shell.openExternal({url})`; a plain click only places the cursor. Failures show "This link cannot be opened".

### 9.8 Messages (exact; `src/shared/attachments/limits.ts`)

`imageTooLarge(n)` "This image is larger than N MB. Use a smaller image."; `fileTooLarge(n)` "This file is larger than N MB. Use a smaller file."; unsupported and megapixel messages (section 8.7); "Only the first 20 files were added."; "Plain-text notes cannot contain images. Convert to rich text to add images."; "The image could not be added."; "The file could not be added."; in-content "Adding image…", "Adding file…", "Image unavailable". The same builders are used by main and renderer.

### 9.9 Toolbar (UX_SPEC section 6 editor copy)

`role="toolbar"`, `aria-label="Formatting"`, one row of 32 px icon buttons (lucide), `overflow-x: auto` at narrow widths. Rich: Heading menu (Paragraph, Heading 1, Heading 2, Heading 3), Bold, Italic, Bulleted list, Numbered list, Checklist, Link, Code block, Insert image (dialog import, kind `image`), More menu (Inline code, Attach file, Find in note, Convert to plain text…, Version history…). Toggle buttons expose `aria-pressed` from `useEditorState`. Plain: Find in note, Convert to rich text, Version history. Read-only: formatting buttons disabled; Find and Version history stay enabled. Every button has `aria-label` and `title` (with its shortcut).

### 9.10 `NoteEditor` (INF-EDIT-01, INF-TABS-07)

```ts
<NoteEditor controller format content contentKey editable variant="tab" | "sticky" scrollTop onScroll />
```
- `useEditor({ extensions: format === 'rich' ? richExtensions(deps) : plainExtensions(deps), content, editable, immediatelyRender: true, shouldRerenderOnTransaction: false, enableContentCheck: true, onContentError: () => controller.contentError(), editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note text', spellcheck: 'false', class: 'note-editor-content' }, ...pasteProps, handleClick }, onUpdate: ({transaction}) => isUserEdit(transaction) && controller.markDirty(), onBlur: () => controller.flush() }, [format, contentKey])`. Remounts on `format` or `contentKey` change, so an external reload gets a clean undo history.
- `isUserEdit(tr)`: `tr.docChanged && (tr.getMeta('addToHistory') !== false || tr.getMeta('infinity:persist') === true)`. The create-time UniqueID pass is therefore not an edit: opening a note never saves (no revision or `updated_at` change).
- `controller.attachSource({ getContent: () => format === 'rich' ? toSavable(editor.getJSON()) : docToText(editor.getJSON()), getPlainText: () => editor.getText({blockSeparator:'\n'}), waitForUploads: ms => uploader.waitIdle(ms) })` on mount; `detachSource()` on unmount.
- `editor.setEditable(editable)` when it changes; `aria-readonly` follows.
- Registers in `editor-registry` on create and unregisters on destroy, updating `document.documentElement.dataset.liveEditors`. The `sticky` variant (Phase 04) uses a compact toolbar; Phase 03 renders only `tab`.

### 9.11 CSS (`editor.css`)

Editor body 15 px, line height 1.55, max content width 760 px; H1 22 px, H2 18 px, H3 15 px semibold; code font from UX_SPEC; code block on `--bg-subtle` with 6 px radius; checklist rows with native checkboxes; image sizes; selected node outline 2 px `--accent`; file chip bordered 6 px radius; find highlights `--accent-soft`, current `--accent-border` outline; placeholder `--text-muted`; banners reuse `.banner`. Light and dark via existing tokens only; `prefers-reduced-motion` disables transitions.

## 10. Renderer state and views

### 10.1 `NoteController` (rewrite; INF-SAVE-01/03/04/05, INF-EDIT-03/04/05/13)

State:

```ts
{ status: 'loading'|'ready'|'readOnly'|'trashed'|'missing'|'error'; note: NoteSummary|null; title: string;
  format: 'rich'|'plain'; revision: number; content: RichDocLike|string|null; contentKey: number;
  save: 'saved'|'pending'|'saving'|'retrying'|'error'; message?: string; titleError?: string; trashBatchId?: string|null;
  readOnlyReason: 'lease'|'leaseLost'|null; holderElsewhere: boolean;
  drafts: DraftSummary[]; conflict: { draftId: string; reason: 'stale'|'lease_lost' } | null;
  converted: { versionId: string } | null; busy: 'take'|'convert'|'restore'|'draft'|null }
```

| Method or event | Behavior |
| --- | --- |
| `open()` | `note:open`; set format, content, revision; `drafts:list` (failures ignored); `lease:acquire`: granted gives `ready`, otherwise `readOnly` with `readOnlyReason:'lease'`, `holderElsewhere:true`. No compatibility check any more. |
| `attachSource(src)` / `detachSource()` | The editor content provider |
| `markDirty()` | Only when `ready` with a token: `dirty = true`, `save: 'pending'`, schedule the 400 ms debounce |
| drain (private) | One request at a time; `content = source.getContent()`; same `requestId` across `INTERNAL` retries (3 at 1 s). Before any reload after `CONFLICT` or `LEASE_REQUIRED`: if the editor changed after the rejected request was sent (`dirty`), submit the current content once more with the same `baseRevision` and a new `requestId` so main keeps it as a draft too (text typed during an in-flight save is never lost); banners then use the newest draft. `CONFLICT` stale: reload, `conflict = {draftId, reason:'stale'}`, refresh drafts, `save:'saved'`. `CONFLICT` trashed: `status:'trashed'`, failure kept with details. `LEASE_REQUIRED`: reload, `readOnly`, `readOnlyReason:'leaseLost'`, `conflict = {draftId, reason:'lease_lost'}`. `NOT_FOUND`: `missing`. `LIMIT_EXCEEDED`: `save:'error'`, message from main, stay dirty. `VALIDATION_FAILED`: `save:'error'`, "Could not save this note.", stay dirty, `console.error`. |
| `flush()` | Cancel timers; `await source.waitForUploads(10000)` when uploads are pending; drain; pending rename; returns `{ok:true}` or `{ok:false, code, message, details?}` |
| `reload()` | `note:open`; replace content, `contentKey + 1`, revision |
| `onRevision(e)` | Ignore other notes and `sourceViewId === viewId`. `readOnly`: reload. `ready` with nothing dirty or saving: reload. Otherwise ignore (the next save conflicts and keeps a draft). |
| `onLease(e)` | Holder is another view: `holderElsewhere:true`; `null`: `holderElsewhere:false` |
| `onReleaseRequest()` | `await flush()`, `lease:release`, `readOnly`, `readOnlyReason:'lease'`, `holderElsewhere:true` |
| `takeEditControl()` | `busy:'take'`, `lease:take` (or `acquire` when `holderElsewhere` is false), then `reload()`, `ready` |
| `convert(target)` | `flush` must succeed; `note:convertFormat` (`confirmLossy` for plain); apply the response; `converted = {versionId}` for rich to plain |
| `listVersions()`, `restoreVersion(id)` | `versions:list`; `flush`, then `versions:restore`, apply |
| `restoreDraft(id)`, `dismissDraft(id)` | `drafts:resolve`; apply content on restore; refresh drafts; clear `conflict` |
| `contentError()` | `status:'error'`, "This note could not be displayed." (no save, no lease kept) |
| `rename(title)` | Unchanged (debounced `note:rename`, validation) |
| `dispose({flush})` | As before: flush unless `false`, release the lease |

All bridge calls for content operations pass `{noteId, viewId, leaseToken, baseRevision: state.revision, requestId: uuid()}`.

### 10.2 `TabsStore` (F-02-1)

- `closeNoteTabs(noteIds)`: when the active note is removed, `const r = await controller.flush()`; if `r.ok === false && r.code === 'CONFLICT' && r.details?.reason === 'trashed'`, push the notice `Your unsaved edits to "<title>" were kept as a recovered draft. Restore the note from Trash to see them.` (title from `displayTitle`); then `dispose({flush:false})`.
- `leaveActive()`: keep the tab open (notice `SAVE_FAILED_NOTICE`, return false) for every failed flush except `CONFLICT`, `LEASE_REQUIRED` and `NOT_FOUND` (main kept a draft or the note is gone). Previously only `INTERNAL` kept it open.

### 10.3 `AppServices`

- Subscribe `note:revision`, `note:lease` (to the active controller when `noteId` matches), `lease:release-request` (active controller `onReleaseRequest`), `app:flush-request` (`tabs.flushActive()` then `bridge.app.flushed({flushId})`, also when the flush failed).
- `PUBLIC_KEYS` adds the two attachment limits; an `EditorSettings` store holds `{imageMaxMb, documentMaxMb}` and follows `settings:changed`.
- Commands: `note.find` (Ctrl+F; only when the active tab is a note), `note.newPlain` (palette "New plain-text note"; same location rules as `note.new`); palette also lists "Find in note" with `Ctrl+F`.

### 10.4 `NoteView` and dialogs (UX_SPEC section 6 editor copy)

Layout: header (title field, meta, save status) → banners (at most two stacked: lease or lease-lost first, then conflict, recovered draft or converted) → toolbar (with link bar) → find bar (when open) → `NoteEditor`.

- Lease banner: "This note is being edited in another window" with "Take edit control" (label "Taking edit control…" and disabled while `busy:'take'`).
- Lease lost: "Another window took edit control. Your last edits were kept as a recovered draft." with Take edit control and Compare.
- Conflict: "This note changed elsewhere. Your edits were kept as a recovered draft" with Compare, Restore draft, Dismiss.
- Recovered draft on open: "This note has a recovered draft from <formatRelative>." (or the plural form) with Compare, Restore draft, Dismiss; actions use the newest draft. Restore draft is disabled with the tooltip "Take edit control first" while read-only.
- Converted: "Converted to plain text. A version with formatting and images was saved." with "Restore formatted version" (restores `versionId`) and Dismiss.
- `ConvertDialog`: exact UX_SPEC text "Convert to plain text? Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it." with Convert and Cancel. Plain to rich needs no dialog.
- `CompareDialog` "Compare recovered draft": columns "Current note" (`source.getPlainText()`) and "Recovered draft" (`plainText`, plus "Draft truncated for display" when `truncated`), buttons Restore draft and Close.
- `VersionsDialog` "Version history": list (time with `formatRelative`, reason label, format, preview); Restore asks "Restore this version? The current content is saved as a version first." (Restore, Cancel). Empty list: "No versions yet".
- The loading state shows "Opening note…" in the existing `aria-busy` placeholder. The save indicator labels are unchanged ("Saved", "Editing…", "Saving…", "Not saved - retrying", "Not saved").
- All dialogs use the existing `Dialog` primitive and return focus to the invoking control.

## 11. Security summary for this phase

Pasted HTML: DOMPurify plus the schema whitelist plus the image parse rule; nothing remote is fetched (the network guard records any attempt, and E2E asserts there was none). Links: http/https only at insert, at paste, at normalize and at open. Attachments: magic-number validation in main, no SVG, managed copies only, the protocol serves image rows by UUID with realpath containment, documents are never served or executed. Binary IPC is bounded and type-checked. Test hooks exist only in unpackaged E2E runs. Spellcheck stays off (D-057). No new permissions; the permission handlers still deny everything (clipboard paste through a keystroke or the Edit menu needs no permission).

## 12. Tests

### 12.1 Explicit assertions per requirement ID (Phase 00 F-1)

W = Windows, L = WSLg (default ozone) and Xvfb. Every row must pass on W and L for `done`.

| ID | Assertions |
| --- | --- |
| INF-TABS-07 | E `editor.spec › single editor instance`: with 3 note tabs, after each Ctrl+Tab exactly one `.ProseMirror` exists and `html[data-live-editors="1"]`; on Home there are 0 `.ProseMirror`, 0 `img` in `#tabpanel`, `data-live-editors="0"`; returning restores the text and scroll position. Every rendered `img` `src` starts with `infinity-attachment://` (no blob or data URLs). P `editor-memory.spec`: 1 and 5 cycles through 10 tabs (one with 20 images) record `performance.memory.usedJSHeapSize` and `app.getAppMetrics()` working sets into `test-results/perf-editors.json` (copied to the logs); structural invariants asserted, numbers reported only (Phase 09 owns targets). U `editor-registry.test`, `uploader.test › bounded queue` |
| INF-KEY-04 | E `editor.spec › find in note`: text "alpha beta Alpha ALPHA বাংলা"; Ctrl+F focuses "Find in note"; "alpha" shows "1 of 3" and 3 `.find-match`; Enter gives "2 of 3", Shift+Enter "1 of 3", 3 Enters wrap to "1 of 3"; "বাংলা" gives "1 of 1"; "zzz" gives "No results"; Escape closes, focus in the editor, selection text equals the match; revision unchanged; Ctrl+F on Home shows no find bar. U `find.test` |
| INF-EDIT-01 | R `boundaries.test`: no `contenteditable="true"`, `contentEditable={true}` or `execCommand` in `src/renderer`; only `editor/NoteEditor.tsx` calls `useEditor`. E `editor.spec`: `.ProseMirror[contenteditable="true"][role="textbox"][aria-label="Note text"]` |
| INF-EDIT-02 | U `editor-schema.test`: each command (heading 1-3, bold, italic, bullet, ordered, task list, Ctrl+Enter toggle, link set and unset, inline code, code block, undo, redo) gives the expected JSON, and `normalizeRichDoc` accepts it (no `DocSchemaError`; only link `target`, `rel`, `class` and `title` are dropped) and the normalized document loads back with the same text and structure. E `editor.spec › formatting survives reload`: toolbar and keys (Ctrl+B, Ctrl+I, Ctrl+Shift+8, Ctrl+Shift+7, Ctrl+Shift+9, Ctrl+Enter, Ctrl+Alt+1, Ctrl+E, Link dialog, Code block) → "Saved" → DB JSON has heading level 1, bold, italic, code, link `https://example.com/docs`, bulletList, orderedList, taskItem `checked:true`, codeBlock → restart → DOM has `h1`, `strong`, `em`, `ul li`, `ol li`, `li[data-checked="true"]`, `code`, `a[href="https://example.com/docs"]`, `pre code`. `› undo and redo`: type "abc", Ctrl+Z removes it, Ctrl+Y restores it; DB final text |
| INF-EDIT-03 | E `editor.spec › rename flushes`: type "Renamed note" in Title and press Ctrl+W at once → DB title, tab gone, tree label; reopen; clear the title → tab and tree show "Untitled", field placeholder "Untitled"; revision unchanged by renames |
| INF-EDIT-04 | I `notes-format.test › plain note`: `note:create {format:'plain'}` gives `content_text ''`, `content_json NULL`; save of a string sets `plain_text`; open returns a string. E `editor.spec › plain note`: palette "New plain-text note"; no Bold button; Ctrl+B adds no `strong`; pasted HTML (real clipboard) arrives as text only; pasting a bitmap shows the plain-text image message; DB `format 'plain'`, `content_text` exact lines; restart keeps it |
| INF-EDIT-05 | I `notes-format.test › version created`: rich with heading and image; convert without `confirmLossy` → `VALIDATION_FAILED`; with it → `format 'plain'`, expected lines, `note_versions` `conversion` row with `format 'rich'`, snapshot equal to the prior JSON and `attachment_ids` containing the image; `note_attachments` empty; revision + 1; `versions:restore` → rich content equal to the snapshot including block IDs, links back, a `restore` version of the plain text. E `editor.spec › conversion warning`: More > Convert to plain text → exact dialog text; Cancel keeps rich; Convert → converted banner → plain editor → "Restore formatted version" → heading and image (`naturalWidth > 0`) back → restart keeps it |
| INF-EDIT-06 | U `block-ids.test`: load without IDs assigns UUID v4 IDs and `isUserEdit` is false; typing keeps every ID; Enter in the middle gives a new ID and the original keeps its ID; `pasteHTML` with a foreign `data-id` and with an existing block's `data-id` (two-paragraph slices) gives fresh IDs; `insertContentAt` of a copy of an existing block gives a fresh ID (the UniqueID gap); all IDs unique. E `paste.spec › copied blocks get new IDs`: note with 2 saved paragraphs, Ctrl+A, Ctrl+C, Ctrl+End, Enter, Ctrl+V (real clipboard) → after "Saved" 4 paragraphs with 4 distinct IDs and the first 2 unchanged → restart → same IDs |
| INF-EDIT-07 | U `sanitize.test` (every forbidden tag and attribute, `javascript:` and `vbscript:` links, remote `img` to link text, data image token, `style` dropped); U `paste-pipeline.test` (jsdom editor `pasteHTML` of hostile HTML: no image node with a remote `src`, no script text, link kept only for https). E `paste.spec › no script execution`: real clipboard HTML with `<script>`, `<img src="http://example.invalid/x.png" onerror=...>`, `<iframe>`, `<object>`, `<embed>`, `<a href="javascript:...">`, `<style>` plus a heading and bold → `window.__pwned` undefined; no `script/iframe/object/embed` and no `img[src^="http"]` in the editor; link text "Image: example.invalid" with that href; heading and bold kept; `__infinityTest.blockedRequests` has nothing for `example.invalid`; DB `content_json` contains none of `script`, `onerror`, `javascript:`, `iframe` |
| INF-EDIT-08 | I `attachments.test › png bytes`: row `kind image`, `mime image/png`, file at `attachments/<aa>/<id>.png`, sha256 matches, `attachments/tmp` empty, `unreferenced_since` set and cleared after a save links it. E `paste.spec › bitmap`: real clipboard PNG 64x48 seeded from main, Ctrl+V → `img[src^="infinity-attachment://"]` with `naturalWidth 64`; DB one `image/png` row; node `width 64`, `height 48`; `note_attachments` row whose `block_id` equals the image node `id`; file on disk; restart → still shown |
| INF-EDIT-09 | E `paste.spec › original deleted`: temp PNG queued in `dialogQueue`, Insert image → shown; delete the original; restart → `naturalWidth > 0`; managed file under `<userData>/data/attachments`. `› drop image file` (synthetic DataTransfer File, labelled synthetic) inserts an image. `› data image in HTML` imported as an attachment. I `attachments.test › dialog import copies` (fake dialog; original removed afterwards; protocol still serves) |
| INF-EDIT-10 | I `attachments.test › limits`: 20 MB + 1 → `LIMIT_EXCEEDED` exact message, no file, no row; `imageMaxMb = 1` lowers it; SVG, HTML, truncated PNG → `UNSUPPORTED` exact message; a 12000x12000 header → megapixel message; GIF, JPEG and WebP accepted with dimensions. U `sniff.test`. E `paste.spec › oversized message`: drop a 21 MB file → notice text within 2 s, no attachment row, then typing "still works" saves; dialog import of the 21 MB file → same message from main; drop an SVG → unsupported message |
| INF-EDIT-11 | E `editor.spec › image size preset`: 800x200 PNG inserted (default `medium`, rendered width 480); select it; "Image size" Small → width 240; Full width → width > 480 and at most the editor content width; DB `size 'full'`; restart keeps it |
| INF-EDIT-12 | I `notes-save.test › Bangla`: title "বাংলা নোট", content "আমার সোনার বাংলা e\u0301 😀" → DB title, content text and `plain_text` byte-identical (no normalization); FTS `MATCH 'বাংলা'` finds the note. E `editor.spec › Bangla`: `keyboard.insertText` into title and editor → "Saved" → DB exact → restart → editor text exact |
| INF-EDIT-13 | E `editor.spec › save indicator`: "Editing…" right after typing, then "Saved"; with `failSaves = 4` → "Not saved - retrying" then "Not saved"; with `failSaves = 0` and more typing → "Saved"; with `importDelayMs = 1500` a pasted bitmap shows "Adding image…" then the image |
| INF-EDIT-14 | I `attachments.test › document import`: `report final.pdf` → `kind document`, `.pdf`, `original_name`; a name with path separators is sanitized; `.exe` is stored as a document; the protocol answers 404 for a document ID. E `paste.spec › document chip`: queued temp `report.pdf`, More > Attach file → chip "report.pdf" with its size; `note_attachments` row; original deleted; restart → chip present and the managed file exists |
| INF-SAVE-01 | I `notes-save.test › ack` (ack fields, one event); `flush-coordinator.test` (ack, 2000 ms timeout with fake timers, wrong sender refused, several windows). U `note-controller.test` (debounce 400 ms, blur flush, flush waits for uploads). E `editor.spec › flush on close` (type, Ctrl+W at once → DB), `› flush on tab switch`, `› flush on window close` (type, then `BrowserWindow.close()` at once → process exits → relaunch shows the text; `main.log` has `flush: requested=1 acked=1`), `› flush on quit` (type, then `app.quit()` → same) |
| INF-SAVE-02 | I `notes-save.test › atomic commit`: a test trigger aborting `note_attachments` inserts makes the save `INTERNAL` with revision, `content_json`, `plain_text`, `updated_at`, FTS (old text matches, new does not), versions and links unchanged and no event; without it everything (plain text, FTS, links, auto version) commits and one `note:revision` is emitted with the new revision |
| INF-SAVE-03 | I `revision.test` (existing stale and trashed cases; new `› retried conflict reuses the draft` and `› retried lease-lost reuses the draft`). I `drafts.test` (list, restore creates a `conflict` version and resolves, dismiss, restore of another note's draft refused). E `conflict.spec › stale save keeps a draft`: type, then `fakeView.forceWrite(emit:false)` within the debounce → conflict banner exact text; `note_drafts` row `conflict` containing the typed text; Compare shows both texts; Restore draft → editor shows the typed text, revision + 1, `conflict` version holds the forced text, draft resolved; a second conflict → Dismiss → resolved and editor shows current content. `› trashed while editing keeps a draft` (F-02-1): type " more", trash through the bridge within 400 ms → `note_drafts` row (`conflict`, content contains " more") and the exact notice |
| INF-SAVE-04 | I `lease.test` (existing plus `› release-request goes only to the holder`, `› holder flush lands before the grant`, `› webContentsReset revokes and allows a new acquire`, `› a second viewId in the same document is refused`). E `conflict.spec › read-only mirror and take control`: `fakeView.acquire` → open → lease banner, `contenteditable="false"`, Bold disabled; `fakeView.save('from other')` → editor shows it; Take edit control → editable, type, "Saved", DB holder text. `› take from a busy holder`: renderer typing, `fakeView.take` → renderer flushes then turns read-only; DB has the typed text. `› silent holder times out`: `releaseBehavior 'ignore'`, Take edit control → granted after about 3 s; `fakeView.save` → `LEASE_REQUIRED` and a `lease_lost` draft row |
| INF-SAVE-05 | E `crash.spec › renderer crash keeps acked text`: type, "Saved", `webContents.forcefullyCrashRenderer()` → auto reload → `data-ready` → note tab restored, text present and editable (lease reset). `› killed process keeps acked text`: "Saved", `SIGKILL` → relaunch → text present. The unacknowledged window (typing within 400 ms before a crash) is documented in PRODUCT_SPEC section 9 and not asserted |
| INF-SAVE-06 | I `versions.test`: with a fake clock, the first save of revision 0 makes no auto version; the next save makes one of the previous content; saves within 10 minutes add none; after 10 minutes one more; prune removes auto versions older than 30 days and beyond 100, never `conversion`, `conflict` or `restore`; list is newest first with preview. E `editor.spec › version history`: after a conversion, More > Version history lists "Before conversion"; Restore with confirmation restores it |
| INF-SEC-01 | U `url-policy.test` (http, https accepted; `javascript:`, `file:`, `data:`, `mailto:`, `vbscript:`, relative, credentials, over 2048 rejected). I `ipc-handlers-phase03.test › shell:openExternal` (`FORBIDDEN` for rejected URLs, fake shell called once for https). E `editor.spec › link open`: a plain click records no call; Ctrl+Click records `{op:'openExternal', url:'https://example.com/docs'}`; Open link records a second; the dialog refuses `javascript:alert(1)` with the error text; no network request recorded |

### 12.2 Unit tests (Vitest `unit`; renderer tests use `// @vitest-environment jsdom`)

New: `tests/unit/editor/{editor-schema,block-ids,sanitize,paste-pipeline,find,uploader,editor-registry,doc-drift}.test.ts`, `tests/unit/{doc-schema,sniff,url-policy,retention,attachment-names}.test.ts`. `doc-drift.test` builds a document with every feature through real editor commands and `setContent`, then checks `normalizeRichDoc(editor.getJSON())` equals its own normalization and that loading it back into a fresh editor round-trips. jsdom notes: pass `new window.Event('paste')` to `view.pasteHTML`; do not test DOM selection or coordinates in jsdom (E2E covers them).

Updated: `note-controller.test` (rewritten for the content source; the "incompatible document" case is removed with the behavior; new cases for conflict reload, typing during a conflicting save becoming a second draft before the reload, lease lost, release request, take, revision mirror, convert, uploads awaited by flush), `tabs-store.test` (F-02-1 and the failure rule), `textarea-doc.test` (ids option; `isTextareaCompatible` cases removed with the function in S6), `plain-text.test`, `contracts.test` and `contracts-phase02.test` (new schemas; "no Phase 04 channel" guard: `sticky:float`, `window:getState`, `note:trashed`, `sticky:state`), `boundaries.test` (same Phase 04 names; the INF-EDIT-01 review rules), `shell-smoke.test.tsx` (asserts the editor mounts with role textbox and that `insertContent` through the registry's live editor triggers a `note:save` with JSON), `shortcuts.test` (Ctrl+F), `palette-actions.test`, `fake-bridge.ts` and `support/services.ts` (new methods).

### 12.3 Integration tests (Vitest `integration`, real better-sqlite3, temp DB)

New: `notes-save.test.ts`, `notes-format.test.ts`, `versions.test.ts`, `drafts.test.ts`, `attachments.test.ts` (temp `dataDir`, fake dialog, fake settings), `flush-coordinator.test.ts`, `ipc-handlers-phase03.test.ts` (every new channel through the router: schema, binary measure, a non-`Uint8Array` `bytes` rejected, 200 MiB + 64 KiB ceiling, wrong sender, `app:flushed` sender check, `note:create` plain). Updated: `revision.test.ts` (F-01-3), `lease.test.ts`, `protocol.test.ts` (`› junction or symlink escape refused`: a directory junction on Windows (`fs.symlinkSync(target, path, 'junction')`, no admin needed) or a directory symlink on Linux under `attachments/` pointing outside; a row through it gives 404), `ipc-validation.test.ts` (out-of-catalogue example becomes `sticky:float`), `notes-open-save.test.ts` (normalized content).

### 12.4 E2E (Playwright `_electron`, built app, `workers: 1`, `retries: 0`)

New helpers `tests/e2e/editor-ui.ts`: `editor(page)`, `editorText(page)`, `waitSaved(page)`, `docOf(h, id)`, `blockIds(doc)`, `seedClipboardImage(app, png)`, `seedClipboardHtml(app, html, text)` (Electron 44 API, then `clipboard.has` must be true or the helper fails with a clear message), `paste(page)` (Ctrl+V; documented fallback `webContents.paste()` per D-054), `dropFiles(page, files)` (synthetic), `queueDialog(app, paths)`, `fakeView(app, ...)`, `shellCalls(app)`, `setHook(app, key, value)`.

```ts
// load-bearing: Electron 44 clipboard seeding from the main process
await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
}, png.toString('base64'));
```

New specs: `editor.spec.ts` (rewritten and extended: cases in 12.1 for TABS-07, KEY-04, EDIT-01/02/03/04/05/11/12/13, SAVE-01/06, SEC-01, plus the two Phase 02 cases kept with editor selectors), `paste.spec.ts`, `conflict.spec.ts`, `crash.spec.ts`, `editor-flow.spec.ts`, `editor-memory.spec.ts`.

`editor-flow.spec.ts › edit, paste and reload` (the phase demo): Ctrl+N; title "Field notes বাংলা"; Heading 1 "Plan"; bold and italic words; bulleted and checked checklist items; link; code block; real clipboard bitmap paste; real clipboard HTML paste with a script (not executed); Insert image from a temp file, then delete the file; Ctrl+Z and Ctrl+Y once; "Saved"; quit; relaunch (network guard active, `blockedRequests` empty); open from the tree; every format present, both images `naturalWidth > 0`, title and Bangla exact; DB block IDs unique.

### 12.5 Existing specs to update (no assertion weakened)

- `tabs.spec.ts` (F-02-3): every `expect(await tabLabels(page)).toEqual(...)` and `expect(await activeTabLabel(page)).toBe(...)` becomes `await expect.poll(() => tabLabels(page)).toEqual(...)` / `await expect.poll(() => activeTabLabel(page)).toBe(...)` (lines 26-41, 53, 57, 86, 92, 107-120, 193-194, 216-217, 231, 241, 256, 274, 285, 292-293, 299 at `1dda11f`); `getByLabel('Note text')).toHaveValue(x)` becomes `expect(editor(page)).toHaveText(x)` (or `editorText` with `expect.poll` for multi-line text).
- `editor.spec.ts` Phase 02 cases: `fill` → click the editor then `keyboard.insertText`; `toHaveValue` → `editorText` poll with the same exact string (multi-line through paragraphs).
- `visual.spec.ts`, `keyboard.spec.ts`, `note-live.spec.ts`: same selector change (`getByRole('textbox', {name:'Note text'})` keeps working through `role="textbox"`).
- `security.spec.ts › bridge surface`: the exact new key set (section 6.3); the subscribe-rejection probe uses `sticky:state`.
- `seed.ts` `saveText` unchanged (a second `viewId` in the same document gets `granted:false` when the UI holds the lease, as before).

### 12.6 Visual (V evidence for review, no pixel diffs)

`visual.spec.ts` gains: `1100x720 light: rich note` (heading, lists, checklist, link bar, image, code block), `1100x720 dark: rich note`, `1100x720 light: plain note`, `1100x720 light: conflict banner`, `1100x720 light: read-only banner`, `1100x720 light: find bar`, `760x560 light: editor toolbar`. Windows run regenerates the whole set (F-02-4).

## 13. Commands, hosts and logs

Every log goes to `.infinity-work/logs/phase-03/`, starts with the command, date and `pwd`, and ends with `EXIT=<code>`. Prefix by step: `S1-` … `S10-`, `wsl-`, `win-`.

### 13.1 Windows (Git Bash, repository root)

```
export INFINITY_E2E_NODE='E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe'
npm run check                                   # S<n>-check.log (lint, typecheck, unit, integration, traceability)
npm run build                                   # S<n>-build.log
npm run test:e2e                                # S<n>-test-e2e.log
npm run test:e2e -- tests/e2e/<spec>.ts         # focused runs while repairing (never a gate on their own)
INFINITY_SCREENSHOT_DIR="$PWD/.infinity-work/logs/phase-03/screens/win" npm run test:e2e -- tests/e2e/visual.spec.ts   # S7-win-visual.log
node tools/dev-smoke.mjs                        # S8-dev-smoke.log
npm run package:current; npm run verify:native -- --packaged; npm run test:e2e:packaged   # S8-win-package.log, S8-win-verify-native-packaged.log, S8-win-test-e2e-packaged.log
node tools/check-traceability.mjs --repo .      # S10-traceability.log
git diff --exit-code package.json package-lock.json   # S8-deps-unchanged.log
```

A Windows E2E crash with the 0xC0000409 worker signature while `INFINITY_E2E_NODE` is set is a real failure. Windows E2E overwrites the OS clipboard during paste specs; that is expected and stated in the progress report.

### 13.2 WSL (user `infinity`, D-039; from Git Bash prefix `MSYS_NO_PATHCONV=1`; put multi-command runs in a script file to avoid quoting problems)

```
wsl -d Ubuntu -u infinity -- bash -lc '<cmd>'
# env: lsb_release -ds; uname -r; node -v; npm -v; cat /mnt/wslg/versions.txt; WAYLAND_DISPLAY/DISPLAY/XDG_SESSION_TYPE   (wsl-env.log)
mkdir -p ~/infinity-notes && rsync -a --delete --exclude=node_modules/ --exclude=out/ --exclude=release/ --exclude=.git/ --exclude=.infinity-work/ --exclude=test-results/ --exclude=playwright-report/ --exclude=coverage/ /mnt/e/notecapt/ ~/infinity-notes/   # wsl-sync.log
cd ~/infinity-notes && export WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0
npm ci && npm run setup:electron                       # wsl-npm-ci.log
npm run check                                          # wsl-check.log
npm run build                                          # wsl-build.log
npm run test:e2e                                       # wsl-test-e2e-wslg.log (record ozone from main.log)
env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e     # wsl-test-e2e-xvfb.log
INFINITY_SCREENSHOT_DIR=/mnt/e/notecapt/.infinity-work/logs/phase-03/screens/wslg npm run test:e2e -- tests/e2e/visual.spec.ts   # wsl-visual.log
INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e   # wsl-test-e2e-wayland.log (informational, D-050)
npm run package:linux && npm run test:e2e:packaged     # wsl-package-linux.log, wsl-test-e2e-packaged.log
```

Rules: never share `node_modules`; never root; never `--no-sandbox`; no apt installs; label results "WSLg 1.0.73 (Weston), ozone <value>" or "Xvfb", never GNOME or an X11 session; GNOME and X11 desktops are `outside_validation_scope`. A WSLg launch-exit or XWayland connection flake is recorded as its own run with the error, never retried away (F-02-3 watch item). An environment failure is recorded as pending with the exact error; a code defect is fixed.

## 14. Work order, gates and checkpoints

After each step: run the gate, save logs, append `Checkpoint S<n> done <date> — gates: <log names>` plus a short file list to `docs/progress/phase-03.md`. A resumed implementer reads that file and continues at the first missing checkpoint.

| Step | Work | Gate |
| --- | --- | --- |
| S1 Entry follow-ups | F-02-1 (`tabs-store.ts` + unit test), F-01-3 (`note-writer.ts` conflict cache + `revision.test`), F-02-3 (`tabs.spec.ts` polling only; textarea selectors stay until S6) | `npm run check`; `npm run test:e2e -- tests/e2e/tabs.spec.ts tests/e2e/editor.spec.ts` |
| S2 Shared pure modules | Section 3.2 shared rows except contracts; unit tests `doc-schema`, `sniff`, `url-policy`, `retention`, `attachment-names`, `plain-text`, `textarea-doc` (ids option) | `npm run check` |
| S3 Main services | Indexer, `writeNoteContent`, `NoteWriter` refactor, versions, drafts, format, attachments, dialog and shell adapters, protocol realpath, lease reset, flush coordinator; integration tests of 12.3 that need no IPC | `npm run check` |
| S4 IPC and wiring | Contracts, channels, bridge, preload, router `measurePayload`, handlers, event bus `sendTo`, `index.ts` and `main-window.ts` wiring, test hooks, settings keys; `contracts`, `boundaries`, `ipc-handlers-phase03`, `ipc-validation` tests; `security.spec` surface | `npm run check`; `npm run build`; full `npm run test:e2e` green with the textarea still in place |
| S5 Editor module | `src/renderer/editor/**`, `editor.css` (not yet mounted); unit tests of 12.2 for the editor | `npm run check`; `npm run build` |
| S6 Integration | `NoteController` rewrite, `NoteView`, banners, dialogs, `TabsStore`, `AppServices`, commands, shortcuts, palette; delete `TempTextEditor.tsx`, `isTextareaCompatible`, `READONLY_FORMAT`; unit test updates; existing E2E specs updated (12.5) | `npm run check`; `npm run build`; full `npm run test:e2e` green |
| S7 New E2E and visual | `editor`, `paste`, `conflict`, `crash`, `editor-flow`, `editor-memory` specs; visual additions; repairs with regression tests | Full `npm run test:e2e` green on Windows; Windows screenshot set regenerated (F-02-4) |
| S8 Windows release gates | dev smoke, package, verify native, packaged E2E, deps unchanged | All exit 0 |
| S9 WSL leg | Section 13.2 | check, build, WSLg and Xvfb E2E green; forced Wayland informational; packaged Linux E2E |
| S10 Report | BACKLOG and the final progress report (section 15), traceability | `node tools/check-traceability.mjs --repo .` exit 0 |

## 15. Progress report and BACKLOG

### 15.1 `docs/progress/phase-03.md` must contain

1. Summary, date, agent role and model, and the checkpoint lines S1-S10.
2. Hosts: Windows OS, Node, E2E runner Node 24.21; WSL Ubuntu, kernel, Node, WSLg version, Weston hash, observed ozone for WSLg, Xvfb and forced-Wayland runs.
3. Changed, created and deleted files by area, one line each.
4. IPC catalogue as implemented; any difference from section 6 needs a decision entry.
5. Command table: command, host, exit code, duration, log path, for every log in section 13.
6. Requirement coverage: one row per ID (23 rows) with the assertions run (file › case), W and L (WSLg, Xvfb) results, screenshot paths for visual evidence and the BACKLOG status set.
7. Follow-ups: F-02-1, F-02-2 (planner), F-02-3, F-02-4, F-01-3, F-01-2, D-048 gap, each with files and tests.
8. Paste evidence: which paste trigger each host used (Ctrl+V or the `webContents.paste()` fallback); synthetic drop labelled synthetic.
9. Perf record from `editor-memory.spec` (numbers only, no target claims).
10. Decisions added after planning (D-059 onward) or "none"; deviations with reasons.
11. Issues found and fixed: severity, reproduction, expected, actual, regression test.
12. Not run or pending: GNOME and X11 desktops (outside scope); forced-Wayland informational failures; pasting files copied in the OS file manager (not automated; Chromium file-list clipboard support not asserted); any Linux step left pending.
13. Known limitations: an image still importing when a window closes may be missing (D-055); block IDs of a never-edited note are persisted at its first edit (D-053); no drag-resize of images (presets only); attachment chips cannot be opened until Phase 07; size-limit and retention settings have no UI until Phase 08; attachment GC is Phase 08.

### 15.2 BACKLOG (Status and Planned tests columns only)

Set `done` for each of the 23 IDs when every assertion in its section 12.1 row passed on W and on L (WSLg and Xvfb); INF-TABS-07 additionally needs the perf record. Update Planned tests to the final case names. Traceability must exit 0. No Phase 03 ID has an N part.

## 16. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R3-01 | Playwright's Ctrl+V does not trigger a paste on some host | Probe shows a synthesized Ctrl+V works on all three hosts; fallback `webContents.paste()` (real clipboard, Edit menu path), recorded per host |
| R3-02 | OS clipboard locked by another Windows app during E2E | Helper verifies `clipboard.has` and fails with a clear message; no test retries |
| R3-03 | Drift between Tiptap JSON and `normalizeRichDoc` makes saves fail | `doc-drift.test` with every feature; renderer keeps the content dirty and shows "Not saved" on `VALIDATION_FAILED`, never drops it |
| R3-04 | `BlockIdGuard` cost on large documents | Runs only when inserted slices carry IDs; one O(n) pass then |
| R3-05 | jsdom limits for ProseMirror (selection, coordinates) | jsdom tests stay on commands and JSON; DOM behaviors are E2E |
| R3-06 | Large binary IPC payloads | Renderer checks `File.size` first, reads bytes per job, concurrency 2, router ceiling, service limit |
| R3-07 | A hung renderer delays window close or quit | 2000 ms per window in `FlushCoordinator`; `pagehide` as second line |
| R3-08 | Playwright `Page` unusable after `forcefullyCrashRenderer` | Fallback: assert through a relaunch; the DB check is primary |
| R3-09 | WSLg XWayland launch flake (Phase 02) | Separate run records, no retries |
| R3-10 | Renderer bundle grows with Tiptap and ProseMirror | Accepted; minification is F-01-5 (Phase 09) |
| R3-11 | The fake view and `forceWrite` hooks leak into production | Installed only under `testHooksEnabled`; `packaged.spec` asserts `__infinityTest` is absent |
| R3-12 | Leftover `electron.exe` processes on the Windows host | Coordinator may close them before gates; tests use fresh temp userData |
| R3-13 | Seeds or other same-document views stealing the lease | No supersede rule; only reload, crash and destroy reset leases (D-055) |

## 17. Out of scope for Phase 03

- Sticky windows, the `sticky` editor variant UI, `note:trashed`, `window_state` (Phase 04).
- Reminders and suggestions (Phases 05-06).
- Opening attachments, Show in folder, note and block references, backlinks, full-text search UI (Phase 07).
- Settings UI for attachment limits and retention, the full version history screen, attachment GC, backup (Phase 08).
- Not in V1: drag-resize of images, tables, syntax highlighting, collaborative editing, spellcheck dictionaries (D-057), OCR.

Never, in any phase: publishing, pushing, signing, apt installs, running as root, `--no-sandbox`.

## 18. Planner status

```json
{"status":"ready","evidence":["docs/plans/phase-03.md","docs/DECISIONS.md (D-044 status, D-051..D-058, R-06)","docs/ARCHITECTURE.md (section 3 allocation, section 4 rows 03/04/07, section 6 Phase 03 refinements, section 7 clipboard and limit wording)","docs/BACKLOG.md (W02-02, W04-01, W05-01, W06-02, W07-01 migration numbers)","docs/UX_SPEC.md (section 6 editor copy, section 7 keys)",".infinity-work/logs/phase-03/planner-probe-clipboard-win.log",".infinity-work/logs/phase-03/planner-probe-clipboard-wslg.log",".infinity-work/logs/phase-03/planner-probe-clipboard-xvfb.log",".infinity-work/logs/phase-03/planner-probe-tiptap.log"],"blockers":[]}
```

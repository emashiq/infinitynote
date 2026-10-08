# Phase 03 progress: Rich notes, plain text and image paste

Implementer: infinity-code-opus (Opus 5.5, high), 2026-10-08. Plan: `docs/plans/phase-03.md` (work order section 14). Logs: `.infinity-work/logs/phase-03/`.

## Checkpoints

- Checkpoint S1 done 2026-10-08 — gates: `S1-check.log` (EXIT=0), `S1-test-e2e.log` (tabs and editor specs, 11 passed, EXIT=0). Files: `src/main/services/request-cache.ts` (new), `src/main/services/note-writer.ts` (F-01-3 outcome cache), `src/renderer/state/tabs-store.ts` (F-02-1 flush in `closeNoteTabs`, D-055 failure rule), `src/renderer/state/notice-store.ts` (`trashedDraftNotice`), `src/renderer/notes/note-controller.ts` (`FlushResult.details`), `tests/integration/revision.test.ts`, `tests/unit/renderer/state/tabs-store.test.ts`, `tests/unit/renderer/support/fake-bridge.ts`. F-02-3 was already completed by the Phase 01–02 cleanup (no non-polling tab reads remain).
- Checkpoint S2 done 2026-10-08 — gates: `S2-check.log` (264 unit, 129 integration, traceability fails=0, EXIT=0). Files: `src/shared/editor/doc-schema.ts`, `src/shared/url-policy.ts`, `src/shared/attachments/{sniff,limits,names}.ts`, `src/shared/versions/retention.ts` (new); `src/shared/text/plain-text.ts` (file, image, rule blocks), `src/shared/text/textarea-doc.ts` (`textToDoc` id option, `RichDocLike` from doc-schema); tests `tests/unit/{doc-schema,sniff,url-policy,retention,attachment-names}.test.ts` (new), `plain-text.test.ts`, `textarea-doc.test.ts`, `tests/support/images.ts` (new).
- Checkpoint S3 done 2026-10-08 — gates: `S3-check.log` (266 unit, 177 integration + 1 Linux-only skip, fails=0, EXIT=0). The channel catalogue, schemas and `index.ts` wiring needed for main to compile were written in the same pass and are completed and gated in S4. Files: repositories `src/main/db/repositories/{notes-repo (content row, revision-guarded write), drafts-repo, versions-repo, attachments-repo}.ts`; services `src/main/services/{content-indexer, note-content, content-ops, version-service, draft-service, format-service, attachment-service, dialog-adapter, flush-coordinator}.ts` (new), `note-writer.ts`, `note-reader.ts`, `lease-manager.ts` (`webContentsReset`), `shell-adapter.ts`, `hierarchy-service.ts` (`createNote` format); `src/main/windows/attachment-protocol.ts` (F-01-2 realpath); `src/main/main-services.ts`; contracts `src/shared/contracts/{notes,attachments,settings}.ts`; `src/shared/text/plain-text.ts` (empty paragraphs as empty lines); tests `tests/integration/{notes-save,notes-format,versions,drafts,attachments,flush-coordinator}.test.ts` (new), `revision`, `lease`, `protocol`, `hierarchy-helpers.ts`.
- Checkpoint S4 done 2026-10-08 — gates: `S4-check.log` (274 unit, 185 integration + 1 Linux-only skip, fails=0, EXIT=0), `S4-build.log` (EXIT=0), `S4-test-e2e.log` (76 passed, 1 Linux-only skip, textarea still in place, EXIT=0). Files: `src/shared/contracts/{channel-names,channels,bridge,app,hierarchy}.ts`, `src/preload/index.ts`, `src/main/ipc/router.ts` (`RegisterOptions.measurePayload`), `src/main/ipc/event-bus.ts` (`sendTo`, typed payloads), `src/main/ipc/register-handlers.ts`, `src/main/ipc/handlers/{note,app,hierarchy}-handlers.ts`, `src/main/ipc/handlers/{content,attachment}-handlers.ts` (new), `src/main/windows/{main-window,window-registry}.ts`, `src/main/window-lifecycle.ts` (new: close/quit flush, crash reload, lease reset on navigation), `src/main/test-hooks.ts` (fake view, dialog queue, save faults, import delay, flush log), `src/main/index.ts`, `src/renderer/state/app-services.ts` (answers `app:flush-request`); tests `tests/unit/contracts-phase03.test.ts`, `tests/integration/ipc-handlers-phase03.test.ts` (new), `contracts`, `contracts-phase02`, `boundaries`, `ipc-validation`, `ipc-handlers-phase02`, `ipc-helpers.ts` (`catalogueRouter`), `tests/e2e/security.spec.ts` (bridge surface), `tests/unit/renderer/support/fake-bridge.ts`.
- Checkpoint S5 done 2026-10-08 — gates: `S5-check.log` (339 unit, 185 integration + 1 Linux-only skip, fails=0, EXIT=0), `S5-build.log` (EXIT=0). Files: `src/renderer/editor/{content,editor-registry,block-id-guard,managed-image,file-attachment,task-toggle,sanitize,paste,uploader,find-core,find,link,extensions}.ts`, `src/renderer/editor/{ImageView,FileChipView,FindBar,LinkDialog,LinkBar,Toolbar,NoteEditor}.tsx`, `src/renderer/styles/editor.css` (imported in `main.tsx`), `src/shared/app-identity.ts` (`attachmentUrl`), `src/shared/attachments/limits.ts` (`plainNoFiles`, D-059); tests `tests/unit/renderer/editor/{block-ids,sanitize,paste-pipeline,find,uploader,editor-registry,editor-schema,doc-drift}.test.ts` and `support.ts` (under `tests/unit/renderer/` because only the web tsconfig compiles TSX). Negative control: removing `BlockIdGuard` from the extensions makes 3 block-ID cases fail (run during development, guard restored).
- Checkpoint S6 done 2026-10-08 — gates: `S6-check.log` (354 unit, 185 integration + 1 Linux-only skip, fails=0, EXIT=0), `S6-build.log` (EXIT=0), `S6-test-e2e.log` (76 passed, 1 Linux-only skip, EXIT=0; development run `S6-dev-e2e-editor.log`). Files: `src/renderer/notes/note-controller.ts` (rewrite), `NoteView.tsx`, `NoteBanners.tsx`, `CompareDialog.tsx`, `VersionsDialog.tsx` (new; the convert and restore confirmations use the existing `ConfirmDialog`), `TempTextEditor.tsx` (deleted), `src/renderer/editor/editor-services.ts` (new), `src/renderer/state/{app-services,commands,shortcuts,palette-actions,ui-store,tree-store}.ts`, `src/renderer/styles/components.css` (text-area rule replaced by banner and dialog styles), `src/shared/text/textarea-doc.ts` (`isTextareaCompatible` removed); tests `tests/unit/renderer/state/{note-controller (rewrite),app-events (new),tabs-store,tree-commands}.test.ts`, `tests/unit/renderer/support/editor-source.ts` (new), `shell-smoke.test.tsx`, `shortcuts.test.ts`, `palette-actions.test.ts`, `textarea-doc.test.ts`; E2E `tests/e2e/editor-ui.ts` (new), `editor.spec.ts` (Phase 02 cases on the editor), `tabs.spec.ts`, `visual.spec.ts`, `keyboard.spec.ts`.
- Checkpoint S7 done 2026-10-08 — gates: `S7-check.log` (355 unit, 185 integration + 1 skip, EXIT=0), `S7-test-e2e.log` (111 passed, 1 Linux-only skip, EXIT=0), `S7-win-visual.log` (11 passed; screenshots `.infinity-work/logs/phase-03/screens/win/`, F-02-4), `S7-win-perf.log` + `perf-editors-win.json`. Development runs `S7-dev-*.log`. Files: E2E `tests/e2e/{editor (extended),paste,conflict,crash,editor-flow,editor-memory}.spec.ts`, `visual.spec.ts` (7 new screenshots), `editor-ui.ts`, `seed.ts` (`saveDoc`, `importImage`, plain-aware `saveText`, `createNote` format); product fixes found by these runs: `NoteEditor.tsx` (effect deps; uploader re-bind), `uploader.ts` (`insertBlocks`: text cursor after inserted attachments), `ui/Dialog.tsx` (`returnFocus` option, used by the link dialog), `tabs-store.ts` (pending scroll applied before switching), `editor.css` (checklist layout, content box sizing), `components.css` (disabled buttons); unit regression `uploader.test.ts › leaves a text cursor after inserted blocks`.
- Checkpoint S8 done 2026-10-08 — gates: `S8-dev-smoke.log`, `S8-win-package.log`, `S8-win-verify-native-packaged.log`, `S8-win-test-e2e-packaged.log` (2 passed, renderer `sandboxed=true integrity=untrusted`), `S8-deps-unchanged.log`; all EXIT=0.
- Checkpoint S9 done 2026-10-08 — gates: `wsl-env.log`, `wsl-sync.log` (MIRROR_IDENTICAL), `wsl-npm-ci.log`, `wsl-check.log`, `wsl-build.log` (EXIT=0); development WSLg run `wsl-test-e2e-wslg.log` (111 passed, 1 failed: `editor.spec › formatting survives reload` used End to collapse a selection, which does not collapse it on Linux; the test now uses ArrowRight, re-verified in `S9-dev-win-editor.log` and `wsl-dev-editor-wslg.log`, 17 passed each). The full Linux leg was then repeated as the final gates (section 5).
- Checkpoint S10 done 2026-10-08 — BACKLOG (23 Phase 03 rows `done`, Planned tests set to the final case names), D-059, this report; traceability `fails=0` inside `final-win-check.log` and `final-wsl-check.log`.

## 1. Summary

Phase 03 replaces the Phase 02 text area with one Tiptap editor for rich and plain-text notes and adds the main-process content pipeline behind it: a shared document schema enforced on every save (`normalizeRichDoc`), a single content writer that commits text, search text, attachment links, automatic versions and the revision in one transaction, recovered drafts for refused saves, format conversion with a restorable version, managed attachments (clipboard bitmap, files, data images, documents) with magic-number checks and limits, lease hand-off with Take edit control, acknowledged flush on window close and quit, crash reload, find in note and an http(s)-only link policy. All 23 Phase 03 requirement IDs pass on Windows, WSLg and Xvfb.

Agent: infinity-code-opus (Opus 5.5, high). Nothing was committed. The pack, `.claude/`, `CLAUDE.md` and `.infinity-work/agent-status.json` were not edited. `package.json` and `package-lock.json` are unchanged (`final-deps-unchanged.log`).

## 2. Hosts

| Host | Details |
| --- | --- |
| Windows | Windows 11 Pro 10.0.26300, Node 24.15.0 (tools), Playwright runner Node 24.21.0 (`INFINITY_E2E_NODE`), Electron 44.7.0 |
| WSL | Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, user `infinity`, Node 24.21.0, npm 11.19.0, own `node_modules` in `~/infinity-notes` (exact mirror) |
| WSLg | WSLg 1.0.73 (Weston 2318fecaeac1f1a2d5a7a042c34d931c71dae04c); the app logs `ozone=x11` (XWayland), DISPLAY=:0 |
| Xvfb | `env -u WAYLAND_DISPLAY -u DISPLAY` (run-e2e starts xvfb-run, DISPLAY=:99); the app logs `ozone=x11` |
| Forced Wayland | `--ozone-platform=wayland` under WSLg; informational only (D-050), section 12 |

Sandbox evidence: Windows dev and packaged `sandboxed=true integrity=untrusted`; WSLg, Xvfb and Linux packaged `ownUserNamespace=true ownPidNamespace=true Seccomp=2`.

## 3. Changed, created and deleted files

Main
- `src/main/main-services.ts` — builds the Phase 03 services (indexer, content writer, content ops, versions, drafts, formats, attachments) and wires events and test faults.
- `src/main/index.ts` — flush coordinator, real dialog and shell adapters, lifecycle hooks, tmp sweep, fake view hook-up.
- `src/main/window-lifecycle.ts` (new) — close and quit flush, crash reload (at most 3 per minute), lease reset on navigation and renderer exit.
- `src/main/test-hooks.ts` — test state (`dialogQueue`, `failSaves`, `importDelayMs`, `flushLog`, `shellCalls`) and the fake second view.
- `src/main/services/{content-indexer,note-content,content-ops,version-service,draft-service,format-service,attachment-service,dialog-adapter,flush-coordinator,request-cache}.ts` (new).
- `src/main/services/note-writer.ts` (normalization, auto versions, outcome cache F-01-3, fault seam), `note-reader.ts`, `lease-manager.ts` (`webContentsReset`), `shell-adapter.ts` (`openExternal`), `hierarchy-service.ts` (`createNote` format).
- `src/main/db/repositories/notes-repo.ts` (content row, revision-guarded write); `{drafts,versions,attachments}-repo.ts` (new).
- `src/main/windows/attachment-protocol.ts` (realpath containment, F-01-2), `main-window.ts` (close, renderer-gone and navigation hooks), `window-registry.ts` (`get`).
- `src/main/ipc/router.ts` (`RegisterOptions.measurePayload`), `event-bus.ts` (`sendTo`, typed payloads), `register-handlers.ts`, `handlers/{note,app,hierarchy}-handlers.ts`, `handlers/{content,attachment}-handlers.ts` (new).

Shared and preload
- `src/shared/editor/doc-schema.ts`, `url-policy.ts`, `attachments/{sniff,limits,names}.ts`, `versions/retention.ts` (new).
- `src/shared/contracts/{notes,app,hierarchy,settings,channel-names,channels,bridge}.ts`, `attachments.ts` (new); `src/shared/text/{plain-text,textarea-doc}.ts`; `src/shared/app-identity.ts` (`attachmentUrl`).
- `src/preload/index.ts` — new namespaces and methods, still frozen, no generic invoke.

Renderer
- `src/renderer/editor/*` (new): `NoteEditor`, `Toolbar`, `FindBar`, `LinkDialog`, `LinkBar`, `ImageView`, `FileChipView`, `extensions`, `block-id-guard`, `managed-image`, `file-attachment`, `task-toggle`, `sanitize`, `paste`, `uploader`, `find`, `find-core`, `link`, `content`, `editor-registry`, `editor-services`.
- `src/renderer/notes/note-controller.ts` (rewrite), `NoteView.tsx`, `NoteBanners.tsx`, `CompareDialog.tsx`, `VersionsDialog.tsx` (new); `TempTextEditor.tsx` (deleted).
- `src/renderer/state/{app-services,tabs-store,notice-store,commands,shortcuts,palette-actions,ui-store,tree-store}.ts`; `src/renderer/ui/Dialog.tsx` (`returnFocus`); `src/renderer/styles/editor.css` (new), `components.css`, `main.tsx`.

Tests
- Unit (new): `tests/unit/{doc-schema,sniff,url-policy,retention,attachment-names,contracts-phase03}.test.ts`, `tests/unit/renderer/editor/{block-ids,sanitize,paste-pipeline,find,uploader,editor-registry,editor-schema,doc-drift}.test.ts`, `tests/unit/renderer/state/app-events.test.ts`; support `tests/unit/renderer/editor/support.ts`, `tests/unit/renderer/support/editor-source.ts`, `tests/support/images.ts`.
- Unit (updated): `note-controller` (rewrite), `tabs-store`, `tree-commands`, `shell-smoke`, `shortcuts`, `palette-actions`, `plain-text`, `textarea-doc`, `contracts`, `contracts-phase02`, `boundaries`, `fake-bridge`.
- Integration (new): `notes-save`, `notes-format`, `versions`, `drafts`, `attachments`, `flush-coordinator`, `ipc-handlers-phase03`; (updated) `revision`, `lease`, `protocol`, `ipc-validation`, `ipc-handlers-phase02`, `hierarchy-helpers`, `ipc-helpers`.
- E2E (new): `editor-ui.ts`, `paste.spec`, `conflict.spec`, `crash.spec`, `editor-flow.spec`, `editor-memory.spec`; (updated) `editor.spec` (rewritten and extended), `tabs.spec`, `visual.spec`, `keyboard.spec`, `security.spec`, `seed.ts`.

Docs: `docs/BACKLOG.md` (23 rows), `docs/DECISIONS.md` (D-059), `docs/UX_SPEC.md` (D-059 copy), this report.

## 4. IPC catalogue as implemented

Invoke channels appended in plan order: `lease:take`, `note:convertFormat`, `versions:list`, `versions:restore`, `drafts:list`, `drafts:resolve`, `attachment:importBytes` (measured as byte length plus the JSON of the other fields; ceiling 200 MiB + 64 KiB), `attachment:importFromDialog`, `shell:openExternal`, `app:flushed`; `note:create` takes an optional `format`. Events: `note:revision`, `note:lease` (broadcast), `lease:release-request`, `app:flush-request` (one webContents). The bridge surface matches plan section 6.3 (`security.spec › bridge surface`). No difference from plan section 6.

## 5. Commands (final gates; every log ends with `EXIT=<code>`)

| Command | Host | Exit | Duration | Log |
| --- | --- | --- | --- | --- |
| `npm run check` (356 unit, 185 integration + 1 Linux-only skip, traceability fails=0; re-run after the last test change) | Windows | 0 | 18 s | `final-win-check.log` |
| `npm run build` | Windows | 0 | 4 s | `final-win-build.log` |
| `npm run test:e2e` (111 passed, 1 Linux-only skip; screenshots to `screens/win`) | Windows | 0 | 150 s | `final-win-test-e2e.log` |
| `npm run package:current` (NSIS `Infinity-Notes-Setup-0.1.0-x64-unsigned.exe`, sha256 `b3d617cbb09779afc13e354abc3358e45eb8f77295ef81bd3cff41ec1b4218ac`) | Windows | 0 | 29 s | `final-win-package-current.log` |
| `npm run verify:native -- --packaged` | Windows | 0 | 1 s | `final-win-verify-native-packaged.log` |
| `npm run test:e2e:packaged` (2 passed) | Windows | 0 | 3 s | `final-win-test-e2e-packaged.log` |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | 0 s | `final-deps-unchanged.log` |
| rsync mirror + `diff -rq` (`MIRROR_IDENTICAL`) | WSL | 0 | 2 s | `final-wsl-sync.log` |
| `npm run check` (356 unit, 186 integration, fails=0; re-run after a re-sync) | WSL | 0 | 16 s | `final-wsl-check.log` |
| `npm run build` | WSL | 0 | 4 s | `final-wsl-build.log` |
| `npm run test:e2e` under WSLg (112 passed; screenshots to `screens/wslg`) | WSL | 0 | 151 s | `final-wsl-test-e2e-wslg.log` |
| `env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e` (Xvfb, 112 passed) | WSL | 0 | 144 s | `final-wsl-test-e2e-xvfb.log` |
| `npm run package:linux` (AppImage and .deb) | WSL | 0 | 26 s | `final-wsl-package-linux.log` |
| `npm run test:e2e:packaged` (2 passed) | WSL | 0 | 2 s | `final-wsl-test-e2e-packaged.log` |
| forced Wayland `INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e` (informational, D-050): 59 passed, 53 failed | WSL | 1 | 1585 s | `final-wsl-test-e2e-wayland.log` |

Step gates S1–S8 and development runs are listed in the checkpoints (`S*-*.log`, `wsl-*.log`); `S7-dev-*.log` runs with EXIT=1 are development runs whose failures led to the fixes in section 11. Logs of the discarded earlier attempt were moved to `sonnet-discarded/` and are not evidence. After the runs no `electron` process remained on Windows (`tasklist`) or WSL (`ps`).

## 6. Requirement coverage (W = Windows, L = WSLg and Xvfb; final runs above)

| ID | Assertions run | W | L | BACKLOG |
| --- | --- | --- | --- | --- |
| INF-TABS-07 | e2e/editor.spec › single editor instance; e2e/editor-memory.spec (perf record, section 9); unit editor-registry, uploader › bounded queue | pass | pass | done |
| INF-KEY-04 | e2e/editor.spec › find in note; unit find.test | pass | pass | done |
| INF-EDIT-01 | unit boundaries › one editor engine (no hand-made contentEditable or execCommand; only NoteEditor calls useEditor), shell-smoke (editor mounts as role textbox; JSON save through the live editor); e2e role textbox in every editor spec | pass | pass | done |
| INF-EDIT-02 | unit editor-schema, doc-drift; e2e/editor.spec › formatting survives reload, › undo and redo | pass | pass | done |
| INF-EDIT-03 | e2e/editor.spec › rename flushes, › editor save increments revision | pass | pass | done |
| INF-EDIT-04 | integration notes-format › plain note; e2e/editor.spec › plain note (real clipboard HTML and bitmap); unit paste-pipeline | pass | pass | done |
| INF-EDIT-05 | integration notes-format › version created; e2e/editor.spec › conversion warning and version history | pass | pass | done |
| INF-EDIT-06 | unit block-ids (with negative control); e2e/paste.spec › copied blocks get new IDs | pass | pass | done |
| INF-EDIT-07 | unit sanitize, paste-pipeline; e2e/paste.spec › no script execution | pass | pass | done |
| INF-EDIT-08 | integration attachments › png bytes; e2e/paste.spec › bitmap from the real clipboard | pass | pass | done |
| INF-EDIT-09 | integration attachments › dialog import copies; e2e/paste.spec › original removed, › drop (synthetic) and data image | pass | pass | done |
| INF-EDIT-10 | unit sniff; integration attachments › limits; e2e/paste.spec › oversized and unsupported | pass | pass | done |
| INF-EDIT-11 | e2e/editor.spec › image size preset | pass | pass | done |
| INF-EDIT-12 | integration notes-save › Bangla; e2e/editor.spec › Bangla | pass | pass | done |
| INF-EDIT-13 | e2e/editor.spec › save indicator | pass | pass | done |
| INF-EDIT-14 | integration attachments › document import; e2e/paste.spec › document chip | pass | pass | done |
| INF-SAVE-01 | integration notes-save › ack, flush-coordinator; unit note-controller, app-events; e2e/editor.spec › flush on close, tab switch, window close, quit (main.log `flush: requested=1 acked=1 timedOut=0`) | pass | pass | done |
| INF-SAVE-02 | integration notes-save › atomic commit | pass | pass | done |
| INF-SAVE-03 | integration revision (F-01-3 cases), drafts; e2e/conflict.spec › stale save keeps a draft, › trashed while editing keeps a draft | pass | pass | done |
| INF-SAVE-04 | integration lease (release request only to the holder, holder flush before the grant, reset, second viewId refused); e2e/conflict.spec › read-only mirror, busy holder, silent holder | pass | pass | done |
| INF-SAVE-05 | e2e/crash.spec › renderer crash (auto reload, lease reset, edit after), › killed process | pass | pass | done |
| INF-SAVE-06 | integration versions; e2e/editor.spec › conversion warning and version history | pass | pass | done |
| INF-SEC-01 | unit url-policy; integration ipc-handlers-phase03 › shell:openExternal; e2e/editor.spec › link open | pass | pass | done |

Visual evidence (V, review only): `.infinity-work/logs/phase-03/screens/win/` and `screens/wslg/` — the Phase 02 set regenerated (F-02-4) plus `1100x720-{light,dark}-rich-note`, `1100x720-light-plain-note`, `1100x720-light-conflict-banner`, `1100x720-light-read-only-banner`, `1100x720-light-find-bar`, `760x560-light-editor-toolbar`.

## 7. Follow-ups

| Item | Result | Files and tests |
| --- | --- | --- |
| F-02-1 | `closeNoteTabs` flushes before disposing; a trashed conflict shows `Your unsaved edits to "<title>" were kept as a recovered draft. Restore the note from Trash to see them.`; tabs stay open for every failed flush except CONFLICT, LEASE_REQUIRED and NOT_FOUND | `tabs-store.ts`, `notice-store.ts`; unit tabs-store (3 cases); e2e conflict.spec › trashed while editing keeps a draft |
| F-02-2 | Done by the planner (D-051) | — |
| F-02-3 | Done by the Phase 01–02 cleanup | — |
| F-02-4 | Windows screenshot set regenerated on the final tree | `screens/win/` (16 files) |
| F-01-3 | Retried conflict and lease-lost saves return the same error and draft without a second row | `note-writer.ts`, `request-cache.ts`; integration revision (3 cases) |
| F-01-2 | The protocol refuses symlinked files and files whose realpath leaves the real attachments directory | `attachment-protocol.ts`; integration protocol › junction or symlink escape refused (Windows junction, Linux directory symlink); › a file symlink (Linux only; creating file symlinks on Windows needs administrator rights, recorded platform condition) |
| D-048 gap | Window close and quit flush through `FlushCoordinator` | `window-lifecycle.ts`, `flush-coordinator.ts`; e2e flush on window close and quit |

## 8. Paste evidence

Every clipboard case used the real OS clipboard, seeded from main with the Electron 44 API `clipboard.write([new ClipboardItem(...)])`, and a real Ctrl+V on all three hosts (Windows 11, WSLg, Xvfb); the `webContents.paste()` fallback was not needed. File drop is SYNTHETIC (a page-built DataTransfer dispatched as dragenter, dragover and drop) because Playwright cannot drag files from the OS. Windows E2E overwrote the OS clipboard during the paste specs.

## 9. Performance record (`editor-memory.spec`; numbers only, no targets claimed)

10 tabs, one note with 20 images; samples after 0, 1 and 5 full cycles (`usedJSHeapSize`; working sets in KB):

| Host | 0 cycles | 1 cycle | 5 cycles |
| --- | --- | --- | --- |
| Windows (`perf-editors-win.json`) | heap 19.1 MB; renderer 207452, total 516292 | heap 21.7 MB; renderer 245692, total 555416 | heap 38.7 MB; renderer 256360, total 575092 |
| WSLg (`perf-editors-wslg.json`) | heap 19.1 MB; renderer 242900, total 674980 | heap 22.3 MB; renderer 277208, total 699540 | heap 46.1 MB; renderer 354212, total 782420 |
| Xvfb (`perf-editors-xvfb.json`) | heap 19.1 MB; renderer 243996, total 672376 | heap 22.3 MB; renderer 277824, total 696496 | heap 40.7 MB; renderer 282368, total 708888 |

Structural invariants asserted at every step: one live editor (`data-live-editors="1"`, one `.ProseMirror`) on note tabs and none on Home; images only for the active note and only through `infinity-attachment://`. The heap grows across cycles without a forced GC; Phase 09 owns targets and leak analysis.

## 10. Decisions and deviations

- D-059 (new): plain-text notes refuse pasted or dropped documents with "Plain-text notes cannot contain files. Convert to rich text to add files."
- The image node is a new `Node` named `image` instead of `Image.extend`: the stock extension brings a markdown input rule and a `src` attribute that would create remote or attachment-less image nodes (R-06). `@tiptap/extension-image` stays installed and unused (no dependency change).
- `writeNoteContent` is `NoteContent.write`; the content-operation guard of plan 8.6 is `ContentOps`.
- The conversion and version-restore confirmations use the existing `ConfirmDialog` (no separate `ConvertDialog.tsx`).
- Editor unit tests live in `tests/unit/renderer/editor/` (only the web tsconfig compiles TSX).
- `NoteEditor` is remounted with `key={format:contentKey}` instead of a `contentKey` prop with `useEditor` deps.
- `Dialog` gained `returnFocus` (default true); the link dialog hands the focus back to the editor so typing continues where the link was applied.
- The plain text of rich notes keeps empty paragraphs as empty lines, so a rich-to-plain conversion keeps blank lines.

## 11. Issues found and fixed during the phase

| Severity | Reproduction | Expected | Actual | Fix and regression test |
| --- | --- | --- | --- | --- |
| High | Paste a bitmap and wait | image appears | stayed "Adding image…" | the `NoteEditor` effect re-ran on every render and disposed the uploader; deps fixed, `bind` re-enables; e2e editor.spec › save indicator, paste.spec › bitmap |
| High | Paste a bitmap, then paste HTML | both kept | the image was replaced (selection was a NodeSelection on it) | `insertBlocks` leaves a text cursor after inserted attachments; unit uploader › leaves a text cursor; e2e editor-flow |
| Medium | Scroll a note, switch tabs within 500 ms, return | scroll restored | position lost | pending scroll applied before switching; e2e single editor instance |
| Medium | Save in the Link dialog and keep typing | focus in the editor | focus on the toolbar button | `Dialog.returnFocus`; e2e formatting survives reload |
| Medium | Paste HTML that is a frameset | no crash | the sanitizer threw (DOMPurify returns null) | returns ''; unit sanitize › a frameset document keeps nothing |
| Medium | Restore draft right after a handled conflict | restores | refused with the old conflict message | content operations stop only on a failed flush with unsaved edits; unit note-controller › restore draft |
| Low | Rich-to-plain conversion | blank lines kept | dropped | `extractPlainText` empty paragraphs; unit plain-text |
| Low | Checklist rendering | checkbox beside the text | text below the checkbox | CSS selector; screenshots |

## 12. Not run or pending

- GNOME and X11 desktop sessions: outside the user-selected validation scope (WSLg results are WSLg/Weston, not GNOME).
- Forced Wayland (`--ozone-platform=wayland`), informational per D-050: 59 passed, 53 failed (`final-wsl-test-e2e-wayland.log`). 38 failures are `locator.click` timeouts and 6 are `page.screenshot` timeouts (no compositor frame callbacks for the forced Wayland window under WSLg, the D-050 behavior; Phase 02 already recorded 15 such failures with fewer pointer-driven cases); the rest follow from those steps. The default WSLg run (ozone x11) and Xvfb pass every case. A first attempt ran concurrently with Linux packaging and was stopped by me (`wsl-test-e2e-wayland-stopped.log`, EXIT=143); packaging and the packaged E2E were then repeated alone and the Wayland run was repeated on its own.
- Pasting files copied in an OS file manager (file-list clipboard) is not automated and not asserted.
- Native OS validation matrix items stay with Phase 09.

## 13. Known limitations

An image still importing when a window closes may be missing from the note (window close and quit wait at most 2000 ms per window, D-055). Block IDs of a never-edited note are persisted at its first edit (D-053). Images have size presets only (no drag-resize). File chips cannot be opened until Phase 07. Size-limit and retention settings have no UI until Phase 08. Attachment garbage collection is Phase 08. The unacknowledged window (typing within 400 ms before a crash or kill) is not asserted (PRODUCT_SPEC section 9).

## Repair 1 (2026-10-09, QA defects QA-1, QA-2, QA-3 from `docs/progress/phase-03-qa.md`)

### Fixes

| Defect | Cause | Fix | Regression tests |
| --- | --- | --- | --- |
| QA-1 (medium): a rich note over about 5 MB showed only "Not saved" with the tooltip "Request is too large" | The `note:save` router ceiling (5 MB + 64 KiB) answered with the router's generic message; the friendly copy came only from the writer's own limit; the note view showed save errors only as a tooltip | `RegisterOptions.tooLargeMessage`; `note:save` uses `NOTE_TOO_LARGE_MESSAGE` for the router ceiling too; `NoteView` shows the save error as visible `role="alert"` text below the save status. The content stays dirty (nothing lost; undo recovers) | integration `ipc-handlers-phase02 › note:save accepts a 4.9 MiB document and rejects larger ones` (exact message for 5 MB + 1, 5 MB + 70 KB and 6 MB); e2e `paste.spec › a note over 5 MB says why it is not saved…` |
| QA-2 (medium): pasting 12,000 paragraphs took 34 s; a 9.6 MB paste killed the renderer (`oom`) and lost typing from the last 400 ms | UniqueID's pass over the pasted range is quadratic (one `setNodeMarkup` per new block, each copying the sibling list, plus a duplicate search per block); no paste size bound; the frozen renderer never ran the save debounce | Pasted and dropped slices get fresh IDs in `BlockIdGuard.transformPasted`; UniqueID skips paste and drop transactions; the duplicate repair is one scan per document. Pastes over 8 MiB are refused before parsing with "This paste is too large (over 8 MB). Paste a smaller part."; from 256 KiB on, pending edits are saved (controller flush) before the paste runs (D-060) | unit `paste-scaling.test` (12,000 paragraphs: 31.8 s before the fix, about 1.1 s after in jsdom; 6,000 vs 3,000 ratio under 3.2), `paste-limits.test › a paste over 8 MB is refused…`, `› a large paste first saves pending edits…`, `› a small paste is not delayed`; e2e `paste.spec › large pastes are linear, save earlier typing first, and over 8 MB are refused` (12,000 paragraphs in 371 ms Windows, 465 ms WSLg, 460 ms Xvfb) |
| QA-3 (low): a 40-level pasted list was accepted, then every save failed | The editor had no depth or size bound matching `normalizeRichDoc` (64 levels, 100,000 nodes) | `DocLimits` plugin (`src/renderer/editor/doc-limits.ts`) refuses any change that would exceed either limit, with "This would nest lists or quotes more deeply than a note can store. Use fewer levels." or "This would make the note too large to store. Paste or add a smaller part."; work is proportional to each change, the node count is tracked incrementally (D-061) | unit `paste-limits.test › a pasted list nested deeper…`, `› a list nested as deep as allowed…`, `› indenting with Tab stops at the limit…`, `› a paste that would exceed 100,000 parts is refused`; e2e `paste.spec › a paste nested deeper than a note can store is refused with a message` |

Files: `src/main/ipc/router.ts`, `src/main/ipc/handlers/note-handlers.ts`, `src/renderer/editor/{block-id-guard,extensions,paste,NoteEditor}.ts(x)`, `src/renderer/editor/doc-limits.ts` (new), `src/renderer/notes/NoteView.tsx`; tests `tests/unit/renderer/editor/{paste-scaling,paste-limits}.test.ts` (new), `tests/unit/renderer/editor/support.ts`, `tests/integration/ipc-handlers-phase02.test.ts`, `tests/e2e/paste.spec.ts`; docs `docs/DECISIONS.md` (D-060, D-061), `docs/UX_SPEC.md` (new copy), this section.

### QA specs and probes (not edited)

`.infinity-work/qa/p03.config.ts` (all `p03-*.spec.ts`, including PS3 and `p03-probe-{limit,big,big10,nest}`) on Windows: 48 passed (`repair1-qa-probes-win.log`). Observations from the probes: PS3 hint and visible text carry the UX_SPEC copy; BIG 1,500 / 3,000 / 6,000 paragraphs render in 87 / 128 / 203 ms (was 0.7 / 2.3 / 8.7 s); the 9.57 MB paste is refused with the message and "KEEPME" stays saved in both BIG10 variants (no renderer crash); NEST 20 and 31 save (stored depth 40 and 62), NEST 40 is refused with the depth message and the note stays saved.

### Repair 1 gates (after the last change; every log ends with `EXIT=<code>`)

| Command | Host | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| `npm run check` | Windows | 0 | 365 unit, 185 integration + 1 Linux-only skip, traceability fails=0 | `repair1-win-check.log` |
| `npm run build` | Windows | 0 | | `repair1-win-build.log` |
| `npm run test:e2e` | Windows | 0 | 114 passed, 1 Linux-only skip; screenshots regenerated in `screens/win` | `repair1-win-test-e2e.log` |
| `npm run package:current` | Windows | 0 | NSIS, sha256 `9da5933f49d7c23f2f9b3369e701e556b9c80635a3d05efa92290a373e5960a5` | `repair1-win-package-current.log` |
| `npm run test:e2e:packaged` | Windows | 0 | 2 passed, `sandboxed=true integrity=untrusted` | `repair1-win-test-e2e-packaged.log` |
| `git diff --exit-code package.json package-lock.json` | Windows | 0 | dependencies unchanged | `repair1-deps-unchanged.log` |
| rsync + `diff -rq` | WSL | 0 | `MIRROR_IDENTICAL` | `repair1-wsl-sync.log` |
| `npm run check` | WSL | 0 | 365 unit, 186 integration, fails=0 | `repair1-wsl-check.log` |
| `npm run build` | WSL | 0 | | `repair1-wsl-build.log` |
| `npm run test:e2e` under WSLg (ozone x11) | WSL | 0 | 115 passed; screenshots in `screens/wslg` | `repair1-wsl-test-e2e-wslg.log` |
| `env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e` (Xvfb) | WSL | 0 | 115 passed | `repair1-wsl-test-e2e-xvfb.log` |

Development run: `repair1-dev-paste.log`. The perf records `perf-editors-{win,wslg,xvfb}.json` were refreshed by these runs. Linux packaging and the forced-Wayland informational run were not repeated for this repair (the packaging configuration is unchanged; the earlier `final-wsl-package-linux.log` and `final-wsl-test-e2e-packaged.log` stand for the pre-repair tree only). No `electron` process remained on Windows or WSL after the runs.

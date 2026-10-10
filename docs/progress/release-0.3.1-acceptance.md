# Release 0.3.1 acceptance

Acceptor: infinity-acceptor (Opus, high effort). Date: 2026-10-11. Scope: the uncommitted v0.3.1 batch on `master` against HEAD `5ce2a0d` (110 files changed, 21 new), as described in `docs/progress/release-0.3.1.md` (D-182..D-185).

## Verdict

**Rejected. Repairs are needed before release.** Items 1 (rename), 2 (diagrams) and 3 (typed dates) are acceptable as implemented; their findings are minor. Item 4 (locked documents) is careful in most places, but it has one blocker that I reproduced. A sealed save that is in flight while the document's key is dropped gets encrypted with an all-zero AES key. The ciphertext is then readable by anyone, and the document becomes unreadable with the user's own password. The fix is small: get the key at the moment of sealing, or copy it, and add a regression test. Once B1 is repaired and the gates are re-run, the batch can be accepted. The minors can follow later.

## What I checked

- I read the progress doc, the decisions and the code of every item 4 file in the main process. That covers the migration and its checksum, the repositories, `document-locks.ts`, `lock-vault.ts`, `lock-service.ts`, `lock-purge.ts`, the comment cipher and service, `document-store.ts`, `document-files.ts`, `byte-source.ts`, `document-service.ts`, the spreadsheet service, worker and task, the document protocols, the lock handlers, the wiring in `main-services` and `index`, portability (portable export and repo), the test hooks and the sticky locks.
- On the renderer side, for items 1, 2 and 4, I read `Menu.tsx`, `RenameInput.tsx`, `DocumentView.tsx`, `use-document-lock.ts`, `LockDialogs.tsx`, `DialogHost.tsx`, `commands.ts`, `tabs-store.ts`, `paste.ts` and `code-fences.ts`.
- For item 3 I read `typed-date.ts`, `sheet-dates.ts`, `fortune-sheet-patch.config.ts`, and every call site of `genarate` in `@fortune-sheet/core` 1.0.4.
- **Gates re-run locally on Windows** (non-window only), with `npm run check`: lint clean, typecheck, unit 142 files / 1108 passed, integration 64 files / 584 passed + 2 skipped (pre-existing), traceability fails=0 warns=0, EXIT 0. Log: `.infinity-work/logs/release-0.3.1/acceptance-win-check.log`.
- I read the cited logs (I did not re-run them):
  - `final-e2e.log`: WSL Xvfb, 307 passed, 2 skipped, EXIT 0.
  - `final-e2e-packaged.log`: 8 passed.
  - `final-package.log`: .deb and AppImage built, EXIT 0.
  - `final-e2e-stickylocks.log`: 7 passed, after the last source change.
  - `win-build-final.log`: EXIT 0.
  - `final-sync-2.log`: MIRROR_IDENTICAL.
- Tests: no `.skip`, `.only` or `.todo` was added. The changed expectations are updated counts (channels, LATEST 15, `await lockAll`/`sweep`) and the button list. None was removed or weakened.
- **Probes** (scratch Vitest tests outside the repo suite, in git-ignored `.infinity-work/acceptance-031/`, on the real `setupDocuments` services). Output: `.infinity-work/logs/release-0.3.1/acceptance-probes.log`.
  - `zero-key.test.ts`: relock while a sealed save is in flight. This reproduces B1.
  - `lock-race.test.ts`: a plaintext save in flight while `lock()` commits. This reproduces m1.
- I ran no Electron window on the Windows desktop and no new WSL run. The E2E evidence above is the implementer's.

## Findings

### Blocker

**B1. A save racing a relock is sealed with an all-zero key, so its plaintext can be recovered and the document is lost to its owner.**

- Where: `src/main/locks/document-locks.ts:302-304` (`sealerOf` captures `vault.keyOf(...)`, the vault's own Buffer, in a closure) together with `src/main/documents/document-store.ts:63-64` (`putSealed` awaits `isDocumentOfKind` before it calls `seal`).
- How the key gets zeroed: `src/main/locks/lock-vault.ts:82` (`drop` runs `unlocked.key.fill(0)` on that same Buffer) and `lock-vault.ts:59` (`put` zeroes the previous key when an item is unlocked again).
- Failure scenario (reproduced): a locked document is unlocked. `DocumentService.save` reaches `writeManaged`, so `sealerOf` has captured the key and `putSealed` is awaiting the kind check. At that moment `DocumentLocks.relock` drops the key, as it does after idle time, Lock all, screen lock or suspend, quit (`LockService.stop`), or Remove lock.
- What the probe shows:
  - The save reports **saved**.
  - The new current blob **opens with `Buffer.alloc(32)`**, so the file on disk is effectively plaintext.
  - After unlocking with the real password, `sourceOf` fails with `INTERNAL "This file is not a readable word document."`. The content is unreadable to its owner, Remove lock fails, and the earlier versions were deleted at lock time.
- Why the honest UI can reach it: `relock` awaits `saveOpenEdits`, but that is the window flush, which has a 5 s timeout (`FLUSH_TIMEOUT_MS`) and does not throw when it times out (`index.ts:240-243`, `document-locks.ts:186-197`). A large xlsx or pptx save that outlives the flush, or a quit or suspend while a save is running, puts the drop inside the window between the kind check and the seal. The same pattern in `plaintextOf` (`document-locks.ts:279-288`: key captured, then `await store.read`) turns a relock during a read into a spurious "damaged" error (minor m4).
- Repair:
  - In `sealerOf`, call `keyOf` inside the returned function, synchronously at seal time: `(bytes) => seal(this.deps.vault.keyOf(documentId, …), …)`, so a dropped key fails with FORBIDDEN. Alternatively, copy the key (`Buffer.from(key)`) and zero the copy after `seal`.
  - In `plaintextOf`, call `keyOf` after the `await store.read`.
  - Add an integration test in `tests/integration/document-locks.test.ts`, modeled on the probe: start a sealed save, relock without awaiting, then assert that the save was refused (or sealed under the real key) and that the document still opens with the password.
  - Check that `restoreVersion` follows the same path (it goes through `writeManaged`).

### Major

None beyond B1.

### Minor

**m1. A plaintext save that loses the race to `lock()` leaves the newest plaintext on disk for 7 days.**

- Where: `src/main/locks/document-locks.ts:103-135`. `lock()` uses `LockKeys.exclusive`, not DocumentService's per-document save queue (`this.saves.run`). `replaceContent` does not bump the revision.
- Scenario (reproduced with a slowed text extraction): an unlocked document's save has written its plaintext blob through `putBytes`, and then `lock()` commits. The save's commit is refused by the trigger `documents_locked_plaintext` (the user sees "Something went wrong" and the edits are not in the document). The plaintext `.docx` blob of those newest edits stays in `data/documents/` as an unreferenced row until blob GC (`ATTACHMENT_GC_GRACE_MS` = 7 days). That contradicts "removes the old plaintext blob files at once".
- Reachability: low in the UI. `LockDocumentDialog` flushes the active tab first (joining a save under way), and the dialog is modal.
- Repair: run `lock()` and `remove()` inside DocumentService's save queue for the document (or a shared per-document mutex), or have `lock()` bump the revision and, after its transaction, `removeUnused` any unreferenced plaintext blob created since it started.

**m2. `remove()` has no revision check.**

- Where: `src/main/locks/document-locks.ts:245-257` reads `row` before the awaits and commits without checking `revision`/`blob_id`. `lock()` does check (line 118).
- Scenario: a sealed save lands between the read and the transaction. `replaceContent` puts back the older bytes, so the newer save is silently reverted. The version the save created keeps pointing at a sealed blob of a document that is now unlocked; it was not in the `versions` list that was opened.
- Repair: the same `fresh.revision`/`blob_id` check as in `lock()` (CONFLICT), or the shared queue from m1.

**m3. `document:saveCopy` is not refused for locked documents.**

- Where: `src/main/documents/document-service.ts:405-406` uses `liveRow`, not `unlockedCopySource`. The renderer offers "Save a copy…" on the conflict banner (`DocumentView.tsx:336`) whether or not the document is locked. It uses bytes the renderer still holds (`refused.current`), so it also works after the tab has locked again.
- Scenario: a locked document hits a save conflict and the user picks "Save a copy…". A plaintext file is written where the user chose (acceptable, like Export a copy). The app also adds an **unlocked linked document whose text is extracted into `documents_fts`/`body_text`**. That is the "unencrypted copy inside the app" that `createBeside` and `copyVersion` refuse with `noCopyInside`.
- Repair: refuse in main for `row.locked === 1` (or write the file without adding a document), and hide the button while `lockedOut`.

**m4. Relock during a read gives a "damaged" error instead of the lock screen.**

- Where: `document-locks.ts:279-288`.
- The key is captured before `await store.read`. A drop during the read makes `open` run with zeros, which gives `SealError`, then INTERNAL "not a readable … document". The protocol answers 404 (not 403) and the viewer shows a damage message.
- Repair: fixed together with B1.

**m5. Cell comment anchors keep the sheet name in the clear.**

- Where: `src/shared/comments/anchors.ts` (`cell.sheet`, stored in `comment_threads.anchor_json`, which the lock leaves unencrypted).
- Sheet names can be content ("Salaries 2026"). Either seal `anchor_json` for locked items or mention it in `DOCUMENT_LOCK_POINTS` (`src/renderer/notes/lock-form.ts:20-25`).

**m6. Ctrl+Shift+V does not keep fences as text.**

- Where: `src/renderer/editor/paste.ts:97`. The fenced-text branch in `pasteFromEvent` runs for every paste with HTML.
- Scenario: Ctrl+Shift+V of Markdown copied from VS Code (text plus styled HTML) still turns the fences into code blocks or diagrams. The parser's own comment promises that "Paste as plain text keeps it text", and the clipboard-text path does respect `plain`.
- Repair: skip the branch when ProseMirror pastes as plain. Track Shift on keydown, as ProseMirror does, or leave the fence handling to `clipboardTextParser`.

**m7. The graph never marks documents as locked.**

- Where: `src/main/graph/graph-service.ts:59` hard-codes `locked: false` for documents.
- Cosmetic: the graph shows titles only either way.

**m8. A code comment is inaccurate.**

- Where: `src/main/windows/document-protocol.ts:46`.
- It says decrypted bytes "live in an ordinary (never shared) ArrayBuffer". Buffers under 4 KB from `Buffer.concat` come from Node's shared pool. The code is correct (it uses `byteOffset`/`byteLength`); only the comment is wrong.

## Item reviews

### Item 4: locked documents, confidentiality checklist (apart from B1 and m1-m3)

- **Migration 015**: forward-only. `checksums.json` adds only `"15"`, and 1-14 are unchanged. The `ADD COLUMN ... NOT NULL DEFAULT 0 CHECK` statements are valid on STRICT tables. The triggers refuse a locked row that is not managed, has non-empty `body_text`, or has an unsealed current blob. They also refuse inserting an unsealed version, plaintext comments or quotes, and creating a lock while plaintext versions or comments still exist. Migration forward from schema 6 is covered by `restore.test`.
- **Lock transaction** (`document-locks.ts:103-135`):
  - The bytes are sealed in memory (`putSealed` writes only ciphertext through a `.part` that is removed in `finally`).
  - The revision and blob are re-checked inside the transaction.
  - Versions are deleted, `body_text` is set to '' (the FTS trigger deletes the old tokens), comments are sealed, and the lock row is inserted.
  - Replaced plaintext blobs are removed at once (`removeUnused` keeps bytes another document uses).
  - The scrub runs `secure_delete`, FTS `optimize` (now including `documents_fts`), `VACUUM` and `wal_checkpoint(TRUNCATE)`, with a retry. OK.
- **Protocols** (`document-protocol.ts`): `infinity-document://` and `infinity-html://` both go through `DocumentService.sourceOf`.
  - While locked, FORBIDDEN gives 403, for `?version=` too (versions are sealed blobs and are opened with the document-bound key).
  - While unlocked, the bytes are served from memory, with `Cache-Control: no-store` on both.
  - HEAD, ranges and 416 work from memory.
  - The main window uses the default session, but every document response is no-store. I found no Cache API, IndexedDB or localStorage use in the renderer.
- **Workbook worker**: `worker_threads` takes `workerData` as an in-memory clone. No temp file is written, and `readXlsx`/`readCsv`/`packageFeatures`/`isDocumentOfKind` take bytes.
- **Text extraction**: never run for sealed blobs (`writeManaged` uses '' for locked documents). `open()` re-extracts only linked documents, and a locked document is always managed.
- **Refused while locked** (main and UI): Open in system app, Show in folder, `createBeside` (PDF extract and merge), Versions "Save as copy". `saveCopy` is the exception (m3). Export a copy writes plaintext only where the user chooses and is disclosed in the dialog.
- **Restore of a version**: decrypted with `plaintextOf`, re-sealed through `writeManaged`, and the previous current blob becomes a sealed version. Affected by B1 like any sealed save.
- **Relock**: flushes the active tab (only the active tab holds edits: `leaveActive` flushes on every switch), then drops the key, forgets the plaintext cache and emits `lock:documentLocked`; the tab swaps the viewer for the lock screen. Idle, Lock now, Lock all, screen lock, suspend and quit all go through it. B1 is the defect here.
- **Exports and backups**:
  - The portable export leaves out locked documents (`d.locked = 0`) and sealed comments, and counts them.
  - Backups copy the database and the sealed files, so they hold ciphertext.
  - Note export, print and `export-tmp` cover notes only.
  - No drag-out exists for documents.
- **Logs**: only IDs, flags and counts. No passwords and no content.
- **Linked copy-in**: the size is checked before reading (`currentBytes`), the document becomes managed, the original is untouched, and the dialog says so. Over the limit the dialog explains and does not offer the lock.
- **Disclosure**: `DOCUMENT_LOCK_POINTS` states that titles are unencrypted, that versions and search text are destroyed, that earlier backups and exports and note attachments are unchanged, and that a forgotten password cannot be recovered.
- **Out of scope (documented)**: SSD and file-system remnants, process memory while unlocked (the plaintext cache is not zeroed, only dropped), and copies made before locking.

### Item 3: typed dates

- `parseTypedDate` (`src/shared/time/typed-date.ts`) needs one separator throughout and a four-digit year of at least 1900, with day and month checked against the month length.
  - Stay text: "1.5", "3-4", "1,5", phone numbers ("555-1234", "+1 555 123 4567"), thousands-separated numbers ("1.234.567"), invalid dates (31-02-2026), and invalid times ("24:00", "13 PM", "10:61").
  - "05-06-7890"-style codes become dates (year 7890), which matches Excel (years up to 9999).
  - Ambiguous day and month follow `dateOrderOf(app.getSystemLocale())`, and a part over 12 always decides.
  - Excel serials around the fictitious 29 February 1900 match Excel.
- The hook only sees strings. FortuneSheet's text-format (`@`) branch runs before `genarate`, so cells formatted as text are not converted, and number calls (`genarate(number)`) bypass the hook.
- Autofill (`fillDays`) feeds "YYYY-MM-DD", which the hook parses to the same serial.
- The build patch fails when `function genarate(value) {` is not present exactly once.
- CSV: written as shown, and read back only when the text formats back identically, so an untouched CSV saves the same bytes. The xlsx round trip through ExcelJS is covered by `sheet-dates.test`.
- No wrong conversions found. Accepted.

### Item 1: rename

- `Menu.tsx` now refocuses the opener only when focus was lost (body, null or inside the menu). That fixes the root cause for notes and documents alike, and keeps the old behavior for items that do not move focus.
- `RenameInput` has an in-flight guard (no double commit on Enter then blur) and selects on mount.
- `checkRename` keeps the "title may be empty" rule for notes and "name required" for documents.
- Tab and header rename use the same check. Renaming a locked document is allowed; titles are unencrypted, as for notes, and this is disclosed.
- Covered by unit tests (the menu case fails with the old `Menu.tsx`, per the progress doc) and by E2E in WSL. Accepted.

### Item 2: diagrams

- `insertDiagram` and `toggleDiagram` are reachable from the context menu, the toolbar, the slash menu and the palette.
- A fence line followed by Enter makes a code block. Pasted text with complete fences becomes code blocks; unclosed fences stay text, and plain-format notes are unaffected (handled earlier, and their schema has no code block).
- HTML with `pre`/`code`/`table` still pastes as HTML.
- No regression found for ordinary note pastes; m6 is the only gap. Accepted.

## Native and OS cases not run

These were not run by the implementer or by me:

- Windows Electron E2E (unpackaged and packaged) and the Windows installer. These run on GitHub Actions only, by rule.
- Real Windows Hello prompts for documents (fake verifier only).
- Real OS screen lock and suspend events.
- Native WSLg sessions.

## Repair list for the implementer

1. **B1**:
   - Get the key synchronously at seal time in `sealerOf`, and after the read in `plaintextOf`.
   - Add an integration regression test for "relock while a sealed save is in flight" that asserts no blob opens with a zero key and the document still opens with the password.
   - Re-run `npm run check`, plus `locked-documents.spec`, `locks.spec` and `locked-stickies.spec` in WSL Xvfb.
2. Recommended in the same pass (small):
   - m3: refuse `saveCopy` in main for locked documents, and hide the button while `lockedOut`.
   - m1 and m2: serialize `lock()`/`remove()` with the document's save queue, and add a revision check to `remove()`.
3. Later: m5-m8.

## Re-check after repair (2026-10-11)

Scope: the repair of B1 and m1-m8 described in the "Repair" section of `docs/progress/release-0.3.1.md` and in D-185, on the uncommitted tree (116 files against `5ce2a0d`). No source or test file changed after the implementer's final WSL sync (`find src tests -newer repair2-sync.log` is empty). I edited no source and opened no Electron window.

### Verdict

**Accepted.** B1 is fixed structurally, m1-m8 are repaired with tests, the gates pass, and no new blocker or major was found. Three informational notes follow; none of them blocks the release.

### Evidence I produced

- **Acceptor probes re-run** (`.infinity-work/acceptance-031/`, unchanged). Log: `.infinity-work/logs/release-0.3.1/acceptance-recheck-probes.log`.
  - `zero-key.test.ts`: the save reports "saved", the current blob **does not** open with an all-zero key, and after unlocking with the real password the document is **readable**. Before the repair: opened with zeros, then "not a readable word document".
  - `lock-race.test.ts`: "save: saved | lock: locked". Exactly one blob row (sealed) and one `.sealed` file remain; no plaintext `.docx` is left behind. Before the repair: save failed, plaintext blob left for 7 days.
- **Windows non-window gate**, `npm run check` on the final tree: lint 0 warnings, typecheck, unit 143 files / 1109 passed, integration 65 files / 591 passed + 2 skipped (the same pre-existing skips), traceability fails=0 warns=0, EXIT 0. Log: `.infinity-work/logs/release-0.3.1/acceptance-recheck-win-check.log`.
- **Implementer's logs, read and not re-run**: `repair2-e2e.log` (WSL Xvfb full suite 307 passed, 2 skipped, EXIT 0), `repair2-e2e-packaged.log` (8 passed), `repair2-package.log` (EXIT 0), `repair2-check.log` (WSL, EXIT 0), `repair2-win-build.log` (EXIT 0), `repair2-sync.log` (MIRROR_IDENTICAL). The two single flakes recorded during repair (`nlp.spec` INF-NLP-12, and the `documents.spec` HTML viewer, whose cause was found and fixed) are both green in the final full run.
- **Tests**: no `.skip`, `.only` or `.todo` was added. The new `tests/integration/document-lock-races.test.ts` has 7 cases covering relock during a sealed save, a key dropped outright during a save (quit), re-unlock during a save, Remove lock during a save, a plaintext save during lock, relock during a read, and saveCopy/anchors/graph.

### B1: structural check (no key buffer held across an await)

- `LockVault.keyOf` is gone. The vault's buffers are private (the `keys` map). The only ways to reach a key are:
  - `withKey(id, use)`, which runs `use` synchronously. It refuses a Promise result, which is a guard against misuse; it does not prevent misuse, so it relies on every caller being synchronous, and every caller is.
  - `keyAccess(id)`, which re-resolves the key on every use and is therefore safe even when kept across awaits.
- Every caller (grep of `withKey|keyAccess|heldKey` in `src/main`):
  - `document-locks.ts:339`: `plaintextOf` takes the key after `await store.read`, inside a synchronous `open`.
  - `document-locks.ts:360`: `sealerOf` takes the key inside the seal callback, which `putSealed` calls after its `await isDocumentOfKind`; if the key is gone by then, the save fails with FORBIDDEN `lockedDuringSave`.
  - `lock-vault.ts:143,155,160,165`: note content, draft seal and draft open, all synchronous.
  - `comment-service.ts:162` and `note-content.ts:62`: `keyAccess`.
  - `comment-cipher.ts:74,77` and `lock-service.ts:338`: `heldKey` on a lock operation's own data key, which the operation zeroes in `finally` after its transaction.
- Notes: `note-crypto` is synchronous and takes keys as arguments, and no note path keeps a vault Buffer. `vault.put` (re-unlock) and `drop` still zero in place, which is now safe because no one else holds the buffer.

### Queue and deadlock analysis

- `KeyedQueue` (`src/main/services/keyed-queue.ts`) serializes per document: `save`, `restoreVersion`, `lockQueued`, `removeQueued` and relock's key drop. Different documents run independently, and a failed task does not block the tail (`then(task, task)` plus `catch`).
- **Relock vs. flush cannot deadlock.** `relock` awaits `saveOpenEdits()` (the window flush, bounded by `FLUSH_TIMEOUT_MS`) *before* it enqueues the drop. The renderer's flush save therefore enters the queue ahead of the drop and is never behind it.
- **No queued task waits on IPC, a flush, `relock` or the queue itself.**
  - Spreadsheet saves run the workbook worker (which has its own timeout) *outside* the queue (`spreadsheet-service.ts:66-78`) and enqueue only `documents.save`.
  - `removeQueued`'s `vault.drop` fires listeners that are synchronous (`forget`, `onLocked`), with no re-entry into the queue.
  - Lock order is always `LockKeys.exclusive` → queue; nothing holds the queue and then waits on `exclusive`.
  - Windows Hello confirmation in `lock()` runs before the queue.
- **Quit with a hung save.** `LockService.stop()` (`lock-service.ts:94-100`) drops every key directly, not through the queue, so quitting never waits on a save. A save that resumes afterwards finds no key at seal time and is refused (`lockedDuringSave`), as the race test "a key dropped outright while a save waits (quit)" shows.
- Lock all, the idle sweep and screen lock or suspend wait for a save already under way before dropping that document's key. The sweep timer callback is `void`, so it keeps rescheduling.

### Migration 015 amendment

- 015 has never shipped:
  - `git ls-tree` of tags v0.1.0 (7 SQL files), v0.2.0 (10) and v0.3.0 (14) contains no `015`.
  - `git log --all` has no commit touching `015_document_locks.sql`.
  - The remote tags stop at `v0.3.0` → `5ce2a0d`.
- `checksums.json` changes against HEAD only by adding `"15"`; 1-14 are unchanged.
- The checksums are checked by `tests/unit/migrations-checksum.test.ts` only, not at runtime; the runner goes by `user_version`. Every released install (schema 14 or lower) runs the amended 015, so the amendment is safe for all of them.

### Minor repairs verified

- **m1/m2**: the queue serializes lock and remove with saves (probe above), and `removeQueued` re-checks revision and blob (CONFLICT).
- **m3**: `saveCopy` uses `unlockedCopySource` (`document-service.ts:407`), and the conflict banner hides the button for a locked document.
- **m4**: `plaintextOf` returns FORBIDDEN, not "damaged".
- **m5**: anchors of locked documents are stored as `{"type":"sealed",...}`. Migration 015 refuses a plaintext anchor (insert and update of `quote, anchor_json`) and refuses a lock while any thread is unsealed; a sealed anchor fits the 1000-character limit.
- **m6**: Shift is tracked in the editor's keydown and keyup, and `paste.ts:104` skips the fence branch.
- **m7**: `graph-service.ts:59` reads `d.locked`.
- **m8**: the protocol comment is corrected.

### Informational notes (no repair required)

1. A save that is hung in the queue (for example on a stalled disk) delays the key drop for that document on Lock all, idle or screen lock until the save settles. Quit is unaffected. Delaying the drop is the price of never sealing with a dropped key, and it is bounded by the save's own I/O.
2. Edits held after a refused save (`DocumentController.heldEdits`) stay in renderer memory, never on disk, until **Save them** (after unlocking) or **Discard them**. This falls under the documented "process memory" limit.
3. `paste.ts` `shiftDown` can stay true if Shift is released outside the editor. The only effect is that the next HTML paste keeps Markdown fences as text, which is the safe direction. Separately, any dev or test profile that ran the pre-amendment 015 lacks the new anchor triggers, because the runner goes by `user_version`. That matters only for throwaway userData.

### Not run (unchanged)

Windows Electron E2E and the installer (GitHub Actions only), native WSLg, real Windows Hello, and real OS screen-lock and suspend events.

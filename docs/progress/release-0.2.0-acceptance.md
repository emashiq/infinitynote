# Release 0.2.0 acceptance (v0.2.0 feature batch)

Acceptor: infinity-acceptor (Opus, high effort), 2026-10-10. Fast mode: I reviewed the code and the logs and re-ran only the parts I had doubts about (unit and integration tests). I did not run Playwright E2E or packaging, because another agent (Run D: CI repair and WSL) was using them.

Reviewed: CLAUDE.md (the v0.2.0 batch and fast mode), docs/progress/release-0.2.0.md (Runs A, B and C), and the uncommitted work against HEAD 62e8a67. That is 178 changed files plus the new files: `git diff HEAD`, the new modules under src/main/locks, src/main/services/linked-file*.ts and file-picker.ts, the shared formatting, color, table and text-style modules, migrations 008-010, the renderer dialogs and views, every changed test (each removed line was compared with its replacement), DECISIONS D-104..D-113, USER_GUIDE, and website/index.html and docs.html. I also read the command logs in .infinity-work/logs/release-0.2.0/.

## Verdict

**Accepted with repairs required.**

All seven requested features are implemented end to end. There are no stubs, no fake behavior and no weakened tests. The lock crypto is sound, the lock purge covers every table that held plaintext, and the documentation is honest about what is not guaranteed. The release should not ship until three things are fixed:

- the two linked-file security issues (findings 1 and 2);
- the table-span denial of service (finding 3);
- the full E2E gate, which is not green (finding 4: two failures that already fail at HEAD).

## Findings

1. **Major: imported linked-file paths are probed automatically, so a crafted export leaks Windows credentials.**
   - Where: `src/main/services/linked-file.ts:7,16` (UNC paths `\\host\share\…` are accepted), `src/main/portability/portable-import.ts:156-157` (link records from an `.infinityexport` are stored without any origin or trust check), and `src/renderer/editor/FileLinkView.tsx:23` (every rendered chip calls `fileLink:status`, which runs `fs.realpath`/`stat` on the stored path).
   - Scenario: someone sends a user an `.infinityexport` whose `links` include `\\attacker.example\s\invoice.pdf` or a WebDAV form such as `\\attacker.example@SSL\DavWWWRoot\x.pdf`. The user imports it and opens the note. Windows then connects over SMB or WebDAV and offers the user's NTLM credentials to the attacker, with no click needed. A dead host also blocks a libuv thread pool slot for each chip. "Open" then hands a remote document to the OS handler.
   - Repair: never probe a remote path automatically.
     - Option A: on import, mark link records `untrusted`, or refuse UNC and WebDAV paths there. `status` would then answer `missing`/`unverified` without touching the file system until the user re-links the file or confirms.
     - Option B: for any UNC path, `status` does no I/O and Open or Copy into Infinity Notes needs an explicit main-side confirmation.
     - Either way, add integration tests: an import with a UNC link is never stat'ed (inject the fs layer or assert no I/O through a spy), and the UNC cases of `isUsableLinkPath`.

2. **Major: `fileLink:create` takes any path string from the renderer, so with `fileLink:copyIn` a compromised renderer can read any file.**
   - Where: `src/main/ipc/handlers/attachment-handlers.ts:36,40`, `src/preload/index.ts:39-48` (the bridge exposes `fileLink.create({path})` alongside `pathOf`), and `src/main/services/linked-file-service.ts:45-57,88-91`.
   - Scenario: script running in a renderer (main window or sticky) does the following, which reads up to 25 MB of any file the user can read (for example `~/.ssh/id_rsa` or browser profile files):
     1. Calls `bridge.fileLink.create({ path: 'C:\\Users\\me\\.ssh\\id_rsa' })`.
     2. Saves a document holding a `fileLink` node with the returned ID (the content indexer records the use).
     3. Calls `fileLink.copyIn`.
     4. Reads the copy through `infinity-attachment://`.
   - Why it matters: before v0.2.0 the renderer could never name a path. D-108 even introduced pick sessions so that picked paths never leave main, and `security.spec` asserts "renderer cannot read files". This channel undoes that property. `fileLink:status` is also a file-existence oracle for any path.
   - Repair: remove the raw path from the bridge. The preload should expose `fileLink.createFromFile(file: File)`, which calls `webUtils.getPathForFile` and sends the IPC itself. Page script cannot make a `File` carry an arbitrary path, so it can no longer choose the path. Also consider a main-side confirmation for `copyIn` of a file the user did not drop or pick in this session. Extend `security.spec` "bridge surface" and "renderer cannot read files" to cover it.

3. **Major (robustness): table spans are unbounded in total size, so a small document can hang or crash the editor.**
   - Where: `src/shared/editor/doc-schema.ts:46,152-153`. `MAX_CELL_SPAN = 1000` per cell, and nothing bounds the table grid.
   - Scenario: a table of about 2,200 nodes passes `normalizeRichDoc`, the paste sanitizer and portable import. It has one row of 100 cells with `colspan` 1000, followed by 1000 one-cell rows. I verified this with prosemirror-tables' `TableMap.get` in a scratch script: width 100,000, 100,100,000 map entries, about 1.5 GB heap and 1 s. `fixTables` would then try to add about 100 M cells. A crafted `.infinityexport`, or a pasted HTML table, therefore leaves a note that hangs or crashes the renderer when it is touched.
   - Repair: in `normalizeRichDoc` (main) and the paste path, bound the spans to a small value (for example 50) and the grid (columns × rows, for example 10,000 cells, and columns of, say, 100 or fewer). Refuse with a message, as D-060/QA-3 do for nesting depth. Add unit tests.

4. **Major (gate; existing before this batch): the full Windows E2E gate is not green.**
   - Evidence: runC-e2e-full-2.log shows 235 passed, 3 failed and 1 skipped. Two failures are deterministic and also fail on a build of HEAD 62e8a67 (runC-e2e-head-baseline.log):
     - `palette.spec:9` expects the note path in the main area, which D-102 removed. This looks like a stale expectation.
     - `save-failure.spec:93` "Quit is canceled once while a window cannot save". The main log shows `flush: requested=2 acked=1 timedOut=1 unsaved=1`, so one window did not acknowledge the flush within the timeout. That may be a real quit-flow defect introduced with live sync (D-103), not just a stale test.
   - The third failure, `nlp.spec:153`, passed on a rerun (a flake).
   - Repair:
     - Investigate `save-failure.spec:93`. If the timeout is a real defect, fix it. If the test is stale, update it under a recorded decision.
     - Update `palette.spec:9` to the D-102 layout.
     - Re-run the full E2E and record the result.

5. **Minor: the packaged notification check is unresolved.** In runC-e2e-packaged-2.log, `packaged.spec:124` recorded `uncertain/no-show-event`. The log shows Windows itself answered "The notification platform is unavailable" at the time. Repair: re-run `npm run test:e2e:packaged` while notifications are available, and record the result.

6. **Minor: the wrong-password backoff can be bypassed with parallel requests.**
   - Where: `src/main/locks/lock-service.ts:201-206,324-343`. `unlock` is not serialized, `retryInSeconds` is checked before the asynchronous scrypt, and a failure is recorded only afterwards.
   - Scenario: N concurrent `lock:unlock` calls all pass the check, so the backoff does not throttle them. The cost is bounded by scrypt and the thread pool, and an offline attack on the database is the real threat model, so this is low impact.
   - Repair: serialize password attempts per note (a queue, or reuse `exclusive`), and count the attempt before deriving the key.

7. **Minor: the lock dialog does not say that reminder titles stay in plaintext.**
   - Where: `src/renderer/notes/lock-form.ts` (`LOCK_DIALOG_POINTS`). The dialog says only that notifications hide the reminder text. A reminder made with "Create reminder from text" has the note's own sentence as its title, and that title stays in plaintext on disk and visible in the Reminders page. USER_GUIDE section 2 does say this.
   - Repair: add a point such as "Reminder titles stay visible in the Reminders page and are not encrypted."

8. **Minor: the website overstates screen-lock re-locking.**
   - Where: `website/docs.html:250-251` says notes lock again "when you lock the screen or the computer sleeps". Electron reports screen lock only on Windows (and macOS); on Linux only sleep is reported, as USER_GUIDE says.
   - Repair: "when you lock the screen (Windows) or the computer sleeps".

9. **Minor: the WAL scrub can fall short, and the comment says it cannot.**
   - Where: `src/main/locks/lock-purge.ts:36-37,46-49`. When `wal_checkpoint(TRUNCATE)` reports busy, the comment says "the next checkpoint then overwrites it". That is not guaranteed: frames beyond the point where the WAL restarts stay in the file until it is truncated.
   - The app uses a single connection, so this is unlikely in practice.
   - Repair: retry the truncating checkpoint later (the next idle sweep or quit) and correct the comment.

10. **Minor: a locked note's plaintext can reach the log.**
    - Where: `src/main/services/collab-hub.ts:275-277`. If a decrypted locked note fails `doc.check()`, the log line includes `errorDetail(err)`, and ProseMirror's "Invalid content for node …" message contains the fragment's text.
    - Repair: when `row.locked === 1`, log without the error detail.

11. **Minor (release step): the version is still 0.1.0.** `package.json` still says 0.1.0, and the packaged installer is `Infinity-Notes-Setup-0.1.0-…`. Bump the version to 0.2.0 before tagging.

12. **Minor (test gaps; no repair required for acceptance):**
    - No test of a `.pdf` symlink to a program. It is runnable on POSIX, and the double check by link name and real name covers it in code.
    - No tests for trailing-dot or trailing-space names and uppercase extensions. The code handles them: the extension regex requires an alphanumeric ending and lowercases it.
    - Column resizing is covered only by a stored-width unit test, with no drag test.
    - Real Windows Hello is not exercised; this is documented in D-113 and needs a person.

## What I verified and how

- **Note view (D-104):** read the CSS and NoteView diff. E2E `rich-formatting.spec:53` measures the pane-edge scrollbar and left text start; it passed in runC-e2e-full-2.log.
- **Tables (D-105):**
  - The shared extension and schema (`tables.ts`, `doc-schema.ts` cell attributes and the `table` block ID) and plain text and TSV (`table-text.ts`) are correct. The quoted-field parser is linear in practice.
  - Markdown GFM output escapes pipes and turns newlines into `<br>`.
  - The clipboard serializer and parser are in `paste.ts` and `table-clipboard.ts`. Pasted HTML still goes through DOMPurify, then the rebuilt-style pass, then the schema.
  - Spot-run: `doc-schema.test`, `table-text.test`, `renderer/editor/tables.test`. E2E `rich-formatting.spec:89` (insert, Tab, rows, TSV copy, HTML and TSV paste) passed.
  - Size gap: finding 3.
- **Fonts and colors (D-106), CSS-injection review:**
  - Stored values are validated three times: the editor's parse/render (`text-style.ts` renders only `normalizeHexColor`, `fontStack(key)` and listed sizes); the sanitizer (`safeStyle` rebuilds the `style` attribute from validated values; anything else is dropped, including `url()`, `expression`, `;` smuggling, `!important` and unlisted fonts); and main (`normalizeTextStyle` in `normalizeRichDoc` rebuilds the attributes).
  - The hex regexes are anchored on trimmed input (JS `$` without the `m` flag), `rgb()` channels are capped at 255, sizes must match `^\d+(\.\d+)?(px|pt)$` and then a listed value, and fonts are stored as keys.
  - Sticky colors: Zod `NoteColor` is a preset or `^#[0-9a-f]{6}$`, `text_color` has a CHECK in migration 008, and React style objects are used in lists.
  - I found no bypass.
  - Spot-run: `formatting.test`, `renderer/editor/text-style.test`, `renderer/editor/sanitize.test`.
- **Stickies (D-107):** migration 008 (CHECK plus the upgrade test), `sticky:setTextColor` (sticky allowlist, own note), window background on color and theme changes, and portable `textColor`. E2E `sticky-colors.spec` and `stickies.spec` passed. The changed stickies and visual specs assert the new radiogroup with the same six labels and a checked state; nothing was weakened.
- **Files (D-108):**
  - Path policy (`isUsableLinkPath`): drive or UNC paths only; `\\?\` and `\\.\` refused; a second colon refused (blocks `file.txt:stream`); must already be normalized (blocks `..`, forward slashes and double separators); NUL refused.
  - Openable types: the allowlist is checked against both the link name and the realpath name. Trailing dot or space resolves to `bin` and is blocked. `.lnk`, `.url`, `.desktop`, `.exe` and scripts are blocked. Case is lowered. 8.3 short names are caught by the realpath long-name check. Linux exec bit refused.
  - Shell calls use only DB-stored paths (`openPath(check.real)`), and the renderer never passes a path to the shell.
  - Pick sessions are per window and single-use.
  - The 25 MB copy limit is enforced in main (`limitMb` range 1-25, plus an upgrade hook for v1 values).
  - Migration 009, the content indexer, GC, Markdown `file://`, portable link records and backups.
  - Spot-run: `linked-files.test` (1 POSIX-only test skipped on Windows, as recorded). E2E `files.spec` passed.
  - Gaps: findings 1 and 2.
- **Logo and loader (D-109):** electron-builder (Linux `resources/icons`, tray PNGs in the asar, Windows ICO unchanged), the multi-representation tray image, `backgroundColor` and `setBackgroundColor` following the theme (no white flash), and the loader in `index.html` with a 150 ms fade-in, no minimum time, and the delay only under test hooks. runB-package-inspect.log shows the packaged assets are byte-identical; E2E `brand.spec` passed.
- **Locked notes (D-111..D-113):**
  - `note-crypto.ts`: AES-256-GCM, a fresh random 96-bit IV per seal, a 16-byte tag, purpose and note ID as AAD, version byte checked.
  - Key derivation: scrypt N=2^17, r=8, p=1 with a 16-byte salt and the parameters stored, bounded on read. The data key is wrapped with GCM, and keys are zeroed.
  - `os-key.ts`: `execFile` of `%SystemRoot%\…\powershell.exe` with `-EncodedCommand`. Only constants and a bigint HWND are in the script, so there is no injection. 20 s and 120 s timeouts; only `Verified` unlocks.
  - Windows Hello limits: safeStorage/DPAPI, and the guide honestly says that code running as the same user can unwrap the key.
  - Purge in the lock transaction: versions, drafts, reminder sources, dismissals and the row content and plain text (the FTS row gets the title only). After it: `secure_delete`, FTS optimize, VACUUM and a TRUNCATE checkpoint.
  - Migration 010 guard triggers on notes, versions, drafts, sources and dismissals.
  - Every content path goes through `NoteVault`, and the purge leaves no plaintext behind. Readers that do not know about locks see empty columns.
  - Search, previews, references and Home are empty for a locked note; stickies are refused; the collab hub evicts the note on lock and re-lock; portable export skips locked notes; Markdown export needs the note unlocked; notifications are masked; passwords appear only in requests and never in logs.
  - Re-locking: idle sweep, lock-screen and suspend, quit; change password, Hello on and off, remove.
  - Spot-run: `note-crypto.test`, `os-key.test`, `locks.test` (the raw byte scan of the database and WAL in UTF-8 and UTF-16 after a lock is meaningful, because it first asserts the marker *is* present), and `migrations.test`. E2E `locks.spec` passed.
  - Gaps: findings 6, 7, 9 and 10.
- **Tests:**
  - No `.skip`, `.only` or `fixme` was added, apart from one documented POSIX-only `skipIf`.
  - Every removed assertion in changed tests was replaced by an equal or stricter one. Hard-coded `7` became `LATEST`. `importFromDialog` became picker plus `addPicked` with the same rejection messages, now checked per file. The colour menu became a radiogroup with the same labels and checked state. The 50 MB limit became the 25 MB copy limit. The release-config and app-identity tests follow the published intent (D-110).
  - Spot-run total: 11 files, 155 passed and 1 skipped (`npx vitest run` of the files listed above).
  - Logs: runC-check-3.log (lint and typecheck pass; unit 792 passed; integration 450 passed and 2 skipped; traceability fails=0) and runC-build-4.log pass.
- **Docs:**
  - DECISIONS D-104..D-113, ARCHITECTURE, UX_SPEC and USER_GUIDE are consistent with the code.
  - USER_GUIDE "Locked notes" is accurate and honest: titles visible, attachments not encrypted, pre-lock backups, pre-migration copies, disk remanence, the DPAPI limit of Hello, and Linux screen lock.
  - The website's index.html and docs.html match the app, except finding 8.

## Not run here

- Playwright E2E, packaging and WSL, by instruction. Run D owns CI repair and WSL; its results must be appended and checked before release.
- Real Windows Hello prompts, which need a person.

## Re-check (repairs)

Acceptor: infinity-acceptor (Opus, high effort), 2026-10-10, after Runs D and E. I read the Run D and Run E sections of docs/progress/release-0.2.0.md, then the code and test diffs against HEAD 62e8a67 for every file they name, and the logs runD-* and runE-* in .infinity-work/logs/release-0.2.0/. No file under src/ or tests/ changed after runE-check-1.log (04:27). The full Windows E2E (runE-e2e-full-1.log, 04:28-04:37) therefore ran on the code reviewed here. I edited no app source, tests, website or CHANGELOG.

Spot-run (`npx vitest run`, Windows, 04:45): `tests/unit/preload-file-link.test.ts`, `tests/unit/table-limits.test.ts`, `tests/unit/doc-schema.test.ts`, `tests/unit/renderer/editor/tables.test.ts`, `tests/integration/linked-files.test.ts`, `tests/integration/locks.test.ts`, `tests/integration/collab.test.ts` and `tests/integration/notes-save.test.ts`. Result: 8 files, 94 passed, 1 skipped (the POSIX-only test, as recorded). I also probed `isUsableLinkPath`'s win32 branch directly with Node against these paths, with the results shown:

| Path | Result |
| --- | --- |
| `c:\x\a b.pdf` | accepted |
| `C:\Users\Émile\文档\ノート.pdf` | accepted |
| `C:\a \b.pdf` | accepted |
| `C:\x\y.` | accepted (the openable check still blocks it) |
| `C:x.pdf` | refused (drive-relative; also refused before Run E) |
| `D:\a\\b.pdf` | refused |
| `C:/a/b.pdf` | refused |

### Per finding

| # | Finding | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | UNC/WebDAV link paths probed automatically | **Repaired** | The win32 branch of `isUsableLinkPath` accepts only `^[A-Za-z]:\\`, so UNC, `//host`, `\\host@SSL\DavWWWRoot`, `\\?\UNC` and `\\.\` are refused before any fs call (`src/main/services/linked-file.ts:14-27`). `inspectLinkedFile` returns `missing` first (`:51`). `create` refuses network paths with their own message (`linked-file-service.ts:46`). Open, Show in folder and Copy in all go through `resolve` → `inspectLinkedFile` (`:94-99`), so a stored UNC path is never touched. Portable import does not store records that fail the check and logs `refusedLinks` (`portable-import.ts:140,162`). Tests in `linked-files.test` › "network locations are never touched (D-115)" (`:134-`) spy on `fs.promises` stat, lstat, realpath, access, open, readFile and copyFile. They assert that create, status, open, showInFolder, copyIn and import never touch the host, and they prove the spy does see a local `stat` (so the "no I/O" result means something). No regression for local paths with spaces or Unicode (see the probe above). Note: a mapped drive letter (`Z:\` on SMB) is still a "local drive" path. That mapping is the user's own, so it is not attacker-controlled through an export. |
| 2 | `fileLink:create` took any path from the renderer | **Repaired** | The bridge exposes only `fileLink.createFromFile(file)` and `isOnDisk(file)`; there is no `create` and no `pathOf` (`src/preload/index.ts:31-33,50-55`). The path comes only from `webUtils.getPathForFile` on a real `File`, and anything else gets `LINK_MESSAGES.noPath` with no IPC. Real drops still work: `files.spec` drops real disk files through `setInputFiles` + `DataTransfer` (`tests/e2e/editor-ui.ts:204-225`). That goes through `createFromFile`, and the spec checks the stored `linked_files.path`; it passed in runE-e2e-full-1.log and under WSLg in runE-wsl-test-e2e-wslg-targeted.log. The picker is unaffected: it uses main-side pick sessions (`attachment:addPicked`, `file-sources.ts:pickedSources`), and `files.spec` "a file over 25 MB can only be linked" passed. `security.spec` asserts the new bridge key list (`:181`) and refuses 4 forged attempts (a named `File`, a `File` with a forged `path`, a plain object, a string) with `onDisk:false` (`:284-301`). The unit test `preload-file-link.test` covers the surface, forwarding a real file, and 5 forged inputs with no IPC. |
| 3 | Table spans/grid unbounded | **Repaired** | `MAX_CELL_SPAN = 50` and `MAX_TABLE_CELLS = 10,000` (`src/shared/editor/table-limits.ts:8-10`). `tableFits` is linear in the cells and computes the same width as prosemirror-tables' `findWidth` (cells carried down from rowspans included). Main refuses an oversize span (`doc-schema.ts` `cellSpan`) and an oversize table at any depth (`normalizeRichDoc`), so saves, live-sync saves and imports all refuse them. In the editor: `handlePaste` is a direct view prop (`NoteEditor.tsx:178-180`), so it runs before the tableEditing plugin lays out cells (`paste.ts`); `doc-limits` refuses local edits that make a table too large; TSV over 10,000 cells is pasted as text (`table-clipboard.ts:63-70`). Normal tables are unaffected: 100×100 and 200×50 fit, and `rich-formatting.spec:89` (insert, Tab, rows, TSV and HTML paste) passed. Tests: `table-limits.test` (including the 2,200-node case), `doc-schema.test` (spans 50/51, 100×100 vs 101×100, nested), `tables.test` › "table size limits in the editor (D-116)", and `notes-save.test`. |
| 4 | Full E2E gate not green | **Repaired** | `save-failure.spec:93` was a real app bug, fixed in `CollabHub.save` (`collab-hub.ts:370-379`): a flush now joins the running save instead of queuing a second retry cycle. I reviewed the join for loss and recursion. A joiner re-runs `save` after the running save settles; `finally` clears `saving` first, so the joiner either starts a fresh run or joins the next one. `saveOnce` stores the session's current doc, so later edits are saved again. Covered by `collab.test` › "a flush while main retries a failed save (D-072)" (`:300`). `palette.spec:9` was stale and was updated to the same intent (the right one of two same-titled notes opens). Results: runE-e2e-full-1.log **238 passed, 0 failed, 1 skipped** (the Linux-only smoke case); runD-wsl-test-e2e-wslg.log 237 passed, 2 skipped (the Windows-only tray specs). |
| 5 | Packaged notification check | **Not repaired; environmental. Recorded as a native case not run, not a blocker** | runE-e2e-packaged-1.log: 7 passed; `packaged.spec:124` failed with `{"outcome":"uncertain","detail":"no-show-event"}` against capability `supported`. runE-toast-probe.log (04:39, right after) shows a plain PowerShell `ToastNotificationManager.CreateToastNotifier(...)` failing with "The notification platform is unavailable." So the OS refuses toasts from any process, and the failure is not specific to this app. The spec was not loosened: Windows `supported` still requires `dispatched` (`packaged.spec:169`). The v0.2.0 diff does not touch the notification adapter; only the reminder text is masked for locked notes, which the integration tests and `reminders.spec` cover. To close this before or at tagging, either the ci.yml `test:e2e:packaged` step on windows-2025 or a local rerun on a session where toasts work must show `dispatched`. If the runner also lacks a notification platform, record that as a runner limit; do not loosen the spec. |
| 6 | Parallel wrong passwords bypass the delay | **Repaired** | `keyFromPassword` runs inside `oneAttemptAtATime` (a per-note promise chain that settles on both outcomes) and calls `recordFailure` before scrypt; success clears it (`src/main/locks/lock-service.ts:339-374`). Deadlock review: the chain holds no lock. `exclusive` never waits: it refuses with CONFLICT. `exclusive` → `keyFromPassword` is the only nesting, and unlock attempts never take `exclusive`, so there is no cycle. scrypt always settles. Covered by `locks.test` › "parallel wrong passwords cannot get past the delay" (`:254`): 10 parallel requests give 3 wrong-password results and 7 `LIMIT_EXCEEDED`. |
| 7 | Lock dialog silent on reminder titles | **Repaired** | `src/renderer/notes/lock-form.ts:12,16` says that the note title and reminder titles are not encrypted and that reminder titles stay visible in the Reminders page. Covered by `tests/unit/renderer/lock-form.test.ts:14-16`. |
| 8 | Website overstates screen-lock re-lock | **Repaired (coordinator)** | `website/docs.html:258`: "when you lock the screen (Windows) or the computer sleeps". |
| 9 | WAL scrub can fall short; wrong comment | **Repaired** | `scrubDatabase` returns false when VACUUM throws or `wal_checkpoint(TRUNCATE)` is busy, and the comment is corrected (`src/main/locks/lock-purge.ts:32-62`). `scrubPending` is retried by the idle sweep and on stop (`lock-service.ts:120,132,199-200`). Covered by `locks.test` › "a blocked scrub is retried (D-112)" (`:141`): a pinned reader keeps the WAL non-empty, and after release the next sweep empties it with no marker left. |
| 10 | Locked plaintext can reach the log | **Repaired** | `CollabHub.logDetail` logs only the error name for a locked note (`collab-hub.ts:263-266`), at all four former `errorDetail` sites (`:139,286,336,340`). Covered by `locks.test` › "live sync never logs a locked note's text" (`:238`). Residual, low: the generic IPC router still logs `errorDetail` for non-`AppError` throws from any handler (`src/main/ipc/router.ts:119`). I found no locked-note path that throws a non-`AppError` carrying content. This is not a blocker. |
| 11 | Version still 0.1.0 | **Repaired** | `infinity-notes@0.2.0` in runE-check-1.log. `APP_VERSION = '0.2.0'`; `app-identity.test` asserts `pkg.version === APP_VERSION`. runE-package.log produced `Infinity-Notes-Setup-0.2.0-x64-unsigned.exe` (SHA-256 recorded in Run E). The `release-config.test` change from `### Highlights` to `### Downloads` checks a heading both CHANGELOG sections really have; I checked the CHANGELOG diff, and this is not a weakening. |
| 12 | Test gaps (no repair required) | Unchanged, accepted | Still open: no symlink-to-program test (POSIX), no tests for trailing-dot names or uppercase extensions, no column-drag test, and real Windows Hello still needs a person (D-113). |

### Regression review

- **Linked files:**
  - Real drops and pastes reach main with the OS path, and clipboard data and page-made `File`s do not.
  - The picker keeps paths in main.
  - The UNC refusal does not affect local drive paths with spaces or Unicode.
  - Drive-relative paths (`C:x`) were refused before Run E and still are.
  - On Linux the posix branch is unchanged. A Windows export's links are now dropped on import (`refusedLinks`) instead of being stored as missing. That is acceptable, and USER_GUIDE, CHANGELOG and the website now say so.
- **Tables:** normal tables, including pasted spreadsheets up to 10,000 cells, are unaffected.
  - `doc-limits` checks only the tables a change touches.
  - Each keystroke inside a full 10,000-cell table costs one linear `tableFits` pass, which is negligible.
- **Locks:** no deadlock (see finding 6). Success clears the failure count, and the backoff still applies to the correct password once it has started (by design).
- **Collab save join:** no lost edits and no unbounded recursion (see finding 4). WSLg full E2E ran in Run D, before the Run E repairs. Run E re-ran `check` (807 unit, 462 integration) and the touched specs under WSLg: 36 passed (runE-wsl-test-e2e-wslg-targeted.log).

### Docs consistency (coordinator-edited)

- **CHANGELOG.md [0.2.0]:** consistent with the app.
  - Tables: up to 10,000 cells, spans up to 50.
  - Files: 25 MB copy limit with a link-only warning; local drives only on Windows; network links in imports not kept.
  - Locked notes: title and reminder titles visible; re-lock after 5 idle minutes, on sleep, on screen lock (Windows) and on quit; attachments not encrypted.
- **website/docs.html:** consistent with the app.
  - Tables: lines 202-204.
  - Files: lines 209-238.
  - Locked notes: lines 241-279. "Lock note…", "Lock now" and "Lock all notes" match `note-actions.ts` and `palette-actions.ts`.
- **One optional nit, not a blocker:** docs.html:204 says "a larger table is refused with a message". Oversize tab-separated text is actually pasted as text, with a message saying so.

### Not run here (native cases)

- **Windows packaged OS notification delivery** (`packaged.spec:124`). Windows' notification platform was unavailable during this session (finding 5).
- **Real Windows Hello prompts.** These need a person.
- **Linux packaging at version 0.2.0, and the full WSLg, Xvfb and CI-like E2E after Run E.** Run D ran these on the pre-repair code, at version 0.1.0. Run E ran WSL `check` and the touched specs. The release workflow builds the Linux packages.

### Verdict (re-check)

**Accepted.** Findings 1-4 (the blockers) and 6-11 are repaired, with tests that prove the behavior. No test was weakened, and the full Windows E2E gate is green (238 passed, 0 failed).

There are no remaining blockers for a local release. Finding 5 is a native case not run: the OS refuses all toasts, not just this app's. Confirm `dispatched` on the windows-2025 CI packaged step, or on a session where toasts work, before or at tagging.

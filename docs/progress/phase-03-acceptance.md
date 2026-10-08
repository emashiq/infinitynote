# Phase 03 acceptance: Rich notes, plain text and image paste

Acceptor: infinity-acceptor (Opus 5.5, high), 2026-10-09. Host: Windows 11 Pro 10.0.26300, Node 24.15 (tools); the Playwright runner and workers use Node 24.21.0 through `INFINITY_E2E_NODE`. WSL evidence: Ubuntu 26.04.1 LTS, kernel 6.6.114.1-microsoft-standard-WSL2, Node 24.21.0, WSLg 1.0.73 (Weston), observed `ozone=x11` (XWayland). These results are not labelled GNOME.

Scope reviewed: the working tree on top of the cleanup commit 4932831 (72 modified files plus the new Phase 03 sources and tests). Phase 03 was rebuilt by the Opus implementer. I did not use the discarded Sonnet attempt (`logs/phase-03/sonnet-discarded/`, `.infinity-work/discarded/`) as evidence.

## Decision: ACCEPTED

All functional local gates for Phase 03 pass on the current tree, and every gate postdates the last source change. The tree has no placeholders, no disabled or weakened tests, and no retries. Each acceptance criterion in `phases/03-rich-notes-plain-text-and-image-paste.md` is covered by a real Electron E2E case that reads the SQLite database directly. The three defects from the first QA round (QA-1 to QA-3) are fixed and have regression tests at unit, integration and E2E level. QA-4 is accepted with a Phase 09 follow-up, because my probe shows it is Chromium line-breaking cost on pathological input and loses no data (rationale below). The Linux packaging gap left by Repair 1 is closed by my own run on the current tree.

## Evidence read or run

| Item | Source | Result |
| --- | --- | --- |
| Coordinator check: lint, typecheck, 365 unit, 185 integration + 1 platform skip, traceability ids=187 fails=0 | `.infinity-work/logs/phase-03/coordinator2-check.log` | exit 0 |
| Coordinator build | `coordinator2-build.log` | exit 0 |
| Coordinator Windows E2E: 114 passed, 1 Linux-only skip (not counted) | `coordinator2-test-e2e.log` | exit 0 |
| Gates postdate source | newest `src`/`tests` mtime 00:39:46 (`tests/e2e/paste.spec.ts`); repair1 gates 00:44 to 00:53, coordinator2 gates 00:55 to 00:57; `find src tests tools -newer coordinator2-check.log` returns nothing | verified |
| Implementer Repair 1, Windows: check, build, E2E 114 + 1 skip, package:current (NSIS sha256 `9da5933f…`), packaged E2E 2 passed (`sandboxed=true integrity=untrusted`), dependencies unchanged | `repair1-win-*.log`, `repair1-deps-unchanged.log` | all exit 0 |
| Implementer Repair 1, WSL: mirror `MIRROR_IDENTICAL`, check 365/186, build, WSLg E2E 115 passed, Xvfb E2E 115 passed | `repair1-wsl-*.log` | all exit 0 |
| QA initial (FAIL: QA-1, QA-2, QA-3) and re-QA (PASS, QA-4 low): 48 earlier specs and probes re-run, 14 new repair cases on Windows, 34 on WSLg | `docs/progress/phase-03-qa.md`, `qa2-rerun-win.log`, `qa2-repair-win.log`, `qa2-wslg.log`, `qa2-probe-*.log` | read |
| **Acceptor spot-run**: `npm run check` | `acceptor-check.log` | exit 0 (365 unit; 185 integration + 1 skip; fails=0) |
| **Acceptor spot-run**: Linux packaging and packaged E2E on the post-repair tree (user `infinity`, `~/infinity-notes`, rsync + `diff -rq` gave `MIRROR_IDENTICAL`) | `acceptor-wsl-package-linux.log` | exit 0; AppImage sha256 `248a519e…646b`, .deb sha256 `800b3bfc…593c`; packaged E2E 2 passed, `ownUserNamespace=true ownPidNamespace=true Seccomp=2`; no electron process left |
| **Acceptor probe** on QA-4 | `.infinity-work/qa/p03-acceptor-probe.spec.ts`, `acceptor-probe-qa4-win.log` | exit 0, 3 passed (numbers below) |
| Test integrity | `git diff HEAD -- tests`: the removed assertions are the textarea-era ones (`toHaveValue`, `TEXTAREA`), and editor-based assertions replace them. Boundary guards were retargeted from "Phase 03 channels absent" to the real Phase 03 surface. The `note:save` limit test now also asserts the exact message. `.skip`/`skipIf` appear only for the existing packaged-only and Linux-only conditions and the Windows file-symlink case (administrator rights, recorded). No `.only`, no retries, no TODO or FIXME in `src` or `tests`. | verified |
| Visual review | `screens/win/1100x720-light-rich-note.png`, `1100x720-light-conflict-banner.png` (heading, marks, link bar, checklist, code block, managed image; conflict banner with Compare / Restore draft / Dismiss) | consistent with UX_SPEC |

Housekeeping: my first WSL command was re-parsed by `wsl --` in the outer shell (root). It created a stray copy `/root/infinity-notes`, made at 01:20:01 with no `node_modules`. I verified that copy was mine and removed it. The real mirror `/home/infinity/infinity-notes` was then synced normally. Nothing in the repository was changed by this.

## Acceptance criteria (phase file) and where they are proven

| Criterion | Proof (test bodies read) |
| --- | --- |
| Formatting and images survive restart offline | `e2e/editor-flow.spec` › edit, paste and reload: heading, bold, italic, bullet, checked task, link, code block, a clipboard bitmap and a file image; quit, relaunch, every mark and both images decoded (`naturalWidth > 0`), `blockedRequests` empty. Also `editor.spec` › formatting survives reload. |
| Original image file may be removed | `editor-flow.spec` (`fs.rmSync(original)` before relaunch); `paste.spec` › the original image file may be removed |
| Unicode text intact | `editor.spec` › Bangla title and text are stored exactly; `integration/notes-save` › Bangla; QA PS5 (NUL, RLO, lone surrogate, ZWJ, combining marks, FTS match) |
| Unsafe HTML cannot execute | `paste.spec` › no script execution (real Ctrl+V); `editor-flow` (`__pwned` undefined, remote image becomes a link); QA PS1 26 vectors with 0 network requests |
| Rename and tab close flush | `editor.spec` › rename flushes, › flush on close, › tab switch, › window close, › quit (main.log `flush: requested=1 acked=1 timedOut=0`) |
| Competing save revisions cannot erase work | `conflict.spec` › stale save keeps a draft, › trashed while editing keeps a draft, › silent holder's late save becomes a lease-lost draft; `integration/revision` (F-01-3 cached outcomes), `drafts`, `lease`; QA BR2 and DL9/DL10 |
| Duplicate and pasted blocks get new IDs | `paste.spec` › copied blocks get new IDs; unit `block-ids` with a negative control; QA PASTE-DUP (five equal `data-id`s become distinct). After Repair 1 the IDs are given in `transformPasted` and a linear duplicate repair runs. |
| Plain-text conversion has a restorable source | `editor.spec` › conversion warning and version history; `integration/notes-format` › version created; QA CV1 (Cancel changes nothing, a `conversion` version holds the rich JSON, converting back restores it) |
| One real note edit/paste/reload E2E flow | `editor-flow.spec` › edit, paste and reload, on Windows, WSLg and Xvfb |

All 23 Phase 03 BACKLOG IDs are `done`. Traceability reports fails=0 (`acceptor-check.log`).

## Decisions on the open questions

### QA-4: a single unbroken run of one Bangla letter pastes superlinearly

Acceptor probe (`acceptor-probe-qa4-win.log`): I measured layout of plain `<div>` elements appended to the app page, with no ProseMirror involved, at width 600 px and `white-space: pre-wrap`:

| Text | 64K chars | 128K | 256K |
| --- | --- | --- | --- |
| Bangla `ক` run, `overflow-wrap: anywhere` (the editor's rule) | 172 ms | 459 ms | 1679 ms |
| Bangla run, `overflow-wrap: break-word` | 130 ms | 450 ms | 1667 ms |
| Bangla run, `word-break: break-all` | 29 ms | 56 ms | 113 ms |
| Latin `a` run, `overflow-wrap: anywhere` | 2 ms | 7 ms | 10 ms |

Pasted through the app: a 512K Latin run was responsive after 103 ms, and a 256K Bangla run after 3370 ms (QA measured 3355 ms).

- Cause: Chromium's line breaking of one unbroken complex-script word under emergency wrapping. It reproduces without the editor, so the app's paste pipeline is linear (QA-2 fix), and Latin text is not affected. The cost lives in layout, which is why the 8 MiB character guard does not bound it.
- Impact: realistic Bangla (10,000 paragraphs, 1.27 M chars) pastes in 1.1 s, which is what Bangla users actually paste. The slow case needs hundreds of thousands of one letter with no space, which is not realistic input. No data is lost. Pending edits are flushed before any paste of 256 KiB or more (D-060). A hung window can still be closed, because the close flush times out after 2 s per renderer (D-055) and the last acknowledged state stays in the database.
- Residual risk: a run of about 1 M chars fits under the 5 MB note limit (about 3 MB UTF-8). Once saved, such a note pays the same layout cost every time it opens. This is a user-visible degradation, but it is self-inflicted with pathological input and recoverable (undo, or the version history).
- Decision: this does not block Phase 03. TEST_MATRIX has no responsiveness row for Phase 03; Phase 09 owns "image-heavy editor responsiveness" and fixing defects found by measurement. It becomes F-03-1 (below). Inserting zero-width spaces is not an acceptable fix, because it would break "Unicode text remains intact".

### Linux packaging evidence from before Repair 1

Repair 1 changed `src/main/ipc/router.ts`, `note-handlers.ts` and renderer files, all of which are bundled into the package. The pre-repair `final-wsl-package-linux.log` therefore did not stand for the current tree. Rather than accept it by argument, I re-ran `npm run package:linux` and `npm run test:e2e:packaged` on the current tree in the WSL mirror (`acceptor-wsl-package-linux.log`, both exit 0). The gap is closed. The forced-Wayland run stays informational (D-050) and was not repeated.

### Gates postdate the last source change

Yes. The newest source or test file is 00:39:46. The repair1 Windows and WSL gates ran 00:44 to 00:53, the coordinator2 gates 00:55 to 00:57, and my check and packaging 01:20 to 01:22. The WSL mirror was identical before both the repair1 runs and my run.

### Code quality

I reviewed the save path (`note-writer`, `note-content`, `draft-service`, `version-service`), the router change, `window-lifecycle`, `flush-coordinator`, and the renderer editor (`paste`, `block-id-guard`, `doc-limits`, `sanitize`, `NoteEditor`).

The design is clean:
- A single content writer runs inside one transaction.
- Every restore path normalizes through `normalizeRichDoc`.
- Retried requests reuse cached outcomes.
- Close and quit flushes are bounded.
- Sanitizing happens in an inert document, and the image policy cannot fetch anything.
- The limits are shared constants between main and renderer.
- Comments state intent and cite decisions.

Low-severity findings, none blocking:
- `doc-limits.ts` computes `delta(tr)` twice per transaction (once in `filterTransaction`, once in `state.apply`). `countInRange` and `depthAround` also visit every top-level child on each keystroke, even outside the changed range. Measured cost is acceptable: on a 4 MB note QA R6 measured a 37 ms median per key, 72 ms max. Proposed follow-up: cache the delta per transaction and walk with `nodesBetween`.
- The pre-paste size guard counts the characters the page receives. On Windows that includes the 72-character CF_HTML wrapper, so "exactly 8 MiB" of HTML is refused. This is cosmetic.
- `@tiptap/extension-image` is installed but unused (recorded in progress section 10). Remove it in the Phase 09 dependency review.
- `NoteEditor.tsx` has a doubled blank line after the imports. This is a trivial style nit.

## Follow-ups

| ID | Item | Phase |
| --- | --- | --- |
| F-03-1 | QA-4: bound layout cost of very long unbroken complex-script runs. Options: a paste-time guard on the longest run without a break opportunity (refuse or warn above a measured threshold), or apply `word-break: break-all` only to blocks whose longest run exceeds a threshold, through a decoration. The fix must keep text byte-exact. Add a regression probe like `p03-acceptor-probe` (256K Bangla run responsive in under 1 s) and cover opening an already-saved note that holds such a run. | 09 (responsiveness measurement and defect closure) |
| F-03-2 | `doc-limits` efficiency: compute the delta once per transaction and walk only the changed ranges. Include it in the large-note typing-latency measurement. | 09 |
| F-03-3 | Remove the unused `@tiptap/extension-image` dependency, with a lockfile update and dependency check. | 09 (dependency compatibility review) |
| F-03-4 | Retention for `lease_lost` drafts that a rogue renderer could create in large numbers (QA observation), together with draft and version retention settings. | 08 |
| carried | F-01-6 `desktopName` / `linux.syncDesktopName` (electron-builder warns again in `acceptor-wsl-package-linux.log`) | 09 |

## Pending native and out-of-scope cases (not passes)

- GNOME and X11 desktop sessions are outside the user-selected validation scope. WSLg results are WSLg/Weston with XWayland and are not GNOME.
- Forced Wayland (`--ozone-platform=wayland`) is informational per D-050: 59 passed and 53 failed in `final-wsl-test-e2e-wayland.log` (pre-repair). The failures are pointer and screenshot timeouts from missing frame callbacks under WSLg. It was not re-run.
- File-list clipboard paste from an OS file manager and native OS drag-and-drop are not automated. Drop uses a synthetic DataTransfer, recorded as SYNTHETIC.
- Windows file symlinks in the attachment protocol need administrator rights. The Linux file-symlink case and the Windows junction case pass.
- The unacknowledged 400 ms typing window before a crash or kill is documented and not asserted (PRODUCT_SPEC section 9).
- Installed-package validation on native hosts (NSIS install, AppImage/.deb install, update persistence) belongs to the Phase 09 native matrix.

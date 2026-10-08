# Phase 03 QA: Rich notes, plain text and image paste

Reviewer: infinity-qa (fresh Sonnet 5.5, medium), 2026-10-09. Scope: the working tree at the cleanup commit 4932831 plus the uncommitted Phase 03 changes. No application source, test or tool was edited. QA specs: `.infinity-work/qa/p03-*.spec.ts` with `.infinity-work/qa/p03.config.ts`. Logs: `.infinity-work/logs/phase-03/qa-*.log`.

## Verdict: FAIL (3 actionable defects, none blocks the controller's own acceptance cases)

All 23 Phase 03 IDs pass the implementer's and coordinator's gates, and 31 of my 32 adversarial cases pass on Windows. The 32nd (PS3) deliberately reproduces defect QA-1. Two further defects (QA-2, QA-3) were found by probes and are documented below. Acked saves are durable, stale/lease conflicts keep recoverable drafts, unsafe paste is neutralized, and nothing was fetched from the network.

## Inputs checked

- `.infinity-work/logs/phase-03/coordinator-check.log`: exit 0, traceability fails=0. `coordinator-build.log`: exit 0. `coordinator-test-e2e.log`: 111 passed, 1 Linux-only skip (the skip is a platform-conditioned case, not counted as a pass).
- Implementer `final-*.log` for WSL (WSLg and Xvfb 112 passed, packaged 2 passed) were read, not re-run.
- WSL mirror check before the WSLg spot run: `diff -rq` against `~/infinity-notes` showed only `docs/progress/phase-03.md` differing (documentation edited after the last sync); all source, tests and tools identical. WSLg 1.0.73, `DISPLAY=:0`, Ubuntu 26.04.1, Node 24.21.0.

## Checks run by QA

| ID | Case | Result | Notes |
| --- | --- | --- | --- |
| DL1 | Type then immediately Ctrl+W | pass | DB has the text; tab closed |
| DL2 | Type then immediately switch tab | pass | saved before the switch; text still there on return |
| DL3 | Type then immediately `page.reload()` | pass | pagehide flush saved the text |
| DL4 | Type then quit app | pass | `flush: requested=1 acked=1 timedOut=0` in main.log |
| DL4b | Type then `BrowserWindow.close()` | pass | saved via close flush |
| DL5 | Acked text, then typing, then forced renderer crash | pass | acked text kept; the last unacked 400 ms edit (" LAST") lost, which is the documented unacknowledged window; window auto-reloads, note reopens, editable, new edit saves |
| DL6 | 150 bursts of typing, wait Saved, SIGKILL, relaunch | pass | exact text, same revision, `PRAGMA integrity_check` ok |
| DL7 | Title rename + body, immediate tab close | pass | both stored |
| DL8 | Injected save failures (2) | pass | retried, content kept, final Saved |
| DL9, DL10 | External write on a stale base, then typing | pass | DB keeps external content, one `conflict` draft with the typed text, later edits save normally without more drafts |
| BR1 | Save with unknown node/mark, heading level 9, bad image ids, empty file name, non-doc root | pass | all VALIDATION_FAILED, revision unchanged; hostile attrs (`onclick`, `__proto__`, `style`), `javascript:`, `data:`, credentialed and non-http links stripped on accept, prototype not polluted |
| BR2 | Replay of a requestId, forged token, other viewId with real token, second acquire, format mismatch, stale retry | pass | replay returns the same ack (no second revision); forged/other-view saves give LEASE_REQUIRED plus a `lease_lost` draft and never reach the note; second acquire `granted:false`; a retried stale save returns the same draftId (one `conflict` row) |
| BR3 | Version or draft of another note used for restore/dismiss; convert without confirm; stale convert | pass | NOT_FOUND / VALIDATION_FAILED / CONFLICT; other note's draft stays unresolved |
| BR4 | Attachment links on save | pass | link rows follow content; removed image becomes `unreferenced_since`; unknown attachment ids kept but not linked |
| BR5 | Plain note, Bangla and emoji text, importBytes with empty bytes, string bytes and 21 MB | pass | exact text; VALIDATION_FAILED / LIMIT_EXCEEDED |
| PS1 | 26-vector hostile HTML (SVG with script, remote img/picture/srcset/video/audio/input/link/meta/base/body background/inline CSS url, data:svg, data:text/html, iframe srcdoc, template, noscript, form, math, `javascript:` in 4 obfuscations, `vbscript:`, `data:`, `file:`, protocol-relative, credentialed URL, event handlers) pasted with real Ctrl+V | pass | `window.__pwned` undefined; a local HTTP server on 127.0.0.1 recorded 0 requests in 2.5 s; `blockedRequests` empty; only `http(s)` hrefs remain (remote images become "Image: host" links); no img/svg/iframe/script/style in editor or stored JSON; nothing in `attachments` |
| PS2 | Paste 12,000 paragraphs (2.4 MB HTML) | pass with observation | worked, saved, relaunch intact, but the paste took 34 s on Windows and 41 s on WSLg (see QA-2) |
| PS4 | 70 nested blockquotes pasted | pass (observation) | saved; see QA-3 for the list variant |
| PS5 | NUL, RLO, lone surrogate, ZWJ emoji, Bangla conjuncts, combining marks, tab: type, relaunch | pass | all round-trip; FTS `MATCH` finds "combining" and the Bangla word after save |
| IM1 | Same bitmap pasted twice | pass | one `attachments` row and one file, two `note_attachments` rows with distinct block ids, `attachments/tmp` empty, survives relaunch |
| IM2 | Forged/malformed bytes through the real IPC: PE, HTML, SVG, truncated PNG, 30000x30000 PNG | pass | UNSUPPORTED with the exact copy (the pixel case gives the 100 megapixel copy); JPEG/GIF/WebP named `.png` are stored with their real mime and extension; an executable stored as `document` is not served by the protocol |
| IM3 | Drop of fake PNG, 25 MB image, `.exe` | pass | friendly toasts; `.exe` becomes a document chip, no image row; typing latency 9 ms afterward |
| IM4 | Managed file deleted and another corrupted, relaunch | pass | both nodes show "Image unavailable", editor stays editable and saves; protocol requests for unknown UUID, `..%2f`, `../`, `/../..`, `%2e%2e`, `///etc/passwd`, a document id, a trailing path and an uppercase id all fail (no image loads) |
| IM5 | Image paste into a plain note; HTML paste into a plain note | pass | notice shown, no rows; plain text fallback stored |
| KB1 | Ctrl+B, Ctrl+I, Ctrl+Alt+1, Ctrl+Shift+8/7/9, Ctrl+Enter, Ctrl+Alt+c, 60x undo and 60x redo | pass | marks, heading, bullet, ordered, task (checked toggled), code block saved; undo to empty is persisted and redo restores; every block id unique afterwards |
| BID1 | Block ids across 5 edits, split, join+undo, relaunch, cut and paste | pass | ids unchanged by edits and by relaunch, split gives the new paragraph a new id, never a duplicate |
| PASTE-DUP | Clipboard HTML where five nodes carry the same `data-id` | pass | all five replaced by distinct new ids |
| CV1 | Rich to plain with Bangla/emoji/combining text | pass | warning dialog text shown, Cancel changes nothing, Convert stores one `conversion` version holding the bold JSON, plain text exact, relaunch identical, Convert back to rich restores text and gives every block an id; two `conversion` versions |
| FIND1 | Ctrl+F with `(`, `[x]`, `a.b*`, backslash, `.*`, Bangla, case | pass | no exceptions, `.*` is literal, note revision unchanged, focus returns to editor |
| LINK1 | Link dialog with six unsafe schemes and a bare host | pass | each shows the specified error; `https://example.com/path` saved; plain click does not call `shell`; Ctrl+click opens through main (`shellCalls`) |
| WSLg | Same four specs under WSLg (ozone x11): 31 passed, 1 failed (`qa-wslg-spot.log`; PS3 failure was a flaw in my first test version; rerun in `qa-wslg-ps3.log` reproduces QA-1 identically) | pass except QA-1 | |

Not repeated (already passing in the controller logs and not in doubt): single live editor and inactive-tab disposal (`editor.spec` single editor instance and `editor-memory.spec`), the basic stale/read-only/take-control/silent-holder flows (`conflict.spec`), lease manager unit behavior (13 cases in `tests/integration/lease.test.ts`: refusal of a second viewId, take with cooperating and silent holders, concurrent take conflict, reset, FORBIDDEN for a reused viewId, lease_lost draft). I checked these at integration level by reading the case list and exercised the forged/other-view/second-acquire paths through the real bridge in BR2.

## Issues

### QA-1 (Medium): an oversized note says "Request is too large" and shows only "Not saved"

- Reproduce: `.infinity-work/qa/p03-paste.spec.ts` PS3 (or `p03-probe-limit.spec.ts`). Paste one 6 MB paragraph of HTML into a rich note.
- Expected (UX_SPEC line 97, plan 8.1, `NOTE_TOO_LARGE_MESSAGE`): "This note is too large to save (over 5 MB). Remove some content to keep editing safely."
- Actual: the save status reads "Not saved" with the tooltip "Request is too large" (the router's generic payload error, `src/main/ipc/router.ts:78`); no banner or toast. The friendly message exists only for bodies between 5 MB and 5 MB plus 64 KiB, because the router limit (`MAX_CONTENT_BYTES + 65536`) trips first. Closing the tab shows the toast "Could not save this note. The tab stays open." Nothing is lost (DB keeps the last good content; Ctrl+Z recovers; quit takes 169 ms and drops the unsavable paste with no warning).
- Evidence: `.infinity-work/logs/phase-03/qa-ps3-win.log`, `qa-probe-limit-win.log`, `qa-wslg-ps3.log`.
- Fix direction: map `LIMIT_EXCEEDED` on `note:save` to the specified copy (router message per channel or a renderer pre-check), and show it as a visible message rather than only a tooltip.

### QA-2 (Medium): very large pasted HTML freezes and then kills the renderer; unacked typing before it is lost

- Reproduce: `.infinity-work/qa/p03-probe-big.spec.ts` and `p03-probe-big10.spec.ts`; `p03-paste.spec.ts` PS2.
- Actual: paste time grows roughly quadratically with paragraph count (1500: 0.7 s, 3000: 2.3 s, 6000: 8.7 s, 12000: 34 s on Windows, 41 s on WSLg); a 9.6 MB (30,000 paragraph) paste runs about 15 to 24 s and the renderer dies with `renderer-gone reason=oom` (main.log), after which the app reloads the window. The text typed just before the paste (inside the 400 ms debounce, the renderer being frozen so the timer never ran) is lost silently (BIG10 withWait=false: editor and DB both empty). With the text acknowledged first, it survives.
- Expected: a pathological paste should be bounded (size guard or fall back to plain text with a message) and should not endanger earlier edits.
- Evidence: `qa-probe-big-win.log`, `qa-probe-big10-win.log`, `qa-paste-win.log` (PS2 time), `qa-wslg-spot.log`.
- Fix direction: guard `transformPastedHTML` by size (for example reject or truncate above a couple of MB with a notice), and flush pending edits before processing a paste.

### QA-3 (Low): the editor accepts nesting that the save pipeline refuses forever

- Reproduce: `.infinity-work/qa/p03-probe-nest.spec.ts`. Paste a list nested 40 levels (document depth 78): the editor shows it, save status becomes "Not saved" (stored depth limit is 64, `normalizeRichDoc`); 31 levels (depth 62) saves. Via the bridge, depth 62 saves and 64 gives VALIDATION_FAILED (`qa-probe-depth2-win.log`).
- Actual: generic "Could not save this note." with no hint; every later edit in that note keeps failing until the paste is undone, and closing the tab is blocked with the generic toast. Not data loss (last good state stays), but not recoverable by a user who does not know the limit.
- Fix direction: limit nesting when pasting (flatten beyond the allowed depth) or give a specific message for VALIDATION_FAILED on depth.

## Observations, no action required

- The first Windows E2E attempt of my own `Control+Alt+C` used an uppercase key (Playwright adds Shift); `Control+Alt+c` and the toolbar button both create a code block. Test artifact only.
- Forged-token and other-view saves each create a `lease_lost` draft (plan 8.1 step 3); a rogue renderer could create many small draft rows. Phase 08 retention applies.
- Remote image paste turns into "Image: host" links, which is intended and never fetches.
- File-list clipboard paste from an OS file manager and native drag-and-drop are not automated (synthetic DataTransfer only), as the implementer states.
- Timezone/DST, duplicate reminders and platform notifications are not Phase 03 scope.

## Pending native cases

GNOME and X11 desktop sessions (outside the user-selected scope); forced Wayland (informational, D-050); native OS validation matrix (Phase 09).

## Cleanup

No `electron` process remains on Windows (`tasklist`) or in WSL (`ps`) after the runs. QA specs write only to temp userData directories that are removed after each test; `.infinity-work/qa-results-p03/` holds Playwright output.

## Re-QA after Repair 1 (2026-10-09)

Verdict: PASS. QA-1, QA-2 and QA-3 are fixed. No new blocking defect; one Low observation (QA-4) is recorded below. Controller logs read: `coordinator2-check.log`, `coordinator2-build.log` (exit 0), `coordinator2-test-e2e.log` (114 passed, 1 Linux-only skip).

### Re-run of all earlier QA specs and probes (Windows)

`.infinity-work/logs/phase-03/qa2-rerun-win.log`: 48 passed. Previously failing PS3 now passes with the specified copy as tooltip and visible `role="alert"`. Paste of 1,500 / 3,000 / 6,000 paragraphs renders in 80 / 119 / 196 ms (was 0.7 / 2.3 / 8.7 s); PS2 (12,000 paragraphs) 0.9 s (was 34 s). A 9.57 MB paste is refused with "This paste is too large (over 8 MB). Paste a smaller part." and "KEEPME" stays saved in both variants (no `renderer-gone`). NEST 40 is refused with the depth message and the note stays Saved; NEST 20 and 31 save.

### New adversarial cases (`.infinity-work/qa/p03-repair.spec.ts`; Windows 14 passed, `qa2-repair-win.log`)

| Case | Result |
| --- | --- |
| R1 paste of 8 MiB + 1 chars | refused with the message, editor text unchanged. Note: the limit counts the characters delivered to the page, and Windows adds a 72-char CF_HTML wrapper, so "exactly 8 MiB" of sent HTML is refused too; 8 MiB - 1000 is accepted (`p03-probe-edge`, `qa2-probe-edge-win.log`) |
| R1 accepted ~8 MiB paragraph | then the 5 MB note limit applies: "Not saved", visible alert with the exact copy, DB keeps "KEEP", typing latency 336 ms |
| R2 6 MB paste accepted | "Not saved" plus alert; extra typing does not reach the DB; relaunch shows last good "GOOD"; Ctrl+A, Delete, retype returns to Saved and clears the alert; undoing back to the huge paragraph is refused again without touching the DB |
| R3 typing, then 300 KB paste, then immediate quit | typed text durable (pre-paste flush works); typing then an over-8 MiB refused paste then quit: "TAIL" durable |
| R4a repeated Tab indentation (40 nested list levels) | stops at stored depth 64, message shown, note stays Saved, editable, later typing saves |
| R4b blockquote+list mix pasted at 10/20/21 levels | saved with stored depth 31/61/64 (boundary 64 accepted); 22/31/32/33 levels refused with the depth message, status never "Not saved" |
| R5 40,000 paragraphs (80,001 nodes) | accepted in 786 ms; 15,000 more refused with "This would make the note too large to store. Paste or add a smaller part."; note stays Saved; typing at the end saves in 947 ms |
| R6 3.97 MB note (1,900 paragraphs) | opens in 3.6 s; per-key insert plus next frame median 37 ms, max 72 ms; keystroke to Saved 852 ms; head edit 873 ms; find fill 128 ms |
| R7 undo after refusals | undo after an over-8 MB refusal only undoes earlier typing; editor text equals DB after redo; after a depth refusal undo/redo remain consistent; undoing an unsavable 6 MB paste returns to Saved with the DB at "one" |

### WSLg run (Ubuntu 26.04.1, WSLg 1.0.73, DISPLAY :0)

`qa2-wslg.log`: `p03-repair`, `p03-paste`, `p03-probe-limit`, `p03-probe-big`, `p03-probe-nest`: 34 passed. Same numbers as Windows (PS2 3.5 s, 6000 paragraphs 252 ms, depth boundary 21 accepted / 22 refused, 40k paragraphs 1.0 s, 4 MB note keystroke to Saved 831 ms). The mirror's only difference from the working tree before the run was `docs/progress/phase-03.md`; the QA specs were copied into `~/infinity-notes/.infinity-work/qa/` (excluded from the mirror comparison) and removed afterward, along with `qa-results-p03`.

### QA-4 (Low, observation, no action required for acceptance)

Performance of `p03-probe-bangla.spec.ts` (`qa2-probe-bangla-win.log`): a realistic Bangla document of 10,000 paragraphs (1.27 M chars) pastes in 1.1 s, but a single unbroken run of one Bangla letter scales quadratically in browser text layout: 128K chars 0.9 s, 256K 3.4 s, 512K 13 s, 1 M chars 57 s (`qa2-probe-edge-win.log`), and 7 M chars hangs the renderer. Earlier edits are flushed first (>= 256 KB rule), so no data is lost, but the 8 MB character guard does not bound this pathological shape. Not realistic user input.

### Cleanup

No Electron process remains on Windows or in WSL. QA temp userData directories are removed by the harness.

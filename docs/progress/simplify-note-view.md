# Simplified note view (D-102, user request 2026-10-09)

Scope: a focused UI change on the user's request. Testing is targeted: lint, typecheck, unit tests for the touched modules, and only the E2E specs whose selectors or flows this change affects. No WSL, packaging, full E2E suite or commit.

## What changed

- **Note view** (`src/renderer/notes/NoteView.tsx`): the note area is only the text. The title field, path line, persistent save line, toolbar row, More menu and the Float button are gone. The save state stays a `role="status"` element (visually hidden) and becomes a small "Not saved" pill only when a save fails or is retrying; the reason (for example too large) shows below it. Banners, title errors and the note-level reminder chip bar are unchanged.
- **The tab is the title** (`src/renderer/tabs/TabStrip.tsx`, `src/renderer/notes/TitleRenameInput.tsx`, `src/renderer/state/ui-store.ts`, `src/renderer/state/app-services.ts`): a new note's tab opens in rename mode. Double-click or F2 on a note tab renames it, with the field over the tab label. Enter saves and moves into the text synchronously (A08-F1, one `EditorHandle` for the active note tab). A click elsewhere saves. Escape restores the title and focuses the tab. `NoteTitleInput.tsx` is replaced.
- **Floating formatting** (`src/renderer/editor/FormatBubble.tsx`, `Floating.tsx`, `placement.ts`): the toolbar appears above a selection (or below it when there is no room), with the link actions in a link and "Image size" for a selected image. Alt+F10 shows it at the cursor and focuses it. Left and Right move between its buttons; Escape returns to the text. `Toolbar.tsx` is removed.
- **Insert list** (`src/renderer/editor/slash-menu.ts`, `SlashMenu.tsx`, `note-actions.ts`): "/" at the start of a line or after a space shows headings, lists, checklist, code block, image, file, Link to note…, Add reminder… and Create reminder from text. The list is filtered with the palette matcher (`filterActions` is now generic, with keywords).
- **Note menu** (`src/renderer/editor/NoteEditor.tsx`, `note-actions.ts`): right-click or Shift+F10 opens it. It has insert, reminders, Find, Convert, Version history and (tabs only) Float as sticky. Read-only text is now keyboard-focusable, so the menu works there too. A picked note link moves the focus into the text synchronously.
- **Details panel**: `layout.panelOpen` defaults to false (`src/shared/contracts/settings.ts`, renderer fallback, `LayoutStore`). The title bar toggle, View menu and Ctrl+Shift+\ open it, and the choice still persists. The D-097 title bar is unchanged.
- **Sticky header** (`src/renderer/stickies/StickyHeader.tsx`, `StickyView.tsx`, `styles/stickies.css`): the title is text inside the drag region (N-O2). The header, title and badge are `drag`; only the color, pin, collapse, actions and × buttons are `no-drag`. Renaming uses F2 or the new "Rename" menu item, which show a no-drag field. A double-click cannot be used because a drag region swallows pointer events and Windows maximizes on a double-click there.
- **Styles**: `components.css` (note header, save pill, tab rename field), `editor.css` (surface, floating box, bubble, insert list) and `stickies.css`.
- **Keyboard help** (`src/renderer/state/shortcuts.ts`): Alt+F10, "/", Shift+F10, F2 on a tab, F2 in a sticky.
- **Docs**: DECISIONS D-102, UX_SPEC sections 5–7, USER_GUIDE section 2.

## Tests changed or added

- New unit test `tests/unit/renderer/editor/note-menus.test.ts`: the slash trigger (including Bangla, words, code blocks and long paragraphs), bubble kinds, placement and flipping, and the note and insert menu composition.
- `shell-smoke.test.tsx` adds D-102 checks: the tab is the title (rename field focused, Enter into the text), only the text in the view, the hidden save state, the "Not saved" pill with the too-large message, and Details closed by default. `sticky-header.test.tsx` covers the title as text and the Rename item. `layout-store`, `tree-commands`, `settings` and `ipc-handlers-phase02` follow the new default without weaker assertions.
- New E2E spec `tests/e2e/note-view.spec.ts` with two tests:
  - Note view: only the text in the view; tab rename by double-click (Enter into the text) and F2 (Escape cancels and focuses the tab); the floating toolbar on a selection applies Bold and stays clear of the selected line; Alt+F10, arrows and Escape; "/" not opening inside a word and Escape keeping the "/"; "/link" opening the Link to note picker; "/rem" leading to Create reminder from text with the card's title; the right-click menu listing and Add reminder…; the Details toggle with a persisted setting.
  - Sticky header: computed `-webkit-app-region` is drag for the header, title and badge and no-drag for every control; the controls take less than half the header; F2 rename (field no-drag, Enter into the text, title saved); menu Rename with Escape keeping the title.
- Updated E2E helpers:
  - `pressToolbar` uses Alt+F10.
  - `chooseMore` is replaced by `chooseNoteMenu` (Shift+F10).
  - New: `openFormatting`, `noteMenu`, `activeTab` and `renameActiveTab`.
  - `saveStatus` uses the `.note-view` locator.
  - `withPanel` opens the panel when it is closed.
  - `floatFromTab` uses the note menu.
  - `setContentSize` waits two frames so the resize reaches the layout.
  - Spec assertions were changed to the new places with the same strength, for example tab label checks instead of title-field values and the Details Location in place of the removed path line. `packaged.spec.ts` was updated but not run (no packaging in scope).

## Commands and results (Windows 11, Node 24.15; E2E with `INFINITY_E2E_NODE` = portable Node 24.21)

Logs are in `.infinity-work/logs/simplify/`.

| Command | Result | Log |
| --- | --- | --- |
| `npm run lint` (final) | EXIT=0 | `lint.log` |
| `npm run typecheck` (final) | EXIT=0 | `typecheck.log` |
| `npm run test:unit` | 92 files, 674 tests passed, EXIT=0 | `test-unit.log` |
| `vitest --project integration` settings + ipc-handlers-phase02 | 20 passed, EXIT=0 | `test-integration-touched.log` |
| `npm run check:traceability` | fails=0 warns=0, EXIT=0 | `traceability.log` |
| `run-e2e` note-view (first version) | 1 failed: the note menu item "Find in note" also showed its shortcut text, so the shortcut hint was removed | `e2e-note-view-1.log` |
| `run-e2e` note-view (with tab title and sticky header) | 2 passed, EXIT=0 | `e2e-note-view-2.log` |
| `run-e2e` batch 1: visual, editor, editor-flow, conflict, note-live, shell, stickies, titlebar, tabs | 84 passed, 4 failed, EXIT=1 | `e2e-batch-1.log` |
| (fixes below) rerun editor, shell, stickies, note-view | 45 passed, EXIT=0 | `e2e-batch-1-rerun.log` |
| `run-e2e` batch 2: nlp, paste, references, reminders, search, versions, backup, crash | 53 passed, 1 failed, EXIT=1 | `e2e-batch-2.log` |
| (fix below) rerun references, note-view | 7 passed, EXIT=0 | `e2e-references-rerun.log` |
| `run-e2e` batch 3 on the final code: visual (screenshots), perf, a11y-keyboard, home, keyboard, tree, editor-flow, conflict, note-live, titlebar, tabs | 72 passed, 1 failed, EXIT=1 | `e2e-batch-3.log` |
| (test fix below) rerun a11y-keyboard | 8 passed, EXIT=0 | `e2e-a11y-rerun.log` |

Each failure had a cause that was fixed. Nothing was retried unchanged:

- Batch 1, `editor › image size preset`: pressing a size radio blurred the text, which hid the toolbar under the pointer. Fix: a press on a field in the toolbar marks it focused; other presses keep the focus in the text.
- Batch 1, `shell › panel toggle`: the toggle could run before the resize reached the layout (drawer mode, not persisted). Fix: `setContentSize` waits for the next frames.
- Batch 1, `stickies › float opens one native window`: the main tab's text is read-only once floated and was not focusable, so Shift+F10 did nothing. Fix: read-only text gets `tabindex=0`.
- Batch 1, `stickies › header controls`: the expected menu now includes Rename.
- Batch 2, `references › picker`: keys typed right after picking a note link arrived before Tiptap's deferred focus. Fix: the focus moves synchronously.
- Batch 3, `a11y-keyboard › accessibility structure`: the audit expects the Details landmark, which is now closed by default. The test opens it first.

No orphaned Electron processes: `tasklist | grep -ci electron` printed 0 after the runs.

## Screenshots (looked at)

`.infinity-work/logs/simplify/screens/` (from the final `visual.spec` run):

- `1100x720-light-note.png`: only the text under the "Launch plan" tab.
- `1100x720-dark-rich-note.png`: dark, with the floating link actions.
- `760x560-light-editor-toolbar.png`: the formatting toolbar on a selection.
- `tab-note-menu.png`: the right-click note menu.
- `sticky-light.png`, `sticky-dark.png`: the header with the title as text.
- `1280x800-light-panel.png`: the Details panel opened.

## Not run

- The full E2E suite, WSL/WSLg, packaging and `packaged.spec` (outside the requested scope).
- Native drag of the sticky header with a real pointer. It is covered only by the computed-style assertions.

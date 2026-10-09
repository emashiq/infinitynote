# Phase 08 progress: Backup, export/import, preferences and polish

Implementer: infinity-code-opus (Opus 5.5, high), fast mode (CLAUDE.md 2026-10-09: no separate planner or QA). Plan pointer: `docs/plans/phase-08.md`. Logs: `.infinity-work/logs/phase-08/`. Decisions: D-099.

## Plan

- No migration (every table exists; D-051 allocation leaves 008 unused). Dependencies: `yazl` 3.3.1, `yauzl` 3.4.0 (pinned in DECISIONS) plus their `@types`.
- Main `src/main/portability/`: `zip-archive` (yazl writer; yauzl reader with preflight: normalized names, no absolute/`..`/drive/backslash/NUL, no symlink attributes, at most 200,000 entries, at most 4 GiB declared, ratio at most 100 for entries over 1 MiB, declared sizes enforced); `backup-writer` (`db.backup()` snapshot so WAL content is included, attachment files from the snapshot's rows, `manifest.json` with SHA-256 and sizes); `restore` (prepare: preflight, extract to `data/restore-staging/`, verify hashes, read-only `integrity_check`, schema at most the app's; commit: marker `data/restore-pending.json` and restart; startup swap: live data to `data/rollback-<stamp>/`, staging into place, open (older schemas migrate forward); any failure moves the rollback copy back); `portable-export` / `portable-import` (`*.infinityexport`: JSON of live projects, folders, notes with tags, reminders and attachments; import remaps every project, folder, note, block and attachment ID, rewrites `noteRef`, image and file nodes, reminders and their blocks, never overwrites, Common items land in a new folder "Imported <date>"); `markdown` (lossy Markdown and plain-text export of one note, images and files copied beside it); `auto-backup` (off by default, chosen folder, every 1/7/14/30 days, keep 3/5/10/20, prunes only its own file names); `portability-service` (dialogs, one operation at a time, GC paused while it runs).
- `services/maintenance.ts`: trash auto-purge (Never default, 30, 90 days), configurable automatic version retention (days, count), draft retention (F-03-4: at most 20 open `lease_lost` drafts per note, resolved drafts deleted after 30 days), attachment GC (live or trashed notes, versions and open drafts count as references; 7-day grace). Runs at startup and every 6 hours.
- `services/global-shortcut.ts` (INF-KEY-05): optional quick-sticky shortcut, off by default, three presets, capability-checked (Windows, X11 supported; Wayland/WSLg unsupported), registration failure reported in Settings; a fake adapter under the E2E hooks.
- IPC (appended): `backup:create|prepareRestore|restore|status|setAuto|chooseAutoFolder|deleteRollback`, `export:markdown|portable`, `import:portable`, `shortcut:getGlobal|setGlobal` (main window only). Dialog adapter gains save, open-file and folder pickers (hook queues in E2E). Settings registry: `retention.trashDays|autoVersionDays|autoVersionMax` (public), `backup.auto`, `backup.lastAuto`, `shortcut.quickSticky` (internal).
- UX: Settings sections General, Appearance, Notes and attachments (image and document limits, trash and version retention), Reminders, Windows and tray (launch at login completion, A05-F4), Backup (back up, restore with confirmation, export, import, automatic backup, previous data copy), Keyboard (global shortcut, keyboard help). Ctrl+/ opens keyboard help (app, tree and editor keys). File menu: Back up, Restore, Export note as Markdown / plain text, Import. Contrast fixes (control borders at least 3:1), reduced motion.
- Tests per ID: PORT-01 integration/backup.test › WAL content present; PORT-02 integration/restore.test › failure rollback + e2e/backup.spec; PORT-03 integration/import-security.test (crafted archives); PORT-04 integration/import.test › remap; PORT-05 integration/export.test; PORT-06 integration/backup.test › auto schedule + e2e; PORT-07 integration/versions.test › retention + e2e/versions.spec; PORT-08 integration/attachment-gc.test; PREF-01..04 e2e/settings.spec; PREF-02/05 integration/settings.test; DESK-03 e2e/settings.spec › lifecycle settings; KEY-05 integration/shortcuts.test + e2e; KEY-06 e2e/settings.spec › keyboard help; A11Y-01..03 e2e/a11y-keyboard.spec additions; A11Y-04 unit/contrast.test; A11Y-05 unit/css-motion.test; A11Y-06 e2e scaled check (native check Phase 09). Gate once at the end: check, build, test:e2e (Windows, Node 24.21 runner).

## Summary

A notebook can be backed up while in use: a consistent SQLite snapshot (online backup API, so committed WAL content is included), every attachment file and a manifest with SHA-256 hashes. Restore checks the archive before anything changes, stages and verifies it, restarts, swaps it in before the database opens and puts the previous data back if anything fails; the replaced data is kept until the user deletes it. A portable export moves notes, folders, projects, tags, reminders and attachments into another notebook with fresh IDs and rewritten references. Single notes export to Markdown or plain text. Automatic backups (off by default) go to a chosen folder. Trash and version retention are configurable, `lease_lost` drafts are capped (F-03-4) and unused attachment files are collected after a 7-day grace period. Settings is complete (General, Appearance, Notes and attachments, Reminders, Windows and tray incl. launch at login (A05-F4), Backup, Keyboard), with an optional global quick-sticky shortcut, keyboard help on Ctrl+/, contrast-checked tokens, a global reduced-motion rule and narrow-layout fixes.

## Hosts

- Windows 11 Pro 10.0.26300; Node 24.15.0 (lint, typecheck, unit, integration, build); E2E runner Node 24.21.0 (`INFINITY_E2E_NODE`, portable); Electron 44.7.0.
- No WSL, Xvfb, forced-Wayland or packaging runs in this phase (fast mode; deferred to Phase 09).

## Files

- Dependencies: `yazl` 3.3.1, `yauzl` 3.4.0 (runtime, pinned in DECISIONS), `@types/yazl` 3.3.1, `@types/yauzl` 3.4.0. No migration.
- Shared: `contracts/portability.ts`, `contracts/shortcuts.ts` (new); `contracts/{settings,channel-names,channels,bridge}.ts`; `attachments/limits.ts` (oversize wording points at Settings); `versions/retention.ts` (configurable policy); `names.ts` (`suggestedFileName`); `theme/tokens.css` (`--border-strong`, `--on-accent`, lighter light `--accent-soft`).
- Main: `portability/{zip-archive,backup-manifest,backup-writer,restore,portable-format,remap,portable-export,portable-import,markdown,note-export,auto-backup,portability-service}.ts`, `services/{maintenance,global-shortcut,retention-policy}.ts`, `db/repositories/portable-repo.ts`, `ipc/handlers/{portability,shortcut}-handlers.ts` (new); `app-paths.ts`, `index.ts` (restore before open, housekeeping timers, global shortcut), `desktop.ts` (`newSticky` shared by tray and shortcut), `main-services.ts`, `test-hooks.ts` (save/open/folder dialog queues, restart counter, fake global-shortcut registry, maintenance and auto-backup triggers), `services/{attachment-service,capabilities,dialog-adapter,note-writer,reminder-service,trash-service,version-service}.ts`, repositories `attachments,drafts,trash,versions`, `ipc/register-handlers.ts`, preload.
- Renderer: `settings/{fields,use-settings,NotesSettings,BackupSettings,KeyboardSettings}`, `state/portability-commands.ts`, `ui/motion.ts` (new); `pages/{SettingsPage,ReminderSettings}.tsx`, `shell/{AppMenuBar,HelpDialogs}.tsx`, `state/{app-services,commands,palette-actions,shortcuts,ui-store}.ts`, `ui/DialogHost.tsx`, `tabs/TabStrip.tsx`, styles `base.css`, `components.css`, `editor.css` (its duplicate reduced-motion block is covered by the global rule).
- Tests (new): integration `backup`, `restore`, `import-security`, `import`, `export`, `attachment-gc`, `shortcuts` (incl. Phase 08 IPC roles/validation), `portability-helpers`; unit `contrast`, `css-motion`; e2e `backup.spec`, `settings.spec`, `versions.spec`, `portability-ui`; `tests/support/zip.ts` (byte-level zip writer for malicious archives).
- Tests (extended or updated for the new phase, no assertion weakened): `integration/{settings,versions}.test` (Phase 08 cases); `e2e/a11y-keyboard.spec` (keyboard-only primary flows, getByRole coverage, narrow layouts); `e2e/visual.spec` (high DPI 200 %); `unit/{shortcuts,palette-actions}.test` (Ctrl+/, new actions); channel catalogue 78 → 90 (`contracts.test`), settings key list (`contracts-phase02.test`), runtime dependency list (`app-identity.test`), bridge surface (`security.spec`), `globalShortcut` now detected (`capabilities.test`), UX token table 13 → 15 rows (`tokens.test`), oversize wording in 5 files, dialog/desktop/fake-bridge seams.
- Docs: `DECISIONS.md` (D-099), `ARCHITECTURE.md` (sections 4, 5, 13), `UX_SPEC.md` (tokens, Phase 08 copy, attachment wording), `BACKLOG.md` (22 rows), `docs/plans/phase-08.md`, this report.

## Requirement coverage

| ID | Evidence (tests that ran) | Status |
| --- | --- | --- |
| INF-PORT-01 | integration/backup.test › WAL content present (last edit only in `-wal` with auto-checkpoint off; a copy of the main file lacks it, the archive has it; manifest hashes/sizes, image hash, rollback-journal copy, live DB still WAL); e2e/backup.spec › edited note with images while SQLite uses WAL (typed in the editor, `-wal` non-empty, File → Back up now…) | done |
| INF-PORT-02 | integration/restore.test › clean profile (content, revisions, references, reminders, occurrences, tags, attachment hash, search, rollback copy, delete), failure rollback ×4 (restored copy fails to open, move fails half way, swap interrupted by a crash, staging changed after verification), nothing prepared, older schema migrated forward; e2e/backup.spec › restore into a clean profile (summary, restart, notice, DB snapshot equal, image renders, reference chip, delete previous data), malicious archive leaves the notebook usable | done |
| INF-PORT-03 | integration/import-security.test (traversal, absolute, drive letter, backslash, symlink, too many entries, oversized total, 8 MiB deflate bomb, newer schema, newer format, unknown format, unexpected/missing entries, bad hash, damaged DB; nothing written outside; staging removed; same for portable import) | done |
| INF-PORT-04 | integration/import.test › remap (fresh IDs for items and blocks, noteRef and reminder blocks rewritten, backlinks, attachment re-stored, flags and tags, Common items in "Imported …"), same notebook never overwrites or aliases, unknown zone skipped, only live items exported; e2e/backup.spec › export everything and import as a copy | done |
| INF-PORT-05 | integration/export.test (Markdown structure, emphasis, lists, checklists, quote, code, link, hard break, reference label, copied image, plain text, plain note, refusals, file names); e2e/backup.spec › Markdown and plain text from the File menu. Lossy limits documented in D-099, UX_SPEC and Settings > Backup | done |
| INF-PORT-06 | integration/backup.test › auto schedule (off by default, needs a folder, once per interval, keeps 3, user's own file untouched), failure retried after an hour; e2e/backup.spec › automatic backup | done |
| INF-PORT-07 | integration/versions.test › retention (count/age at save and in maintenance; Trash kept by default, 30 days purges only older batches; F-03-4 cap 20, resolved drafts deleted after 30 days); e2e/versions.spec; e2e/settings.spec › notes and attachments | done |
| INF-PORT-08 | integration/attachment-gc.test (live, trashed, version-only, draft-only kept; orphan deleted exactly at 7 days; reference resets clock; purge starts it; waits while busy) | done |
| INF-PREF-01 | e2e/settings.spec › theme (System default, Light, Dark, survives restart); e2e/a11y-keyboard.spec (View → Dark theme by keyboard) | done |
| INF-PREF-02 | integration/settings.test › reminder defaults; e2e/settings.spec › reminder defaults | done |
| INF-PREF-03 | e2e/settings.spec › quiet hours | done |
| INF-PREF-04 | e2e/settings.spec › lifecycle settings (Ask default, background and fully-quit texts, switches default off, launch at login disabled "Available in the installed app", survives restart; optional features off) | done |
| INF-PREF-05 | integration/settings.test › limits bounds; e2e/settings.spec › notes and attachments | done |
| INF-DESK-03 | e2e/settings.spec › lifecycle settings (A05-F4 final layout; fake login items under hooks) | Phase 08 part done; native login check Phase 09 (row in_progress) |
| INF-KEY-05 | integration/shortcuts.test; unit/capabilities.test › global shortcut; e2e/settings.spec › global quick-sticky shortcut, unavailable desktop | Phase 08 part done; native check Phase 09 (row in_progress) |
| INF-KEY-06 | e2e/settings.spec › keyboard help; unit/shortcuts.test › Ctrl+/ | done |
| INF-A11Y-01 | e2e/a11y-keyboard.spec › keyboard-only primary flows, tree, tabs keyboard-only; e2e/widget.spec (keyboard activation) | done |
| INF-A11Y-02 | e2e/a11y-keyboard.spec › dialogs return focus, primary flows (menus, help); e2e/settings.spec › keyboard help | done |
| INF-A11Y-03 | e2e/a11y-keyboard.spec › getByRole coverage, accessibility structure on every view | done |
| INF-A11Y-04 | unit/contrast.test › token pairs (15 text pairs ≥ 4.5:1, 7 boundary pairs ≥ 3:1, both themes) | done |
| INF-A11Y-05 | unit/css-motion.test | done |
| INF-A11Y-06 | e2e/visual.spec › high DPI 200 % (devicePixelRatio 2, SVG icons, `test-results/screens/dpi200-settings.png`) | V part done; native scaling Phase 09 (row in_progress) |

Carried findings F-03-4 and A05-F4 are closed by the rows above.

## Commands and results

| Step | Command | Log | Result |
| --- | --- | --- | --- |
| Targeted integration | `npx vitest run --project integration tests/integration/{backup,restore,import-security,import,export,attachment-gc,shortcuts,settings,versions}.test.ts` | console | all passed after test fixes and one source fix (backslash in `suggestedFileName`) |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/backup.spec.ts` | dev-backup-1..4.log | 1: 3/4 (typed text landed after the reference paragraph; content reordered); 2-3: image locator also matched ProseMirror separators; 4: 1/1 |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/settings.spec.ts` | dev-settings-1.log | 8/8 |
| Targeted E2E | versions.spec + settings lifecycle | dev-versions-1.log | 2/2 |
| Targeted E2E | `node tools/run-e2e.mjs tests/e2e/a11y-keyboard.spec.ts` | dev-a11y-1..5.log, dev-debug-1..2.log | the new flow pressed Enter in a just-created title before it was saved, and assumed the first menu item; it now waits for the saved title (user-visible) and walks the menu to the item; 5: passed |
| Targeted E2E | visual.spec -g "high DPI" | dev-dpi-1.log | 1/1 |
| Final check | `npm run check` | final-check.log | EXIT=0: lint, typecheck, unit 88 files / 640 tests, integration 48 files / 417 passed + 1 skipped (pre-existing Linux-only symlink case), traceability fails=0 (the first attempt failed typecheck on an optional index in backup.spec; fixed, re-run) |
| Final build | `npm run build` | final-build.log | EXIT=0 |
| Final E2E | `INFINITY_E2E_NODE=…\node-v24.21.0-win-x64\node.exe npm run test:e2e` | final-test-e2e.log | EXIT=0: 218 passed, 1 skipped (`smoke.spec › Linux: main.log records the display and ozone line`), 8.0 min; includes the Phase 07 title-bar specs; no Electron process left (`tasklist` count 0) |

After the final E2E only this report was edited; traceability was re-run (final-traceability-after-docs.log).

## Notes and limits

- Restore restarts the app (`app.relaunch()`); under the E2E hooks it only quits and the test starts it again, so no detached Electron process is left.
- Markdown export is lossy by design (D-099); a backup is the faithful format.
- Not run here (Phase 09): WSLg E2E, Linux packaging, native launch at login, native global shortcut and native 125-200 % scaling.

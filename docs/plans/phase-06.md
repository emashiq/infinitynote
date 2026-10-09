# Phase 06 plan: Reminder suggestions from natural-language notes

Planner: infinity-planner (Opus 5.5, high), 2026-10-09. Implementer: infinity-code-opus (Opus 5.5, high). One agent at a time; work can resume at every checkpoint in section 14. QA: infinity-qa. Acceptance: infinity-acceptor.

Phase contract: `infinity-notes-claude-pack/phases/06-reminder-suggestions-from-natural-language-notes.md`.

Requirement IDs (24): INF-NLP-01 to INF-NLP-14 and INF-SUG-01 to INF-SUG-10. INF-PREF-02 is touched (new settings keys) but its row stays Phase 08.

Decisions added by this plan: D-088 to D-095 (`docs/DECISIONS.md`), plus the A05-F1 clarification line in D-087.

The parsing test contract is the frozen-clock table in `docs/PRODUCT_SPEC.md` section 6 (D-095). Section 9.2 of this plan adds rows for the rules of D-090.

Acceptance to demonstrate (phase file):
- Every TEST_MATRIX frozen-clock example passes.
- Tomorrow EOD defaults to a visible 17:00, and date-only phrases show a visible 09:00.
- Calendar arithmetic in the selected zone differs correctly near midnight.
- Ambiguous text asks for a choice.
- No reminder exists before confirmation.
- Editing or deleting the source, and restarting, never silently shift or duplicate a reminder.
- An E2E test covers: write the phrase → preview → confirm → side panel → notification opens the source.

---

## 1. Inputs read and actual repository state

Read:
- Root `CLAUDE.md`.
- Pack: `PRODUCT_PLAN.md` ("Natural-language reminder generation"), `ARCHITECTURE.md`, `TEST_MATRIX.md` (Parsing, Suggestions, Time zones, frozen-clock examples), and the phase 06 file.
- `docs/PRODUCT_SPEC.md` (section 4.14/4.15 and the section 6 table), `UX_SPEC.md`, `ARCHITECTURE.md` (sections 3, 4, 8 to 10, 12), `DECISIONS.md` (to D-087), `BACKLOG.md`.
- `docs/plans/phase-00.md` (section 7.11, Appendix B), `docs/plans/phase-05.md`.
- `docs/progress/phase-00-acceptance.md` (F-1, F-7), `docs/progress/phase-05.md`, `phase-05-qa.md`, `phase-05-acceptance.md` (A05-F1 to F5).
- The code listed below.

Actual state at commit `edb40c6` (Phase 05 accepted, working tree clean):

- **Data.**
  - Migrations 001 to 005, `LATEST = 5`, checksums 1 to 5. Migration 005 is frozen (A05-F3).
  - `reminders` has `block_id`, `anchor_state ok|block_missing`, a revision and a soft delete.
  - There is no `reminder_sources` or `suggestion_dismissals` table.
- **Main services.**
  - `ReminderService` (`src/main/services/reminder-service.ts`): `create`, `update` (schedule, pending policy, re-anchor), `delete`/`undoDelete`, `complete`, `snooze`, `listForNote`, views, `zones()` (`asOf` from the reminder clock, which is frozen under `INFINITY_NOTES_TEST_CLOCK`). It validates the zone against `zoneList`, the block against stored content (`collectBlockIds`), and the past rule (`allowPast`).
  - `ReminderAnchors.sync` runs inside `ContentIndexer.index` in every content transaction. `main-services.ts` turns `anchors.consumeChanged` into `reminder:changed {reason:'anchor'}` after the revision event.
- **IPC.**
  - 67 invoke channels and 12 events.
  - The sticky allowlist has `reminder:listForNote` and `reminder:open` only, so `zones:list` and `reminder:create` are FORBIDDEN for stickies (asserted in `ipc-handlers-phase05.test`).
  - Phase 06 names are guarded as absent in `unit/boundaries.test`, `unit/contracts.test`, `integration/ipc-validation.test` and `e2e/security.spec › bridge surface`.
  - `unit/contracts-phase05.test` asserts `INVOKE_CHANNELS` has length 67.
- **Shared time** (`src/shared/time`):
  - `resolveLocal` (gap and fold, D-079), `localParts`, `addDays`, `isoWeekday`, `formatShort`, `dueLines`, `gapNotice`, `foldNotice`, `laterChoiceLabel`;
  - `zoneList`/`isKnownZone` (ICU lists `Asia/Calcutta` and `Asia/Katmandu`, not `Asia/Kolkata` or `Asia/Kathmandu`);
  - `defaultZoneFor`.
- **Renderer.**
  - One `NoteEditor` (Tiptap) for tabs and stickies, rich and plain. Rich block IDs are on paragraph, heading, codeBlock, blockquote, listItem, taskItem, image and fileAttachment.
  - `isUserEdit(tr)` separates edits from load and ID passes.
  - Reminder chips are widget decorations set by meta-only transactions (`reminder-chips.ts`).
  - The Phase 05 `ReminderDialog` (main window `DialogHost`) is built on the pure `reminder-form.ts` (`initialForm`, `previewOf`, `toInput`, `formProblem`).
  - The context panel `RemindersSection` shows the "Original text was removed" actions.
  - Stickies show chips read-only; a chip click opens the main window.
  - `useNoteReminders` reloads on `reminder:changed`.
- **Settings.** `reminders.defaultZone`, `reminders.followupDefault` and `reminders.quietHours` are public. There are no end-of-day or date-only keys.
- **Dependencies.** `chrono-node 2.10.2` is already a pinned devDependency (bundled into the renderer by vite) and is not imported anywhere yet. `luxon 3.7.2` is a dependency.
- **Test seams (D-084).** Under the hooks, the main reminder clock and the computer zone are frozen. The renderer's `Date.now()` and `Intl` zone are real, so detection must take its reference instant and zones from main (D-089).

### 1.1 Planner probes (logs and probe sources in `.infinity-work/logs/phase-06/`)

| Probe | Result |
| --- | --- |
| `planner-probe-chrono.log` (`probe-chrono.cjs`; chrono-node 2.10.2, `forwardDate:false`, reference 2026-10-08T07:00Z, Dhaka offset 360) | <ul><li>"tomorrow end of the day" → only "tomorrow" (no "end of day" result, and no spurious "the day" with `forwardDate:false`). "end of day", "by end of day" and "EOD" → nothing.</li><li>"tomorrow at 8pm" → known 2026-10-09 20:00 with meridiem. "in 2 hours" → known 15:00 with tags `result/relativeDateAndTime`. "tomorrow" → known date, implied 13:00.</li><li>Weekdays: "Friday" → implied Oct 9; "Monday" → implied **Oct 5 (past)**; "Thursday" → **today**; "next Monday" → Oct 12; "last Friday" → Oct 2.</li><li>"03/04 at 5" → known month 3, day 4, hour 5, meridiem implied, year implied 2026. "on Oct 1" → text "Oct 1", year implied 2026 (no roll forward with `forwardDate:false`).</li><li>"by 5 CST" → nothing; "at 5pm CST" → known `timezoneOffset -360`; "tomorrow 9am IST" → `+330`.</li><li>"at 5", "tomorrow at 5" and "tomorrow at 9" → hour with implied meridiem. "17:00" and "at 17" → known meridiem.</li><li>"this evening" → **no known values**; "tonight" → known date, implied 22:00; "tomorrow morning" → implied 06:00; "noon tomorrow" → known 12:00.</li><li>"call Bob tomorrow at 9 and send report on Friday" → two results at 9 and 39.</li><li>Bangla text → nothing.</li><li>New York, reference 03:30Z: "tomorrow at 9am" → Oct 8 09:00.</li><li>Timing: a 2,300-character block takes 0.57 ms; 2,000 characters of plain words 0.08 ms; a short sentence 0.016 ms.</li></ul> |
| `planner-probe-chrono-edge.log` (`probe-chrono2.cjs`) | <ul><li>False positives: "the sun is bright" → weekday Sunday; "see you sun", "mon" and "wed" match; "I will do it in a second" → a 1 s duration; "may 5" lowercase → May 5; "3/4 of the cake" → March 4.</li><li>"next month", "this weekend", "October" and "in October" return results; "on the 15th" → nothing.</li><li>"Friday 3-5pm" → start 15:00 with `end.meridiem` known.</li><li>"midnight" → known hour 0. "tomorrow night" and "Friday evening" → casual evening tag only.</li><li>"tomorrow at 09:30" → hour 9, meridiem implied; the leading zero is visible only in the text.</li><li>"13/04" → day 13, month 4; "04/04" → equal parts; "03/04/2027" → year known.</li><li>"in 2 hours and 30 minutes", "in 2h", "within 2 hours" and "2 hours from now" → duration tags. "the day after tomorrow" → `relativeDate`.</li><li>"tomorrow end of the day at 6pm" → "tomorrow" plus "at 6pm". "Have to submit this by EOD Friday" → only "Friday".</li><li>"by 5" → nothing.</li></ul> |
| `planner-probe-chrono-en.log` (`probe-en.cjs`) | `chrono-node/en` (subpath export) exposes `casual`, `strict`, `GB`, `parse`; same results as the root import. Passing `timezones: {}` does not stop abbreviation offsets, so masking is required. |
| `planner-probe-dst-zones.log` (`probe-dst.cjs`) | <ul><li>New York: 2027-03-14 01:59 EST = 06:59Z and 03:00 EDT = 07:00Z (2027 gap); 2026-11-01 01:30 = 05:30Z (EDT) or 06:30Z (EST).</li><li>Dhaka offset +360.</li><li>2026-10-08 is a Thursday; 2026-10-20 a Tuesday; 2027-04-03 a Saturday.</li><li>Runtime zone list: `Asia/Kolkata` and `Asia/Kathmandu` are absent; `Asia/Calcutta` is present. Present: America/Chicago, Asia/Shanghai, America/Havana, Europe/Dublin, Asia/Jerusalem, Europe/London, Asia/Dhaka, America/Los_Angeles, Asia/Manila, America/Denver, America/Phoenix, Europe/Paris, Europe/Berlin, Asia/Tokyo, Australia/Sydney, Asia/Karachi, Asia/Singapore, Asia/Hong_Kong.</li></ul> |

These results are recorded in D-090. The probes do not change the repository.

## 2. Follow-ups and defects incorporated

| Item | Where |
| --- | --- |
| Phase 00 F-1 (explicit assertions per ID) | Section 12.1: every one of the 24 IDs has inputs, expected outputs and failure cases. |
| Phase 00 F-7 (name the PRODUCT_SPEC section 6 table as the contract) | Done by the planner: PRODUCT_SPEC section 6 wording, D-095, ARCHITECTURE section 10, BACKLOG W06-01. Unit tests cite "PRODUCT_SPEC section 6" in their `describe` titles. |
| A05-F1 (claimed follow-up counts whatever its outcome, incl. `skipped`) | Done by the planner: clarification line in D-087. No behavior change; the implementer adds no code. |
| A05-F3 (migration 005 frozen) | Schema changes only in `006_reminder_sources.sql` (D-088). `unit/migrations-checksum` keeps hashes 1 to 5 byte-identical; S2 checks `git diff --exit-code src/main/db/migrations/00[1-5]*`. |
| A05-F2, A05-F5 (native checks) | Phase 09, unchanged; listed in 12.7. |
| A05-F4 (INF-DESK-03 Settings completion) | Phase 08, unchanged. |
| Open QA defects from Phase 05 | None open (QA5-01 to 04 fixed; QA6-01 and 02 accepted). |

## 3. Ownership, order and file boundaries

### 3.1 Rules

- One implementer modifies application code. The step order is in section 14. Each step ends green and with a checkpoint line.
- Main never imports `chrono-node` or `src/shared/nlp/parse.ts` (boundary test). Main never computes an instant from text. It resolves `{date, time, zoneId, foldPreference}` exactly as `reminder:create` does.
- `src/shared/nlp/parse.ts` imports only `chrono-node/en`, `luxon`, `../time/*` and `./*`. It is never imported from the root `chrono-node` entry, which pulls in every locale.
- Detection never changes the document. It uses meta-only transactions (`addToHistory:false`, no steps), never takes focus and never dispatches during composition.
- No new dependency. `package.json` and `package-lock.json` stay byte-identical (`git diff --exit-code`).
- Migrations 001 to 005 and checksums 1 to 5 are never edited.
- Existing tests are updated only where this plan changes a contract (section 12.5). No assertion is weakened, and the stricter replacement is named.

### 3.2 Files created (C) and modified (M)

Shared (`src/shared`):

| File | C/M | Content |
| --- | --- | --- |
| `nlp/types.ts` | C | `DateIntent`, `TimeIntent`, `ZoneIntent`, `Candidate`, `Choices`, `CandidateResolution` (section 9.1) |
| `nlp/constants.ts` | C | `PARSER_VERSION = 1`, `IDLE_MS = 1000`, `SLICE_MS = 8`, `MAX_BLOCKS_PER_PASS = 2000`, `MAX_CANDIDATES = 100`, `SKIP_INSERT_CHARS = 65536`, `LONG_BLOCK_CHARS = 5000`, `LONG_BLOCK_WINDOW = 300`, `MAX_SOURCE_TEXT = 500`, `MAX_SELECTION_CHARS = 2000`, `MAX_TITLE = 120`, `DAY_PART_TIMES`, `CONNECTORS`, `MAX_DISMISSALS_PER_NOTE = 500`, `DISMISSAL_KEEP_DAYS = 2` |
| `nlp/abbreviations.ts` | C | Abbreviation table (section 9.2.4), `zoneSuggestions(abbr, isKnown)` with alias fallback |
| `nlp/source-text.ts` | C | `normalizePhrase`, `spanOrdinal`, `richBlockText(jsonNode)`, `richBlockTexts(doc, ids)`, `occurrences(text, phrase)`. No chrono; used by main and the renderer |
| `nlp/parse.ts` | C | `findCandidates(text, {referenceInstantUtc, zoneId})`: masking, chrono, classification, EOD and adjacency merges, abbreviations, titles. Renderer only |
| `nlp/resolve-candidate.ts` | C | `resolveCandidate(candidate, {zoneId, choices, endOfDayTime, dateOnlyTime})`. Pure |
| `nlp/title.ts` | C | `titleFor(text, span, fallback)` |
| `time/format.ts` | M | `formatLongDate('YYYY-MM-DD')` → "Friday, 9 October 2026" (built from `formatToParts`, so the output does not depend on the locale) |
| `contracts/suggestions.ts` | C | Schemas in section 6.1 |
| `contracts/reminders.ts` | M | `ReminderDto.source`, `REMINDER_MESSAGES` additions |
| `contracts/channel-names.ts`, `channels.ts`, `bridge.ts`, `channel-roles.ts` | M | 4 channels, bridge methods, sticky allowlist (section 6) |
| `contracts/settings.ts` | M | 3 keys (section 7) |

Main (`src/main`):

| File | C/M | Content |
| --- | --- | --- |
| `db/migrations/006_reminder_sources.sql`, `index.ts`, `checksums.json` | C/M | Section 5; `LATEST = 6`; checksum "6" via `node tools/gen-migration-checksums.mjs` |
| `db/repositories/reminder-sources-repo.ts` | C | insert, replace, get, `forReminders(ids)`, `liveForNote(noteId)` (joined with live reminders), `setState`, `findLiveLink` |
| `db/repositories/dismissals-repo.ts` | C | `insertIgnore`, `get`, `listForNote` (newest 500), `trimNote`, `pruneBefore(date)` |
| `services/reminder-sources.ts` | C | `checkSource(note, source)` → `{spanOrdinal}` or `AppError`; `sourceStateFor(format, content, row)` |
| `services/reminder-service.ts` | M | `createFromSource`, `updateFromSource`, `keepSource`, `source` in DTOs, detach on re-anchor, `zoneContext()` |
| `services/reminder-anchors.ts` | M | Source-state sync (section 8.4) |
| `services/suggestion-service.ts` | C | dismiss (SHA-256 key), `listDismissed`, `pruneDismissals` |
| `main-services.ts` | M | `suggestions` service wiring |
| `index.ts` | M | `suggestions.pruneDismissals()` once after the services start |
| `ipc/handlers/suggestion-handlers.ts`, `ipc/register-handlers.ts` | C/M | Four handlers |
| `test-hooks.ts` | M | `reminders()` also returns `sources` and `dismissals` |
| `services/messages.ts` | M | Error strings if main-side copy lives there |

Preload: `src/preload/index.ts` (M): `reminder.createFromSuggestion`, `reminder.updateFromSource`, `suggestion.dismiss`, `suggestion.listDismissed`.

Renderer (`src/renderer`):

| File | C/M | Content |
| --- | --- | --- |
| `editor/block-text.ts` | C | Text of a ProseMirror textblock with an offset↔position map (hardBreak = "\n"), the plain-document text and offsets |
| `editor/suggestions.ts` | C | `SuggestionDecorations` extension: plugin state (changed ranges, candidates, decorations), `candidateAt(state, pos)`, meta API |
| `editor/suggestion-detector.ts` | C | Idle scheduler, slices, abort, suppression, memory (section 9.3) |
| `editor/SuggestionBar.tsx` | C | The bar (section 9.5) |
| `editor/NoteEditor.tsx` | M | `suggestions` prop, bar, More command |
| `editor/Toolbar.tsx` | M | More item "Create reminder from text" (rich and plain) |
| `editor/extensions.ts` | M | Add the extension to the rich and plain schemas |
| `editor/reminder-chips.ts` | M | `ChipInfo.sourceChanged` → class `reminder-chip-changed` and the ", its text changed" accessible-name suffix |
| `reminders/suggestion-context.ts` | C | `listDismissed` client: per-note cache, coalesced calls, local dismissal add |
| `reminders/suggestion-memory.ts` | C | In-memory candidates per note (at most 20 notes), re-applied on remount |
| `reminders/card-request.ts` | C | Builds a `CardRequest` from a candidate, the selection or the paragraph (pure) |
| `reminders/suggestion-form.ts` | C | Card state, `resolveCard`, Add gating, `toCreateRequest`, `toUpdateRequest` (pure) |
| `reminders/ReminderFields.tsx` | C | Zone, preview, DST, repeat and follow-up fields, extracted from `ReminderDialog` with no behavior change |
| `reminders/ReminderDialog.tsx` | M | Uses `ReminderFields` |
| `reminders/SuggestionCard.tsx` | C | The card (section 9.6) |
| `reminders/note-reminders.ts` | M | `sourceChanged` chips; `linkedSources(reminders)` for suppression |
| `reminders/reminders-store.ts` | M | `updateFromSource`, `keepSource` actions |
| `panel/RemindersSection.tsx` | M | Source-state rows and actions (section 9.7) |
| `notes/NoteView.tsx` | M | Card wiring (main window) |
| `ui/DialogHost.tsx`, `state/ui-store.ts` | M | Dialog kind `suggestion` |
| `stickies/StickyView.tsx`, `notes/NoteDialogs.tsx` | M | Card in the sticky window; "Open in app to update" |
| `pages/ReminderSettings.tsx` | M | Three controls and the English-only sentence |
| `styles/*.css` | M | `.nlp-candidate` dotted underline, `.suggestion-bar`, card layout, `.reminder-chip-changed` |

Tests: section 12.

Docs (this planner already updated DECISIONS, ARCHITECTURE sections 3, 4 and 10, UX_SPEC sections 5 and 6, PRODUCT_SPEC section 6 and the BACKLOG planned tests):
- The implementer updates the BACKLOG statuses.
- The implementer writes `docs/progress/phase-06.md`.
- Any deviation from this plan gets a new decision (D-096 onward).

## 4. Dependencies

No install.
- `chrono-node 2.10.2` (MIT, pinned devDependency since Phase 01) is imported through its subpath export `chrono-node/en`, which vite bundles into the renderer. The implementer first confirms that `node -e "require.resolve('chrono-node/en')"` works and that the renderer `tsconfig` resolves the subpath for typings; `"moduleResolution": "bundler"` handles `exports`. If typings do not resolve, a one-line `declare module` shim is not allowed: use `import * as chrono from 'chrono-node/en'` with the package's own `dist/esm/locales/en/index.d.ts`, and record the outcome.
- `luxon 3.7.2` is already a dependency.
- No other library: no NLP model, no network, no AI SDK.
- The packaged build checks that the bundled chrono works (section 12.4, packaged case).

## 5. Migration 006 (D-088)

`src/main/db/migrations/006_reminder_sources.sql` (LF only):

```sql
-- Reminder sources and suggestion dismissals (Phase 06, D-088). Offsets are JavaScript string (UTF-16) indices.
CREATE TABLE reminder_sources (
  reminder_id            TEXT PRIMARY KEY NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  note_id                TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id               TEXT,                                   -- NULL for plain-text notes (note-level)
  source_text            TEXT NOT NULL CHECK (length(source_text) BETWEEN 1 AND 500),
  span_start             INTEGER CHECK (span_start IS NULL OR span_start >= 0),
  span_end               INTEGER,
  span_ordinal           INTEGER NOT NULL CHECK (span_ordinal >= 0),
  reference_instant_utc  INTEGER NOT NULL,
  reference_zone         TEXT NOT NULL CHECK (length(reference_zone) BETWEEN 1 AND 64),
  parser_version         INTEGER NOT NULL CHECK (parser_version >= 1),
  origin                 TEXT NOT NULL CHECK (origin IN ('suggestion', 'selection')),
  source_state           TEXT NOT NULL DEFAULT 'ok' CHECK (source_state IN ('ok', 'changed', 'missing', 'detached')),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK ((block_id IS NULL) = (span_start IS NULL)),
  CHECK ((span_start IS NULL) = (span_end IS NULL)),
  CHECK (span_end IS NULL OR span_end > span_start)
) STRICT;
CREATE INDEX reminder_sources_note ON reminder_sources(note_id);

CREATE TABLE suggestion_dismissals (
  dedupe_key      TEXT PRIMARY KEY NOT NULL CHECK (length(dedupe_key) = 64),
  note_id         TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id        TEXT,
  span_text       TEXT NOT NULL CHECK (length(span_text) BETWEEN 1 AND 500),
  span_ordinal    INTEGER NOT NULL CHECK (span_ordinal >= 0),
  reference_date  TEXT NOT NULL CHECK (reference_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX suggestion_dismissals_note ON suggestion_dismissals(note_id, created_at);
CREATE INDEX suggestion_dismissals_date ON suggestion_dismissals(reference_date);
```

- The span length is checked in code, not SQL: SQLite `length` counts code points, while the spans are UTF-16 indices.
- `index.ts` gets `{ version: 6, name: 'reminder_sources', sql }`.
- Run `node tools/gen-migration-checksums.mjs` and confirm that only key `"6"` was added.
- Upgrade path: a populated v5 database (notes, reminders, occurrences, deliveries) upgrades with a pre-migration copy, and every v5 row stays the same (integration test).
- Purge: deleting a note row cascades to its sources and dismissals, and a reminder cascade also removes its source. `trash.test › purge removes reminders` is extended to cover both tables.

## 6. Contracts and IPC (D-089)

### 6.1 Schemas (`src/shared/contracts/suggestions.ts`, Zod 4 strict objects)

```ts
// The literal phrase exactly as written (not trimmed or normalized): 1-500 UTF-16 units, no control characters (no newline: a phrase lies inside one block line).
export const SourceText = z.string().min(1).max(500).refine(noControlChars);
export const SourceOrigin = z.enum(['suggestion', 'selection']);
export const SourceState = z.enum(['ok', 'changed', 'missing', 'detached']);
export const SpanOrdinal = z.number().int().min(0).max(10_000);

export const SuggestionSource = z.strictObject({
  blockId: Uuid.nullable(),                 // null = plain-text note (note-level)
  text: SourceText,
  spanStart: z.number().int().min(0).max(5_000_000).nullable(),
  spanEnd: z.number().int().min(1).max(5_000_000).nullable(),
  spanOrdinal: SpanOrdinal,
  referenceInstantUtc: z.number().int(),
  referenceZone: ZoneId,
  origin: SourceOrigin,
}).refine((s) => (s.blockId === null) === (s.spanStart === null) && (s.spanStart === null) === (s.spanEnd === null), 'Block and span go together')
  .refine((s) => s.spanStart === null || s.spanEnd! - s.spanStart === s.text.length, 'Span length must match the text');

const FromSourceInput = ReminderInput.omit({ blockId: true });   // title, zoneId, date, time, recurrence, foldPreference, followup, allowPast
export const ReminderCreateFromSuggestionRequest = FromSourceInput.extend({ noteId: Uuid, source: SuggestionSource });
export const ReminderCreateFromSuggestionResponse = z.strictObject({ reminder: ReminderDto, existing: z.boolean() });
export const ReminderUpdateFromSourceRequest = z.discriminatedUnion('action', [
  FromSourceInput.extend({ action: z.literal('apply'), reminderId: Uuid, expectedRevision: z.number().int().min(1), pendingPolicy: PendingPolicy.default('keep'), source: SuggestionSource }),
  z.strictObject({ action: z.literal('keep'), reminderId: Uuid }),
]);
export const SuggestionDismissRequest = z.strictObject({ noteId: Uuid, blockId: Uuid.nullable(), text: SourceText, spanOrdinal: SpanOrdinal, referenceDate: LocalDate });
export const DismissalDto = z.strictObject({ blockId: Uuid.nullable(), text: z.string().min(1).max(500), spanOrdinal: SpanOrdinal, referenceDate: LocalDate, createdAt: z.number().int() });
export const SuggestionDismissResponse = z.strictObject({ dismissal: DismissalDto });
export const SuggestionListDismissedRequest = z.strictObject({ noteId: Uuid });
export const SuggestionListDismissedResponse = z.strictObject({
  asOf: z.number().int(),               // main's reminder clock (frozen under the E2E seam)
  systemZone: ZoneId.nullable(),
  defaultZone: ZoneId.nullable(),       // setting, else computer zone (defaultZoneFor)
  dismissals: z.array(DismissalDto).max(500),
});
export const ReminderSourceDto = z.strictObject({
  blockId: Uuid.nullable(), text: z.string().min(1).max(500), spanOrdinal: SpanOrdinal,
  origin: SourceOrigin, state: SourceState, referenceInstantUtc: z.number().int(), referenceZone: ZoneId,
});
```

- `ReminderDto` gains `source: ReminderSourceDto.nullable()`. Every DTO path fills it: create, update, undoDelete, `listForNote`, the update-from-source answer. `OccurrenceItem` is unchanged, so the widget, the Reminders page and Home are unaffected.
- No request carries an instant. The strict schemas reject extra keys such as `dueAtUtc` or `instantUtc`.
- New `REMINDER_MESSAGES` keys:
  - `sourceMismatch: 'The note text changed. Try again.'`
  - `sourceNotSaved: 'The note could not be saved. Try again.'`
  - `sourceFormat: 'This phrase does not belong to this note.'` (a span sent for a plain note, or no block sent for a rich note)
  - `referenceRange: 'The phrase was read too long ago. Read it again.'`

### 6.2 Channels (appended after `autostart:set`, in this order; 71 invoke channels; no new event)

| Channel | Request | Response | Main behavior |
| --- | --- | --- | --- |
| `reminder:createFromSuggestion` | `ReminderCreateFromSuggestionRequest` | `ReminderCreateFromSuggestionResponse` | Section 8.2. One IMMEDIATE transaction: live note, zone, source check (8.3), idempotent link lookup, reminder plus first occurrence (Phase 05 rules incl. `allowPast`), source row `ok`. Emits `reminder:changed {created}` and wakes the scheduler. |
| `reminder:updateFromSource` | `ReminderUpdateFromSourceRequest` | `ReminderDto` | `apply`: Phase 05 `update` semantics (revision check → `CONFLICT`, pending policy, reschedule) with `blockId = source.blockId`, then replace the source (state `ok`). `keep`: source → `detached`; no schedule change; reminder revision unchanged. Emits `reminder:changed {updated}`. |
| `suggestion:dismiss` | `SuggestionDismissRequest` | `SuggestionDismissResponse` | Live note; format check (rich needs a block, plain needs null); normalize text; key; `INSERT OR IGNORE`; trim the note to 500. Idempotent. |
| `suggestion:listDismissed` | `SuggestionListDismissedRequest` | `SuggestionListDismissedResponse` | Read only. A live or trashed note (`NOT_FOUND` when absent). |

Errors use the existing envelope:
- `VALIDATION_FAILED`, with details `{sourceMismatch:true}`, `{blockMissing:true}` (Phase 05 key), `{past:true, dueAtUtc}` (Phase 05), or `{sourceFormat:true}`;
- `NOT_FOUND` (note or reminder);
- `CONFLICT {currentRevision}`;
- `LIMIT_EXCEEDED` (200 reminders per note);
- `FORBIDDEN` (role).

### 6.3 Bridge (`window.infinity`, frozen)

- `reminder.createFromSuggestion(req)`
- `reminder.updateFromSource(req)`
- `suggestion.dismiss(req)` and `suggestion.listDismissed(req)` (new frozen namespace `suggestion`)

### 6.4 Roles (D-089)

- `STICKY_ALLOWED_CHANNELS` gains `zones:list`, `reminder:create`, `reminder:createFromSuggestion`, `suggestion:dismiss` and `suggestion:listDismissed`.
- The router's ownership rule (a `noteId` must be the sticky's own note) covers all of these except `zones:list`, which has no note.
- `reminder:updateFromSource`, `reminder:update` and `reminder:delete` stay FORBIDDEN for stickies.
- `WIDGET_ALLOWED_CHANNELS` is unchanged, so all four new channels are FORBIDDEN for the widget.

## 7. Settings registry (D-094)

| Key | Schema | Default | Public |
| --- | --- | --- | --- |
| `reminders.endOfDayTime` | `LocalTime` (`HH:mm`) | `'17:00'` | yes |
| `reminders.dateOnlyTime` | `LocalTime` | `'09:00'` | yes |
| `reminders.suggestFromText` | `z.boolean()` | `true` | yes |

- Version 1 for each key.
- Invalid stored values read as the default with a warning (D-041).
- Renderers read them with `settings:get` (allowed for stickies) and follow `settings:changed`.

## 8. Main process design

### 8.1 Composition

`createMainServices` builds `SuggestionService({db, clock: reminderClock, logger, reminders})` and passes `ReminderSourcesRepo` to `ReminderService`. `ReminderAnchors` also reads sources. `index.ts` calls `services.suggestions.pruneDismissals()` once after the services start and logs `suggestions: pruned <n> dismissals`.

### 8.2 `ReminderService` changes

- `createFromSource(req)` → `{reminder, existing}`. In one transaction:
  1. Live note (`NOT_FOUND` otherwise) and zone check.
  2. `checkSource(note, req.source)` (8.3) → `spanOrdinal`.
  3. `findLiveLink(noteId, source.blockId, normalizePhrase(text), spanOrdinal)`: if a live reminder (not deleted) with a non-`detached` source matches, return it with `existing: true` and write nothing.
  4. The reminder limit (200).
  5. Insert the reminder with `block_id = source.blockId`, `anchor_state 'ok'`, and the first occurrence through the same `generateFirst` and `oneTimeDue`. `allowPast` and the past rule are unchanged.
  6. Insert the source row: `state 'ok'`, `parser_version = PARSER_VERSION`, `created_at = updated_at = now`.

  After commit: `committed('created', [noteId])`.
- `updateFromSource(req)`:
  - `apply`: inside one transaction, run the Phase 05 `update` body (revision check, zone, block check of `source.blockId`, reschedule, follow-up re-target), then `checkSource` and replace the source row (state `ok`, new text, span, ordinal, reference, origin, `updated_at`). A reminder without a source row is allowed: the row is inserted.
  - `keep`: the source row must exist (else `VALIDATION_FAILED`); set `detached`.

  Both emit `committed('updated', [noteId])`.
- `update` (Phase 05 `reminder:update`): when `blockChanged` and a source row exists → `setState(detached)` in the same transaction. Schedule-only edits leave the source unchanged.
- `toDto` adds `source` (one query per call through `forReminders(ids)`).
- `zoneContext()` → `{asOf, systemZone, defaultZone}`. `zones()` uses it internally.
- Reference sanity: `referenceInstantUtc` must lie within `[now − 400 days, now + 5 minutes]` of the reminder clock, else `VALIDATION_FAILED` with `M.referenceRange`. It is metadata and never used for scheduling.

### 8.3 Source check (`services/reminder-sources.ts`)

Rich note:
- `source.blockId` must be non-null and present in the stored content (else `{blockMissing:true}`, so the renderer flushes and retries, as in Phase 05).
- `richBlockText(block)` equals what the renderer saw:
  - text nodes concatenated;
  - `hardBreak` gives `"\n"`;
  - for a container block (listItem, taskItem, blockquote), the ID is the textblock's own (paragraph and heading carry IDs), so the anchor is always an innermost textblock;
  - image and fileAttachment blocks are never sources.
- `text.slice(spanStart, spanEnd) === source.text`, else `{sourceMismatch:true}`.
- `spanOrdinal(blockText, spanStart, text)` must equal `source.spanOrdinal`, else `{sourceMismatch:true}`.

Plain note:
- `blockId`, `spanStart` and `spanEnd` must be null (else `{sourceFormat:true}`).
- `occurrences(content_text, text) > source.spanOrdinal`, else `{sourceMismatch:true}`.
- No offset is stored (ARCHITECTURE section 12).

`spanOrdinal(t, start, phrase)`:
- the number of non-overlapping, case-insensitive (`toLowerCase` of both) occurrences of `phrase` in `t` that start before `start`;
- scanned left to right from index 0, stepping by the phrase length after each match.

`normalizePhrase(s)` = NFC, whitespace collapsed to single spaces, trimmed, lowercased.

### 8.4 Source-state sync (`ReminderAnchors.sync`, inside every content transaction)

After the Phase 05 anchor loop:

- Read the note's sources whose reminder is live and whose state is not `detached`. With none, nothing more is done.
- For rich content, build `richBlockTexts(content, ids)` once, for the referenced block IDs only.
- New state:
  - With a block ID, the block missing from the note, or the content plain (after a conversion) → `missing`.
  - The text (rich block text, or for a NULL block the note's extracted plain text) contains `source_text` case-insensitively → `ok`.
  - Otherwise → `changed`.
- Write only real changes, set `updated_at`, and mark the note changed. The existing `consumeChanged` then emits `reminder:changed {reason:'anchor'}` after the revision event.
- Reminder rows, occurrences and revisions are never touched by this sync. That is the "no silent move" guarantee, asserted in the integration test.
- Cost: proportional to the note's live sources (at most 200) plus one walk of the content when sources exist. Notes without sources pay one indexed query.

### 8.5 `SuggestionService` (`services/suggestion-service.ts`)

- `dismiss(req)`:
  - live note;
  - format rule (rich needs `blockId`, plain needs null);
  - `text = normalizePhrase(req.text)` (1-500 after normalization);
  - `key = sha256Hex(JSON.stringify(['v1', noteId, blockId ?? '', text, spanOrdinal, referenceDate]))` with `node:crypto`;
  - `INSERT OR IGNORE`, then `trimNote(noteId, 500)` (delete all but the newest 500 by `created_at DESC, dedupe_key`);
  - returns the stored row's DTO, the existing one on a repeat.
- `listDismissed(noteId)`: the note must exist (live or trashed), else `NOT_FOUND`. Returns `{...reminders.zoneContext(), dismissals}` (newest 500, `created_at DESC`).
- `pruneDismissals(now = clock.now())`: deletes rows with `reference_date < addDays(UTC date of now, −DISMISSAL_KEEP_DAYS)` and returns the count.

### 8.6 Test hooks (only `!app.isPackaged && INFINITY_NOTES_E2E === '1'`)

`reminders()` adds `sources: SELECT * FROM reminder_sources ORDER BY created_at, reminder_id` and `dismissals: SELECT * FROM suggestion_dismissals ORDER BY created_at, dedupe_key`, on a fresh macrotask (F04-A2). No other seam is added: the reference instant and zones already come from the D-084 clock and zone seams through `suggestion:listDismissed`.

### 8.7 Logging

- Create and update log one line: `suggestions: reminder <id> from source origin=<o> state=ok existing=<bool>`. The text is never logged (user content).
- Dismiss logs `suggestions: dismissed note=<id>`. Prune logs a count.
- Source-state transitions log `suggestions: source <reminderId> <old>-><new>`.

## 9. Parser and renderer

### 9.1 Adapter pipeline (`src/shared/nlp/parse.ts`, `resolve-candidate.ts`)

```ts
type DateIntent =
  | { kind: 'absolute'; year: number | null; month: number; day: number; order: { month: number; day: number } | null } // order = the swapped reading when ambiguous
  | { kind: 'relative'; days: number }                                    // today 0, tonight 0, tomorrow 1, yesterday -1, day after tomorrow 2, in N days N, in N weeks 7N
  | { kind: 'weekday'; weekday: 1|2|3|4|5|6|7; modifier: 'bare' | 'next' | 'last' }  // this/on/by/coming → bare
  | { kind: 'none' };                                                     // time-only phrase
type TimeIntent =
  | { kind: 'explicit'; hour: number; minute: number }
  | { kind: 'ambiguousHour'; hour12: number; minute: number }            // 1..12, needs am/pm
  | { kind: 'endOfDay' } | { kind: 'dateOnly' }
  | { kind: 'dayPart'; part: 'morning' | 'afternoon' | 'evening' | 'tonight' }
  | { kind: 'needsTime' };                                               // "midnight"
type ZoneIntent = { kind: 'selected' } | { kind: 'fixed'; zoneId: 'UTC' } | { kind: 'abbreviation'; abbr: string; suggestions: string[] };
interface Candidate {
  start: number; end: number; text: string; title: string;              // offsets in the given text (UTF-16)
  intent: { kind: 'calendar'; date: DateIntent; time: TimeIntent } | { kind: 'duration'; ms: number };
  zone: ZoneIntent; referenceInstantUtc: number; parseZone: string;
}
interface Choices { order?: 'asWritten' | 'swapped'; meridiem?: 'am' | 'pm'; zoneId?: string; time?: string; useNextYear?: boolean }
type CandidateResolution =
  | { status: 'needsChoice'; missing: Array<'order' | 'meridiem' | 'zone' | 'time'> }
  | { status: 'ready'; date: string; time: string; foldPreference: 'earlier' | 'later'; instantUtc: number;
      resolution: 'ok' | 'gap' | 'fold'; past: boolean; yearOmitted: boolean; relative: boolean;
      disclosure: null | { kind: 'endOfDay' | 'dateOnly' } | { kind: 'dayPart'; part: string } };
```

`findCandidates(text, {referenceInstantUtc, zoneId})`:
1. **Mask** with spaces (offsets kept):
   - end-of-day tokens `/\b(?:end\s+of\s+(?:the\s+)?day|EOD)\b/gi`, recorded as EOD ranges;
   - zone abbreviation tokens from the table (case-sensitive, whole word), recorded.
2. **Parse**: `en.casual.parse(masked, {instant: new Date(ref), timezone: offsetMinutes(zoneId, ref)}, {forwardDate: false})`.
3. **Classify** each result from `start.knownValues`, the result text and tags. Implied values are never used for components.
   - **Duration.** Tag `result/relativeDateAndTime`, and the text names only minutes or hours (`min|mins|minute|minutes|h|hr|hrs|hour|hours`, "half an hour"). `ms = start.date() − ref`, which must be > 0 and ≤ 1000 h. Seconds or days in the text → dropped.
   - **Relative days.** Tags `casualReference/today|tonight|tomorrow|yesterday`, or `result/relativeDate` with text matching `^(?:in|within)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?)$`, `(\d+) (days|weeks) from now`, or `the day after tomorrow`. Anything else under `relativeDate` ("next week", "next month") → dropped.
   - **Weekday.** Known `weekday` and no known `day`, with a weekday token in the text: a full name in any case, or `Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun` only capitalized. The modifier comes from `^(this|next|last|on|by|coming)\s+` (otherwise bare). "this weekend" has no weekday token → dropped.
   - **Absolute.** Known `day` and `month` (`year` if known).
     - Numeric order ambiguity: the text matches `^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?` with both parts ≤ 12 and different → `order` = the swapped reading.
     - The month name "may" counts only as "May"; a lowercase "may" → dropped.
   - **Time-only.** Known `hour` and no date part → `date: none`.
   - **No known day/weekday/hour.** "this evening", "this afternoon", "this morning" (tag `casualReference/<part>` with "this") → `relative 0` with a day-part. Month-only and anything else → dropped.
   - `casualReference/now` → dropped.
   - **Time intent.**
     - A known `hour`: when meridiem is not known, the hour is 1-12, the hour token in the text has no leading zero, the text has no day-part word, and `end.meridiem` is unknown → `ambiguousHour` (chrono's hour mod 12, so 12 means 12 or 0). Otherwise `explicit` with chrono's hour and minute.
     - `casualReference/noon` → explicit 12:00. `casualReference/midnight` → `needsTime`.
     - A day-part word without an hour (`morning`, `afternoon`, `evening`, `night`, `tonight`) → `dayPart`; `night` and `tonight` map to `tonight`.
     - A day-part word with an ambiguous hour resolves the meridiem (morning → am; the others → pm).
     - Nothing else → `dateOnly`.
4. **Merge.**
   - An EOD range next to a date-bearing candidate whose time is `dateOnly` (only whitespace, `,`, `at`, `by`, `on` or `of` between them, either order) → time `endOfDay`, and the span becomes the union.
   - An EOD range with no neighbor → its own candidate, `relative 0` plus `endOfDay`.
   - A time-only candidate right after (or before) a date-bearing candidate whose time is `dateOnly` or `endOfDay` → one candidate. The explicit time wins.
   - Overlapping candidates keep the longer one.
5. **Zones.**
   - An abbreviation token inside a candidate's span, or separated from its end by at most 2 spaces, extends the span and sets the zone intent: `abbreviation` with `zoneSuggestions(abbr)`, or `fixed UTC` for `UTC`/`GMT`.
   - An abbreviation with no candidate, preceded by `(?:\b(?:at|by|before|until)\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$`, synthesizes a time-only candidate over the time and the abbreviation ("by 5 CST").
   - Chrono's `timezoneOffset` is always ignored.
6. **Titles.** `titleFor(text, span, '')`: remove the span, then remove one connector word (`by|on|at|before|until|till|due`) directly before the removed span or after it at the end. Collapse whitespace, trim `,;:-–—` and spaces at both ends, cut at 120 characters on a word boundary with "…". An empty result stays empty: the card falls back to the note title (`displayTitle`).
7. Sort by start, and return at most `MAX_CANDIDATES`.

`resolveCandidate(c, {zoneId, choices, endOfDayTime, dateOnlyTime})`:
- **Missing choices first.**
  - `zone` when the zone intent is an abbreviation without `choices.zoneId`, or when `zoneId` is empty.
  - `order` when an absolute date has `order` set and no `choices.order`.
  - `meridiem` for `ambiguousHour` without `choices.meridiem`.
  - `time` for `needsTime` without `choices.time`.
- **Zone.** `choices.zoneId` ?? fixed UTC ?? `zoneId`.
- **Today.** `today = localParts(ref, zone).date`.
- **Time.**
  - explicit → as given;
  - ambiguousHour → pm adds 12 (12 am → 00);
  - endOfDay → `endOfDayTime`;
  - dateOnly → `dateOnlyTime`;
  - dayPart → `DAY_PART_TIMES[part]` (morning 09:00, afternoon 15:00, evening 19:00, tonight 20:00);
  - needsTime → `choices.time`.
- **Date.**
  - `relative n` → `addDays(today, n)`.
  - Weekday `bare` → the first d ≥ today with `isoWeekday(d) = W` and `resolveLocal(d, time) > ref`.
  - Weekday `next` → `mondayOf(today) + 7 + (W − 1)`.
  - Weekday `last` → the latest d < today with weekday W.
  - `absolute` → year ?? the year of `today` (yearOmitted), month and day after the order choice. `useNextYear` adds 1 year, and only when yearOmitted.
  - `none` → today if `resolveLocal(today, time) > ref`, else tomorrow.
- **Duration.** `instant = floor((ref + ms) / 60000) * 60000`; `{date, time} = localParts(instant, zone)`. `foldPreference` is `later` when `resolveLocal(…,'earlier')` ≠ instant (and then `resolveLocal(…,'later')` must equal it).
- **Calendar.** `foldPreference` = `choices` ?? `earlier`; `r = resolveLocal({date, time}, zone, foldPreference)`.
- **Flags and output.**
  - `past = instant ≤ ref`.
  - `relative` = date intent relative/weekday/none, or a duration.
  - `disclosure` = the default time kind when the time came from a default.
  - An invalid date (outside 2000-2100 or nonexistent) → the candidate is dropped by `findCandidates`. It is never shown.

### 9.2 Rules table (unit `nlp-parse.test`; rows marked C are the PRODUCT_SPEC section 6 contract)

Reference R = 2026-10-08T07:00:00Z (Thu 13:00 Asia/Dhaka), zone Asia/Dhaka, EOD 17:00, date-only 09:00, unless stated. "UTC" means the resolved `instantUtc`.

#### 9.2.1 Contract rows (C)

| # | Input | Expected |
| --- | --- | --- |
| C1 | tomorrow end of the day | span [0,23) "tomorrow end of the day"; Fri 2026-10-09 17:00; 11:00Z; disclosure endOfDay |
| C2 | Have to submit this by tomorrow end of the day | span [23,46); title "Have to submit this"; 2026-10-09T11:00Z |
| C3 | tomorrow at 8pm / Tomorrow at 8pm | 2026-10-09 20:00; 14:00Z; no disclosure |
| C4 | in 2 hours | duration; 2026-10-08 15:00; 09:00Z |
| C5 | tomorrow | 2026-10-09 09:00; 03:00Z; disclosure dateOnly |
| C6 | end of day | 2026-10-08 17:00; 11:00Z |
| C7 | Friday / this Friday | 2026-10-09 09:00; 03:00Z |
| C8 | Friday at 5pm | 2026-10-09 17:00; 11:00Z |
| C9 | next Friday | 2026-10-16 09:00; 2026-10-16T03:00Z |
| C10 | Thursday | 2026-10-15 09:00 (today's 09:00 has passed) |
| C11 | Thursday 5pm | 2026-10-08 17:00; 11:00Z |
| C12 | next Thursday | 2026-10-15 09:00 |
| C13 | Monday / next Monday | both 2026-10-12 09:00; 2026-10-12T03:00Z |
| C14 | Sunday / next Sunday | 2026-10-11 09:00 / 2026-10-18 09:00 |
| C15 | last Friday | 2026-10-02 09:00; past true; yearOmitted false |
| C16 | 03/04 at 5 | needsChoice [order, meridiem]. With order swapped and pm: 2026-04-03 17:00, past, yearOmitted. With useNextYear: 2027-04-03 17:00 = 2027-04-03T11:00Z |
| C17 | on Oct 1 | 2026-10-01 09:00; 03:00Z; past; yearOmitted; never 2027 unless useNextYear |
| C18 | by 5 CST | needsChoice [zone, meridiem]; suggestions start with America/Chicago, Asia/Shanghai, America/Havana. With zone America/Chicago and pm: 2026-10-08 17:00 CDT = 22:00Z |
| C19 | tomorrow at 9am, zone America/New_York, R = 2026-10-08T03:30Z | 2026-10-08 09:00; 13:00Z |
| C20 | same input and R, zone Asia/Dhaka | 2026-10-09 09:00; 03:00Z |
| C21 | 2026-03-08 02:30, zone America/New_York | resolution gap; 03:00 EDT; 2026-03-08T07:00Z; past |
| C22 | 2026-11-01 01:30, zone America/New_York | fold; default 05:30Z; with fold later: 06:30Z |
| C23 | Confirm "tomorrow" at R, restart 2026-10-09 | Integration and E2E (12.1 INF-SUG-07): still 2026-10-09 09:00, 03:00Z |

#### 9.2.2 Plan rows (D-090)

| # | Input (R, Dhaka unless stated) | Expected |
| --- | --- | --- |
| P1 | by EOD | span "EOD"; 2026-10-08 17:00; title connector "by" removed |
| P2 | EOD Friday / Friday EOD / by end of the day Friday | 2026-10-09 17:00 |
| P3 | tomorrow end of the day at 6pm | one candidate; 2026-10-09 18:00 (12:00Z); no disclosure |
| P4 | endOfDayTime 18:30, "tomorrow EOD" | 2026-10-09 18:30 = 12:30Z |
| P5 | dateOnlyTime 07:45, "tomorrow" | 2026-10-09 07:45 = 01:45Z |
| P6 | today at 5pm | 2026-10-08 17:00 |
| P7 | today | 2026-10-08 09:00; past; yearOmitted false |
| P8 | tonight / by tonight | 2026-10-08 20:00 (14:00Z); disclosure dayPart tonight |
| P9 | this evening | 2026-10-08 19:00 (13:00Z); dayPart evening |
| P10 | tomorrow morning / tomorrow afternoon / tomorrow night | 2026-10-09 09:00 / 15:00 / 20:00 |
| P11 | noon tomorrow | 2026-10-09 12:00 explicit |
| P12 | tomorrow midnight | needsChoice [time] |
| P13 | at 5pm | 2026-10-08 17:00 (time-only, still ahead) |
| P14 | at 9am | 2026-10-09 09:00 (today's has passed) |
| P15 | tomorrow at 9 / at 12 | needsChoice [meridiem] (09:00 or 21:00; 12:00 or 00:00) |
| P16 | tomorrow at 09:30 / at 17 / 17:00 | explicit 09:30 / 17:00 / 17:00, no choice |
| P17 | Friday 3-5pm | 2026-10-09 15:00 (range start) |
| P18 | in 30 minutes / in an hour / in half an hour / in 2 hours and 30 minutes / within 2 hours / 2 hours from now / in 2h | 13:30 / 14:00 / 13:30 / 15:30 / 15:00 / 15:00 / 15:00 |
| P19 | in 2 hours, R + 40 s | 09:00Z (floored) |
| P20 | in 2 hours, zone America/New_York | same instant 09:00Z, local 05:00 |
| P21 | in 2 hours, R = 2026-11-01T04:30Z, zone America/New_York | 06:30Z = 01:30 EST; foldPreference later |
| P22 | in 3 days / in 2 weeks / in a week / the day after tomorrow | 2026-10-11 / 2026-10-22 / 2026-10-15 / 2026-10-10, each 09:00 |
| P23 | in 1 day, R = 2026-10-31T13:00Z, zone America/New_York | 2026-11-01 09:00 EST = 14:00Z (calendar, not +24 h) |
| P24 | yesterday | 2026-10-07 09:00; past |
| P25 | Oct 20 at 3:30pm / 2026-10-20 14:30 / 12 Oct 2026 at 10am | 09:30Z / 08:30Z / 2026-10-12T04:00Z |
| P26 | 13/04 / 04/04 | no order choice; 2026-04-13 and 2026-04-04 09:00, past, yearOmitted |
| P27 | 03/04/2027 | needsChoice [order]; no useNextYear effect |
| P28 | 10/20 | 2026-10-20 09:00 (not ambiguous) |
| P29 | May 5 / may 5 | 2026-05-05 09:00 past, yearOmitted / no candidate |
| P30 | at 5pm CST / 5pm EST tomorrow | needsChoice [zone]. EST suggests America/New_York. With America/New_York: 2026-10-09 17:00 EDT = 21:00Z |
| P31 | tomorrow 9am IST | suggestions include the runtime's India zone (Asia/Kolkata or Asia/Calcutta), Europe/Dublin, Asia/Jerusalem |
| P32 | 5pm UTC / 5pm GMT | zone UTC without a choice; 2026-10-08 17:00 UTC |
| P33 | call Bob tomorrow at 9 and send report on Friday | 2 candidates: [9,22) needsChoice meridiem, title "call Bob and send report on Friday"; [39,48) "on Friday" 2026-10-09 09:00, title "call Bob tomorrow at 9 and send report" |
| P34 | Nov 1 at 1:30am, zone America/New_York | fold; 05:30Z default, 06:30Z later |
| P35 | March 14, 2027 at 2:30am, zone America/New_York | gap; 2027-03-14T07:00Z |
| P36 | Nov 2 at 9am, zone America/New_York (EDT at R) | 14:00Z: the target date's EST, not the reference offset |
| P37 | at 9am, zone America/New_York, R = 2026-10-08T03:30Z / zone Asia/Dhaka | 2026-10-08 09:00 NY = 13:00Z / 2026-10-09 09:00 Dhaka = 03:00Z |
| P38 | Sunday reference R2 = 2026-10-11T04:00Z (Sun 10:00 Dhaka): Monday / next Monday / Sunday / Sunday at 5pm / next Sunday / last Sunday / this Sunday | 10-12 / 10-12 / 10-18 / 10-11 17:00 / 10-18 / 10-04 / 10-18 |
| P39 | Unsupported, no candidate | "next week", "next month", "this weekend", "October", "in October", "in a second", "now", "on the 15th", "the sun is bright", "see you mon", "Let's do it sometime", "আগামীকাল বিকেল ৫টায়", "demain matin", "morgen früh" |
| P40 | Known noise, documented | "3/4 of the cake" gives a candidate needing an order choice (stated limitation) |

#### 9.2.3 Determinism and isolation

- The same call under `vi.setSystemTime(2030-01-01)` and with `process.env.TZ` set to another zone returns deep-equal results: no hidden clock and no host zone.
- `findCandidates` never calls `Date.now()` (spy).

#### 9.2.4 Abbreviation table (`abbreviations.ts`)

Each suggestion lists alias alternatives in order; the first known zone is used.

| Abbreviation | Suggestions |
| --- | --- |
| CST | America/Chicago, Asia/Shanghai, America/Havana |
| CDT | America/Chicago, America/Havana |
| EST, EDT | America/New_York |
| PST | America/Los_Angeles, Asia/Manila |
| PDT | America/Los_Angeles |
| MST | America/Denver, America/Phoenix |
| MDT | America/Denver |
| IST | Asia/Kolkata (Asia/Calcutta), Europe/Dublin, Asia/Jerusalem |
| BST | Europe/London, Asia/Dhaka |
| CET, CEST | Europe/Paris, Europe/Berlin |
| JST | Asia/Tokyo |
| AEST, AEDT | Australia/Sydney |
| SGT | Asia/Singapore |
| HKT | Asia/Hong_Kong |
| PKT | Asia/Karachi |
| NPT | Asia/Kathmandu (Asia/Katmandu) |

`UTC` and `GMT` are not in this table: they become a fixed UTC zone.

### 9.3 Detection (`editor/suggestions.ts`, `editor/suggestion-detector.ts`; D-091)

**Plugin state:** `{changed: Range[], candidates: LiveCandidate[], decorations}`.
- Every transaction maps the ranges and candidates through `tr.mapping`.
- A transaction with `isUserEdit(tr)` adds the new ranges of each step map, and drops any candidate whose span intersects a changed range. That candidate's block is re-read at the next pass.
- A transaction that inserts more than `SKIP_INSERT_CHARS` characters (a large paste) adds no ranges.
- Decorations:
  - `Decoration.inline(from, to, {class: 'nlp-candidate', 'data-candidate': id, title: 'Reminder suggestion'})`;
  - candidates needing a choice also get `nlp-candidate-choice`.

**Detector** (one per mounted editor, disposed with it):
- After every user edit, (re)start a timer of `IDLE_MS` (1000 ms). When it fires and `view.composing` is false (otherwise wait for `compositionend`, then wait `IDLE_MS` again), start a pass.
- **Pass:**
  1. Context: `await context.load(noteId)` (`suggestion:listDismissed`: `asOf`, zones, dismissals; a call is in flight at most once per note). `ref = asOf`, `parseZone = defaultZone ?? 'UTC'`.
  2. Collect the textblocks with an ID that the changed ranges touch, in document order, at most `MAX_BLOCKS_PER_PASS`. Code blocks are skipped. Plain notes: the paragraphs touched.
  3. In slices of at most `SLICE_MS` (`performance.now()`, yielding with `setTimeout(0)` between slices): `findCandidates(blockText, {ref, parseZone})`. For a block over `LONG_BLOCK_CHARS`, only the window ±`LONG_BLOCK_WINDOW` around the changed ranges is parsed and the offsets are shifted. Keep only candidates whose span touches a changed range (inclusive of the edges).
  4. A user edit during the pass sets an abort flag. Results already computed for blocks whose text is unchanged are kept, the rest is dropped, and the timer restarts.
  5. **Suppression.**
     - Dismissed: `{blockId (null for plain), normalizePhrase(text), spanOrdinal, referenceDate = localParts(ref, parseZone).date}` equals a dismissal.
     - Linked: a live reminder source with state `ok` on the same block (or plain), normalized text and ordinal. In state `changed`, the candidate stays, marked `updateFor: reminderId`.
  6. Apply one meta-only transaction (`tr.setMeta(key, {...}).setMeta('addToHistory', false)`, no steps) with the new candidates, never during composition. Clear the processed changed ranges. Cap at `MAX_CANDIDATES` (the oldest are dropped first).
- The setting `reminders.suggestFromText = false` → no timer, no passes, no decorations. More → "Create reminder from text" still works.
- A read-only editor (lease mirror, trash) has no user edits, so no detection.
- **Memory** (`suggestion-memory.ts`):
  - after each pass, store `{blockId|lineIndex, blockText, candidates (relative offsets, ref)}` per note;
  - on editor mount, re-apply the entries whose block text is unchanged;
  - at most 20 notes (least recently used), never persisted.

### 9.4 Performance budgets and how they are verified

- A keystroke adds O(changed steps) work to the plugin: mapping ranges and candidates.
- A pass parses only touched blocks. The unit test spies the parse call count: one keystroke in a 10,000-paragraph document → exactly 1 block parsed, and the pass ends within 50 ms in jsdom.
- A 12,000-paragraph paste (over 64 KiB) → 0 parse calls.
- A 6,000-character paragraph with an edit in the middle → the parsed text length is at most 2 × 300 + the edit.
- E2E `› large note typing stays responsive`:
  - A seeded note has 2,000 paragraphs, 200 of them containing date phrases.
  - Typing a 40-character sentence that ends with "tomorrow" at 30 ms per key: the text is exact, exactly one `.nlp-candidate` appears (old phrases untouched), and the longest `longtask` recorded by `PerformanceObserver` while typing is under 250 ms.
  - The measured values go into the progress report.

### 9.5 Suggestion bar and the More command

**Bar** (`SuggestionBar.tsx`, rendered inside `NoteEditor`):
- Absolutely positioned over the bottom edge of `.note-editor-scroll`, so it causes no layout shift. It shows while the selection is empty and the cursor lies within or at the edge of a candidate.
- Content:
  - `role="group"`, `aria-label="Reminder suggestion"`.
  - Text: "Reminder: <formatShort(instant, zone)>" using the default zone, "Reminder: needs a choice", or "Reminder: <…> (past)".
  - Buttons:
    - "Create reminder" and "Dismiss";
    - when the candidate has `updateFor`: "Update reminder", "Create new reminder" and "Dismiss";
    - in a sticky: "Open in app to update" instead of "Update reminder".
- Buttons use `onMouseDown` `preventDefault`, so the editor keeps its selection and focus. They are not in the editor's tab order. The keyboard path is the More command.
- "Dismiss" calls `suggestion.dismiss`, adds the dismissal locally and removes the candidate (meta transaction). Failure shows the notice "Could not dismiss this suggestion."

**More → "Create reminder from text"** (rich and plain, tabs and stickies, editable or read-only):
- Source text:
  - a non-empty selection inside one textblock, at most `MAX_SELECTION_CHARS`;
  - a selection across blocks → notice "Select text within one paragraph.";
  - a longer selection → "Select a shorter part (up to 2,000 characters).";
  - else the candidate at the cursor;
  - else the whole textblock at the cursor.
- The renderer loads the context (`listDismissed`) for `ref` and the zones, then runs `findCandidates` on that text, with offsets mapped into the block.
- The card opens with the candidates found (origin `selection` for a selection, `suggestion` for a detected candidate). With none found it opens in manual mode.

### 9.6 Confirmation card (`SuggestionCard.tsx`, `suggestion-form.ts`; D-093)

**Hosting.** The main window opens it through `DialogHost` (`DialogState {kind:'suggestion', noteId, request}`). A sticky opens it through its local `NoteDialogs`. Both use the shared `Dialog`, so focus is trapped and returns to the editor at the phrase.

**`CardRequest`:**
- `{mode:'create'|'update', noteId, noteTitle, format, blockId|null, blockText, candidates: Candidate[], selected: number, origin, reminder?: ReminderDto, manualBlockId: string|null}`.
- Candidate offsets are block-relative (rich) or line-relative (plain), plus the ordinal over the block or the whole plain text.

**Loads:** `zones:list` (the list, `systemZone`, `defaultZone`, `asOf`), and settings `reminders.followupDefault`, `endOfDayTime`, `dateOnlyTime`.

**Initial form** (reuses `ReminderForm`):
- zone = the abbreviation choice or fixed UTC, else `defaultZone`, else empty;
- title = the candidate title, else `displayTitle(noteTitle)` (update mode: the reminder's title);
- repeat none (update mode: the reminder's), follow-up from the default (update mode: the reminder's);
- date and time from `resolveCandidate` when ready, else empty for the missing parts.

**Fields and rendering, in order:**
1. "Dates found" (radio group) when there are several candidates.
2. Title.
3. "From your note" with “<literal phrase>”.
4. "Read on <formatInZone(ref, zone)>" when relative.
5. "Now: <dueLines(reminder).primary>" in update mode.
6. The choice groups for missing items, with no default: "Date order" (labels from `formatDayMonth`, for example "4 March" / "3 April"), "Time of day" ("05:00" / "17:00"), the abbreviation notice with suggestion buttons plus the full Time zone select, and "Enter a time".
7. Date input and the full date line `formatLongDate`.
8. Time input and the disclosure line (shown only while the time equals the defaulted value).
9. Time zone select.
10. Through `ReminderFields`: the Phase 05 preview with "Your time" and the gap/fold notices with "Use the later one (…)", then Repeat and Follow up.
11. The past notice (Phase 05 `PAST_TEXT`), plus "Use next year" when yearOmitted.
12. Buttons Add (or Update) and Cancel.

**Re-resolution:**
- Changing the zone or a choice re-runs `resolveCandidate` and replaces date and time, as long as the user has not typed in Date or Time.
- After a manual Date or Time edit, the typed values stay, and only the instant and preview change.
- Duration candidates keep their instant across zone changes.

**Add gating** (`formProblem` plus the missing choices, in this order): "Choose a time zone", "Choose the date order", "Choose AM or PM", "Enter a time", "Enter a title", "Enter a date and time", "Choose at least one day". The reason shows next to the disabled Add.

**Submit:**
1. `await persist()` (the controller flush; a no-op for read-only). If it fails → "The note could not be saved. Try again."
2. Build the request (`toCreateRequest` / `toUpdateRequest`): the source from the selected candidate with `{blockId, text = blockText.slice(start, end), spanStart, spanEnd, spanOrdinal, referenceInstantUtc: ref, referenceZone: form.zoneId, origin}`. Plain notes send null block and span.
3. On `blockMissing` or `sourceMismatch`: flush once and retry once. Then show "The note text changed. Try again." (mismatch), or offer "Attach to the note instead" (block missing, as in Phase 05).
4. On `past`: the button becomes "Add anyway" and resubmits with `allowPast:true`.
5. On `existing:true`: close and show the notice "This reminder already exists."
6. On success: close. The panel and chip refresh through `reminder:changed`.

**Manual mode** (no candidate):
- The text "No date or time found in this text. Enter the date and time below."
- The form starts like the Phase 05 `initialForm` (today or tomorrow 09:00 in the default zone). The title is the selected text (at most 200 characters) or the paragraph text.
- Add calls `reminder:create` with `blockId = manualBlockId` (the paragraph, rich only). No source row. Phase 05 flush, retry and note-level fallback apply.

**Cancel and Escape** write nothing and keep the candidate.

### 9.7 Update flow and panel (main window)

**`RemindersSection` rows by source state:**
- `changed`: "The text this reminder came from changed: “<source.text>”." with "Update from text…" and "Keep current time".
- `missing`: the Phase 05 "Original text was removed" row, plus "Created from “<text>”".
- `ok` and `detached`: no extra row.

**"Update from text…":**
- The block text comes from the open editor (`controller.blockText(source.blockId)`; for plain, the note text).
- Run `findCandidates` with `ref = asOf` now and the reminder's zone.
- Open the card in update mode with all candidates (pre-selecting the one closest to the old span), or in manual mode when there are none. Manual update calls `reminder:update` (Phase 05) and then `updateFromSource {keep}`, so the stale phrase no longer warns.

**Card "Update"** calls `reminder:updateFromSource {action:'apply', …, pendingPolicy}` (the overdue-series choice as in Phase 05). `CONFLICT` shows the Phase 05 copy and reloads.

**"Keep current time"** calls `{action:'keep'}`.

**Bar in changed mode:** "Update reminder" opens the same update card with the bar's candidate pre-selected. "Create new reminder" opens the create card.

**Chips:** `chipsOf` sets `sourceChanged` when `source?.state === 'changed'`, which adds the class `reminder-chip-changed` and the accessible-name suffix ", its text changed". The chip bar does the same for note-level chips.

### 9.8 Stickies

- Detection, the bar, More → "Create reminder from text" and the card all run in the sticky window, for the sticky's own note (router ownership).
- The card uses `zones:list`, `reminder:createFromSuggestion` and `reminder:create` (manual mode), which are now allowed (D-089).
- A changed source shows "Open in app to update", which calls `reminder:open` and lets the main window's panel handle it.
- A collapsed sticky shows no bar (no editor visible).
- Sticky chips stay read-only (Phase 05).

### 9.9 Plain-text notes

- Detection runs per paragraph line. The bar and card are the same.
- Reminders are note-level (`blockId null`), and their sources have a null block and span, with the ordinal over the whole text (`docToText`).
- State tracking uses "the note text contains the phrase".
- The Phase 05 chip bar shows the reminder above the editor.
- Converting rich → plain makes rich sources `missing` (with the Phase 05 `block_missing` anchors). Converting plain → rich keeps the note-level sources `ok` while their text is present.

### 9.10 Settings UI (`ReminderSettings.tsx`)

- Switch "Suggest reminders from dates in notes".
- Time inputs "End of day" and "Time for date-only phrases".
- The text "Suggestions understand English dates and times only. Your text is read on this computer and is not sent anywhere."
- Changes apply to the next detection pass and the next card (through `settings:changed`). Existing reminders never change.

## 10. UX copy

UX_SPEC sections 5 and 6 hold every exact string of this phase, including the notices "Could not dismiss this suggestion." and "This reminder already exists." and the error "The note could not be saved. Try again." (the planner updated them). If the implementer changes any wording, UX_SPEC is updated in the same step and the change is listed in the progress report.

All copy is English. No UI text suggests other languages are parsed (INF-NLP-14).

## 11. Security summary

- **No new privileges.** Four validated channels with strict schemas and payload limits under the 5 MB router cap. Sticky additions are owner-checked; the widget gets nothing.
- **Untrusted input.** Main never trusts a renderer instant and re-resolves `{date, time, zone, fold}`. Source text is compared with stored content inside the transaction. Hashes are computed in main.
- **No new output channel.** No network or AI: the parser is local, the network guard (D-043) is unchanged, and a boundary test blocks `fetch`, `XMLHttpRequest`, `WebSocket` and `node:http(s)`/`net` in `src/shared/nlp` and the renderer suggestion files.
- **Rendering.** Decorations insert no HTML from user text: the bar and card render through React text nodes.
- **Logging.** Logs contain IDs and counts only, never note text.

## 12. Tests

### 12.1 Explicit assertions per requirement ID (Phase 00 F-1)

| ID | Test (file › case) | Inputs | Expected and failure cases |
| --- | --- | --- | --- |
| INF-NLP-01 | `unit/nlp-parse.test › local and deterministic`; `unit/boundaries.test › nlp is local and English-only`; dependency review in the progress report | 9.2.3; source scan | Deep-equal results under another system time and `TZ`; `Date.now` not called. `src/shared/nlp/parse.ts` imports `chrono-node/en` and nothing from the root `chrono-node`; no file under `src/main` imports `chrono-node` or `shared/nlp/parse`; no `fetch`, `XMLHttpRequest`, `WebSocket`, `http`, `https` or `net` in `src/shared/nlp` and the renderer suggestion files; `package.json` dependency lists unchanged (`git diff --exit-code`) |
| INF-NLP-02 | `unit/nlp-parse.test › zone conversion` | C19, C20, P36, P30, C18 | NY 13:00Z vs Dhaka 03:00Z for the same text and reference. P36 gives 14:00Z (target-date EST), and **fails if 13:00Z** (reference offset). Abbreviation candidates have status `needsChoice` with `zone` and no instant until chosen. Chrono's `timezoneOffset` never changes a result (a `CST` text and the same text without it give the same wall time after choosing America/Chicago) |
| INF-NLP-03 | `unit/nlp-parse.test › tomorrow end of the day` | C1, C2, C6, P1 to P4 | Exactly one candidate for C1 (no "the day" or bare "tomorrow" candidate); span and title as in the table; 2026-10-09T11:00:00Z; disclosure `endOfDay`; the setting changes the time (P4) |
| INF-NLP-04 | `unit/nlp-parse.test › date-only`; `e2e/nlp.spec › disclosure` | C5, P5; E2E types "Call the bank tomorrow" | Unit: 09:00, disclosure `dateOnly`; the setting moves it. E2E: the card shows "09:00 (default time for date-only phrases)". After typing 10:00 into Time the disclosure line is gone and Add stores 10:00 |
| INF-NLP-05 | `unit/nlp-parse.test › explicit time` | C3, P16, P25 | 20:00 = 14:00Z, no disclosure; the leading-zero and 24-hour forms need no choice |
| INF-NLP-06 | `unit/nlp-parse.test › duration` | C4, P18 to P23 | Instant arithmetic (09:00Z, floored); same instant in another zone; the fold case selects `later` so main's `resolveLocal` gives 06:30Z; calendar "in 1 day" gives 14:00Z, and **fails if 13:00Z** |
| INF-NLP-07 | `unit/nlp-parse.test › weekday table` | C7 to C15, P38 | Every date as listed; "last" is past; bare weekday never gives a past date |
| INF-NLP-08 | `unit/nlp-parse.test › 03/04 at 5`; `unit/renderer/suggestion-card.test › choices gate Add`; `e2e/nlp.spec › choice required` | C16, P15, P26 to P28 | `needsChoice` lists `order` and `meridiem`; non-ambiguous forms list none. Card: Add disabled with "Choose the date order", then "Choose AM or PM"; both radio groups have no checked option initially. E2E: type "Meet 03/04 at 5", open the card, Add disabled; choose "3 April" and "17:00", "Use next year", then Add → the DB reminder has date 2027-04-03, time 17:00, zone Asia/Dhaka, and the occurrence is due 2027-04-03T11:00Z |
| INF-NLP-09 | `unit/nlp-parse.test › CST`; `unit/renderer/suggestion-card.test › zone abbreviation`; `e2e/nlp.spec › choice required (CST)` | C18, P30 to P32 | Suggestions filtered by the runtime list (alias fallback); the zone select starts empty; UTC/GMT need no choice. E2E: "Report by 5 CST" shows "“CST” can mean more than one time zone. Choose one."; Add disabled until "America/Chicago" and "17:00" are chosen; the stored zone is `America/Chicago` and the due time 22:00Z |
| INF-NLP-10 | `unit/nlp-parse.test › past date`; `e2e/nlp.spec › past date stays past` | C15, C17, P7, P24, P26 | `past` true, the date unchanged (2026), `useNextYear` only when yearOmitted. E2E: "Pay invoice on Oct 1": the card shows `PAST_TEXT` and "Use next year"; Add → "Add anyway" → reminder date 2026-10-01, occurrence `next_alert_at_utc` null (overdue, no notification); never 2027 unless the button is pressed |
| INF-NLP-11 | `unit/nlp-parse.test › multiple phrases`; `e2e/nlp.spec › underline, text unchanged (two phrases)` | P33 | Two candidates with the spans and titles listed. E2E: two `.nlp-candidate` elements in one paragraph |
| INF-NLP-12 | `unit/nlp-parse.test › unsupported`; `e2e/nlp.spec › unsupported text offers manual entry` | P39 | `[]` for each. E2E: select "Let's do it sometime", More → Create reminder from text: the card shows "No date or time found in this text. Enter the date and time below.", and Add creates a reminder with no source row (`sources` empty) |
| INF-NLP-13 | `unit/nlp-parse.test › new york tomorrow` | C19, C20, P37 | As listed; the dismissal reference date uses the parse zone (Oct 7 in New York vs Oct 8 in Dhaka at 03:30Z) |
| INF-NLP-14 | Review of the UI copy and docs; `unit/nlp-parse.test › english only`; `unit/boundaries.test › nlp is local and English-only` | Bangla, French, German inputs | No candidates. Settings shows "Suggestions understand English dates and times only." Only the `chrono-node/en` import exists; no doc or UI text claims other languages |
| INF-SUG-01 | `unit/renderer/editor/suggest-detect.test`; `e2e/nlp.spec › underline, text unchanged`, `› sticky suggestion`, `› large note typing stays responsive` | Fake timers; jsdom Tiptap editor; E2E typing | Unit: no candidate before 1000 ms idle, one after; `editor.getJSON()` deep-equal before and after the pass; undo depth unchanged; the detector's transactions have `docChanged` false and do not call `markDirty`; no dispatch while `view.composing`; an edit during a pass aborts it; touched-span rule (appending to "Pay rent on Oct 20" gives no candidate, editing inside "Oct 20" gives one); setting off gives no passes; plain editor works; budgets (9.4). E2E: underline appears; continuing to type right away keeps every character (`innerText` exact) and focus stays in `.ProseMirror`; the DB `plain_text` equals the typed text; the same in a floated sticky (card Add creates the reminder for that note; the chip shows read-only) |
| INF-SUG-02 | `e2e/nlp.spec › selection` | "Lunch with Sam on Oct 20 at 1pm" typed with suggestions off; Home, Shift+End; More → Create reminder from text | Card: title "Lunch with Sam", phrase “Oct 20 at 1pm”, "Tuesday, 20 October 2026", 13:00. Add → reminder 2026-10-20 13:00 Asia/Dhaka, source `origin 'selection'`. A selection across two paragraphs shows "Select text within one paragraph." and opens no card |
| INF-SUG-03 | `unit/renderer/suggestion-card.test`; `e2e/nlp.spec › card fields`, `› DST choices` | C1 text; zone change; P34, P35 | Card shows the heading "Create reminder", Title "Have to submit this", “tomorrow end of the day”, "Read on Thu 8 Oct 2026, 13:00 · Asia/Dhaka", "Friday, 9 October 2026", 17:00 and "17:00 (default end of day)", zone Asia/Dhaka, Repeat, Follow up (default from settings), Add, Cancel. Selecting America/New_York re-reads "tomorrow" in New York (2026-10-09 17:00 EDT = 21:00Z) and shows "Your time: Sat 10 Oct 2026, 03:00 · Asia/Dhaka". Fold: notice plus "Use the later one (EST)" → stored `fold_preference 'later'`, due 2026-11-01T06:30Z. Gap: "02:30 does not exist on this date in New York; the reminder will use 03:00" → due 2027-03-14T07:00Z. Weekly repeat creates the recurrence |
| INF-SUG-04 | `integration/suggestions.test › cancel creates nothing`; `e2e/nlp.spec › cancel creates nothing` | Failing creates; dismiss and list; E2E Cancel and Escape | Integration: `listDismissed` and `dismiss` never create reminders. Each failing `createFromSuggestion` (past without `allowPast`, unknown zone, `EST` as a zone, source mismatch, block missing, plain with span, rich without block, reference out of range, extra key `dueAtUtc`) leaves `reminders`, `occurrences` and `reminder_sources` counts unchanged. E2E: detection idle for 3 s, then Cancel, then Escape → `reminders`, `occurrences` and `sources` empty; the note text is unchanged; no chip |
| INF-SUG-05 | `integration/suggestions.test › source stored` | C2 source (block P, span 23-46, ordinal 0, ref R, Dhaka, origin suggestion) with date 2026-10-09 17:00 | `reminders` row (`block_id` P, zone, `start_local_date`, `local_time`); occurrence `due_at_utc = Date.parse('2026-10-09T11:00:00Z')`; `reminder_sources` row with every column as given, `parser_version` 1, `source_state 'ok'`; `ReminderDto.source` equal. The renderer cannot send an instant (strict schema). A request whose date differs from the phrase's meaning is stored as sent: main never parses |
| INF-SUG-06 | `integration/suggestions.test › dedupe after restart`; `unit/renderer/editor/suggest-detect.test › suppression`; `e2e/nlp.spec › dedupe after restart` | Dismissal parts; reopen the DB file with new services; duplicate creates | Dismissing twice gives one row with a 64-character key, and the same `DismissalDto` after reopening. A text differing only in case or whitespace counts as the same dismissal; another ordinal or reference date gives a new row. `createFromSuggestion` twice gives `existing: true` and one reminder. After `delete`, a create gives a new reminder; after `keep` (detached), a create gives a new reminder. Prune removes `reference_date` older than today − 2 days (UTC) and keeps the rest; more than 500 per note keeps the newest 500. Unit: dismissed and `ok`-linked candidates are hidden; a `changed` link shows with `updateFor`; another reference date is not suppressed. E2E: dismiss → relaunch at the same clock → retype the last letter of the phrase → no underline after 2.5 s; a confirmed phrase retyped after relaunch → no underline, chip present, still one reminder |
| INF-SUG-07 | `integration/suggestions.test › next-day restart same instant`; `e2e/nlp.spec › restart next day keeps the instant` | Confirm "tomorrow" at R, then services re-created with clock 2026-10-09T05:00Z | Reminder 2026-10-09 09:00 and due 03:00Z unchanged; overdue; the source unchanged (ref R); a content save on day 2 with the same text keeps state `ok` and leaves the reminder revision and occurrence rows unchanged; the scheduler's startup batch alerts it at most once. E2E: confirm on day 1, quit, relaunch with `INFINITY_NOTES_TEST_CLOCK=2026-10-09T05:00:00Z` → the panel shows "Fri 9 Oct 2026, 09:00" and Overdue; DB due 03:00Z; no `.nlp-candidate` on open; one reminder |
| INF-SUG-08 | `integration/suggestions.test › source changed state`; `e2e/nlp.spec › source edit requires update` | Save content replacing "tomorrow" with "next Friday" | State `changed`; reminder `start_local_date`, revision and occurrence rows byte-identical to before; `reminder:changed {anchor}` emitted. `apply` with the new source (2026-10-16 09:00) moves the occurrence to 2026-10-16T03:00Z, removes the old not-yet-due one, and sets the source text "next Friday" and state `ok`. A stale `expectedRevision` gives `CONFLICT` and nothing is written. A series with an overdue occurrence follows `pendingPolicy`. `keep` → `detached`, and later saves leave it detached. A Phase 05 re-anchor detaches. E2E: edit the phrase → the panel shows "The text this reminder came from changed: “tomorrow”." and the DB due time is unchanged; "Update from text…" → card "Update reminder" with "Now: Fri 9 Oct 2026, 09:00 · Asia/Dhaka" and the new date → Update → panel and chip show Fri 16 Oct |
| INF-SUG-09 | `integration/suggestions.test › block deleted` | Save content without the source block, then restore it | `anchor_state 'block_missing'` and `source_state 'missing'`; the reminder is still in `listForNote` with its `block_id`; `occurrenceSource` gives `blockId: null` (opens the note); the scheduler still alerts it. Restoring the block gives `ok`/`ok`. Converting rich → plain gives `missing` |
| INF-SUG-10 | `e2e/nlp.spec › full flow` | Frozen R; type "Have to submit this by tomorrow end of the day" | Underline → bar "Reminder: Fri 9 Oct, 17:00" → Create reminder → card as INF-SUG-03 → Add → panel row "Have to submit this" with "Fri 9 Oct 2026, 17:00 · Asia/Dhaka"; chip after the paragraph; DB source row as INF-SUG-05. The note text is still exactly the typed sentence. `advance` to 2026-10-09T11:00Z → one fake notification with title "Have to submit this". Simulated click → main window focused, the note tab active, the paragraph selected and highlighted (`.reveal-block`) |

### 12.2 Unit tests (Vitest `unit`)

New:
- `nlp-parse.test.ts`: sections 9.2.1 to 9.2.3, with describe titles citing "PRODUCT_SPEC section 6".
- `nlp-source-text.test.ts`: normalize, ordinal (overlaps, case), `richBlockText` (hardBreak, marks, nested list paragraph). A drift case feeds Tiptap `getJSON()` output and compares with the renderer's `block-text.ts`.
- `contracts-phase06.test.ts`: 71 channels with the order of `INVOKE_CHANNELS.slice(67)`; schemas strict; refinements; `ReminderDto.source`; sticky allowlist contains the five channels and not `reminder:updateFromSource`; widget unchanged.
- `renderer/editor/suggest-detect.test.ts`.
- `renderer/suggestion-card.test.tsx`: gating order, disclosures, zone re-read, manual edit wins, update mode, manual mode, Cancel calls nothing, `existing` notice, past → Add anyway.
- `renderer/editor/reminder-chips.test.ts` gains `sourceChanged`.

Updated:
- `boundaries.test`: Phase 07 names guarded; the NLP boundary case.
- `contracts.test`: the absent-names guard moves to Phase 07 names.
- `contracts-phase05.test`: `slice(50, 67)` stays exact; the total length assertion moves to Phase 06.
- `migrations-checksum.test`: LATEST 6, hashes 1 to 5 unchanged.
- `renderer/reminder-dialog.test`: unchanged expectations after the `ReminderFields` extraction.

### 12.3 Integration tests (Vitest `integration`, real better-sqlite3, temporary DB)

New:
- `suggestions.test.ts`: the INF-SUG-04 to 09 cases plus plain-note sources and the startup prune.
- `ipc-handlers-phase06.test.ts`: the four channels end to end through the router.
  - Sticky: own note allowed for `zones:list`, `reminder:create`, `createFromSuggestion`, `dismiss` and `listDismissed`; another note FORBIDDEN; `updateFromSource` FORBIDDEN.
  - Widget: all four FORBIDDEN.
  - No storage: INTERNAL "Storage is unavailable".

Updated:
- `migrations.test`: fresh v6 tables and constraints, including each CHECK violated once; v5 populated → v6 with a pre-migration copy and identical v5 rows; the failure injection uses version 7.
- `ipc-validation.test`: the catalogue guard uses `refs:list`.
- `ipc-handlers-phase05.test`: the sticky forbidden list drops `zones:list` and `reminder:create`; new ownership assertions (own note `reminder:create` ok, another note FORBIDDEN) replace them.
- `settings.test`: the three keys (defaults, invalid values refused, stored invalid reads default).
- `trash.test`: purge removes sources and dismissals.

### 12.4 E2E (Playwright `_electron`, built app, `workers: 1`, `retries: 0`, keyboard activation per D-050)

New `tests/e2e/nlp-ui.ts`:
- `typeText(page, text, delay?)`;
- `candidates(page)` (`.nlp-candidate` locator);
- `waitForCandidate(page, text)` (timeout 5 s);
- `suggestionBar(page)`;
- `card(page)` (`getByRole('dialog', {name: /^(Create|Update) reminder$/})`);
- `openCreateFromText(page)` (More menu by keyboard);
- `sourceRows(app)`, `dismissalRows(app)`.

New `tests/e2e/nlp.spec.ts` with `reminderEnv()` (clock R, zone Asia/Dhaka) unless stated. Cases:
- underline, text unchanged; underline, text unchanged (two phrases); sticky suggestion;
- disclosure; choice required; choice required (CST); past date stays past;
- unsupported text offers manual entry; selection;
- card fields; DST choices; cancel creates nothing;
- dedupe after restart; restart next day keeps the instant; source edit requires update;
- full flow;
- large note typing stays responsive.

Updated:
- `security.spec › bridge surface`: adds the `suggestion` namespace and the two `reminder` methods; the subscribe guard uses a Phase 07 name. The sticky hardening case adds: sticky `suggestion.listDismissed` for another note gives FORBIDDEN, and for its own note gives ok.
- `smoke.spec` and `packaged.spec`: `schemaVersion` 6.
- `packaged.spec › packaged build suggests a reminder from text`, using the real clock, so no date assertions: create a note, type "Pay rent tomorrow", wait for `.nlp-candidate`, open the card, assert the heading and a non-empty date line, Cancel → no reminder rows. This proves chrono is bundled.

### 12.5 Existing tests to update (no assertion weakened)

The contract changes are those of section 12.2 to 12.4:
- Phase 07 name guards replace Phase 06 ones.
- The sticky allowlist widening is replaced by stricter ownership assertions.
- `schemaVersion` 5 → 6.
- The channel count 67 → 71.

Visual baselines of the Settings page regenerate with the new controls.

### 12.6 Visual (V evidence, no pixel diffs)

Screens:
- `nlp-underline-bar-light`, `nlp-underline-bar-dark`;
- `suggestion-card`, `suggestion-card-choices`, `suggestion-card-dst`;
- `panel-source-changed`;
- `sticky-suggestion`;
- `settings-reminders-phase06`.

Windows screens go to `.infinity-work/logs/phase-06/screens/win`, WSLg screens to `screens/wslg`.

### 12.7 Native cases (recorded, not passes)

- Phase 06 adds no OS-specific behavior. The native items carried forward are Phase 09: A05-F2 and A05-F5 (toast click and Action Center, sleep/wake, tray, login item, widget pin).
- The full-flow notification uses the fake adapter. A real toast for a suggestion-created reminder is the same code path as Phase 05 (INF-REM-06/07) and is not re-claimed here.
- GNOME and X11: `outside_validation_scope`.

## 13. Commands, hosts and logs

Every log goes to `.infinity-work/logs/phase-06/`. It starts with the command, date and `pwd`, and ends with `EXIT=<code>`. File names are prefixed by step: `S0-` … `S9-`, `wsl-`, `final-`.

### 13.1 Windows (Git Bash, repository root)

```
export INFINITY_E2E_NODE='E:\notecapt\.infinity-work\node-portable\node-v24.21.0-win-x64\node.exe'
git rev-parse HEAD; git status --short                   # S0-preflight.log (expect edb40c6, clean apart from planning docs)
node -e "console.log(require.resolve('chrono-node/en'))" # S0-preflight.log
node tools/gen-migration-checksums.mjs                   # S2-checksums.log (only key 6 added)
git diff --exit-code -- src/main/db/migrations/001_initial.sql src/main/db/migrations/002_hierarchy_indexes.sql src/main/db/migrations/003_trash_reanchored.sql src/main/db/migrations/004_window_state.sql src/main/db/migrations/005_reminders.sql   # S2-frozen.log
npm run check                                            # S<n>-check.log
npm run build                                            # S<n>-build.log
npm run test:e2e                                         # S<n>-test-e2e.log
npm run test:e2e -- tests/e2e/nlp.spec.ts                # focused runs while repairing (never a gate alone)
INFINITY_SCREENSHOT_DIR="$PWD/.infinity-work/logs/phase-06/screens/win" npm run test:e2e -- tests/e2e/visual.spec.ts
node tools/dev-smoke.mjs                                 # S7-dev-smoke.log
npm run package:current; npm run verify:native -- --packaged; npm run test:e2e:packaged   # S7-package-current.log, S7-verify-native.log, S7-test-e2e-packaged.log
git diff --exit-code package.json package-lock.json      # S7-deps-unchanged.log
node tools/check-traceability.mjs --repo .               # S9-traceability.log
```

### 13.2 WSL (user `infinity`, D-039; script `.infinity-work/wsl-leg-p06.sh` with `L=/mnt/e/notecapt/.infinity-work/logs/phase-06`)

```
wsl -d Ubuntu -u infinity -- bash -lc '<cmd>'
# env: lsb_release -ds; uname -r; node -v; npm -v; cat /mnt/wslg/versions.txt; WAYLAND_DISPLAY/DISPLAY/XDG_SESSION_TYPE   (wsl-env.log)
rsync -a --delete --exclude=node_modules/ --exclude=out/ --exclude=release/ --exclude=.git/ --exclude=.infinity-work/ --exclude=test-results/ --exclude=playwright-report/ --exclude=coverage/ /mnt/e/notecapt/ ~/infinity-notes/ ; diff -rq (MIRROR_IDENTICAL)   # wsl-sync.log
cd ~/infinity-notes && export WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0
npm ls chrono-node luxon                                 # wsl-deps.log (2.10.2, 3.7.2; no npm ci needed unless the lockfile changed, which it must not)
npm run check; npm run build                             # wsl-check.log, wsl-build.log
npm run test:e2e                                         # wsl-test-e2e-wslg.log (record ozone and the capabilities line)
env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e       # wsl-test-e2e-xvfb.log
INFINITY_SCREENSHOT_DIR=/mnt/e/notecapt/.infinity-work/logs/phase-06/screens/wslg npm run test:e2e -- tests/e2e/visual.spec.ts
INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e   # wsl-test-e2e-wayland.log (informational, D-050)
npm run package:linux && npm run test:e2e:packaged       # wsl-package-linux.log, wsl-test-e2e-packaged.log
```

Rules:
- Never share `node_modules`. Never run as root, never use `--no-sandbox`, never install with apt, and never force an ozone platform in product code.
- Label results "WSLg 1.0.73 (Weston), ozone <value>" or "Xvfb", never GNOME or an X11 session.
- A WSLg launch flake is recorded as its own run, never retried away. An environment failure is pending with the exact error; a code defect is fixed.

## 14. Work order, gates and checkpoints

After each step:
1. Run the gate and save the logs.
2. Append to `docs/progress/phase-06.md`: `Checkpoint S<n> done <date> — gates: <log names> — files: <short list>`.

A resumed implementer reads `docs/progress/phase-06.md`, re-reads the files of the last checkpoint, re-runs that step's gate if any file is newer than its log, and continues at the first missing checkpoint. Every step leaves the app fully working: features are added complete, never as placeholders.

| Step | Work | Gate |
| --- | --- | --- |
| S0 Preflight | HEAD, clean tree, chrono subpath resolves, baseline `npm run check` | `S0-check.log` exit 0 |
| S1 Parser core | `src/shared/nlp/*`, `formatLongDate`, abbreviation table; unit `nlp-parse` (all of 9.2), `nlp-source-text` (JSON side), `boundaries` NLP case | `npm run check` |
| S2 Data and main services | Migration 006, checksums, LATEST 6 (every hard-coded 5); repos; `reminder-sources.ts`; `ReminderService` source paths and DTO `source`; `ReminderAnchors` source sync; `SuggestionService`; startup prune; settings keys; test-hook rows; integration `suggestions`, `migrations`, `settings`, `trash` | `npm run check`; `npm run build`; `npm run test:e2e -- tests/e2e/smoke.spec.ts tests/e2e/migration-failure.spec.ts tests/e2e/reminders.spec.ts` |
| S3 Contracts and IPC | `contracts/suggestions.ts`, channel names (append), channels, bridge, preload, roles, handlers, router registration; `contracts-phase06`, `ipc-handlers-phase06`, `ipc-validation`, `ipc-handlers-phase05` (ownership), `boundaries`/`contracts` guards to Phase 07, `security.spec` surface | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S4 Card and More command | `ReminderFields` extraction, `suggestion-form.ts`, `card-request.ts`, `SuggestionCard.tsx`, `suggestion-context.ts`, More "Create reminder from text" (selection, paragraph, manual mode) in tabs and stickies, `DialogHost` and `NoteDialogs` kinds, `block-text.ts`; unit `suggestion-card`, `reminder-dialog` (unchanged), `nlp-source-text` drift | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S5 Detection and bar | `suggestions.ts` plugin, `suggestion-detector.ts`, `suggestion-memory.ts`, `SuggestionBar.tsx`, `NoteEditor` wiring, setting switch read, plain editor; unit `suggest-detect` | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S6 Sources in the UI and settings | Panel rows and actions, update and keep flows, chip `sourceChanged`, bar changed mode, sticky "Open in app to update", `ReminderSettings` controls, CSS; unit chips | `npm run check`; `npm run build`; full `npm run test:e2e` |
| S7 New E2E, visual, Windows release gates | `nlp-ui.ts`, `nlp.spec.ts` (all cases), packaged case, visual cases; repairs with regression tests; dev smoke; `package:current`, `verify:native --packaged`, `test:e2e:packaged`; deps unchanged | Full `npm run test:e2e` green; screenshots; all release gates exit 0 |
| S8 WSL leg | Section 13.2 | check, build, WSLg and Xvfb E2E green; packaged Linux E2E; forced Wayland informational |
| S9 Report | BACKLOG statuses, progress report (section 15), UX_SPEC notices if worded differently, traceability | `node tools/check-traceability.mjs --repo .` exit 0 |

## 15. Progress report and BACKLOG

### 15.1 `docs/progress/phase-06.md` must contain

1. Summary, date, agent role and model, and the checkpoint lines S0 to S9.
2. Hosts: Windows build and Node (E2E Node 24.21); WSL Ubuntu, kernel, Node, WSLg version, Weston hash, observed ozone.
3. Changed and created files by area, one line each.
4. The IPC catalogue as implemented (71 invoke channels, 12 events, the sticky allowlist additions). Any difference from section 6 needs a decision.
5. Command table: command, host, exit code, duration and log path for every log of section 13.
6. Requirement coverage: one row per ID (24, plus F-7, A05-F1, A05-F3) with the assertions run (file › case), Windows and Linux results, screenshot paths and the BACKLOG status set.
7. Parsing evidence:
   - the rules table with actual outputs (copied from the test output or a reporter dump: input, date, time, UTC, status);
   - the dependency review (imports, no network, no AI SDK, package files unchanged);
   - bundle evidence that the renderer bundle contains the chrono English parsers and that no other locale is imported.
8. Performance evidence: parse counts and pass time for 10,000 paragraphs, and the measured longest `longtask` and keystroke integrity in the E2E large-note case, per host.
9. Decisions added after planning (D-096 onward) or "none"; deviations with reasons.
10. Issues found and fixed: severity, reproduction, expected, actual, regression test.
11. Not run or pending: 12.7; forced-Wayland informational failures with counts; GNOME and X11 outside scope.
12. Known limitations:
    - English only;
    - recurrence words ("every Monday") are not interpreted (the card's Repeat sets it);
    - ranges use their start;
    - "3/4"-style fractions may be suggested as dates;
    - day-part times are fixed defaults;
    - suggestions appear only for text edited in the current session;
    - dismissals expire with their reference date;
    - reminders still fire only while the app runs.

### 15.2 BACKLOG (Status and Planned tests columns only)

- Set `done` for each of the 24 IDs when every assertion in its 12.1 row passed on Windows and on WSL (WSLg and Xvfb E2E).
- INF-NLP-14 and INF-NLP-01 also need the review entry in the report.
- No Phase 06 ID has an N part.
- INF-PREF-02 stays `planned` (Phase 08), with its planned tests naming the Phase 06 keys (already updated).
- Keep the Planned tests text in sync with the final case names. Traceability must exit 0.

## 16. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R6-01 | Chrono quirks or behavior differences | Pinned 2.10.2; an adapter that uses known values, text and tags only; the probe-derived rules table pins behavior; masking for EOD and abbreviations |
| R6-02 | Noise from false positives | Touched-span rule; capitalization rules; unsupported list; dismissals; setting switch; unobtrusive underline, no popups |
| R6-03 | Typing interrupted (focus, IME, layout shift) | Meta-only transactions; no dispatch while composing; overlay bar with `preventDefault` on mousedown; E2E keystroke integrity and focus assertions |
| R6-04 | Large notes slow typing | Changed-block parsing; 8 ms slices; aborts; block, candidate and paste caps; long-block windows; unit counts; E2E longtask measurement |
| R6-05 | Stale relative phrases re-read on another day | No re-parse on open; detection only on edited spans; confirmed reminders store the instant; restart tests |
| R6-06 | Renderer/main block-text drift (hardBreak, nesting) | One definition in `source-text.ts`, a drift test against editor output, `sourceMismatch` with flush and retry |
| R6-07 | Renderer clock or zone differ from the main test seams | Reference context from `suggestion:listDismissed` (main clock and zone) |
| R6-08 | Zone abbreviation treated as a fixed offset | Masked before chrono; `timezoneOffset` ignored; explicit IANA choice with no default; tests |
| R6-09 | Sticky allowlist widening | Router ownership on every added channel; integration and E2E FORBIDDEN cases; widget unchanged |
| R6-10 | `ReminderDto` shape change breaks views | `OccurrenceItem` unchanged; strict schemas updated in one step; response validation in development builds |
| R6-11 | Dismissal table growth | 500 per note; startup prune by reference date; cascade on purge |
| R6-12 | Plain notes storing offsets (ARCHITECTURE section 12) | Null spans and blocks; ordinal over the text; schema CHECK |

## 17. Out of scope for Phase 06

- Multilingual or Bangla parsing; recurrence phrases; date ranges as two reminders; LLM or online services.
- Calendar integration.
- Showing suggestions for unchanged old text, and a global "scan this note" command. The More command covers the explicit case.
- Final Settings layout and the INF-PREF-02 E2E (Phase 08). Backup and export of sources and dismissals (Phase 08 portable export, which drops them by the D-030 lossy rules unless Phase 08 decides otherwise). The native matrix (Phase 09).

Never, in any phase: publishing, pushing, signing, apt installs, running as root, `--no-sandbox`, forcing an ozone platform, or changing the host's time zone, clock or login items from a test.

## 18. Planner status

```json
{"status":"ready","evidence":["docs/plans/phase-06.md","docs/DECISIONS.md (D-088..D-095; D-087 A05-F1 clarification)","docs/ARCHITECTURE.md (sections 3, 4, 10)","docs/UX_SPEC.md (sections 5, 6)","docs/PRODUCT_SPEC.md (section 6, F-7)","docs/BACKLOG.md (Phase 06 planned tests, W06 items, INF-PREF-02)",".infinity-work/logs/phase-06/planner-probe-chrono.log",".infinity-work/logs/phase-06/planner-probe-chrono-edge.log",".infinity-work/logs/phase-06/planner-probe-chrono-en.log",".infinity-work/logs/phase-06/planner-probe-dst-zones.log"],"blockers":[]}
```

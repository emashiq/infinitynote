import type { HomeScopeType } from '../../shared/contracts/home';
import {
  COMPLETED_VIEW_DAYS,
  HOME_REMINDER_LIMIT,
  MAX_REMINDERS_PER_NOTE,
  REMINDER_MESSAGES as M,
  UNDO_DELETE_MS,
  VIEW_LIMIT,
  type OccurrenceItemType,
  type ReminderChangedEventType,
  type ReminderCreateRequestType,
  type ReminderDtoType,
  type ReminderInputType,
  type ReminderListResponseType,
  type ReminderSourceDtoType,
  type ReminderUpdateRequestType,
  type ReminderViewResponseType,
  type ReminderViewType,
  type RemindersSummaryResponseType,
  type SnoozePresetType,
  type ZonesListResponseType,
} from '../../shared/contracts/reminders';
import type {
  ReminderCreateFromSuggestionRequestType,
  ReminderCreateFromSuggestionResponseType,
  ReminderUpdateFromSourceRequestType,
  SuggestionSourceType,
} from '../../shared/contracts/suggestions';
import { collectBlockIds } from '../../shared/editor/doc-schema';
import { PARSER_VERSION } from '../../shared/nlp/constants';
import { normalizePhrase, richBlockTexts } from '../../shared/nlp/source-text';
import { firstAfter, latestAtOrBefore, type Series } from '../../shared/time/recurrence';
import { addDays, localParts, resolveLocal } from '../../shared/time/resolve';
import { snoozeTarget } from '../../shared/time/snooze';
import { defaultZoneFor, FALLBACK_DAY_ZONE, isKnownZone, zoneList } from '../../shared/time/zones';
import type { PathIndex } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { NotesRepo, type ContentRow } from '../db/repositories/notes-repo';
import { ReminderSourcesRepo, type ReminderSourceRow, type SourceFields } from '../db/repositories/reminder-sources-repo';
import { RemindersRepo, type OccurrenceItemRow, type ReminderRow, type ViewBounds } from '../db/repositories/reminders-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import { livePathIndex } from './dto';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';
import { followupOf, recurrenceOf, seriesOf, toOccurrenceItem } from './reminder-model';
import { checkSource, sourceStateFor } from './reminder-sources';
import type { SettingsService } from './settings-service';
import type { SystemZoneProvider } from './system-zone';
import { runTx } from './transaction';

const DAY_MS = 86_400_000;
/** Bound on regenerating the next occurrence when existing rows (done ahead of time) already hold its instants. */
const MAX_GENERATION_STEPS = 8;
/** A phrase's reference instant must lie in this window around the reminder clock (plan section 8.2). */
const REFERENCE_PAST_MS = 400 * DAY_MS;
const REFERENCE_FUTURE_MS = 5 * 60_000;

export interface ReminderServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  zones: SystemZoneProvider;
  settings: Pick<SettingsService, 'getInternal'>;
  /** After every committed change: the `reminder:changed` broadcast. */
  emit(event: ReminderChangedEventType): void;
  /** After every committed write: wakes the scheduler. */
  onWrite(): void;
}

type Input = Pick<ReminderInputType, 'blockId' | 'title' | 'zoneId' | 'date' | 'time' | 'recurrence' | 'foldPreference' | 'followup' | 'allowPast'>;

/** The stored columns of a confirmed phrase. */
function sourceFields(source: SuggestionSourceType): SourceFields {
  return {
    block_id: source.blockId,
    source_text: source.text,
    span_start: source.spanStart,
    span_end: source.spanEnd,
    span_ordinal: source.spanOrdinal,
    reference_instant_utc: source.referenceInstantUtc,
    reference_zone: source.referenceZone,
    parser_version: PARSER_VERSION,
    origin: source.origin,
  };
}

function sourceDto(row: ReminderSourceRow): ReminderSourceDtoType {
  return {
    blockId: row.block_id,
    text: row.source_text,
    spanOrdinal: row.span_ordinal,
    origin: row.origin,
    state: row.source_state,
    referenceInstantUtc: row.reference_instant_utc,
    referenceZone: row.reference_zone,
  };
}

const scheduleOf = (r: Pick<ReminderRow, 'zone_id' | 'start_local_date' | 'local_time' | 'recurrence' | 'fold_preference'>) =>
  JSON.stringify([r.zone_id, r.start_local_date, r.local_time, r.recurrence, r.fold_preference]);

/**
 * Reminders, their occurrences and the views (plan section 8.2, D-078): creation with zone, block and limit checks,
 * edits with the explicit pending policy, Done, Snooze, delete with undo, series generation and the list views.
 * Reminders confirmed from note text keep their source phrase (Phase 06, D-092). Every write runs in an immediate
 * transaction; after it commits `reminder:changed` is emitted and the scheduler woken.
 */
export class ReminderService {
  private readonly repo: RemindersRepo;
  private readonly sources: ReminderSourcesRepo;
  private readonly notes: NotesRepo;
  private readonly hierarchy: HierarchyRepo;

  constructor(private readonly deps: ReminderServiceDeps) {
    this.repo = new RemindersRepo(deps.db);
    this.sources = new ReminderSourcesRepo(deps.db);
    this.notes = new NotesRepo(deps.db);
    this.hierarchy = new HierarchyRepo(deps.db);
  }

  private tx<T>(fn: () => T): T {
    return runTx(this.deps.db, this.deps.logger, fn);
  }

  private committed(reason: ReminderChangedEventType['reason'], noteIds: string[]): void {
    this.deps.emit({ reason, noteIds: [...new Set(noteIds)] });
    this.deps.onWrite();
  }

  // Zones -------------------------------------------------------------------------------------
  private systemZone(): string | null {
    return this.deps.zones.current();
  }

  /** The zone days are counted in: the computer's, else the default setting (plan section 9.3). */
  displayZone(): string | null {
    return this.systemZone() ?? this.deps.settings.getInternal('reminders.defaultZone');
  }

  /** The reminder clock and zones a renderer reads phrases with (D-089): never its own clock or zone. */
  zoneContext(): Pick<ZonesListResponseType, 'asOf' | 'systemZone' | 'defaultZone'> {
    const system = this.systemZone();
    return {
      asOf: this.deps.clock.now(),
      systemZone: system,
      defaultZone: defaultZoneFor({ setting: this.deps.settings.getInternal('reminders.defaultZone'), system }),
    };
  }

  zones(): ZonesListResponseType {
    const context = this.zoneContext();
    return { zones: zoneList(context.systemZone), ...context };
  }

  // Validation ----------------------------------------------------------------------------------
  private liveNote(noteId: string): ContentRow {
    const row = this.notes.getContentRow(noteId);
    if (!row) throw new AppError('NOT_FOUND', M.noteMissing);
    if (row.deleted_at !== null) throw new AppError('NOT_FOUND', M.noteMissing, { trashed: true, trashBatchId: row.trash_batch_id });
    return row;
  }

  private liveReminder(reminderId: string): ReminderRow {
    const row = this.repo.getReminder(reminderId);
    if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND', M.missing);
    return row;
  }

  private checkZone(zoneId: string): void {
    if (!isKnownZone(zoneId, this.systemZone())) throw new AppError('VALIDATION_FAILED', M.chooseZone);
  }

  /** A block anchor must name a block of the stored content (D-080); plain-text notes have none. */
  private checkBlock(note: ContentRow, blockId: string): void {
    if (note.format === 'plain') throw new AppError('VALIDATION_FAILED', M.plainBlock);
    if (!collectBlockIds(JSON.parse(note.content_json ?? '{}')).has(blockId)) throw new AppError('VALIDATION_FAILED', M.blockMissing, { blockMissing: true });
  }

  /** A phrase's reference instant is metadata, but it must be plausible (plan section 8.2). */
  private checkReference(referenceInstantUtc: number, now: number): void {
    if (referenceInstantUtc < now - REFERENCE_PAST_MS || referenceInstantUtc > now + REFERENCE_FUTURE_MS) {
      throw new AppError('VALIDATION_FAILED', M.referenceRange);
    }
  }

  // Occurrence generation ------------------------------------------------------------------------
  private insertOccurrence(reminderId: string, date: string, time: string, dueAtUtc: number, now: number): boolean {
    return this.repo.insertOccurrence({
      id: this.deps.ids.uuid(),
      reminderId,
      dueAtUtc,
      originalLocalDateTime: `${date}T${time}`,
      // A one-time reminder added in the past is overdue at once, without a notification.
      nextAlertAtUtc: dueAtUtc > now ? dueAtUtc : null,
      now,
    });
  }

  /** The first occurrence of a one-time reminder; a past time needs `allowPast`. */
  private oneTimeDue(input: Input, now: number): number {
    const due = resolveLocal({ date: input.date, time: input.time }, input.zoneId, input.foldPreference).instantUtc;
    if (due <= now && !input.allowPast) throw new AppError('VALIDATION_FAILED', M.past, { past: true, dueAtUtc: due });
    return due;
  }

  /** Inserts the first occurrence of a series after `after`; instants already held by a row count as taken. */
  private insertNextOf(reminderId: string, series: Series, after: number, now: number): void {
    let from = after;
    for (let i = 0; i < MAX_GENERATION_STEPS; i += 1) {
      const next = firstAfter(series, from);
      if (this.insertOccurrence(reminderId, next.date, series.time, next.instantUtc, now)) return;
      from = next.instantUtc;
    }
  }

  /**
   * Series generation (D-078): the newest occurrence due at or before `now` is added when it is newer than every
   * existing row, older open occurrences become missed, and the next future occurrence is added. Intermediate instants
   * are never created, so a long downtime adds at most two rows. A series that still has an open future occurrence is
   * left alone.
   */
  private ensureOne(row: ReminderRow, now: number): void {
    const series = seriesOf(row);
    if (!series || this.repo.openOccurrences(row.id).some((o) => o.due_at_utc > now)) return;
    const latest = latestAtOrBefore(series, now);
    const newest = this.repo.newestDue(row.id);
    if (latest && (newest === null || latest.instantUtc > newest)) {
      this.repo.insertOccurrence({
        id: this.deps.ids.uuid(),
        reminderId: row.id,
        dueAtUtc: latest.instantUtc,
        originalLocalDateTime: `${latest.date}T${series.time}`,
        nextAlertAtUtc: latest.instantUtc,
        now,
      });
    }
    if (latest) this.repo.markOlderMissed(row.id, latest.instantUtc, now);
    this.insertNextOf(row.id, series, Math.max(now, this.repo.newestDue(row.id) ?? now), now);
  }

  /** Runs series generation for every live series without an open future occurrence; returns the notes touched. */
  ensureSeries(now: number): string[] {
    const rows = this.repo.recurringWithoutFutureOpen(now);
    for (const row of rows) this.ensureOne(row, now);
    return rows.map((r) => r.note_id);
  }

  // DTOs ----------------------------------------------------------------------------------
  private paths(): PathIndex {
    return livePathIndex(this.hierarchy);
  }

  private item(row: OccurrenceItemRow, now: number, paths = this.paths()): OccurrenceItemType {
    return toOccurrenceItem(row, now, paths);
  }

  private toDto(row: ReminderRow, current: OccurrenceItemType | null, source: ReminderSourceRow | undefined): ReminderDtoType {
    return {
      id: row.id,
      noteId: row.note_id,
      blockId: row.block_id,
      anchorState: row.anchor_state,
      title: row.title,
      zoneId: row.zone_id,
      date: row.start_local_date,
      time: row.local_time,
      recurrence: recurrenceOf(row),
      foldPreference: row.fold_preference,
      followup: followupOf(row),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolution: { status: resolveLocal({ date: row.start_local_date, time: row.local_time }, row.zone_id, row.fold_preference).status },
      current,
      source: source ? sourceDto(source) : null,
    };
  }

  private dtoOf(reminderId: string): ReminderDtoType {
    const row = this.repo.getReminder(reminderId)!;
    const [current] = this.repo.currentItems([reminderId]);
    return this.toDto(row, current ? this.item(current, this.deps.clock.now()) : null, this.sources.get(reminderId));
  }

  // Writes ----------------------------------------------------------------------------------
  create(req: ReminderCreateRequestType): ReminderDtoType {
    const now = this.deps.clock.now();
    const id = this.tx(() => {
      const note = this.liveNote(req.noteId);
      this.checkZone(req.zoneId);
      if (req.blockId !== null) this.checkBlock(note, req.blockId);
      return this.insertNew(req.noteId, req, now);
    });
    this.committed('created', [req.noteId]);
    return this.dtoOf(id);
  }

  /** A new reminder with its first occurrence, within the per-note limit. */
  private insertNew(noteId: string, input: Input, now: number): string {
    if (this.repo.countLiveForNote(noteId) >= MAX_REMINDERS_PER_NOTE) throw new AppError('LIMIT_EXCEEDED', M.limit);
    const reminderId = this.deps.ids.uuid();
    this.repo.insertReminder({ id: reminderId, note_id: noteId, anchor_state: 'ok', ...this.fieldsOf(input), created_at: now, updated_at: now });
    this.generateFirst(reminderId, input, now);
    return reminderId;
  }

  /** The live reminder already confirmed from this phrase (same block, normalized text and ordinal; not detached). */
  private linkedReminder(noteId: string, source: SuggestionSourceType): string | null {
    const text = normalizePhrase(source.text);
    return this.sources.linksAt(noteId, source.blockId, source.spanOrdinal).find((s) => normalizePhrase(s.source_text) === text)?.reminder_id ?? null;
  }

  /**
   * Confirms a suggestion (plan section 8.2, D-089): the phrase is checked against the stored note, the date, time and
   * zone are resolved exactly as for `reminder:create`, and the source is stored with the reminder. Idempotent per
   * phrase: a live, linked reminder is returned with `existing` instead of a duplicate.
   */
  createFromSource(req: ReminderCreateFromSuggestionRequestType): ReminderCreateFromSuggestionResponseType {
    const now = this.deps.clock.now();
    const { source } = req;
    const result = this.tx(() => {
      const note = this.liveNote(req.noteId);
      this.checkZone(req.zoneId);
      this.checkReference(source.referenceInstantUtc, now);
      checkSource(note, source);
      const linked = this.linkedReminder(req.noteId, source);
      if (linked) return { id: linked, existing: true };
      const id = this.insertNew(req.noteId, { ...req, blockId: source.blockId }, now);
      this.sources.insert(id, req.noteId, sourceFields(source), now);
      return { id, existing: false };
    });
    this.deps.logger.info(`suggestions: reminder ${result.id} from source origin=${source.origin} state=ok existing=${result.existing}`);
    if (!result.existing) this.committed('created', [req.noteId]);
    return { reminder: this.dtoOf(result.id), existing: result.existing };
  }

  /**
   * Update from the note's current text (`apply`: a new schedule and a new source, with the revision check and pending
   * policy of an edit) or Keep current time (`keep`: the source is detached and stops following the text; the schedule
   * and revision stay as they are).
   */
  updateFromSource(req: ReminderUpdateFromSourceRequestType): ReminderDtoType {
    const now = this.deps.clock.now();
    const noteId = this.tx(() => {
      if (req.action === 'keep') {
        const row = this.liveReminder(req.reminderId);
        if (!this.sources.get(row.id)) throw new AppError('VALIDATION_FAILED', M.noSource);
        this.sources.setState(row.id, 'detached', now);
        return row.note_id;
      }
      const { action: _action, source, ...input } = req;
      this.checkReference(source.referenceInstantUtc, now);
      const row = this.applyUpdate({ ...input, blockId: source.blockId }, now);
      checkSource(this.liveNote(row.note_id), source);
      this.sources.replace(row.id, row.note_id, sourceFields(source), now);
      return row.note_id;
    });
    const detail = req.action === 'keep' ? 'source detached' : `from source origin=${req.source.origin} state=ok`;
    this.deps.logger.info(`suggestions: reminder ${req.reminderId} ${detail}`);
    this.committed('updated', [noteId]);
    return this.dtoOf(req.reminderId);
  }

  private fieldsOf(input: Input) {
    return {
      block_id: input.blockId,
      title: input.title,
      zone_id: input.zoneId,
      start_local_date: input.date,
      local_time: input.time,
      recurrence: input.recurrence === null ? null : JSON.stringify(input.recurrence),
      fold_preference: input.foldPreference,
      followup_interval_minutes: input.followup?.intervalMinutes ?? null,
      max_followups: input.followup?.maxFollowups ?? 2,
    };
  }

  /** The first occurrence of a new schedule: a series skips past dates (never alerted); a one-time time may be past. */
  private generateFirst(reminderId: string, input: Input, now: number): void {
    if (input.recurrence === null) {
      this.insertOccurrence(reminderId, input.date, input.time, this.oneTimeDue(input, now), now);
      return;
    }
    const series: Series = { rule: input.recurrence, startDate: input.date, time: input.time, zoneId: input.zoneId, fold: input.foldPreference };
    this.insertNextOf(reminderId, series, now, now);
  }

  /**
   * Edit (INF-REM-13, D-078). Title, follow-up and anchor changes keep the occurrence rows. A schedule change deletes
   * open occurrences that are not due yet, applies the pending policy to a series' overdue occurrence (keep or
   * complete), replaces a one-time reminder's open occurrence (cancelled when it already alerted) and generates anew.
   * A follow-up change re-targets the next follow-up of occurrences that already alerted.
   */
  update(req: ReminderUpdateRequestType): ReminderDtoType {
    const now = this.deps.clock.now();
    const noteId = this.tx(() => this.applyUpdate(req, now).note_id);
    this.committed('updated', [noteId]);
    return this.dtoOf(req.reminderId);
  }

  /**
   * The body of an edit, inside the caller's transaction. Moving the reminder to another block (or to note-level)
   * detaches its source: the phrase no longer describes where the reminder is (D-092).
   */
  private applyUpdate(req: ReminderUpdateRequestType, now: number): ReminderRow {
    const row = this.liveReminder(req.reminderId);
    if (row.revision !== req.expectedRevision) throw new AppError('CONFLICT', M.conflict, { currentRevision: row.revision });
    const note = this.liveNote(row.note_id);
    this.checkZone(req.zoneId);
    const blockChanged = req.blockId !== row.block_id;
    if (blockChanged && req.blockId !== null) this.checkBlock(note, req.blockId);
    const fields = this.fieldsOf(req);
    const anchor_state = blockChanged ? 'ok' : row.anchor_state;
    if (scheduleOf(fields) !== scheduleOf(row)) this.reschedule(row, req, now);
    if (fields.followup_interval_minutes !== row.followup_interval_minutes || fields.max_followups !== row.max_followups) {
      this.repo.retargetFollowups(row.id, fields.followup_interval_minutes, fields.max_followups, now);
    }
    this.repo.updateReminder(row.id, { ...fields, anchor_state }, now);
    if (blockChanged && this.sources.get(row.id)) this.sources.setState(row.id, 'detached', now);
    return row;
  }

  private reschedule(row: ReminderRow, req: ReminderUpdateRequestType, now: number): void {
    const wasSeries = row.recurrence !== null;
    // A one-time reminder whose open occurrence keeps its instant is the same occurrence: nothing to replace.
    const oneTimeDue = req.recurrence === null ? this.oneTimeDue(req, now) : null;
    for (const occ of this.repo.openOccurrences(row.id)) {
      if (occ.due_at_utc > now) {
        // Not due yet, so never alerted (asserted in the integration tests).
        if (oneTimeDue === occ.due_at_utc) this.repo.setOriginalLocal(occ.id, `${req.date}T${req.time}`, now);
        else this.repo.deleteOccurrence(occ.id);
      } else if (wasSeries) {
        if (req.pendingPolicy === 'complete') this.repo.complete(occ.id, now);
      } else if (oneTimeDue === occ.due_at_utc) {
        this.repo.setOriginalLocal(occ.id, `${req.date}T${req.time}`, now);
      } else if (this.repo.hasDeliveries(occ.id)) {
        this.repo.cancel(occ.id, now);
      } else {
        this.repo.deleteOccurrence(occ.id);
      }
    }
    if (oneTimeDue !== null) {
      if (this.repo.openOccurrences(row.id).some((o) => o.due_at_utc === oneTimeDue)) return;
      this.insertOccurrence(row.id, req.date, req.time, oneTimeDue, now);
      return;
    }
    this.generateFirst(row.id, req, now);
  }

  delete(reminderId: string): { reminderId: string; undoUntil: number } {
    const now = this.deps.clock.now();
    const noteId = this.tx(() => {
      const row = this.liveReminder(reminderId);
      this.repo.setDeletedAt(reminderId, now);
      return row.note_id;
    });
    this.committed('deleted', [noteId]);
    return { reminderId, undoUntil: now + UNDO_DELETE_MS };
  }

  undoDelete(reminderId: string): ReminderDtoType {
    const now = this.deps.clock.now();
    const restored = this.tx(() => {
      const row = this.repo.getReminder(reminderId);
      if (!row) throw new AppError('NOT_FOUND', M.missing);
      if (row.deleted_at === null) return null;
      if (now > row.deleted_at + UNDO_DELETE_MS) throw new AppError('VALIDATION_FAILED', M.undoExpired);
      this.repo.setDeletedAt(reminderId, null);
      // The note may have changed while the reminder was deleted; its anchor and source follow the stored content.
      const note = this.notes.getContentRow(row.note_id);
      if (note) this.resyncRestored(row, note, now);
      return row.note_id;
    });
    if (restored) this.committed('restored', [restored]);
    return this.dtoOf(reminderId);
  }

  private resyncRestored(row: ReminderRow, note: ContentRow, now: number): void {
    const doc: unknown = note.format === 'rich' ? JSON.parse(note.content_json ?? '{}') : null;
    if (row.block_id !== null) {
      const present = note.format === 'rich' && collectBlockIds(doc).has(row.block_id);
      this.repo.setAnchorState(row.id, present ? 'ok' : 'block_missing');
    }
    const source = this.sources.get(row.id);
    if (!source || source.source_state === 'detached') return;
    const blockTexts = source.block_id !== null && note.format === 'rich' ? richBlockTexts(doc, new Set([source.block_id])) : new Map<string, string>();
    const state = sourceStateFor(source, { format: note.format, plainText: note.plain_text, blockTexts });
    if (state !== source.source_state) this.sources.setState(row.id, state, now);
  }

  /** Done (INF-REM-09): completes one occurrence; a series keeps one future open occurrence. */
  complete(occurrenceId: string): OccurrenceItemType {
    const now = this.deps.clock.now();
    const changed = this.tx(() => {
      const { occ, reminder } = this.occurrenceOf(occurrenceId);
      if (occ.state === 'completed') return null;
      if (occ.state === 'cancelled') throw new AppError('VALIDATION_FAILED', M.replaced);
      this.repo.complete(occurrenceId, now);
      this.ensureOne(reminder, now);
      return reminder.note_id;
    });
    if (changed) this.committed('completed', [changed]);
    return this.item(this.repo.itemById(occurrenceId)!, now);
  }

  /** Snooze (INF-REM-10): only a due open occurrence; it replaces the next alert and never moves the series. */
  snooze(occurrenceId: string, preset: SnoozePresetType): OccurrenceItemType {
    const now = this.deps.clock.now();
    const noteId = this.tx(() => {
      const { occ, reminder } = this.occurrenceOf(occurrenceId);
      if (occ.state === 'cancelled') throw new AppError('VALIDATION_FAILED', M.replaced);
      if (occ.state !== 'pending' && occ.state !== 'snoozed') throw new AppError('VALIDATION_FAILED', M.cannotSnooze);
      if (occ.due_at_utc > now) throw new AppError('VALIDATION_FAILED', M.notDue);
      this.repo.snooze(occurrenceId, snoozeTarget(preset, now, reminder.zone_id), now);
      return reminder.note_id;
    });
    this.committed('snoozed', [noteId]);
    return this.item(this.repo.itemById(occurrenceId)!, now);
  }

  private occurrenceOf(occurrenceId: string) {
    const occ = this.repo.getOccurrence(occurrenceId);
    const reminder = occ ? this.repo.getReminder(occ.reminder_id) : undefined;
    if (!occ || !reminder || reminder.deleted_at !== null) throw new AppError('NOT_FOUND', M.missing);
    return { occ, reminder };
  }

  // Reads ----------------------------------------------------------------------------------
  /** The live reminders of a note with their current occurrence (chips, panel). */
  listForNote(noteId: string): ReminderListResponseType {
    if (!this.hierarchy.getNoteMeta(noteId)) throw new AppError('NOT_FOUND', M.noteMissing);
    const now = this.deps.clock.now();
    const rows = this.repo.liveForNote(noteId);
    const paths = this.paths();
    const ids = rows.map((r) => r.id);
    const current = new Map(this.repo.currentItems(ids).map((c) => [c.reminder_id, this.item(c, now, paths)]));
    const sources = this.sources.forReminders(ids);
    return { reminders: rows.map((r) => this.toDto(r, current.get(r.id) ?? null, sources.get(r.id))), asOf: now, displayZone: this.displayZone() };
  }

  /** Occurrence items in the given order (alert events); ids that no longer exist are skipped. */
  itemsOf(occurrenceIds: readonly string[]): OccurrenceItemType[] {
    const now = this.deps.clock.now();
    const paths = this.paths();
    const rows = new Map(this.repo.itemsByIds(occurrenceIds).map((r) => [r.id, r]));
    return occurrenceIds.flatMap((id) => {
      const row = rows.get(id);
      return row ? [this.item(row, now, paths)] : [];
    });
  }

  /** The note and block a notification of this occurrence opens, or null when the note is gone. */
  occurrenceSource(occurrenceId: string): { noteId: string; blockId: string | null } | null {
    const row = this.repo.itemById(occurrenceId);
    return row ? { noteId: row.note_id, blockId: row.anchor_state === 'ok' ? row.block_id : null } : null;
  }

  /** Where the source of a reminder is (reminder:open); the note must be live. */
  source(reminderId: string): { noteId: string; blockId: string | null } {
    const row = this.liveReminder(reminderId);
    this.liveNote(row.note_id);
    return { noteId: row.note_id, blockId: row.anchor_state === 'ok' ? row.block_id : null };
  }

  private bounds(now: number): ViewBounds {
    const dayZone = this.displayZone() ?? FALLBACK_DAY_ZONE;
    const tomorrow = addDays(localParts(now, dayZone).date, 1);
    return {
      now,
      endOfToday: resolveLocal({ date: tomorrow, time: '00:00' }, dayZone, 'earlier').instantUtc,
      completedSince: now - COMPLETED_VIEW_DAYS * DAY_MS,
    };
  }

  /** Today, Upcoming, Overdue or Completed (INF-REM-05) in the display zone, with the open counts. */
  listView(view: ReminderViewType, scope: HomeScopeType): ReminderViewResponseType {
    const now = this.deps.clock.now();
    const bounds = this.bounds(now);
    const paths = this.paths();
    return {
      view,
      asOf: now,
      displayZone: this.displayZone(),
      items: this.repo.viewItems(view, bounds, scope, VIEW_LIMIT).map((r) => this.item(r, now, paths)),
      counts: {
        today: this.repo.viewCount('today', bounds, scope),
        upcoming: this.repo.viewCount('upcoming', bounds, scope),
        overdue: this.repo.viewCount('overdue', bounds, scope),
      },
    };
  }

  /** Home (INF-HOME-04): the first overdue and due-today reminders with totals. */
  summary(scope: HomeScopeType): RemindersSummaryResponseType {
    const now = this.deps.clock.now();
    const bounds = this.bounds(now);
    const paths = this.paths();
    const items = (view: ReminderViewType) => this.repo.viewItems(view, bounds, scope, HOME_REMINDER_LIMIT).map((r) => this.item(r, now, paths));
    return {
      asOf: now,
      displayZone: this.displayZone(),
      overdue: items('overdue'),
      overdueTotal: this.repo.viewCount('overdue', bounds, scope),
      today: items('today'),
      todayTotal: this.repo.viewCount('today', bounds, scope),
    };
  }
}

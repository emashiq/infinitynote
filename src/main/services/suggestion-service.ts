import { createHash } from 'node:crypto';
import { LOCK_MESSAGES } from '../../shared/contracts/locks';
import { REMINDER_MESSAGES as M } from '../../shared/contracts/reminders';
import type { DismissalDtoType, SuggestionDismissRequestType, SuggestionListDismissedResponseType } from '../../shared/contracts/suggestions';
import { DISMISSAL_KEEP_DAYS, MAX_DISMISSALS_PER_NOTE, MAX_SOURCE_TEXT } from '../../shared/nlp/constants';
import { normalizePhrase } from '../../shared/nlp/source-text';
import { addDays } from '../../shared/time/resolve';
import type { Db } from '../db/driver';
import { DismissalsRepo, type DismissalRow } from '../db/repositories/dismissals-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import type { Logger } from './logger';
import type { ReminderService } from './reminder-service';
import { runTx } from './transaction';

export interface SuggestionServiceDeps {
  db: Db;
  /** The reminder clock (frozen under the E2E clock seam, D-084). */
  clock: Clock;
  logger: Logger;
  reminders: Pick<ReminderService, 'zoneContext'>;
}

function toDto(row: DismissalRow): DismissalDtoType {
  return { blockId: row.block_id, text: row.span_text, spanOrdinal: row.span_ordinal, referenceDate: row.reference_date, createdAt: row.created_at };
}

/** The dismissal key (D-088): SHA-256 over the versioned parts, so the renderer never hashes. */
function dedupeKey(parts: { noteId: string; blockId: string | null; text: string; spanOrdinal: number; referenceDate: string }): string {
  const payload = JSON.stringify(['v1', parts.noteId, parts.blockId ?? '', parts.text, parts.spanOrdinal, parts.referenceDate]);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Dismissed suggestions (plan section 8.5, D-092): stored per note, phrase, ordinal and reference date, so a dismissed
 * phrase stays hidden across edits elsewhere and restarts on the same day, at most 500 per note, and pruned at startup
 * once the reference date is older than two days.
 */
export class SuggestionService {
  private readonly repo: DismissalsRepo;
  private readonly notes: NotesRepo;

  constructor(private readonly deps: SuggestionServiceDeps) {
    this.repo = new DismissalsRepo(deps.db);
    this.notes = new NotesRepo(deps.db);
  }

  /** Idempotent: dismissing the same phrase again returns the stored dismissal. */
  dismiss(req: SuggestionDismissRequestType): { dismissal: DismissalDtoType } {
    const now = this.deps.clock.now();
    const row = runTx(this.deps.db, this.deps.logger, () => {
      const note = this.notes.getContentRow(req.noteId);
      if (!note || note.deleted_at !== null) throw new AppError('NOT_FOUND', M.noteMissing);
      if (note.locked === 1) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.noSuggestions);
      if ((note.format === 'rich') !== (req.blockId !== null)) throw new AppError('VALIDATION_FAILED', M.sourceFormat, { sourceFormat: true });
      const text = normalizePhrase(req.text);
      if (text.length > MAX_SOURCE_TEXT) throw new AppError('VALIDATION_FAILED', 'Invalid request');
      const parts = { noteId: req.noteId, blockId: req.blockId, text, spanOrdinal: req.spanOrdinal, referenceDate: req.referenceDate };
      const fresh: DismissalRow = {
        dedupe_key: dedupeKey(parts),
        note_id: req.noteId,
        block_id: req.blockId,
        span_text: text,
        span_ordinal: req.spanOrdinal,
        reference_date: req.referenceDate,
        created_at: now,
      };
      this.repo.insertIgnore(fresh);
      this.repo.trimNote(req.noteId, MAX_DISMISSALS_PER_NOTE);
      return this.repo.get(fresh.dedupe_key) ?? fresh;
    });
    this.deps.logger.info(`suggestions: dismissed note=${req.noteId}`);
    return { dismissal: toDto(row) };
  }

  /** The note's dismissals (newest first) with main's reference context; a trashed note is still readable. */
  listDismissed(noteId: string): SuggestionListDismissedResponseType {
    if (!this.notes.getContentRow(noteId)) throw new AppError('NOT_FOUND', M.noteMissing);
    return { ...this.deps.reminders.zoneContext(), dismissals: this.repo.listForNote(noteId, MAX_DISMISSALS_PER_NOTE).map(toDto) };
  }

  /** Removes dismissals whose reference date is more than DISMISSAL_KEEP_DAYS before today (UTC). */
  pruneDismissals(now: number = this.deps.clock.now()): number {
    const cutoff = addDays(new Date(now).toISOString().slice(0, 10), -DISMISSAL_KEEP_DAYS);
    const removed = runTx(this.deps.db, this.deps.logger, () => this.repo.pruneBefore(cutoff));
    this.deps.logger.info(`suggestions: pruned ${removed} dismissals`);
    return removed;
  }
}

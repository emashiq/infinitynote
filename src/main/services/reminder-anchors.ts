import { collectBlockIds } from '../../shared/editor/doc-schema';
import { richBlockTexts } from '../../shared/nlp/source-text';
import type { Db } from '../db/driver';
import { ReminderSourcesRepo } from '../db/repositories/reminder-sources-repo';
import { RemindersRepo } from '../db/repositories/reminders-repo';
import type { Clock } from './clock';
import type { Logger } from './logger';
import { sourceStateFor } from './reminder-sources';

/**
 * Keeps block anchors and reminder sources in step with note content (D-080, D-092, INF-REM-17). `sync` runs inside
 * every content transaction, so deleting the anchored block marks the reminder `block_missing` and its source `missing`,
 * editing the phrase marks the source `changed`, and bringing either back (undo, version restore) marks them `ok` in the
 * same commit. Only these states change: the reminder's schedule, occurrences and revision are never touched, so an
 * edit never moves a reminder silently.
 */
export class ReminderAnchors {
  private readonly repo: RemindersRepo;
  private readonly sources: ReminderSourcesRepo;
  private readonly changedNotes = new Set<string>();

  constructor(
    db: Db,
    private readonly deps: { clock: Clock; logger: Logger },
  ) {
    this.repo = new RemindersRepo(db);
    this.sources = new ReminderSourcesRepo(db);
  }

  sync(noteId: string, format: 'rich' | 'plain', content: unknown, plainText: string): void {
    this.syncAnchors(noteId, format, content);
    this.syncSources(noteId, format, content, plainText);
  }

  private syncAnchors(noteId: string, format: 'rich' | 'plain', content: unknown): void {
    const anchored = this.repo.anchoredOf(noteId);
    if (anchored.length === 0) return;
    const blocks = format === 'rich' ? collectBlockIds(content) : new Set<string>();
    for (const row of anchored) {
      const state = blocks.has(row.block_id) ? 'ok' : 'block_missing';
      if (state === row.anchor_state) continue;
      this.repo.setAnchorState(row.id, state);
      this.changedNotes.add(noteId);
    }
  }

  private syncSources(noteId: string, format: 'rich' | 'plain', content: unknown, plainText: string): void {
    const tracked = this.sources.trackedForNote(noteId);
    if (tracked.length === 0) return;
    const blockIds = new Set(tracked.flatMap((s) => (s.block_id === null ? [] : [s.block_id])));
    const blockTexts = format === 'rich' && blockIds.size > 0 ? richBlockTexts(content, blockIds) : new Map<string, string>();
    const now = this.deps.clock.now();
    for (const row of tracked) {
      const state = sourceStateFor(row, { format, plainText, blockTexts });
      if (state === row.source_state) continue;
      this.sources.setState(row.reminder_id, state, now);
      this.deps.logger.info(`suggestions: source ${row.reminder_id} ${row.source_state}->${state}`);
      this.changedNotes.add(noteId);
    }
  }

  /**
   * True once after a content write changed an anchor or a source of the note (then `reminder:changed {anchor}` follows
   * the revision event). A write that rolled back may leave a stale entry; the extra event only makes views re-read.
   */
  consumeChanged(noteId: string): boolean {
    return this.changedNotes.delete(noteId);
  }
}

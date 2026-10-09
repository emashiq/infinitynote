import { collectBlockIds } from '../../shared/editor/doc-schema';
import type { Db } from '../db/driver';
import { RemindersRepo } from '../db/repositories/reminders-repo';

/**
 * Keeps block anchors in step with note content (D-080, INF-REM-17). `sync` runs inside every content transaction, so
 * deleting the anchored block marks the reminder `block_missing` and bringing it back (undo, version restore) marks it
 * `ok` in the same commit. A reminder with a missing block stays on its note and keeps alerting.
 */
export class ReminderAnchors {
  private readonly repo: RemindersRepo;
  private readonly changedNotes = new Set<string>();

  constructor(db: Db) {
    this.repo = new RemindersRepo(db);
  }

  sync(noteId: string, format: 'rich' | 'plain', content: unknown): void {
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

  /**
   * True once after a content write changed an anchor of the note (then `reminder:changed {anchor}` follows the
   * revision event). A write that rolled back may leave a stale entry; the extra event only makes views re-read.
   */
  consumeChanged(noteId: string): boolean {
    return this.changedNotes.delete(noteId);
  }
}

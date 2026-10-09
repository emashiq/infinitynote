import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import { errorMessage } from '../services/app-error';
import type { Logger } from '../services/logger';

export interface PurgeCounts {
  versions: number;
  drafts: number;
  sources: number;
  dismissals: number;
}

/**
 * Deletes every plaintext copy the database holds of a note that is being locked (D-112): its versions, its drafts,
 * the reminder source texts and dismissed suggestion phrases taken from it, and the content and plain text of its row
 * (the search index row then keeps only the title). Runs inside the lock transaction, before the lock row exists.
 * Not touched: reminder titles and the note title (shown in the app, said in the lock dialog), references (IDs and
 * the target's title), attachments and linked files (not encrypted, said in the lock dialog).
 */
export function purgePlaintext(db: Db, noteId: string): PurgeCounts {
  const remove = (table: string) => db.prepare<[string]>(`DELETE FROM ${table} WHERE note_id = ?`).run(noteId).changes;
  const counts = {
    versions: remove('note_versions'),
    drafts: remove('note_drafts'),
    sources: remove('reminder_sources'),
    dismissals: remove('suggestion_dismissals'),
  };
  new NotesRepo(db).clearContent(noteId);
  return counts;
}

/**
 * After a purge committed: makes sure the deleted text does not stay readable in the database files. With
 * `secure_delete` on, the search index merges its segments (`optimize`, dropping the deleted entries), `VACUUM`
 * rewrites the database so no free page or free space inside a page keeps old content, and a TRUNCATE checkpoint
 * copies the WAL into the database and empties it. What SQLite cannot reach (blocks the file system or an SSD keeps,
 * copies made earlier) is outside this guarantee and documented.
 *
 * Returns false when a step was blocked (VACUUM refused while another statement or connection was active, or the WAL
 * busy so it could not be truncated). Old WAL frames then stay in the file until a truncating checkpoint succeeds,
 * since an ordinary checkpoint does not overwrite the frames after the point where the WAL restarts: the caller runs
 * the whole scrub again later (it is idempotent).
 */
export function scrubDatabase(db: Db, logger: Logger): boolean {
  const previous = Number(db.pragmaValue('secure_delete'));
  db.pragma('secure_delete = ON');
  try {
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES ('optimize')");
    db.exec('VACUUM');
    const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    if (result?.busy) {
      logger.warn('locks: the WAL could not be emptied after a lock (busy); retrying later');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(`locks: scrubbing the database after a lock was blocked (${errorMessage(err)}); retrying later`);
    return false;
  } finally {
    db.pragma(`secure_delete = ${previous === 1 ? 'ON' : 'OFF'}`);
  }
}

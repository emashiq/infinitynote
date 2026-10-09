import type { TagInfoType } from '../../shared/contracts/tags';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import { TagsRepo } from '../db/repositories/tags-repo';
import { AppError } from './app-error';
import type { Logger } from './logger';
import { runTx } from './transaction';

/** Small per-note tags used as a search filter (INF-HIER-11). Requests are already normalized by the contract. */
export class TagService {
  private readonly repo: TagsRepo;
  private readonly notes: NotesRepo;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {
    this.repo = new TagsRepo(db);
    this.notes = new NotesRepo(db);
  }

  list(noteId?: string): { tags: TagInfoType[] } {
    if (noteId === undefined) return { tags: this.repo.withLiveCounts() };
    return { tags: this.repo.forNote(noteId).map((name) => ({ name, count: 1 })) };
  }

  set(noteId: string, tags: readonly string[]): { tags: string[] } {
    const names = [...new Set(tags)].sort();
    return runTx(this.db, this.logger, () => {
      const note = this.notes.getContentRow(noteId);
      if (!note || note.deleted_at !== null) throw new AppError('NOT_FOUND', 'This note no longer exists');
      this.repo.replaceForNote(noteId, names);
      return { tags: names };
    });
  }
}

import type { NoteOpenResponseType } from '../../shared/contracts/notes';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import type { NoteVault } from '../locks/note-vault';
import { AppError } from './app-error';
import { livePathIndex, toNoteSummary } from './dto';
import { MSG } from './messages';

export class NoteReader {
  private readonly repo: HierarchyRepo;
  private readonly notes: NotesRepo;

  constructor(
    db: Db,
    private readonly vault: NoteVault,
  ) {
    this.repo = new HierarchyRepo(db);
    this.notes = new NotesRepo(db);
  }

  /** The note and its content; a locked note opens only while it is unlocked (FORBIDDEN `{locked: true}` otherwise). */
  open(noteId: string): NoteOpenResponseType {
    const meta = this.repo.getNoteMeta(noteId);
    const body = this.notes.getContentRow(noteId);
    if (!meta || !body) throw new AppError('NOT_FOUND', MSG.missing);
    if (meta.deleted_at !== null) {
      throw new AppError('NOT_FOUND', MSG.noteInTrash, { trashed: true, trashBatchId: meta.trash_batch_id });
    }
    const serialized = this.vault.serialized(body);
    let content: unknown;
    try {
      content = body.format === 'rich' ? JSON.parse(serialized) : serialized;
    } catch {
      throw new AppError('INTERNAL', 'Something went wrong');
    }
    return {
      note: toNoteSummary(meta, livePathIndex(this.repo)),
      format: body.format,
      content: content as NoteOpenResponseType['content'],
      revision: body.revision,
    };
  }
}

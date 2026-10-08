import type { NoteOpenResponseType } from '../../shared/contracts/notes';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import { livePathIndex, toNoteSummary } from './dto';
import { MSG } from './messages';

export class NoteReader {
  private readonly repo: HierarchyRepo;
  private readonly notes: NotesRepo;

  constructor(db: Db) {
    this.repo = new HierarchyRepo(db);
    this.notes = new NotesRepo(db);
  }

  open(noteId: string): NoteOpenResponseType {
    const meta = this.repo.getNoteMeta(noteId);
    const body = this.notes.getOpenRow(noteId);
    if (!meta || !body) throw new AppError('NOT_FOUND', MSG.missing);
    if (meta.deleted_at !== null) {
      throw new AppError('NOT_FOUND', MSG.noteInTrash, { trashed: true, trashBatchId: meta.trash_batch_id });
    }
    let content: unknown;
    if (body.format === 'rich') {
      try {
        content = JSON.parse(body.content_json ?? '{"type":"doc"}');
      } catch {
        throw new AppError('INTERNAL', 'Something went wrong');
      }
    } else {
      content = body.content_text ?? '';
    }
    return {
      note: toNoteSummary(meta, livePathIndex(this.repo)),
      format: body.format,
      content: content as NoteOpenResponseType['content'],
      revision: body.revision,
    };
  }
}

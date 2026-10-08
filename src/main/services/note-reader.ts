import type { NoteOpenResponseType } from '../../shared/contracts/notes';
import { buildPathIndex } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import { MSG, toNoteSummary } from './dto';

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
    const index = buildPathIndex(
      this.repo.liveProjects().map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at })),
      this.repo.liveFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, createdAt: f.created_at })),
    );
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
      note: toNoteSummary(meta, index),
      format: body.format,
      content: content as NoteOpenResponseType['content'],
      revision: body.revision,
    };
  }
}

import { MAX_PICK_BLOCKS, MAX_REF_CONTEXT, MAX_REF_ROWS, type BacklinkType, type NotesPickResponseType, type OutgoingRefType, type RefTargetStateType, type RefsListResponseType } from '../../shared/contracts/references';
import { collectBlockIds } from '../../shared/editor/doc-schema';
import { clipText, textBlocksOf } from '../../shared/editor/text-blocks';
import { pathOf, type PathIndex } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { ReferencesRepo } from '../db/repositories/references-repo';
import { AppError } from './app-error';
import { livePathIndex } from './dto';

const parseDoc = (json: string | null): unknown => (json ? JSON.parse(json) : null);

/** Parses each note's stored document once per request. */
function docCache(): (noteId: string, json: string | null) => unknown {
  const docs = new Map<string, unknown>();
  return (noteId, json) => {
    if (!docs.has(noteId)) docs.set(noteId, parseDoc(json));
    return docs.get(noteId);
  };
}

/** Outgoing references, backlinks and the block list of the reference picker (INF-REF-01..06, D-098). */
export class ReferenceService {
  private readonly refs: ReferencesRepo;
  private readonly notes: NotesRepo;
  private readonly hierarchy: HierarchyRepo;

  constructor(db: Db) {
    this.refs = new ReferencesRepo(db);
    this.notes = new NotesRepo(db);
    this.hierarchy = new HierarchyRepo(db);
  }

  list(noteId: string): RefsListResponseType {
    const index = livePathIndex(this.hierarchy);
    return { outgoing: this.outgoing(noteId, index), backlinks: this.backlinks(noteId, index) };
  }

  /** The textblocks of a live note that contain the query (all of them for an empty query); none for plain notes. */
  pickBlocks(noteId: string, query: string): NotesPickResponseType {
    const note = this.notes.getContentRow(noteId);
    if (!note || note.deleted_at !== null) throw new AppError('NOT_FOUND', 'This note no longer exists');
    if (note.format === 'plain') return { format: 'plain', blocks: [] };
    const q = query.trim().toLocaleLowerCase();
    const blocks = textBlocksOf(parseDoc(note.content_json))
      .filter((b) => b.text.trim() !== '' && (q === '' || b.text.toLocaleLowerCase().includes(q)))
      .slice(0, MAX_PICK_BLOCKS)
      .map((b) => ({ blockId: b.id, kind: b.kind, text: clipText(b.text, MAX_REF_CONTEXT) }));
    return { format: 'rich', blocks };
  }

  private outgoing(noteId: string, index: PathIndex): OutgoingRefType[] {
    const docOf = docCache();
    return this.refs.outgoing(noteId, MAX_REF_ROWS).map((row): OutgoingRefType => {
      const blockId = row.target_block_id;
      let state: RefTargetStateType = 'ok';
      let blockText: string | null = null;
      if (!row.present) state = 'missing';
      else if (row.deleted_at !== null) state = 'trashed';
      // A block of a locked note is not readable: the reference shows the note without the block's text (D-111).
      else if (blockId !== null && row.locked !== 1) {
        const doc = row.format === 'rich' ? docOf(row.target_note_id, row.content_json) : null;
        if (!collectBlockIds(doc).has(blockId)) state = 'blockMissing';
        else blockText = clipText(textBlocksOf(doc).find((b) => b.id === blockId)?.text ?? '', MAX_REF_CONTEXT);
      }
      const live = state === 'ok' || state === 'blockMissing';
      return {
        targetNoteId: row.target_note_id,
        targetBlockId: blockId,
        title: row.title ?? row.target_title_snapshot,
        path: live ? pathOf(index, { projectId: row.project_id, folderId: row.folder_id }) : [],
        state,
        trashBatchId: state === 'trashed' ? row.trash_batch_id : null,
        blockText,
      };
    });
  }

  private backlinks(noteId: string, index: PathIndex): BacklinkType[] {
    const docOf = docCache();
    return this.refs.backlinks(noteId, MAX_REF_ROWS).map((row) => {
      const block = row.source_block_id ? textBlocksOf(docOf(row.source_note_id, row.content_json)).find((b) => b.id === row.source_block_id) : undefined;
      return {
        sourceNoteId: row.source_note_id,
        sourceBlockId: row.source_block_id,
        targetBlockId: row.target_block_id,
        title: row.title,
        path: pathOf(index, { projectId: row.project_id, folderId: row.folder_id }),
        context: clipText(block?.text ?? '', MAX_REF_CONTEXT),
      };
    });
  }
}

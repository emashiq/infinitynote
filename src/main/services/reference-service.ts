import {
  MAX_PICK_BLOCKS,
  MAX_REF_CONTEXT,
  MAX_REF_ROWS,
  type BacklinkType,
  type DocumentBacklinksResponseType,
  type NotesPickResponseType,
  type OutgoingDocRefType,
  type OutgoingRefType,
  type RefTargetStateType,
  type RefsListResponseType,
} from '../../shared/contracts/references';
import { DocumentTarget, type DocumentTargetType } from '../../shared/documents/targets';
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

/** A stored document target ('' for the whole document); anything unreadable counts as the whole document. */
function parseTarget(json: string): DocumentTargetType | null {
  if (json === '') return null;
  const parsed = DocumentTarget.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

/** The text of the block holding a link, read from the source note's stored document (empty for locked notes, D-111). */
function contextOf(doc: unknown, blockId: string | null): string {
  const block = blockId ? textBlocksOf(doc).find((b) => b.id === blockId) : undefined;
  return clipText(block?.text ?? '', MAX_REF_CONTEXT);
}

/** Parses each note's stored document once per request. */
function docCache(): (noteId: string, json: string | null) => unknown {
  const docs = new Map<string, unknown>();
  return (noteId, json) => {
    if (!docs.has(noteId)) docs.set(noteId, parseDoc(json));
    return docs.get(noteId);
  };
}

/** Outgoing references, backlinks and the block list of the reference picker (INF-REF-01..06, D-098, D-156). */
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
    return { outgoing: this.outgoing(noteId, index), documents: this.documentLinks(noteId, index), backlinks: this.backlinks(noteId, index) };
  }

  /** Live notes linking to a document (D-156). */
  documentBacklinks(documentId: string): DocumentBacklinksResponseType {
    const index = livePathIndex(this.hierarchy);
    const docOf = docCache();
    return {
      backlinks: this.refs.documentBacklinks(documentId, MAX_REF_ROWS).map((row) => ({
        sourceNoteId: row.source_note_id,
        sourceBlockId: row.source_block_id,
        target: parseTarget(row.target_json),
        title: row.title,
        path: pathOf(index, { projectId: row.project_id, folderId: row.folder_id }),
        context: contextOf(docOf(row.source_note_id, row.content_json), row.source_block_id),
      })),
    };
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

  private documentLinks(noteId: string, index: PathIndex): OutgoingDocRefType[] {
    return this.refs.documentOutgoing(noteId, MAX_REF_ROWS).map((row) => {
      const state = !row.present ? 'missing' : row.deleted_at !== null ? 'trashed' : 'ok';
      return {
        targetDocumentId: row.target_document_id,
        target: parseTarget(row.target_json),
        title: row.title ?? row.target_title_snapshot,
        kind: row.kind,
        path: state === 'ok' ? pathOf(index, { projectId: row.project_id, folderId: row.folder_id }) : [],
        state,
        trashBatchId: state === 'trashed' ? row.trash_batch_id : null,
      };
    });
  }

  private backlinks(noteId: string, index: PathIndex): BacklinkType[] {
    const docOf = docCache();
    return this.refs.backlinks(noteId, MAX_REF_ROWS).map((row) => ({
      sourceNoteId: row.source_note_id,
      sourceBlockId: row.source_block_id,
      targetBlockId: row.target_block_id,
      title: row.title,
      path: pathOf(index, { projectId: row.project_id, folderId: row.folder_id }),
      context: contextOf(docOf(row.source_note_id, row.content_json), row.source_block_id),
    }));
  }
}

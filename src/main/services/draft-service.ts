import {
  MAX_DRAFT_PREVIEW_CHARS,
  MAX_LISTED_DRAFTS,
  type DraftsListResponseType,
  type DraftsResolveRequestType,
  type DraftsResolveResponseType,
} from '../../shared/contracts/notes';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
import { DraftsRepo, type DraftRow } from '../db/repositories/drafts-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import type { NoteVault } from '../locks/note-vault';
import { AppError } from './app-error';
import type { Clock } from './clock';
import type { ContentOps } from './content-ops';
import { MSG } from './messages';
import { normalizeContent } from './note-content';
import type { VersionService } from './version-service';

const DRAFT_GONE = 'That recovered draft no longer exists.';

/** Recovered drafts (edits main refused to apply): list, restore over the current content, dismiss. */
export class DraftService {
  private readonly drafts: DraftsRepo;
  private readonly notes: NotesRepo;

  constructor(private readonly deps: { db: Db; clock: Clock; ops: ContentOps; versions: VersionService; vault: NoteVault }) {
    this.drafts = new DraftsRepo(deps.db);
    this.notes = new NotesRepo(deps.db);
  }

  list(noteId: string): DraftsListResponseType {
    if (!this.notes.getContentRow(noteId)) throw new AppError('NOT_FOUND', MSG.missing);
    return { drafts: this.drafts.listOpen(noteId, MAX_LISTED_DRAFTS).map((d) => summarize(d, this.textOf(d))) };
  }

  resolve(req: DraftsResolveRequestType): DraftsResolveResponseType {
    if (req.action === 'dismiss') {
      if (!this.drafts.getOpen(req.noteId, req.draftId)) throw new AppError('NOT_FOUND', DRAFT_GONE);
      this.drafts.resolve(req.draftId, this.deps.clock.now());
      return { resolved: true, content: null };
    }
    // Restore: the current content becomes a `conflict` version, then the draft is written as the next revision.
    // A draft that no longer passes the schema fails with VALIDATION_FAILED and stays unresolved.
    const content = this.deps.ops.run(req, (row, now) => {
      const draft = this.drafts.getOpen(req.noteId, req.draftId);
      if (!draft) throw new AppError('NOT_FOUND', DRAFT_GONE);
      const value = normalizeContent(draft.format, parseDraft(draft.format, this.textOf(draft)));
      const versionId = this.deps.versions.snapshot(row, 'conflict', now);
      this.drafts.resolve(draft.id, now);
      return { format: draft.format, content: value, title: draft.title, versionId };
    });
    return { resolved: true, content };
  }

  /** The draft's text; a draft of a locked note is sealed and opens only while the note is unlocked (D-111). */
  private textOf(draft: DraftRow): string {
    return this.deps.vault.openDraft(draft.note_id, draft.content);
  }
}

function parseDraft(format: 'rich' | 'plain', text: string): unknown {
  if (format === 'plain') return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarize(d: DraftRow, content: string) {
  const text = extractPlainText(d.format, parseDraft(d.format, content));
  return {
    id: d.id,
    reason: d.reason,
    baseRevision: d.base_revision,
    format: d.format,
    title: d.title,
    createdAt: d.created_at,
    plainText: text.slice(0, MAX_DRAFT_PREVIEW_CHARS),
    truncated: text.length > MAX_DRAFT_PREVIEW_CHARS,
  };
}

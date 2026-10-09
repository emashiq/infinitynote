import { collectAttachmentRefs, collectLinkIds, collectNoteRefs, type AttachmentRef } from '../../shared/editor/doc-schema';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { ReferencesRepo, type ReferenceInput } from '../db/repositories/references-repo';
import type { Logger } from './logger';
import type { ReminderAnchors } from './reminder-anchors';

/**
 * Derives the searchable text, the attachment links, the linked files and the note references of note content. Runs inside the
 * caller's transaction, so the text, the links, the references, the reminder anchors and the note row commit together
 * or not at all (INF-SAVE-02, D-080, D-098).
 */
export class ContentIndexer {
  private readonly attachments: AttachmentsRepo;
  private readonly references: ReferencesRepo;
  private readonly links: LinkedFilesRepo;

  constructor(
    db: Db,
    private readonly logger: Logger,
    private readonly anchors?: ReminderAnchors,
  ) {
    this.attachments = new AttachmentsRepo(db);
    this.references = new ReferencesRepo(db);
    this.links = new LinkedFilesRepo(db);
  }

  index(noteId: string, format: 'rich' | 'plain', content: unknown, now: number): { plainText: string; attachmentIds: string[] } {
    const plainText = extractPlainText(format, content);
    this.anchors?.sync(noteId, format, content, plainText);
    this.indexReferences(noteId, format, content);
    this.indexLinks(noteId, format, content, now);
    const refs = format === 'rich' ? uniqueRefs(collectAttachmentRefs(content)) : [];
    const known = this.attachments.existingIds(refs.map((r) => r.attachmentId));
    const kept = refs.filter((r) => known.has(r.attachmentId));
    // An unknown id keeps its node (the view shows "Image unavailable") but gets no link row.
    if (kept.length < refs.length) this.logger.warn(`indexer: ${refs.length - kept.length} unknown attachment reference(s) in note ${noteId}`);

    const before = this.attachments.linkedIds(noteId);
    this.attachments.replaceLinks(noteId, kept);
    const attachmentIds = [...new Set(kept.map((r) => r.attachmentId))];
    this.attachments.markReferenced(attachmentIds);
    this.attachments.markUnreferencedIfOrphaned(
      before.filter((id) => !attachmentIds.includes(id)),
      now,
    );
    return { plainText, attachmentIds };
  }

  /** Linked files (D-108): an unknown link ID keeps its chip (shown as missing) but is not recorded. */
  private indexLinks(noteId: string, format: 'rich' | 'plain', content: unknown, now: number): void {
    const ids = format === 'rich' ? collectLinkIds(content) : [];
    const known = this.links.existingIds(ids);
    if (known.size < ids.length) this.logger.warn(`indexer: ${ids.length - known.size} unknown linked file(s) in note ${noteId}`);
    this.links.replaceForNote(
      noteId,
      ids.filter((id) => known.has(id)),
      now,
    );
  }

  /** Plain-text notes hold no reference nodes; they can only be note-level targets (ARCHITECTURE section 12). */
  private indexReferences(noteId: string, format: 'rich' | 'plain', content: unknown): void {
    const links = format === 'rich' ? collectNoteRefs(content) : [];
    const titles = this.references.titles([...new Set(links.map((l) => l.targetNoteId))]);
    const refs: ReferenceInput[] = links.map((l) => ({
      sourceBlockId: l.sourceBlockId,
      targetNoteId: l.targetNoteId,
      targetBlockId: l.targetBlockId,
      titleSnapshot: titles.get(l.targetNoteId) ?? l.label,
    }));
    this.references.replaceForSource(noteId, refs);
  }
}

function uniqueRefs(refs: AttachmentRef[]): AttachmentRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.attachmentId}|${r.blockId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

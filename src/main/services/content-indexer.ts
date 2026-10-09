import { collectAttachmentRefs, type AttachmentRef } from '../../shared/editor/doc-schema';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import type { Logger } from './logger';
import type { ReminderAnchors } from './reminder-anchors';

/**
 * Derives the searchable text and the attachment links of note content. Runs inside the caller's transaction,
 * so the text, the links, the reminder anchors and the note row commit together or not at all (INF-SAVE-02, D-080).
 * Phase 07 adds note references here.
 */
export class ContentIndexer {
  private readonly attachments: AttachmentsRepo;

  constructor(
    db: Db,
    private readonly logger: Logger,
    private readonly anchors?: ReminderAnchors,
  ) {
    this.attachments = new AttachmentsRepo(db);
  }

  index(noteId: string, format: 'rich' | 'plain', content: unknown, now: number): { plainText: string; attachmentIds: string[] } {
    const plainText = extractPlainText(format, content);
    this.anchors?.sync(noteId, format, content, plainText);
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

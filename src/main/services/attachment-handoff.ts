import { HANDOFF_MESSAGES } from '../../shared/contracts/attachments';
import { extensionFor, isOpenableExtension } from '../../shared/attachments/names';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { AppError, errorMessage } from './app-error';
import { containedAttachmentFile } from './attachment-files';
import type { Logger } from './logger';
import type { ShellAdapter } from './shell-adapter';

/**
 * Hands a note's attached file to the OS (INF-REF-08): the note must link the file, the path always comes from the
 * stored row and must stay inside the attachments directory, and only known document and image types are opened.
 * Programs, scripts and unknown types are never launched; Show in folder only selects the file.
 */
export class AttachmentHandoff {
  private readonly repo: AttachmentsRepo;

  constructor(
    db: Db,
    private readonly deps: { dataDir: string; shell: ShellAdapter; logger: Logger },
  ) {
    this.repo = new AttachmentsRepo(db);
  }

  async open(noteId: string, attachmentId: string): Promise<{ opened: true }> {
    const { file, ext } = await this.resolve(noteId, attachmentId);
    if (!isOpenableExtension(ext)) {
      this.deps.logger.warn(`handoff: blocked type .${ext} id=${attachmentId}`);
      throw new AppError('FORBIDDEN', HANDOFF_MESSAGES.blocked);
    }
    const error = await this.deps.shell.openPath(file);
    if (error) {
      this.deps.logger.warn(`handoff: open failed id=${attachmentId}: ${error}`);
      throw new AppError('UNSUPPORTED', HANDOFF_MESSAGES.failed);
    }
    return { opened: true };
  }

  async showInFolder(noteId: string, attachmentId: string): Promise<{ shown: true }> {
    const { file } = await this.resolve(noteId, attachmentId);
    this.deps.shell.showItemInFolder(file);
    return { shown: true };
  }

  private async resolve(noteId: string, attachmentId: string): Promise<{ file: string; ext: string }> {
    const row = this.repo.isLinked(noteId, attachmentId) ? this.repo.get(attachmentId) : undefined;
    if (!row) throw new AppError('NOT_FOUND', HANDOFF_MESSAGES.missing);
    let file: string | null;
    try {
      file = await containedAttachmentFile(this.deps.dataDir, row.managed_relative_path);
    } catch (err) {
      this.deps.logger.warn(`handoff: file unavailable id=${attachmentId}: ${errorMessage(err)}`);
      throw new AppError('NOT_FOUND', HANDOFF_MESSAGES.missing);
    }
    if (!file) {
      this.deps.logger.warn(`handoff: containment violation id=${attachmentId}`);
      throw new AppError('FORBIDDEN', HANDOFF_MESSAGES.missing);
    }
    return { file, ext: extensionFor(row.managed_relative_path) };
  }
}

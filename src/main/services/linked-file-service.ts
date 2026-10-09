import fs from 'node:fs';
import { sanitizeOriginalName } from '../../shared/attachments/names';
import {
  HANDOFF_MESSAGES,
  LINK_MESSAGES,
  type AttachmentDtoType,
  type FileLinkDtoType,
  type FileLinkStatusType,
} from '../../shared/contracts/attachments';
import type { Db } from '../db/driver';
import { LinkedFilesRepo, type LinkedFileRow } from '../db/repositories/linked-files-repo';
import { AppError } from './app-error';
import type { AttachmentService } from './attachment-service';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';
import { inspectLinkedFile, isNetworkPath, isUsableLinkPath, type LinkedFileCheck } from './linked-file';
import type { Logger } from './logger';
import type { ShellAdapter } from './shell-adapter';

export interface LinkedFileServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  shell: ShellAdapter;
  attachments: Pick<AttachmentService, 'importFile'>;
  platform?: NodeJS.Platform;
}

/**
 * Files linked at their original location (D-108). The path is checked when the link is made and again each time it is
 * used: the renderer only ever names a link ID, and Open, Show in folder and Copy into Infinity Notes need a note that
 * uses the link. Only known document and image types are opened; anything else is only shown in its folder.
 */
export class LinkedFileService {
  private readonly repo: LinkedFilesRepo;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly deps: LinkedFileServiceDeps) {
    this.repo = new LinkedFilesRepo(deps.db);
    this.platform = deps.platform ?? process.platform;
  }

  /** Records a link to a local file that exists now; nothing is copied. A network location is refused untouched (D-115). */
  async create(file: string): Promise<FileLinkDtoType> {
    if (this.platform === 'win32' && isNetworkPath(file)) throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.networkLocation);
    if (!isUsableLinkPath(file, this.platform)) throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.notFound(file));
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      throw new AppError('NOT_FOUND', LINK_MESSAGES.notFound(file));
    }
    if (!stat.isFile()) throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.notAFile);
    const link = { id: this.deps.ids.uuid(), name: sanitizeOriginalName(file) ?? 'file', sizeBytes: stat.size, path: file };
    this.repo.insert({ ...link, now: this.deps.clock.now() });
    return link;
  }

  /** Where a link points and whether the file is there; an unknown link is missing. */
  async status(linkId: string): Promise<FileLinkStatusType> {
    const row = this.repo.get(linkId);
    if (!row) return { path: null, sizeBytes: null, state: 'missing' };
    const check = await inspectLinkedFile(row.path, this.platform);
    return { path: row.path, sizeBytes: check.sizeBytes, state: check.state };
  }

  async open(noteId: string, linkId: string): Promise<{ opened: true }> {
    const { check } = await this.resolve(noteId, linkId);
    if (check.state !== 'available' || !check.real) {
      this.deps.logger.warn(`link: blocked type id=${linkId}`);
      throw new AppError('FORBIDDEN', HANDOFF_MESSAGES.blocked);
    }
    const error = await this.deps.shell.openPath(check.real);
    if (error) {
      this.deps.logger.warn(`link: open failed id=${linkId}: ${error}`);
      throw new AppError('UNSUPPORTED', HANDOFF_MESSAGES.failed);
    }
    return { opened: true };
  }

  async showInFolder(noteId: string, linkId: string): Promise<{ shown: true }> {
    const { row } = await this.resolve(noteId, linkId);
    this.deps.shell.showItemInFolder(row.path);
    return { shown: true };
  }

  /** Copies the linked file into Infinity Notes (the copy limit applies); the caller replaces the chip. */
  async copyIn(noteId: string, linkId: string): Promise<{ attachment: AttachmentDtoType }> {
    const { row } = await this.resolve(noteId, linkId);
    return { attachment: await this.deps.attachments.importFile('document', row.path) };
  }

  private async resolve(noteId: string, linkId: string): Promise<{ row: LinkedFileRow; check: LinkedFileCheck }> {
    const row = this.repo.isUsedBy(noteId, linkId) ? this.repo.get(linkId) : undefined;
    if (!row) throw new AppError('NOT_FOUND', LINK_MESSAGES.unavailable);
    const check = await inspectLinkedFile(row.path, this.platform);
    if (check.state === 'missing') throw new AppError('NOT_FOUND', LINK_MESSAGES.notFound(row.path));
    return { row, check };
  }
}

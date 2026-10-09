import fs from 'node:fs';
import { importFailedMessage, MAX_FILES_PER_ACTION } from '../../shared/attachments/limits';
import { sanitizeOriginalName } from '../../shared/attachments/names';
import {
  LINK_MESSAGES,
  type AddedFileType,
  type AttachmentKindType,
  type PickFilesResponseType,
  type RejectedFileType,
} from '../../shared/contracts/attachments';
import { AppError } from './app-error';
import type { AttachmentService } from './attachment-service';
import type { DialogAdapter } from './dialog-adapter';
import type { IdGenerator } from './ids';
import type { LinkedFileService } from './linked-file-service';

interface PickSession {
  pickId: string;
  kind: AttachmentKindType;
  files: Array<{ path: string; added: boolean }>;
}

export interface FilePickerDeps {
  dialog: Pick<DialogAdapter, 'showOpenFiles'>;
  ids: IdGenerator;
  attachments: Pick<AttachmentService, 'importFile'>;
  links: Pick<LinkedFileService, 'create'>;
}

/**
 * The native file picker (D-108). The chosen paths stay in main: the renderer gets names and sizes, decides per file
 * (copy or link, the user's choice and the 25 MB rule) and adds each file once by its index. Each window has at most
 * one pick; a new pick replaces it.
 */
export class FilePicker {
  private readonly sessions = new Map<number, PickSession>();

  constructor(private readonly deps: FilePickerDeps) {}

  async pick(kind: AttachmentKindType, ctx: { webContentsId: number }): Promise<PickFilesResponseType> {
    this.sessions.delete(ctx.webContentsId);
    const paths = await this.deps.dialog.showOpenFiles({ webContentsId: ctx.webContentsId, kind });
    if (paths === null) return { canceled: true, pickId: null, files: [], truncated: false, rejected: [] };
    const files: PickFilesResponseType['files'] = [];
    const kept: PickSession['files'] = [];
    const rejected: RejectedFileType[] = [];
    for (const file of paths.slice(0, MAX_FILES_PER_ACTION)) {
      const name = sanitizeOriginalName(file) ?? 'file';
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) {
        rejected.push({ name, code: 'NOT_FOUND', message: importFailedMessage(kind) });
        continue;
      }
      kept.push({ path: file, added: false });
      files.push({ name, sizeBytes: stat.size });
    }
    const pickId = this.deps.ids.uuid();
    if (kept.length > 0) this.sessions.set(ctx.webContentsId, { pickId, kind, files: kept });
    return { canceled: false, pickId, files, truncated: paths.length > MAX_FILES_PER_ACTION, rejected };
  }

  /** Copies or links one picked file; images are always copied. */
  async add(req: { pickId: string; index: number; action: 'copy' | 'link' }, ctx: { webContentsId: number }): Promise<AddedFileType> {
    const session = this.sessions.get(ctx.webContentsId);
    const file = session?.pickId === req.pickId ? session.files[req.index] : undefined;
    if (!session || !file || file.added) throw new AppError('NOT_FOUND', importFailedMessage(session?.kind ?? 'document'));
    file.added = true;
    if (session.files.every((f) => f.added)) this.sessions.delete(ctx.webContentsId);
    if (req.action === 'link') {
      if (session.kind === 'image') throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.imageNotLinked);
      return { type: 'link', link: await this.deps.links.create(file.path) };
    }
    return { type: 'attachment', attachment: await this.deps.attachments.importFile(session.kind, file.path) };
  }
}

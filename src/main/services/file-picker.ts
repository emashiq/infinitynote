import fs from 'node:fs';
import { importFailedMessage, MAX_FILES_PER_ACTION } from '../../shared/attachments/limits';
import { sanitizeOriginalName } from '../../shared/attachments/names';
import { DOCUMENT_EXTENSIONS, documentKindOf } from '../../shared/documents/kinds';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import {
  LINK_MESSAGES,
  type AddedFileType,
  type AttachmentKindType,
  type PickFilesResponseType,
  type RejectedFileType,
} from '../../shared/contracts/attachments';
import { AppError } from './app-error';
import type { AttachmentService } from './attachment-service';
import type { DialogAdapter, OpenFilesRequest } from './dialog-adapter';
import type { IdGenerator } from './ids';
import type { LinkedFileService } from './linked-file-service';

const DOCUMENT_FILTER = { name: 'Documents', extensions: [...DOCUMENT_EXTENSIONS] };

/** Files picked for a note, or to import as documents; each kind of pick is added only by its own channel. */
type PickPurpose = 'attachments' | 'documents';

interface PickSession {
  pickId: string;
  purpose: PickPurpose;
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

  pick(kind: AttachmentKindType, ctx: { webContentsId: number }): Promise<PickFilesResponseType> {
    return this.choose({ webContentsId: ctx.webContentsId, kind }, 'attachments', () => null);
  }

  /** Files to import as documents (D-118): the picker shows the document types, and any other file is refused by name. */
  pickDocuments(ctx: { webContentsId: number }): Promise<PickFilesResponseType> {
    return this.choose({ webContentsId: ctx.webContentsId, kind: 'document', filter: DOCUMENT_FILTER }, 'documents', (name) =>
      documentKindOf(name) === null ? DOCUMENT_MESSAGES.unsupported : null,
    );
  }

  private async choose(request: OpenFilesRequest, purpose: PickPurpose, refuse: (name: string) => string | null): Promise<PickFilesResponseType> {
    const { webContentsId, kind } = request;
    this.sessions.delete(webContentsId);
    const paths = await this.deps.dialog.showOpenFiles(request);
    if (paths === null) return { canceled: true, pickId: null, files: [], truncated: false, rejected: [] };
    const files: PickFilesResponseType['files'] = [];
    const kept: PickSession['files'] = [];
    const rejected: RejectedFileType[] = [];
    for (const file of paths.slice(0, MAX_FILES_PER_ACTION)) {
      const name = sanitizeOriginalName(file) ?? 'file';
      const refusal = refuse(name);
      if (refusal) {
        rejected.push({ name, code: 'UNSUPPORTED', message: refusal });
        continue;
      }
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) {
        rejected.push({ name, code: 'NOT_FOUND', message: importFailedMessage(kind) });
        continue;
      }
      kept.push({ path: file, added: false });
      files.push({ name, sizeBytes: stat.size });
    }
    const pickId = this.deps.ids.uuid();
    if (kept.length > 0) this.sessions.set(webContentsId, { pickId, purpose, kind, files: kept });
    return { canceled: false, pickId, files, truncated: paths.length > MAX_FILES_PER_ACTION, rejected };
  }

  /** Hands one picked file's path to main code that adds it, once; the kind is the one it was picked as. */
  claim(req: { pickId: string; index: number }, purpose: PickPurpose, ctx: { webContentsId: number }): { path: string; kind: AttachmentKindType } {
    const session = this.sessions.get(ctx.webContentsId);
    const file = session?.pickId === req.pickId && session.purpose === purpose ? session.files[req.index] : undefined;
    if (!session || !file || file.added) throw new AppError('NOT_FOUND', importFailedMessage(session?.kind ?? 'document'));
    file.added = true;
    if (session.files.every((f) => f.added)) this.sessions.delete(ctx.webContentsId);
    return { path: file.path, kind: session.kind };
  }

  /** Copies or links one picked file; images are always copied. */
  async add(req: { pickId: string; index: number; action: 'copy' | 'link' }, ctx: { webContentsId: number }): Promise<AddedFileType> {
    const { path, kind } = this.claim(req, 'attachments', ctx);
    if (req.action === 'link') {
      if (kind === 'image') throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.imageNotLinked);
      return { type: 'link', link: await this.deps.links.create(path) };
    }
    return { type: 'attachment', attachment: await this.deps.attachments.importFile(kind, path) };
  }
}

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_MESSAGES, importFailedMessage, maxBytes, tooLargeMessage } from '../../shared/attachments/limits';
import { documentMime, extensionFor, sanitizeOriginalName } from '../../shared/attachments/names';
import { sniffImage } from '../../shared/attachments/sniff';
import type { AttachmentDtoType, AttachmentImportBytesRequestType, AttachmentKindType } from '../../shared/contracts/attachments';
import type { Db } from '../db/driver';
import { AttachmentsRepo, type AttachmentRow } from '../db/repositories/attachments-repo';
import { AppError, errorDetail } from './app-error';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';
import { STALE_TMP_MAX_AGE_MS } from './retention-policy';
import type { SettingsService } from './settings-service';
import { moveIntoPlace, sweepStaleFiles, writeNewFileDurably } from './stored-files';


export interface AttachmentServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  settings: SettingsService;
  /** `<userData>/data`; managed files live under `attachments/` inside it. */
  dataDir: string;
  /** Test-only delay before an import starts (E2E hooks), to make the "Adding image…" state observable. */
  beforeImport?: () => Promise<void>;
}

interface Inspected {
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
}

/**
 * Managed attachment copies (D-054): checks the configured size limit and the image magic number, stores the
 * bytes once per SHA-256 (temp file, fsync, atomic rename) and registers the row in a transaction.
 */
export class AttachmentService {
  private readonly repo: AttachmentsRepo;
  private readonly tmpDir: string;

  constructor(private readonly deps: AttachmentServiceDeps) {
    this.repo = new AttachmentsRepo(deps.db);
    this.tmpDir = path.join(deps.dataDir, 'attachments', 'tmp');
  }

  private limitMb(kind: AttachmentKindType): number {
    return this.deps.settings.getInternal(kind === 'image' ? 'attachments.imageMaxMb' : 'attachments.documentMaxMb');
  }

  private inspect(kind: AttachmentKindType, bytes: Uint8Array, name: string | null): Inspected {
    if (kind === 'document') {
      const ext = extensionFor(name);
      return { mime: documentMime(ext), ext, width: null, height: null };
    }
    const sniffed = sniffImage(bytes);
    if (!sniffed.ok) {
      throw new AppError('UNSUPPORTED', sniffed.reason === 'tooManyPixels' ? ATTACHMENT_MESSAGES.tooManyPixels : ATTACHMENT_MESSAGES.unsupportedImage);
    }
    return { mime: sniffed.mime, ext: sniffed.ext, width: sniffed.width, height: sniffed.height };
  }

  async importBytes(req: AttachmentImportBytesRequestType): Promise<{ attachment: AttachmentDtoType }> {
    await this.deps.beforeImport?.();
    const limit = this.limitMb(req.kind);
    if (req.bytes.byteLength > maxBytes(limit)) throw new AppError('LIMIT_EXCEEDED', tooLargeMessage(req.kind, limit));
    return { attachment: await this.store(req.kind, req.bytes, req.originalName ?? null) };
  }

  /**
   * Stores an attachment from a portable import (INF-PORT-04). The archive is already bounded and hash-checked, so the
   * user's size limits do not apply; images are still sniffed, and identical bytes reuse the stored row.
   */
  async importArchived(kind: AttachmentKindType, bytes: Uint8Array, originalName: string | null): Promise<AttachmentDtoType> {
    return this.store(kind, bytes, originalName);
  }

  private async store(kind: AttachmentKindType, bytes: Uint8Array, originalName: string | null): Promise<AttachmentDtoType> {
    const name = originalName === null ? null : sanitizeOriginalName(originalName);
    const info = this.inspect(kind, bytes, name);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const existing = this.repo.findBySha(sha256);
    if (existing) return this.reuse(existing, kind, info);

    const id = this.deps.ids.uuid();
    const relativePath = `attachments/${id.slice(0, 2)}/${id}.${info.ext}`;
    const finalPath = path.join(this.deps.dataDir, relativePath);
    await this.writeFile(id, finalPath, bytes, kind);
    try {
      this.deps.db.transaction(
        () =>
          this.repo.insert({ id, relativePath, sha256, mime: info.mime, sizeBytes: bytes.byteLength, originalName: name, kind, now: this.deps.clock.now() }),
        'immediate',
      );
    } catch (err) {
      await fs.promises.rm(finalPath, { force: true });
      // Another import of the same bytes won the race: use its row.
      const winner = this.repo.findBySha(sha256);
      if (winner) return this.reuse(winner, kind, info);
      this.deps.logger.error(`attachment: register failed ${errorDetail(err)}`);
      throw new AppError('INTERNAL', importFailedMessage(kind));
    }
    return { id, kind, mime: info.mime, sizeBytes: bytes.byteLength, originalName: name, width: info.width, height: info.height };
  }

  /** Identical bytes reuse the stored row; valid image bytes stored earlier as a document become an image. */
  private reuse(row: AttachmentRow, kind: AttachmentKindType, info: Inspected): AttachmentDtoType {
    let current = row;
    if (row.kind === 'document' && kind === 'image') {
      this.repo.promoteToImage(row.id, info.mime);
      current = { ...row, kind: 'image', mime: info.mime };
    }
    const dims = current.kind === 'image' && kind === 'image' ? info : { width: null, height: null };
    return {
      id: current.id,
      kind: current.kind,
      mime: current.mime,
      sizeBytes: current.size_bytes,
      originalName: current.original_name,
      width: dims.width,
      height: dims.height,
    };
  }

  private async writeFile(id: string, finalPath: string, bytes: Uint8Array, kind: AttachmentKindType): Promise<void> {
    const partPath = path.join(this.tmpDir, `${id}.part`);
    try {
      await writeNewFileDurably(partPath, bytes);
      await moveIntoPlace(partPath, finalPath);
    } catch (err) {
      await fs.promises.rm(partPath, { force: true });
      await fs.promises.rm(finalPath, { force: true });
      this.deps.logger.error(`attachment: write failed ${errorDetail(err)}`);
      throw new AppError('INTERNAL', importFailedMessage(kind));
    }
  }

  /**
   * Copies a file on disk that main chose (a picked file, or a linked file copied in later; D-108) with the same limits
   * as bytes from the renderer. A file that cannot be read is reported as one that could not be added.
   */
  async importFile(kind: AttachmentKindType, file: string): Promise<AttachmentDtoType> {
    let real: string;
    let stat: fs.Stats;
    try {
      real = await fs.promises.realpath(file);
      stat = await fs.promises.stat(real);
    } catch (err) {
      this.deps.logger.warn(`attachment: file unreadable ${errorDetail(err)}`);
      throw new AppError('NOT_FOUND', importFailedMessage(kind));
    }
    if (!stat.isFile()) throw new AppError('VALIDATION_FAILED', importFailedMessage(kind));
    const limit = this.limitMb(kind);
    // Checked before reading, so an oversized file is never loaded into memory.
    if (stat.size > maxBytes(limit)) throw new AppError('LIMIT_EXCEEDED', tooLargeMessage(kind, limit));
    const bytes = await fs.promises.readFile(real);
    const { attachment } = await this.importBytes({ kind, originalName: path.basename(file), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
    return attachment;
  }

  /** Removes leftovers of interrupted imports (older than one hour) at startup. */
  sweepTmp(now: number): Promise<number> {
    return sweepStaleFiles(this.tmpDir, now, STALE_TMP_MAX_AGE_MS, this.deps.logger, 'attachment');
  }
}

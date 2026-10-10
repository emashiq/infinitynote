import { z } from 'zod';
import { ARCHIVE_FORMAT_VERSION, BACKUP_FORMAT, PORTABILITY_MESSAGES } from '../../shared/contracts/portability';
import { Uuid } from '../../shared/contracts/ids';
import { AppError } from '../services/app-error';

/** The database inside a backup: an online-backup snapshot (`db.backup()`), so committed WAL content is included. */
export const BACKUP_DB_ENTRY = 'db/infinity-notes.sqlite3';
export const MANIFEST_ENTRY = 'manifest.json';
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Size = z.number().int().nonnegative();
/** The managed relative paths of an attachment and a document blob (the GLOBs their tables enforce). */
const AttachmentPath = z.string().regex(/^attachments\/[0-9a-f]{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/);
const DocumentPath = z.string().regex(/^documents\/[0-9a-f]{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/);
const StoredFile = (pathSchema: z.ZodString) => z.strictObject({ id: Uuid, path: pathSchema, sha256: Sha256, size: Size });

export const BackupManifest = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int().min(1).max(ARCHIVE_FORMAT_VERSION),
  appVersion: z.string().min(1).max(50),
  schemaVersion: z.number().int().min(1),
  createdAt: z.number().int(),
  notes: Size,
  db: z.strictObject({ path: z.literal(BACKUP_DB_ENTRY), sha256: Sha256, size: Size }),
  attachments: z.array(StoredFile(AttachmentPath)).max(200_000),
  /** Stored document bytes (format 2, D-118); format 1 backups have none. */
  documents: z.array(StoredFile(DocumentPath)).max(200_000).default([]),
  /** Attachment and document blob rows whose file was already missing when the backup was made. */
  missing: z.array(Uuid).max(200_000),
});
export type BackupManifestType = z.infer<typeof BackupManifest>;

/**
 * Parses a manifest. The format and its version are checked first, so a newer archive reads "made by a newer version"
 * and anything else "not a backup"; a newer database schema is refused by the caller, which knows the app's schema.
 */
export function parseBackupManifest(bytes: Buffer): BackupManifestType {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
  }
  const head = z.looseObject({ format: z.literal(BACKUP_FORMAT), formatVersion: z.number().int() }).safeParse(raw);
  if (!head.success) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
  if (head.data.formatVersion > ARCHIVE_FORMAT_VERSION) throw new AppError('UNSUPPORTED', PORTABILITY_MESSAGES.newerFormat);
  const manifest = BackupManifest.safeParse(raw);
  if (!manifest.success) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
  const files = storedFiles(manifest.data);
  const paths = new Set(files.map((a) => a.path));
  const named = files.every((a) => a.path.startsWith(`${a.path.split('/')[0]}/${a.id.slice(0, 2)}/${a.id}.`));
  if (!named || paths.size !== files.length) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.unsafe);
  return manifest.data;
}

/** Every stored file a backup carries: attachments, then document blobs. */
export function storedFiles(manifest: Pick<BackupManifestType, 'attachments' | 'documents'>): BackupManifestType['attachments'] {
  return [...manifest.attachments, ...manifest.documents];
}

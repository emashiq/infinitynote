import { z } from 'zod';
import { LinkedPath } from '../../shared/contracts/attachments';
import { HexColor, NoteColor } from '../../shared/contracts/hierarchy';
import { Uuid } from '../../shared/contracts/ids';
import { ARCHIVE_FORMAT_VERSION, EXPORT_FORMAT, PORTABILITY_MESSAGES } from '../../shared/contracts/portability';
import { ReminderInput } from '../../shared/contracts/reminders';
import { MAX_TAGS_PER_NOTE, TagName } from '../../shared/contracts/tags';
import { AppError } from '../services/app-error';

/**
 * The portable export `*.infinityexport` (D-030, D-099): one `data.json` with the live projects, folders, notes (with
 * tags), reminders and the attachments the notes use, plus each attachment file, and the links to files at their original
 * location (path, name and size only; the linked files are never in it, D-108). References travel inside the rich
 * content as `noteRef` nodes and are re-indexed on import. Versions, drafts, trash, window state and settings are not
 * part of it (a backup keeps those).
 */
export const PORTABLE_DATA_ENTRY = 'data.json';
export const MAX_PORTABLE_DATA_BYTES = 512 * 1024 * 1024;
/** One attachment file read into memory on import: the largest any version stored (0.1 copied files up to 200 MB). */
export const MAX_PORTABLE_ATTACHMENT_BYTES = 200 * 1024 * 1024;

const Name = z.string().min(1).max(200);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const PORTABLE_ATTACHMENT_PATH = /^attachments\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;

export const PortableDocument = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.literal(ARCHIVE_FORMAT_VERSION),
  appVersion: z.string().min(1).max(50),
  createdAt: z.number().int(),
  projects: z.array(z.strictObject({ id: Uuid, name: Name, favorite: z.boolean() })).max(100_000),
  folders: z.array(z.strictObject({ id: Uuid, projectId: Uuid.nullable(), parentId: Uuid.nullable(), name: Name, favorite: z.boolean() })).max(200_000),
  notes: z
    .array(
      z.strictObject({
        id: Uuid,
        projectId: Uuid.nullable(),
        folderId: Uuid.nullable(),
        title: z.string().max(200),
        format: z.enum(['rich', 'plain']),
        content: z.unknown(),
        sticky: z.boolean(),
        color: NoteColor.nullable(),
        /** Added in 0.2.0; exports of 0.1 have none. */
        textColor: HexColor.nullable().optional(),
        pinned: z.boolean(),
        favorite: z.boolean(),
        tags: z.array(TagName).max(MAX_TAGS_PER_NOTE),
      }),
    )
    .max(200_000),
  reminders: z.array(ReminderInput.omit({ allowPast: true }).extend({ noteId: Uuid })).max(200_000),
  attachments: z
    .array(
      z.strictObject({
        id: Uuid,
        path: z.string().regex(PORTABLE_ATTACHMENT_PATH),
        sha256: Sha256,
        size: z.number().int().nonnegative(),
        kind: z.enum(['image', 'document']),
        originalName: z.string().max(255).nullable(),
      }),
    )
    .max(200_000),
  /** Added in 0.2.0; exports of 0.1 have none. */
  links: z
    .array(z.strictObject({ id: Uuid, path: LinkedPath, name: z.string().min(1).max(255), sizeBytes: z.number().int().nonnegative() }))
    .max(200_000)
    .optional(),
});
export type PortableDocumentType = z.infer<typeof PortableDocument>;
export type PortableNote = PortableDocumentType['notes'][number];

/** Parses `data.json`: a newer format is named as such; anything malformed is "not an export". */
export function parsePortableDocument(bytes: Buffer): PortableDocumentType {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
  }
  const head = z.looseObject({ format: z.literal(EXPORT_FORMAT), formatVersion: z.number().int() }).safeParse(raw);
  if (!head.success) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
  if (head.data.formatVersion > ARCHIVE_FORMAT_VERSION) throw new AppError('UNSUPPORTED', PORTABILITY_MESSAGES.newerFormat);
  const parsed = PortableDocument.safeParse(raw);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
  return parsed.data;
}

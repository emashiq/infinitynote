import { z } from 'zod';
import { Uuid } from './ids';

/** Backup, restore, export and import (ARCHITECTURE section 13, D-030, D-099). */
export const BACKUP_EXTENSION = 'infinitybackup';
export const EXPORT_EXTENSION = 'infinityexport';
export const BACKUP_FORMAT = 'infinity-notes-backup';
export const EXPORT_FORMAT = 'infinity-notes-export';
export const ARCHIVE_FORMAT_VERSION = 1;

export const AUTO_BACKUP_INTERVAL_DAYS = [1, 7, 14, 30] as const;
export const AUTO_BACKUP_KEEP_COUNTS = [3, 5, 10, 20] as const;
const intervalDays = z.literal(AUTO_BACKUP_INTERVAL_DAYS);
const keepCount = z.literal(AUTO_BACKUP_KEEP_COUNTS);

/** Automatic backup (INF-PORT-06): off by default; switching it on needs a folder chosen through main's dialog. */
export const AutoBackupSetting = z
  .strictObject({ enabled: z.boolean(), directory: z.string().min(1).max(4096).nullable(), intervalDays, keep: keepCount })
  .refine((a) => !a.enabled || a.directory !== null, 'Choose a folder for automatic backups first');
export type AutoBackupSettingType = z.infer<typeof AutoBackupSetting>;

export const LastAutoBackup = z
  .strictObject({ at: z.number().int(), ok: z.boolean(), file: z.string().nullable(), message: z.string().nullable() })
  .nullable();
export type LastAutoBackupType = z.infer<typeof LastAutoBackup>;

export const BackupSummary = z.strictObject({
  createdAt: z.number().int(),
  appVersion: z.string(),
  schemaVersion: z.number().int(),
  notes: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
});
export type BackupSummaryType = z.infer<typeof BackupSummary>;

const Canceled = z.strictObject({ canceled: z.literal(true) });

export const BackupCreateResponse = z.union([
  Canceled,
  z.strictObject({ canceled: z.literal(false), file: z.string(), sizeBytes: z.number().int().nonnegative(), notes: z.number().int(), attachments: z.number().int() }),
]);
export type BackupCreateResponseType = z.infer<typeof BackupCreateResponse>;

export const BackupPrepareResponse = z.union([Canceled, z.strictObject({ canceled: z.literal(false), summary: BackupSummary })]);
export type BackupPrepareResponseType = z.infer<typeof BackupPrepareResponse>;

export const BackupRestoreResponse = z.strictObject({ restarting: z.literal(true) });

export const RestoreOutcome = z.strictObject({ status: z.enum(['restored', 'failed']), message: z.string() });
export type RestoreOutcomeType = z.infer<typeof RestoreOutcome>;

export const BackupStatus = z.strictObject({
  auto: AutoBackupSetting,
  lastAuto: LastAutoBackup,
  /** Copies of the data that was replaced by a restore (`data/rollback-<stamp>`), newest first. */
  rollbackCopies: z.array(z.strictObject({ name: z.string(), createdAt: z.number().int() })),
  /** The result of a restore applied at this start, if any. */
  lastRestore: RestoreOutcome.nullable(),
});
export type BackupStatusType = z.infer<typeof BackupStatus>;

export const BackupSetAutoRequest = z.strictObject({ enabled: z.boolean(), intervalDays, keep: keepCount });

export const ExportMarkdownRequest = z.strictObject({ noteId: Uuid, format: z.enum(['markdown', 'text']) });
export const ExportMarkdownResponse = z.union([
  Canceled,
  z.strictObject({ canceled: z.literal(false), file: z.string(), attachments: z.number().int().nonnegative() }),
]);

export const PortableCounts = z.strictObject({
  projects: z.number().int().nonnegative(),
  folders: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  reminders: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
});
export type PortableCountsType = z.infer<typeof PortableCounts>;

export const ExportPortableResponse = z.union([Canceled, z.strictObject({ canceled: z.literal(false), file: z.string(), counts: PortableCounts })]);

export const ImportPortableResponse = z.union([
  Canceled,
  z.strictObject({
    canceled: z.literal(false),
    counts: PortableCounts,
    /** Reminders whose time zone this computer does not know, or beyond a note's limit. */
    skippedReminders: z.number().int().nonnegative(),
    /** The Common folder that received the archive's Common items, if it had any. */
    folderName: z.string().nullable(),
  }),
]);

/** User-facing refusals; main never names internal paths in them. */
export const PORTABILITY_MESSAGES = {
  busy: 'Another backup, restore, export or import is running. Try again when it finishes.',
  notArchive: 'This file is not an Infinity Notes backup or export.',
  unsafe: 'This file was refused because it contains unsafe or unexpected entries.',
  tooLarge: 'This file was refused because it is too large or too heavily compressed.',
  newerSchema: 'This backup was made by a newer version of Infinity Notes. Update the app to restore it.',
  newerFormat: 'This file was made by a newer version of Infinity Notes.',
  damaged: 'This backup is damaged: a file inside it does not match its checksum.',
  databaseDamaged: 'The database in this backup is damaged and cannot be restored.',
  noPrepared: 'Choose a backup to restore first.',
  writeFailed: 'The file could not be written. Choose another location.',
  noFolder: 'Choose a folder for automatic backups first',
  restoreFailed: 'The backup could not be restored. Your data was not changed.',
  restored: 'Your notebook was restored from the backup.',
  noteMissing: 'This note no longer exists',
} as const;

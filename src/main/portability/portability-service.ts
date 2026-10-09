import path from 'node:path';
import {
  BACKUP_EXTENSION,
  EXPORT_EXTENSION,
  PORTABILITY_MESSAGES,
  type BackupCreateResponseType,
  type BackupPrepareResponseType,
  type BackupStatusType,
  type RestoreOutcomeType,
} from '../../shared/contracts/portability';
import { suggestedFileName } from '../../shared/names';
import type { TreeChangedEventType } from '../../shared/contracts/hierarchy';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError, errorDetail } from '../services/app-error';
import type { AttachmentService } from '../services/attachment-service';
import type { Clock } from '../services/clock';
import type { DialogAdapter, FileFilter } from '../services/dialog-adapter';
import type { IdGenerator } from '../services/ids';
import type { Logger } from '../services/logger';
import type { NoteContent } from '../services/note-content';
import type { ReminderService } from '../services/reminder-service';
import type { SettingsService } from '../services/settings-service';
import { AutoBackup } from './auto-backup';
import { writeBackup } from './backup-writer';
import { writeNoteExport } from './note-export';
import { importPortable } from './portable-import';
import { writePortableExport } from './portable-export';
import { deleteRollbackCopies, listRollbackCopies, prepareRestore, scheduleRestore, type RestorePaths } from './restore';

const BACKUP_FILTER: FileFilter = { name: 'Infinity Notes backup', extensions: [BACKUP_EXTENSION] };
const EXPORT_FILTER: FileFilter = { name: 'Infinity Notes export', extensions: [EXPORT_EXTENSION] };
const MARKDOWN_FILTER: FileFilter = { name: 'Markdown', extensions: ['md'] };
const TEXT_FILTER: FileFilter = { name: 'Plain text', extensions: ['txt'] };

export interface PortabilityServiceDeps {
  db: Db;
  paths: RestorePaths;
  appVersion: string;
  latestSchema: number;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  settings: SettingsService;
  dialog: Pick<DialogAdapter, 'showSaveFile' | 'showOpenFile' | 'showOpenFolder'>;
  attachments: Pick<AttachmentService, 'importArchived'>;
  content: NoteContent;
  reminders: Pick<ReminderService, 'insertImported' | 'announceImported'>;
  onTreeChanged(event: TreeChangedEventType): void;
  /** Quits and starts the app again (after the usual flush), so a scheduled restore is applied. */
  restart(): void;
  /** What a restore at this start did, if one was pending. */
  restoreOutcome: RestoreOutcomeType | null;
}

type Ctx = { webContentsId: number };

/** Adds the extension a save dialog was asked for; some Linux dialogs return the typed name without it. */
function withExtension(file: string, extension: string): string {
  return path.extname(file).toLowerCase() === `.${extension}` ? file : `${file}.${extension}`;
}

/** "2026-10-09" in local time, for suggested file names. */
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Backup, restore, export and import behind native dialogs (D-099). One operation runs at a time; while one runs,
 * attachment GC waits (`isBusy`). Write failures become a plain "could not be written" message.
 */
export class PortabilityService {
  private running = false;
  private readonly auto: AutoBackup;

  constructor(private readonly deps: PortabilityServiceDeps) {
    this.auto = new AutoBackup({ settings: deps.settings, clock: deps.clock, logger: deps.logger, write: (file) => this.backupTo(file) });
  }

  isBusy(): boolean {
    return this.running;
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new AppError('CONFLICT', PORTABILITY_MESSAGES.busy);
    this.running = true;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }

  /** Runs a file-writing step; anything but a user-facing refusal becomes the generic write failure. */
  private async writing<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.deps.logger.error(`${what}: ${errorDetail(err)}`);
      throw new AppError('INTERNAL', PORTABILITY_MESSAGES.writeFailed);
    }
  }

  private backupTo(file: string) {
    const { db, paths, appVersion, clock, ids, logger } = this.deps;
    return writeBackup({ db, dataDir: paths.dataDir, appVersion, now: () => clock.now(), uuid: () => ids.uuid(), logger }, file);
  }

  async createBackup(ctx: Ctx): Promise<BackupCreateResponseType> {
    const file = await this.deps.dialog.showSaveFile({
      webContentsId: ctx.webContentsId,
      title: 'Back up Infinity Notes',
      defaultName: `Infinity Notes ${localDate(this.deps.clock.now())}.${BACKUP_EXTENSION}`,
      filters: [BACKUP_FILTER],
    });
    if (file === null) return { canceled: true };
    const target = withExtension(file, BACKUP_EXTENSION);
    const result = await this.exclusive(() => this.writing('backup', () => this.backupTo(target)));
    return { canceled: false, file: target, ...result };
  }

  async prepareRestore(ctx: Ctx): Promise<BackupPrepareResponseType> {
    const file = await this.deps.dialog.showOpenFile({ webContentsId: ctx.webContentsId, title: 'Restore from backup', filters: [BACKUP_FILTER] });
    if (file === null) return { canceled: true };
    const { paths, latestSchema, logger } = this.deps;
    const summary = await this.exclusive(() => this.writing('restore', () => prepareRestore(file, { paths, latestSchema, logger })));
    return { canceled: false, summary };
  }

  /** Schedules the prepared backup and restarts; the swap happens before the database opens (openWithPendingRestore). */
  async restore(): Promise<{ restarting: true }> {
    await this.exclusive(() => this.writing('restore', () => scheduleRestore(this.deps.paths, this.deps.clock.now())));
    this.deps.logger.info('restore: scheduled, restarting');
    setImmediate(() => this.deps.restart());
    return { restarting: true };
  }

  status(): BackupStatusType {
    return {
      auto: this.deps.settings.getInternal('backup.auto'),
      lastAuto: this.deps.settings.getInternal('backup.lastAuto'),
      rollbackCopies: listRollbackCopies(this.deps.paths.dataDir),
      lastRestore: this.deps.restoreOutcome,
    };
  }

  setAuto(req: { enabled: boolean; intervalDays: BackupStatusType['auto']['intervalDays']; keep: BackupStatusType['auto']['keep'] }): BackupStatusType {
    const current = this.deps.settings.getInternal('backup.auto');
    if (req.enabled && current.directory === null) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.noFolder);
    this.deps.settings.setInternal('backup.auto', { ...current, ...req });
    return this.status();
  }

  async chooseAutoFolder(ctx: Ctx): Promise<BackupStatusType> {
    const directory = await this.deps.dialog.showOpenFolder({ webContentsId: ctx.webContentsId, title: 'Folder for automatic backups' });
    if (directory !== null) this.deps.settings.setInternal('backup.auto', { ...this.deps.settings.getInternal('backup.auto'), directory });
    return this.status();
  }

  async deleteRollback(): Promise<BackupStatusType> {
    await this.writing('rollback', () => deleteRollbackCopies(this.deps.paths.dataDir));
    return this.status();
  }

  /** Runs the automatic backup when it is due and nothing else is running. */
  async runAutoBackup(): Promise<void> {
    if (this.running || !this.auto.isDue(this.deps.clock.now())) return;
    await this.exclusive(() => this.auto.runIfDue());
  }

  async exportNote(req: { noteId: string; format: 'markdown' | 'text' }, ctx: Ctx) {
    const row = new NotesRepo(this.deps.db).getContentRow(req.noteId);
    if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND', PORTABILITY_MESSAGES.noteMissing);
    const markdown = req.format === 'markdown';
    const file = await this.deps.dialog.showSaveFile({
      webContentsId: ctx.webContentsId,
      title: markdown ? 'Export note as Markdown' : 'Export note as plain text',
      defaultName: `${suggestedFileName(row.title)}.${markdown ? 'md' : 'txt'}`,
      filters: [markdown ? MARKDOWN_FILTER : TEXT_FILTER],
    });
    if (file === null) return { canceled: true as const };
    const target = withExtension(file, markdown ? 'md' : 'txt');
    const { db, paths, logger } = this.deps;
    const result = await this.exclusive(() => this.writing('export', () => writeNoteExport({ db, dataDir: paths.dataDir, logger }, req.noteId, req.format, target)));
    return { canceled: false as const, file: target, ...result };
  }

  async exportPortable(ctx: Ctx) {
    const file = await this.deps.dialog.showSaveFile({
      webContentsId: ctx.webContentsId,
      title: 'Export all notes',
      defaultName: `Infinity Notes export ${localDate(this.deps.clock.now())}.${EXPORT_EXTENSION}`,
      filters: [EXPORT_FILTER],
    });
    if (file === null) return { canceled: true as const };
    const target = withExtension(file, EXPORT_EXTENSION);
    const { db, paths, appVersion, clock, logger } = this.deps;
    const counts = await this.exclusive(() =>
      this.writing('export', () => writePortableExport({ db, dataDir: paths.dataDir, appVersion, now: () => clock.now(), logger }, target)),
    );
    return { canceled: false as const, file: target, counts };
  }

  async importPortable(ctx: Ctx) {
    const file = await this.deps.dialog.showOpenFile({ webContentsId: ctx.webContentsId, title: 'Import notes', filters: [EXPORT_FILTER] });
    if (file === null) return { canceled: true as const };
    const { db, ids, clock, logger, attachments, content, reminders, onTreeChanged } = this.deps;
    const result = await this.exclusive(() =>
      this.writing('import', () =>
        importPortable({ db, uuid: () => ids.uuid(), now: () => clock.now(), logger, attachments, content, reminders, onTreeChanged }, file),
      ),
    );
    return { canceled: false as const, ...result };
  }
}


import type { TreeChangedEventType } from '../shared/contracts/hierarchy';
import type { NoteLeaseEventType, NoteRevisionEventType } from '../shared/contracts/notes';
import type { ReminderChangedEventType } from '../shared/contracts/reminders';
import type { RestoreOutcomeType } from '../shared/contracts/portability';
import type { SettingsChangedPayload } from '../shared/contracts/settings';
import type { Db } from './db/driver';
import { SettingsRepo } from './db/repositories/settings-repo';
import { PortabilityService } from './portability/portability-service';
import type { RestorePaths } from './portability/restore';
import { AttachmentHandoff } from './services/attachment-handoff';
import { AttachmentService } from './services/attachment-service';
import type { Clock } from './services/clock';
import { ContentIndexer } from './services/content-indexer';
import { ContentOps } from './services/content-ops';
import type { DialogAdapter } from './services/dialog-adapter';
import { DraftService } from './services/draft-service';
import { FormatService } from './services/format-service';
import { HierarchyService } from './services/hierarchy-service';
import { HomeService } from './services/home-service';
import type { IdGenerator } from './services/ids';
import { LeaseManager, type LeaseHolder } from './services/lease-manager';
import type { Logger } from './services/logger';
import { MaintenanceService } from './services/maintenance';
import { NoteContent } from './services/note-content';
import { NoteReader } from './services/note-reader';
import { NoteWriter, type SaveFaults } from './services/note-writer';
import { PaletteService } from './services/palette-service';
import { ReferenceService } from './services/reference-service';
import { ReminderAnchors } from './services/reminder-anchors';
import { ReminderService } from './services/reminder-service';
import { SearchService } from './services/search-service';
import { SessionService } from './services/session-service';
import type { ShellAdapter } from './services/shell-adapter';
import { SettingsService } from './services/settings-service';
import { StickyService } from './services/sticky-service';
import { SuggestionService } from './services/suggestion-service';
import { TagService } from './services/tag-service';
import type { SystemZoneProvider } from './services/system-zone';
import { WidgetStateStore } from './services/widget-state';
import { TrashService } from './services/trash-service';
import { VersionService } from './services/version-service';

/** Every main-process service that needs the database. Absent when the database failed to open. */
export interface MainServices {
  settings: SettingsService;
  hierarchy: HierarchyService;
  trash: TrashService;
  home: HomeService;
  sessions: SessionService;
  palette: PaletteService;
  reader: NoteReader;
  writer: NoteWriter;
  leases: LeaseManager;
  versions: VersionService;
  drafts: DraftService;
  formats: FormatService;
  attachments: AttachmentService;
  handoff: AttachmentHandoff;
  references: ReferenceService;
  search: SearchService;
  tags: TagService;
  stickies: StickyService;
  reminders: ReminderService;
  suggestions: SuggestionService;
  widgetState: WidgetStateStore;
  portability: PortabilityService;
  maintenance: MaintenanceService;
  /** The single writer of note content (used by the services above and the E2E fake view). */
  content: NoteContent;
}

export interface MainServicesDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** `<userData>/data` (attachments live under it). */
  dataDir: string;
  dialog: Pick<DialogAdapter, 'showOpenFiles' | 'showSaveFile' | 'showOpenFile' | 'showOpenFolder'>;
  /** Where backups are restored (staging, the pending marker, rollback copies). */
  restorePaths: RestorePaths;
  appVersion: string;
  latestSchema: number;
  /** Quits and starts the app again after a restore was scheduled. */
  restart: () => void;
  /** What a restore at this start did, if one was pending. */
  restoreOutcome: RestoreOutcomeType | null;
  /** Opens attached files and shows them in the file manager (a recording fake under test hooks). */
  shell: ShellAdapter;
  onSettingsChanged: (payload: SettingsChangedPayload) => void;
  onTreeChanged: (event: TreeChangedEventType) => void;
  onNoteRevision: (event: NoteRevisionEventType) => void;
  onLeaseChanged: (event: NoteLeaseEventType) => void;
  /** Asks the holder's renderer to flush and release the lease (sent to that renderer only). */
  requestLeaseRelease: (holder: LeaseHolder, noteId: string) => void;
  /** The reminder subsystem's clock (a frozen test clock under the E2E hooks, D-084); defaults to `clock`. */
  reminderClock?: Clock;
  /** The computer's time zone as reminders see it. */
  zones: SystemZoneProvider;
  /** `reminder:changed` after a committed reminder change, including anchor changes from content writes. */
  onReminderChanged: (event: ReminderChangedEventType) => void;
  /** After a committed reminder write: wakes the scheduler. */
  onRemindersWritten?: () => void;
  /** Test-only hooks (E2E): save fault injection and an import delay. */
  testFaults?: { save?: SaveFaults; beforeImport?: () => Promise<void> };
}

export function createMainServices(deps: MainServicesDeps): MainServices {
  const { db, clock, ids, logger } = deps;
  const settings = new SettingsService({ repo: new SettingsRepo(db), clock, logger, emit: deps.onSettingsChanged });
  const leases = new LeaseManager({ ids, clock, requestRelease: deps.requestLeaseRelease, emit: deps.onLeaseChanged });
  const reminderClock = deps.reminderClock ?? clock;
  const anchors = new ReminderAnchors(db, { clock: reminderClock, logger });
  const content = new NoteContent(db, new ContentIndexer(db, logger, anchors));
  // A content write that changed a reminder anchor is followed by reminder:changed after its revision event (D-080).
  const onNoteRevision = (event: NoteRevisionEventType): void => {
    deps.onNoteRevision(event);
    if (anchors.consumeChanged(event.noteId)) deps.onReminderChanged({ reason: 'anchor', noteIds: [event.noteId] });
  };
  const ops = new ContentOps({ db, leases, clock, logger, content, emit: onNoteRevision });
  const versions = new VersionService({
    db,
    ids,
    ops,
    autoPolicy: () => ({ maxAgeDays: settings.getInternal('retention.autoVersionDays'), maxCount: settings.getInternal('retention.autoVersionMax') }),
  });
  const reminders = new ReminderService({
    db,
    clock: reminderClock,
    ids,
    logger,
    zones: deps.zones,
    settings,
    emit: deps.onReminderChanged,
    onWrite: () => deps.onRemindersWritten?.(),
  });
  const trash = new TrashService({ db, clock, ids, logger, onChange: deps.onTreeChanged });
  const attachments = new AttachmentService({
    db,
    clock,
    ids,
    logger,
    settings,
    dialog: deps.dialog,
    dataDir: deps.dataDir,
    beforeImport: deps.testFaults?.beforeImport,
  });
  const portability = new PortabilityService({
    db,
    paths: deps.restorePaths,
    appVersion: deps.appVersion,
    latestSchema: deps.latestSchema,
    clock,
    ids,
    logger,
    settings,
    dialog: deps.dialog,
    attachments,
    content,
    reminders,
    onTreeChanged: deps.onTreeChanged,
    restart: deps.restart,
    restoreOutcome: deps.restoreOutcome,
  });
  return {
    content,
    settings,
    hierarchy: new HierarchyService({ db, clock, ids, logger, onChange: deps.onTreeChanged }),
    trash,
    stickies: new StickyService({ db, clock, logger, onChange: deps.onTreeChanged }),
    home: new HomeService(db),
    widgetState: new WidgetStateStore({ db, clock, logger }),
    reminders,
    suggestions: new SuggestionService({ db, clock: reminderClock, logger, reminders }),
    sessions: new SessionService(db, settings, clock),
    palette: new PaletteService(db),
    references: new ReferenceService(db),
    search: new SearchService(db),
    tags: new TagService(db, logger),
    handoff: new AttachmentHandoff(db, { dataDir: deps.dataDir, shell: deps.shell, logger }),
    reader: new NoteReader(db),
    writer: new NoteWriter({ db, leases, clock, ids, logger, content, versions, emit: onNoteRevision, faults: deps.testFaults?.save }),
    leases,
    versions,
    drafts: new DraftService({ db, clock, ops, versions }),
    formats: new FormatService({ ids, ops, versions }),
    attachments,
    portability,
    maintenance: new MaintenanceService({ db, clock, logger, dataDir: deps.dataDir, settings, trash, versions, isBusy: () => portability.isBusy() }),
  };
}

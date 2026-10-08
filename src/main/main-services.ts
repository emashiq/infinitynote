import type { TreeChangedEventType } from '../shared/contracts/hierarchy';
import type { NoteLeaseEventType, NoteRevisionEventType } from '../shared/contracts/notes';
import type { SettingsChangedPayload } from '../shared/contracts/settings';
import type { Db } from './db/driver';
import { SettingsRepo } from './db/repositories/settings-repo';
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
import { NoteContent } from './services/note-content';
import { NoteReader } from './services/note-reader';
import { NoteWriter, type SaveFaults } from './services/note-writer';
import { PaletteService } from './services/palette-service';
import { SessionService } from './services/session-service';
import { SettingsService } from './services/settings-service';
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
  dialog: DialogAdapter;
  onSettingsChanged: (payload: SettingsChangedPayload) => void;
  onTreeChanged: (event: TreeChangedEventType) => void;
  onNoteRevision: (event: NoteRevisionEventType) => void;
  onLeaseChanged: (event: NoteLeaseEventType) => void;
  /** Asks the holder's renderer to flush and release the lease (sent to that renderer only). */
  requestLeaseRelease: (holder: LeaseHolder, noteId: string) => void;
  /** Test-only hooks (E2E): save fault injection and an import delay. */
  testFaults?: { save?: SaveFaults; beforeImport?: () => Promise<void> };
}

export function createMainServices(deps: MainServicesDeps): MainServices {
  const { db, clock, ids, logger } = deps;
  const settings = new SettingsService({ repo: new SettingsRepo(db), clock, logger, emit: deps.onSettingsChanged });
  const leases = new LeaseManager({ ids, clock, requestRelease: deps.requestLeaseRelease, emit: deps.onLeaseChanged });
  const content = new NoteContent(db, new ContentIndexer(db, logger));
  const ops = new ContentOps({ db, leases, clock, logger, content, emit: deps.onNoteRevision });
  const versions = new VersionService({ db, ids, ops });
  return {
    content,
    settings,
    hierarchy: new HierarchyService({ db, clock, ids, logger, onChange: deps.onTreeChanged }),
    trash: new TrashService({ db, clock, ids, logger, onChange: deps.onTreeChanged }),
    home: new HomeService(db),
    sessions: new SessionService(db, settings, clock),
    palette: new PaletteService(db),
    reader: new NoteReader(db),
    writer: new NoteWriter({ db, leases, clock, ids, logger, content, versions, emit: deps.onNoteRevision, faults: deps.testFaults?.save }),
    leases,
    versions,
    drafts: new DraftService({ db, clock, ops, versions }),
    formats: new FormatService({ ids, ops, versions }),
    attachments: new AttachmentService({
      db,
      clock,
      ids,
      logger,
      settings,
      dialog: deps.dialog,
      dataDir: deps.dataDir,
      beforeImport: deps.testFaults?.beforeImport,
    }),
  };
}

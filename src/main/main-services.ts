import type { TreeChangedEventType } from '../shared/contracts/hierarchy';
import type { SettingsChangedPayload } from '../shared/contracts/settings';
import type { Db } from './db/driver';
import { SettingsRepo } from './db/repositories/settings-repo';
import type { Clock } from './services/clock';
import { HierarchyService } from './services/hierarchy-service';
import { HomeService } from './services/home-service';
import type { IdGenerator } from './services/ids';
import { LeaseManager } from './services/lease-manager';
import type { Logger } from './services/logger';
import { NoteReader } from './services/note-reader';
import { NoteWriter } from './services/note-writer';
import { PaletteService } from './services/palette-service';
import { SessionService } from './services/session-service';
import { SettingsService } from './services/settings-service';
import { TrashService } from './services/trash-service';

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
}

export interface MainServicesDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  onSettingsChanged: (payload: SettingsChangedPayload) => void;
  onTreeChanged: (event: TreeChangedEventType) => void;
}

export function createMainServices(deps: MainServicesDeps): MainServices {
  const { db, clock, ids, logger } = deps;
  const settings = new SettingsService({ repo: new SettingsRepo(db), clock, logger, emit: deps.onSettingsChanged });
  // A single view per note in Phase 02: lease hand-off and the note:revision and note:lease events arrive with Phase 03.
  const leases = new LeaseManager({ ids, clock, requestRelease: () => {}, emit: () => {} });
  return {
    settings,
    hierarchy: new HierarchyService({ db, clock, ids, logger, onChange: deps.onTreeChanged }),
    trash: new TrashService({ db, clock, ids, logger, onChange: deps.onTreeChanged }),
    home: new HomeService(db),
    sessions: new SessionService(db, settings, clock),
    palette: new PaletteService(db),
    reader: new NoteReader(db),
    writer: new NoteWriter({ db, leases, clock, ids, emit: () => {} }),
    leases,
  };
}

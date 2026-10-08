import { DEFAULT_SESSION, type SessionGetResponseType, type TabSessionType } from '../../shared/contracts/session';
import { sanitizeSession } from '../../shared/tabs/tab-session';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import type { Clock } from './clock';
import type { SettingsService } from './settings-service';

/** Stores the tab session in the internal `session.tabs` setting (D-045, D-047). */
export class SessionService {
  private readonly notes: NotesRepo;

  constructor(
    db: Db,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {
    this.notes = new NotesRepo(db);
  }

  /** Reads and sanitizes the stored tab session. Never writes. */
  get(): SessionGetResponseType {
    const stored = this.settings.getInternal('session.tabs');
    const noteIds = stored.tabs.flatMap((t) => (t.kind === 'note' ? [t.noteId] : []));
    const states = noteIds.length > 0 ? this.notes.states(noteIds) : new Map<string, 'live' | 'trashed'>();
    const result = sanitizeSession(stored, (id) => states.get(id) ?? 'missing');
    return { session: result.invalid ? DEFAULT_SESSION : result.session, dropped: result.dropped };
  }

  set(session: TabSessionType): { savedAt: number } {
    this.settings.setInternal('session.tabs', session);
    return { savedAt: this.clock.now() };
  }
}

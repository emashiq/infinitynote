import { DEFAULT_SESSION, type SessionGetResponseType, type TabSessionType } from '../../shared/contracts/session';
import { sanitizeSession, type NoteState } from '../../shared/tabs/tab-session';
import type { Db } from '../db/driver';
import type { Clock } from './clock';
import type { SettingsService } from './settings-service';

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  /** Reads and sanitizes the stored tab session. Never writes. */
  get(): SessionGetResponseType {
    const stored = this.settings.getInternal('session.tabs') as TabSessionType;
    const noteIds = stored.tabs.flatMap((t) => (t.kind === 'note' ? [t.noteId] : []));
    const states = new Map<string, NoteState>();
    if (noteIds.length > 0) {
      const rows = this.db
        .prepare<[string], { id: string; deleted_at: number | null }>(
          'SELECT id, deleted_at FROM notes WHERE id IN (SELECT value FROM json_each(?))',
        )
        .all(JSON.stringify(noteIds));
      for (const r of rows) states.set(r.id, r.deleted_at === null ? 'live' : 'trashed');
    }
    const result = sanitizeSession(stored, (id) => states.get(id) ?? 'missing');
    return { session: result.invalid ? DEFAULT_SESSION : result.session, dropped: result.dropped };
  }

  set(session: TabSessionType): { savedAt: number } {
    this.settings.setInternal('session.tabs', session);
    return { savedAt: this.clock.now() };
  }
}

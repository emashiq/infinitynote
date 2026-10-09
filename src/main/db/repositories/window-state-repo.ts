import { StoredBounds, type StoredBoundsType } from '../../../shared/contracts/stickies';
import type { Logger } from '../../services/logger';
import type { Db } from '../driver';

interface WindowStateRow {
  key: string;
  note_id: string | null;
  bounds: string | null;
  display_id: number | null;
  open: number;
  collapsed: number;
  always_on_top: number;
  updated_at: number;
}

/** Presentation state of one window (D-062). */
export interface WindowState {
  bounds: StoredBoundsType | null;
  displayId: number | null;
  open: boolean;
  collapsed: boolean;
  alwaysOnTop: boolean;
}

export type WindowStatePatch = Partial<WindowState>;

export const EMPTY_WINDOW_STATE: WindowState = { bounds: null, displayId: null, open: false, collapsed: false, alwaysOnTop: false };

const COLS = 'key, note_id, bounds, display_id, open, collapsed, always_on_top, updated_at';

export const stickyKey = (noteId: string): string => `sticky:${noteId}`;
/** The reminder widget's row (D-081); the 004 CHECK reserves the key with no note. */
export const WIDGET_KEY = 'widget';

/**
 * SQL for the `window_state` table. Sticky rows are keyed `sticky:<noteId>` and cascade away with their note; the widget
 * row is keyed `widget`.
 */
export class WindowStateRepo {
  /** Keys whose stored bounds were unreadable; warned about once each. */
  private readonly warned = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly logger?: Logger,
  ) {}

  private toState(row: WindowStateRow): WindowState {
    return {
      bounds: this.parseBounds(row.key, row.bounds),
      displayId: row.display_id,
      open: row.open === 1,
      collapsed: row.collapsed === 1,
      alwaysOnTop: row.always_on_top === 1,
    };
  }

  private parseBounds(key: string, raw: string | null): StoredBoundsType | null {
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const result = StoredBounds.safeParse(parsed);
    if (result.success) return result.data;
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger?.warn(`window-state: invalid bounds key=${key}`);
    }
    return null;
  }

  get(key: string): WindowState | undefined {
    const row = this.db.prepare<[string], WindowStateRow>(`SELECT ${COLS} FROM window_state WHERE key = ?`).get(key);
    return row ? this.toState(row) : undefined;
  }

  /** Writes the given fields of a sticky's row (creating it with defaults first). */
  upsertSticky(noteId: string, patch: WindowStatePatch, now: number): WindowState {
    return this.upsert(stickyKey(noteId), noteId, patch, now);
  }

  /** Writes the given fields of the widget's row (creating it with defaults first). */
  upsertWidget(patch: WindowStatePatch, now: number): WindowState {
    return this.upsert(WIDGET_KEY, null, patch, now);
  }

  private upsert(key: string, noteId: string | null, patch: WindowStatePatch, now: number): WindowState {
    const next = { ...(this.get(key) ?? EMPTY_WINDOW_STATE), ...patch };
    this.db
      .prepare<[string, string | null, string | null, number | null, number, number, number, number]>(
        `INSERT INTO window_state(${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET bounds = excluded.bounds, display_id = excluded.display_id, open = excluded.open,
           collapsed = excluded.collapsed, always_on_top = excluded.always_on_top, updated_at = excluded.updated_at`,
      )
      .run(
        key,
        noteId,
        next.bounds ? JSON.stringify(next.bounds) : null,
        next.displayId,
        next.open ? 1 : 0,
        next.collapsed ? 1 : 0,
        next.alwaysOnTop ? 1 : 0,
        now,
      );
    return next;
  }

  /** Notes whose sticky window was open at the last quit and that are still live stickies, oldest first. */
  listOpenStickies(): string[] {
    return this.db
      .prepare<[], { note_id: string }>(
        `SELECT w.note_id AS note_id FROM window_state w JOIN notes n ON n.id = w.note_id
         WHERE w.open = 1 AND n.deleted_at IS NULL AND n.sticky_enabled = 1 ORDER BY w.updated_at, w.key`,
      )
      .all()
      .map((r) => r.note_id);
  }

  /** Marks open rows of trashed or no-longer-sticky notes closed; returns how many changed. */
  closeStale(now: number): number {
    return this.db
      .prepare<[number]>(
        `UPDATE window_state SET open = 0, updated_at = ? WHERE open = 1 AND note_id IN
           (SELECT id FROM notes WHERE deleted_at IS NOT NULL OR sticky_enabled = 0)`,
      )
      .run(now).changes;
  }

  closeAllStickies(now: number): number {
    return this.db.prepare<[number]>('UPDATE window_state SET open = 0, updated_at = ? WHERE open = 1 AND note_id IS NOT NULL').run(now).changes;
  }

  delete(key: string): void {
    this.db.prepare<[string]>('DELETE FROM window_state WHERE key = ?').run(key);
  }
}

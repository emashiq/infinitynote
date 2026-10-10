import type { HexColor as HexColorValue } from '../../shared/color';
import { HexColor, NoteColor, type NoteColorType, type TreeChangedEventType } from '../../shared/contracts/hierarchy';
import { STICKY_MESSAGES, type StoredBoundsType } from '../../shared/contracts/stickies';
import { DEFAULT_STICKY_COLOR } from '../../shared/sticky-colors';
import { pathOf, type PathIndex } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo, type NoteMetaRow } from '../db/repositories/hierarchy-repo';
import { EMPTY_WINDOW_STATE, WindowStateRepo, stickyKey, type WindowState, type WindowStatePatch } from '../db/repositories/window-state-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import { livePathIndex, pathIndexFromRows } from './dto';
import type { Logger } from './logger';
import { MSG } from './messages';
import { runTx } from './transaction';

/** What a sticky window shows about its note besides the content. */
export interface StickyMeta {
  title: string;
  color: NoteColorType;
  /** The default text color; null is Automatic. */
  textColor: HexColorValue | null;
  path: string[];
  trashed: { batchId: string | null } | null;
  /** Locked: the window shows the text only while revealed there (D-172). */
  locked: boolean;
}

export interface StickyServiceDeps {
  db: Db;
  clock: Clock;
  logger?: Logger;
  onChange: (event: TreeChangedEventType) => void;
}

/**
 * The database side of sticky windows (plan section 8.4): the note's sticky flag and color, and the window state
 * row. Nothing here touches a note's revision or updated_at.
 */
export class StickyService {
  private readonly hierarchy: HierarchyRepo;
  private readonly windows: WindowStateRepo;

  constructor(private readonly deps: StickyServiceDeps) {
    this.hierarchy = new HierarchyRepo(deps.db);
    this.windows = new WindowStateRepo(deps.db, deps.logger);
  }

  private tx<T>(fn: () => T): T {
    return runTx(this.deps.db, this.deps.logger, fn);
  }

  private changed(): void {
    this.deps.onChange({ reason: 'sticky', trashedNoteIds: [], trashedDocumentIds: [] });
  }

  private liveNote(noteId: string): NoteMetaRow {
    const row = this.hierarchy.getNoteMeta(noteId);
    if (!row) throw new AppError('NOT_FOUND', STICKY_MESSAGES.missing);
    if (row.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.noteInTrash, { trashed: true, trashBatchId: row.trash_batch_id });
    return row;
  }

  // Note flags ------------------------------------------------------------------------------
  /** Makes a live note a sticky (yellow unless it has a color) and marks its window open. A locked note floats blurred (D-172). */
  enable(noteId: string): void {
    const changed = this.tx(() => {
      const row = this.liveNote(noteId);
      this.hierarchy.setSticky(noteId, true);
      this.windows.upsertSticky(noteId, { open: true }, this.deps.clock.now());
      return row.sticky_enabled !== 1 || row.color === null;
    });
    if (changed) this.changed();
  }

  /** Clears the sticky flag and forgets the window state ("Remove from stickies"). */
  disable(noteId: string): void {
    this.tx(() => {
      this.liveNote(noteId);
      this.hierarchy.setSticky(noteId, false);
      this.windows.delete(stickyKey(noteId));
    });
    this.changed();
  }

  setColor(noteId: string, color: NoteColorType): void {
    this.updateSticky(noteId, () => this.hierarchy.setColor(noteId, color));
  }

  setTextColor(noteId: string, textColor: HexColorValue | null): void {
    this.updateSticky(noteId, () => this.hierarchy.setTextColor(noteId, textColor));
  }

  /** Changes how a sticky looks; the note must exist and be a sticky. */
  private updateSticky(noteId: string, update: () => void): void {
    this.tx(() => {
      const row = this.hierarchy.getNoteMeta(noteId);
      if (!row) throw new AppError('NOT_FOUND', STICKY_MESSAGES.missing);
      if (row.sticky_enabled !== 1) throw new AppError('VALIDATION_FAILED', STICKY_MESSAGES.notSticky);
      update();
    });
    this.changed();
  }

  // Metadata ------------------------------------------------------------------------------
  /** Title, color, path and trash state of a note, or null when the note row is gone (purged). */
  meta(noteId: string): StickyMeta | null {
    return this.metaMany([noteId]).get(noteId) ?? null;
  }

  /** Metadata of several notes; the path indexes are built once per call. Purged notes are absent. */
  metaMany(noteIds: readonly string[]): Map<string, StickyMeta> {
    const out = new Map<string, StickyMeta>();
    let live: PathIndex | null = null;
    let all: PathIndex | null = null;
    for (const id of noteIds) {
      const row = this.hierarchy.getNoteMeta(id);
      if (!row) continue;
      const trashed = row.deleted_at !== null;
      // A trashed note shows where it came from; its folders may be trashed too.
      const index = trashed
        ? (all ??= pathIndexFromRows(this.hierarchy.allProjects(), this.hierarchy.allFolders()))
        : (live ??= livePathIndex(this.hierarchy));
      out.set(id, {
        title: row.title,
        color: NoteColor.safeParse(row.color).data ?? DEFAULT_STICKY_COLOR,
        textColor: HexColor.safeParse(row.text_color).data ?? null,
        path: pathOf(index, { projectId: row.project_id, folderId: row.folder_id }),
        trashed: trashed ? { batchId: row.trash_batch_id } : null,
        locked: row.locked === 1,
      });
    }
    return out;
  }

  // Window state ------------------------------------------------------------------------------
  state(noteId: string): WindowState {
    return this.windows.get(stickyKey(noteId)) ?? EMPTY_WINDOW_STATE;
  }

  private patch(noteId: string, patch: WindowStatePatch): void {
    // A purged note has no row to attach state to; its window is closing anyway.
    if (!this.hierarchy.getNoteMeta(noteId)) return;
    this.windows.upsertSticky(noteId, patch, this.deps.clock.now());
  }

  saveBounds(noteId: string, bounds: StoredBoundsType, displayId: number | null): void {
    this.patch(noteId, { bounds, displayId });
  }

  setOpen(noteId: string, open: boolean): void {
    this.patch(noteId, { open });
  }

  setCollapsed(noteId: string, collapsed: boolean): void {
    this.patch(noteId, { collapsed });
  }

  setAlwaysOnTop(noteId: string, alwaysOnTop: boolean): void {
    this.patch(noteId, { alwaysOnTop });
  }

  /** Stickies to reopen at startup; rows of trashed or no-longer-sticky notes are closed first. */
  openStickyIds(): string[] {
    return this.tx(() => {
      this.windows.closeStale(this.deps.clock.now());
      return this.windows.listOpenStickies();
    });
  }

  /** Marks every sticky window closed, so a later opt-in to restore never resurrects an old session. */
  closeAll(): void {
    this.windows.closeAllStickies(this.deps.clock.now());
  }
}

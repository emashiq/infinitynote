import type { FlushReasonType } from '../../shared/contracts/app';
import type { TrashRestoreResponseType } from '../../shared/contracts/hierarchy';
import { STICKY_MESSAGES } from '../../shared/contracts/stickies';
import { createStore, type Store, type Timers } from './store';

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
  /** One button next to the text (for example Undo); the notice closes when it is used. */
  action?: NoticeAction;
}
export interface NoticeState {
  notices: Notice[];
}

export const NOTICE_TTL_MS = 10_000;
export const MAX_NOTICES = 3;

export class NoticeStore {
  readonly store: Store<NoticeState> = createStore<NoticeState>({ notices: [] });
  private nextId = 1;

  constructor(private readonly timers: Timers) {}

  push(text: string, tone: 'info' | 'error' = 'info', action?: NoticeAction): number {
    const id = this.nextId++;
    this.store.setState((s) => ({ notices: [...s.notices, { id, text, tone, ...(action ? { action } : {}) }].slice(-MAX_NOTICES) }));
    this.timers.setTimeout(() => this.dismiss(id), NOTICE_TTL_MS);
    return id;
  }

  dismiss(id: number): void {
    this.store.setState((s) => {
      const notices = s.notices.filter((n) => n.id !== id);
      return notices.length === s.notices.length ? s : { notices };
    });
  }
}

export function closedTabsNotice(count: number, includesMissing: boolean): string {
  if (includesMissing) {
    return count === 1
      ? '1 tab was closed because its note is in Trash or no longer exists'
      : `${count} tabs were closed because their notes are in Trash or no longer exist`;
  }
  return count === 1 ? '1 tab was closed because its note is in Trash' : `${count} tabs were closed because their notes are in Trash`;
}

/** Shown when the active note was trashed elsewhere while it had unsaved edits that main kept as a draft (F-02-1). */
export function trashedDraftNotice(title: string): string {
  return `Your unsaved edits to "${title}" were kept as a recovered draft. Restore the note from Trash to see them.`;
}

/** Where a restored item went (UX_SPEC section 6). */
export function restoreNotice(res: Pick<TrashRestoreResponseType, 'path' | 'relocated'>): string {
  const where = res.path.join(' › ');
  return res.relocated ? `Restored to ${where} because its original location is in Trash or no longer exists` : `Restored to ${where}`;
}

/** A window kept open because its note could not be saved (D-072). */
export const WINDOW_KEPT_NOTICE = STICKY_MESSAGES.notSaved;
export const QUIT_CANCELED_NOTICE = 'Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it.';

/** What a window says when main asked it to save before closing or quitting and the save failed. */
export function unsavedFlushNotice(reason: FlushReasonType): string {
  return reason === 'quit' ? QUIT_CANCELED_NOTICE : WINDOW_KEPT_NOTICE;
}

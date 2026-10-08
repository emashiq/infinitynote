import { createStore, type Store, type Timers } from './store';

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
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

  push(text: string, tone: 'info' | 'error' = 'info'): number {
    const id = this.nextId++;
    this.store.setState((s) => ({ notices: [...s.notices, { id, text, tone }].slice(-MAX_NOTICES) }));
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

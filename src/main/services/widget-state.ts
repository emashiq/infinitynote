import type { Db } from '../db/driver';
import { EMPTY_WINDOW_STATE, WIDGET_KEY, WindowStateRepo, type WindowState, type WindowStatePatch } from '../db/repositories/window-state-repo';
import type { Clock } from './clock';
import type { Logger } from './logger';

/** The reminder widget's stored window state (D-081): bounds, open at quit, collapsed and keep-on-top. */
export class WidgetStateStore {
  private readonly repo: WindowStateRepo;

  constructor(private readonly deps: { db: Db; clock: Clock; logger?: Logger }) {
    this.repo = new WindowStateRepo(deps.db, deps.logger);
  }

  get(): WindowState {
    return this.repo.get(WIDGET_KEY) ?? EMPTY_WINDOW_STATE;
  }

  patch(patch: WindowStatePatch): void {
    this.repo.upsertWidget(patch, this.deps.clock.now());
  }
}

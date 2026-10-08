import type { CapabilityStatusType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { SETTINGS } from '../../shared/contracts/settings';
import type { CloseBehaviorType } from '../../shared/contracts/windows';
import type { PublicSettingValues } from './core-services';
import { createStore, failOutcome, okOutcome, type Outcome, type Store } from './store';

export interface WindowSettingsState {
  closeBehavior: CloseBehaviorType;
  restoreOnStartup: boolean;
  /** The tray capability; null until it is known. */
  tray: CapabilityStatusType | null;
}

type Key = 'app.closeBehavior' | 'stickies.restoreOnStartup';
const FIELD = { 'app.closeBehavior': 'closeBehavior', 'stickies.restoreOnStartup': 'restoreOnStartup' } as const;

/** Settings > Windows and tray (D-066, D-068): the close behavior, restoring stickies and the tray availability. */
export class WindowSettingsStore {
  readonly store: Store<WindowSettingsState> = createStore<WindowSettingsState>({
    closeBehavior: SETTINGS['app.closeBehavior'].default,
    restoreOnStartup: SETTINGS['stickies.restoreOnStartup'].default,
    tray: null,
  });

  constructor(private readonly bridge: InfinityBridge) {}

  hydrate(values: PublicSettingValues, tray: CapabilityStatusType | null): void {
    this.store.setState({
      closeBehavior: values['app.closeBehavior'] ?? SETTINGS['app.closeBehavior'].default,
      restoreOnStartup: values['stickies.restoreOnStartup'] ?? SETTINGS['stickies.restoreOnStartup'].default,
      tray,
    });
  }

  /** A change from any writer (settings:changed). */
  applyChange(key: string, value: unknown): void {
    if (!(key in FIELD)) return;
    const k = key as Key;
    const parsed = SETTINGS[k].schema.safeParse(value);
    if (parsed.success) this.store.setState({ [FIELD[k]]: parsed.data });
  }

  setCloseBehavior(value: CloseBehaviorType): Promise<Outcome> {
    return this.write('closeBehavior', value, () => this.bridge.settings.set({ key: 'app.closeBehavior', value }));
  }

  setRestoreOnStartup(value: boolean): Promise<Outcome> {
    return this.write('restoreOnStartup', value, () => this.bridge.settings.set({ key: 'stickies.restoreOnStartup', value }));
  }

  /** Shows the new value at once and reverts it when main refuses the write. */
  private async write<F extends 'closeBehavior' | 'restoreOnStartup'>(
    field: F,
    value: WindowSettingsState[F],
    send: () => ReturnType<InfinityBridge['settings']['set']>,
  ): Promise<Outcome> {
    const previous = this.store.getState()[field];
    this.store.setState({ [field]: value } as Partial<WindowSettingsState>);
    const res = await send();
    if (res.ok) return okOutcome(undefined);
    this.store.setState({ [field]: previous } as Partial<WindowSettingsState>);
    return failOutcome(res.error.code, res.error.message);
  }
}

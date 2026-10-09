import type { CapabilitiesType, CapabilityStatusType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { SETTINGS } from '../../shared/contracts/settings';
import type { AutostartStateType } from '../../shared/contracts/widget';
import type { CloseBehaviorType } from '../../shared/contracts/windows';
import type { PublicSettingValues } from './core-services';
import { createStore, failOutcome, okOutcome, type Outcome, type Store } from './store';

export interface WindowSettingsState {
  closeBehavior: CloseBehaviorType;
  restoreOnStartup: boolean;
  /** The tray capability; null until it is known. */
  tray: CapabilityStatusType | null;
  /** Whether this desktop has a notification service (Settings explains the in-app fallback, D-076). */
  notifications: CapabilityStatusType | null;
  /** Launch at login as the OS reports it (D-082); null until read. */
  autostart: AutostartStateType | null;
}

type Key = 'app.closeBehavior' | 'stickies.restoreOnStartup';
const FIELD = { 'app.closeBehavior': 'closeBehavior', 'stickies.restoreOnStartup': 'restoreOnStartup' } as const;

/**
 * Settings > Windows and tray (D-066, D-068, D-082): the close behavior, restoring stickies, the tray and notification
 * availability and launch at login.
 */
export class WindowSettingsStore {
  readonly store: Store<WindowSettingsState> = createStore<WindowSettingsState>({
    closeBehavior: SETTINGS['app.closeBehavior'].default,
    restoreOnStartup: SETTINGS['stickies.restoreOnStartup'].default,
    tray: null,
    notifications: null,
    autostart: null,
  });

  constructor(private readonly bridge: InfinityBridge) {}

  hydrate(values: PublicSettingValues, caps: CapabilitiesType | null): void {
    this.store.setState({
      closeBehavior: values['app.closeBehavior'] ?? SETTINGS['app.closeBehavior'].default,
      restoreOnStartup: values['stickies.restoreOnStartup'] ?? SETTINGS['stickies.restoreOnStartup'].default,
      tray: caps?.tray ?? null,
      notifications: caps?.nativeNotifications ?? null,
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

  /** Reads launch at login from the OS (it can change outside the app). */
  async loadAutostart(): Promise<void> {
    const res = await this.bridge.autostart.get();
    if (res.ok) this.store.setState({ autostart: res.data });
  }

  async setAutostart(enabled: boolean): Promise<Outcome> {
    const res = await this.bridge.autostart.set({ enabled });
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    this.store.setState({ autostart: res.data });
    return okOutcome(undefined);
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

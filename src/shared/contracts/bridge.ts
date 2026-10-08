import type { AppInfoType, CapabilitiesType } from './app';
import type { EventChannel } from './channel-names';
import type { Result } from './envelope';
import type { SettingKey, SettingValue, SettingsChangedPayload } from './settings';

export interface InfinityBridge {
  readonly app: {
    getInfo(): Promise<Result<AppInfoType>>;
    showDataFolder(): Promise<Result<{ opened: true }>>;
    quit(): Promise<Result<Record<string, never>>>;
  };
  readonly settings: {
    get(req: { keys: SettingKey[] }): Promise<Result<{ values: Partial<{ [K in SettingKey]: SettingValue<K> }> }>>;
    set(req: { key: 'appearance.theme'; value: SettingValue<'appearance.theme'> }): Promise<Result<SettingsChangedPayload>>;
  };
  readonly capabilities: {
    get(): Promise<Result<CapabilitiesType>>;
  };
  subscribe(channel: EventChannel, cb: (payload: unknown) => void): () => void;
}

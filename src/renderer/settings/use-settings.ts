import { useCallback, useEffect, useState } from 'react';
import { SETTINGS, type PublicSettingKey, type SettingValue, type SettingsChangedPayload } from '../../shared/contracts/settings';
import { useServices } from '../state/use-store';

export type SettingValues<K extends PublicSettingKey> = { [P in K]: SettingValue<P> };

/**
 * Reads public settings, follows changes from any window and writes them through `settings:set`. A refused write is
 * reported in a notice and the stored value comes back.
 */
export function useSettingValues<K extends PublicSettingKey>(keys: readonly K[]) {
  const { bridge, notices } = useServices();
  const [values, setValues] = useState<SettingValues<K> | null>(null);
  const keyList = keys.join('|');

  useEffect(() => {
    let cancelled = false;
    const wanted = keyList.split('|') as K[];
    void bridge.settings.get({ keys: wanted }).then((res) => {
      if (cancelled || !res.ok) return;
      setValues(Object.fromEntries(wanted.map((k) => [k, res.data.values[k] ?? SETTINGS[k].default])) as SettingValues<K>);
    });
    const off = bridge.subscribe('settings:changed', ({ key, value }: SettingsChangedPayload) => {
      if (!(wanted as string[]).includes(key)) return;
      const parsed = SETTINGS[key as K].schema.safeParse(value);
      if (parsed.success) setValues((v) => (v ? { ...v, [key]: parsed.data } : v));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge, keyList]);

  const set = useCallback(
    <P extends K>(key: P, value: SettingValue<P>) => {
      let previous: SettingValue<P> | undefined;
      setValues((v) => {
        previous = v?.[key];
        return v ? { ...v, [key]: value } : v;
      });
      void bridge.settings.set({ key, value } as Parameters<typeof bridge.settings.set>[0]).then((res) => {
        if (res.ok) return;
        notices.push(res.error.message, 'error');
        if (previous !== undefined) setValues((v) => (v ? { ...v, [key]: previous } : v));
      });
    },
    [bridge, notices],
  );

  return { values, set };
}

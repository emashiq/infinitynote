import { useEffect, useState } from 'react';
import type { AppInfoType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { applyTheme, resolveTheme, type ThemeSettingValue } from '../theme/theme';

const THEMES: Array<{ value: ThemeSettingValue; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function isTheme(v: unknown): v is ThemeSettingValue {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** Temporary Phase 01 screen; Phase 02 replaces it and moves the theme control to Settings. */
export function FoundationScreen({ bridge, info }: { bridge: InfinityBridge; info: AppInfoType }) {
  const [theme, setTheme] = useState<ThemeSettingValue>('system');
  const [message, setMessage] = useState<string | null>(null);

  // Apply the stored theme and follow the OS while it is "system".
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(document.documentElement, resolveTheme(theme, media.matches));
    apply();
    if (theme !== 'system') return undefined;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void bridge.settings.get({ keys: ['appearance.theme'] }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const value = result.data.values['appearance.theme'];
        if (isTheme(value)) setTheme(value);
      } else {
        setMessage(result.error.message);
      }
    });
    const unsubscribe = bridge.subscribe('settings:changed', (payload) => {
      const p = payload as { key?: string; value?: unknown };
      if (p.key === 'appearance.theme' && isTheme(p.value)) setTheme(p.value);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const choose = async (value: ThemeSettingValue) => {
    const previous = theme;
    setTheme(value);
    const result = await bridge.settings.set({ key: 'appearance.theme', value });
    if (result.ok) {
      setMessage(null);
    } else {
      setTheme(previous);
      setMessage(result.error.message);
    }
  };

  return (
    <main className="foundation">
      <h1>Infinity Notes</h1>
      <p>Version {info.version}</p>
      <p>
        Storage ready (SQLite {info.sqlite?.version ?? 'unknown'})
      </p>
      <section aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="section-label">
          Appearance
        </h2>
        <fieldset>
          <legend>Theme</legend>
          {THEMES.map((t) => (
            <label key={t.value} className="radio">
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={theme === t.value}
                onChange={() => void choose(t.value)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
      </section>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}

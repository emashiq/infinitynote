import type { ThemeSettingValue } from '../theme/theme';
import { useServices, useStore } from '../state/use-store';
import { SegmentedControl } from '../ui/SegmentedControl';

export function SettingsPage() {
  const { theme, meta, notices } = useServices();
  const { value } = useStore(theme.store);
  const { info } = useStore(meta);
  return (
    <div className="page">
      <h2 className="view-title">Settings</h2>
      <h3 className="section-label">Appearance</h3>
      <SegmentedControl<ThemeSettingValue>
        label="Theme"
        name="theme"
        value={value}
        onChange={(v) => {
          void theme.set(v).then((res) => {
            if (!res.ok) notices.push(res.message, 'error');
          });
        }}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <h3 className="section-label">About</h3>
      <p>Version {info?.version ?? ''}</p>
      <p>Storage ready (SQLite {info?.sqlite?.version ?? 'unknown'})</p>
    </div>
  );
}

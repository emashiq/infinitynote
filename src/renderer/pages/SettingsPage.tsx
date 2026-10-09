import { useEffect } from 'react';
import type { CloseBehaviorType } from '../../shared/contracts/windows';
import { BackupSettings } from '../settings/BackupSettings';
import { SettingsSection } from '../settings/fields';
import { AboutCredits } from '../shell/HelpDialogs';
import { KeyboardSettings } from '../settings/KeyboardSettings';
import { NotesSettings } from '../settings/NotesSettings';
import type { ThemeSettingValue } from '../theme/theme';
import type { Outcome } from '../state/store';
import { useServices, useStore } from '../state/use-store';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { ReminderSettings } from './ReminderSettings';

export const BACKGROUND_NOTE = 'Reminders and stickies only work while the app is running.';
export const NO_TRAY_NOTE = 'No tray icon is available on this desktop. Launch Infinity Notes again to bring the main window back.';
export const AUTOSTART_LABEL = 'Start Infinity Notes when you sign in';

/** Why the sign-in switch is disabled (D-082). */
function autostartHint(reason: string): string {
  return reason === 'development-build' ? 'Available in the installed app' : 'Not supported by this desktop';
}

/**
 * Settings (UX_SPEC section 5): General, Appearance, Notes and attachments, Reminders, Windows and tray, Backup,
 * Keyboard and About, each a labelled region.
 */
export function SettingsPage() {
  const { theme, meta, notices, windowSettings, reminders, bridge } = useServices();
  const { widget } = useStore(reminders.store);
  useEffect(() => {
    void windowSettings.loadAutostart();
  }, [windowSettings]);
  const { value } = useStore(theme.store);
  const { info } = useStore(meta);
  const windows = useStore(windowSettings.store);
  const report = (result: Promise<Outcome>) => {
    void result.then((res) => {
      if (!res.ok) notices.push(res.message, 'error');
    });
  };
  return (
    <div className="page settings-page">
      <h2 className="view-title">Settings</h2>
      <SettingsSection title="General">
        <p>Storage ready (SQLite {info?.sqlite?.version ?? 'unknown'})</p>
        <div className="button-row">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void bridge.app.showDataFolder().then((res) => {
                if (!res.ok) notices.push(res.error.message, 'error');
              })
            }
          >
            Show data folder
          </button>
        </div>
      </SettingsSection>
      <SettingsSection title="Appearance">
        <SegmentedControl<ThemeSettingValue>
          label="Theme"
          name="theme"
          value={value}
          onChange={(v) => report(theme.set(v))}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </SettingsSection>
      <NotesSettings />
      <ReminderSettings notificationsSupported={windows.notifications?.status !== 'unsupported'} />
      <SettingsSection title="Windows and tray">
        <p className="setting-caption">When the main window closes</p>
        <SegmentedControl<CloseBehaviorType>
          label="When the main window closes"
          name="close-behavior"
          value={windows.closeBehavior}
          onChange={(v) => report(windowSettings.setCloseBehavior(v))}
          options={[
            { value: 'ask', label: 'Ask' },
            { value: 'background', label: 'Keep running' },
            { value: 'quit', label: 'Quit' },
          ]}
        />
        <p className="muted">{BACKGROUND_NOTE}</p>
        {windows.tray && windows.tray.status !== 'supported' ? <p className="muted">{NO_TRAY_NOTE}</p> : null}
        <Switch label="Restore open stickies on startup" checked={windows.restoreOnStartup} onChange={(next) => report(windowSettings.setRestoreOnStartup(next))} />
        <Switch label="Show reminder widget" checked={widget.open} onChange={(next) => void reminders.setWidgetOpen(next)} />
        {windows.autostart ? (
          <Switch
            label={AUTOSTART_LABEL}
            checked={windows.autostart.enabled}
            disabled={windows.autostart.capability.status !== 'supported'}
            title={windows.autostart.capability.status === 'supported' ? undefined : autostartHint(windows.autostart.capability.reason)}
            onChange={(next) => report(windowSettings.setAutostart(next))}
          />
        ) : null}
      </SettingsSection>
      <BackupSettings />
      <KeyboardSettings />
      <SettingsSection title="About">
        <p>Version {info?.version ?? ''}</p>
        <AboutCredits />
      </SettingsSection>
    </div>
  );
}

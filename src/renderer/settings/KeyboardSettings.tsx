import { useEffect, useState } from 'react';
import { GLOBAL_SHORTCUT_PRESETS, SHORTCUT_MESSAGES, acceleratorLabel, type GlobalAcceleratorType, type ShortcutStateType } from '../../shared/contracts/shortcuts';
import { DEFAULT_ZOOM } from '../../shared/zoom';
import { useServices, useStore } from '../state/use-store';
import { Switch } from '../ui/Switch';
import { SelectField, SettingsSection } from './fields';

export const GLOBAL_SHORTCUT_LABEL = 'Quick sticky from anywhere';
export const GLOBAL_SHORTCUT_TEXT = 'Creates a sticky even while another app is in front. It works only while Infinity Notes is running.';
export const ZOOM_KEYS_TEXT =
  'Zoom: Ctrl+= or Ctrl++ zooms in, Ctrl+- zooms out and Ctrl+0 goes back to actual size; Ctrl+mouse wheel works too. The main window, the stickies and the reminder widget each keep their own zoom. Over a PDF, Word, PowerPoint or web page viewer these keys zoom its page instead.';

/** Settings > Keyboard (INF-KEY-05, INF-KEY-06): the optional global quick-sticky shortcut, the zoom keys (D-186) and the keyboard help. */
export function KeyboardSettings() {
  const { bridge, notices, commands, zoom } = useServices();
  const { percent } = useStore(zoom.store);
  const [state, setState] = useState<ShortcutStateType | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge.shortcut.getGlobal().then((res) => {
      if (!cancelled && res.ok) setState(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (!state) return null;
  const supported = state.capability.status === 'supported';
  const save = async (enabled: boolean, accelerator: GlobalAcceleratorType) => {
    const res = await bridge.shortcut.setGlobal({ enabled, accelerator });
    if (res.ok) setState(res.data);
    else notices.push(res.error.message, 'error');
  };
  return (
    <SettingsSection title="Keyboard">
      <Switch
        label={`${GLOBAL_SHORTCUT_LABEL} (${acceleratorLabel(state.accelerator)})`}
        checked={state.enabled}
        disabled={!supported}
        title={supported ? undefined : SHORTCUT_MESSAGES.unsupported}
        onChange={(next) => void save(next, state.accelerator)}
      />
      <SelectField
        label="Shortcut"
        value={state.accelerator}
        disabled={!supported}
        options={GLOBAL_SHORTCUT_PRESETS.map((a) => ({ value: a, label: acceleratorLabel(a) }))}
        onChange={(v) => void save(state.enabled, v as GlobalAcceleratorType)}
      />
      {state.error ? (
        <p role="alert" className="field-error">
          {state.error}
        </p>
      ) : null}
      <p className="muted">{supported ? GLOBAL_SHORTCUT_TEXT : 'This desktop does not let apps use global shortcuts.'}</p>
      <p className="muted">{ZOOM_KEYS_TEXT}</p>
      <div className="button-row">
        <span>{`Main window zoom: ${percent}%`}</span>
        <button type="button" className="btn" disabled={percent === DEFAULT_ZOOM} onClick={() => void commands.run('view.zoomReset')}>
          Actual size
        </button>
      </div>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void commands.run('help.shortcuts')}>
          Show keyboard shortcuts
        </button>
      </div>
    </SettingsSection>
  );
}

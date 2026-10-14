import { useEffect, useRef } from 'react';
import { useServices, useStore } from '../state/use-store';
import { Switch } from '../ui/Switch';
import { SettingsSection } from './fields';
import { useSettingValues } from './use-settings';

export const OFFICE_SETTING_LABEL = 'Office documents (Word, spreadsheets, PowerPoint)';
export const OFFICE_SETTING_TEXT =
  'When this is off, Word, Excel, CSV and PowerPoint files are kept as files: notes attach or link them and they open in your system app. Documents of these kinds you already have stay in their place and open in the system app. PDF and web pages are not affected.';

const KEYS = ['documents.office'] as const;

/**
 * Settings > Documents (D-187): whether Word, spreadsheet and PowerPoint documents open and are edited in the app. A
 * document tab of such a kind asks for this switch while it is off ("Turn on in Settings").
 */
export function DocumentSettings() {
  const { values, set } = useSettingValues(KEYS);
  const { ui } = useServices();
  const { focusRequest } = useStore(ui.store);
  const officeSwitch = useRef<HTMLButtonElement>(null);
  const shown = values !== null;
  useEffect(() => {
    if (focusRequest?.target !== 'officeSetting' || !shown) return;
    ui.consumeFocus();
    officeSwitch.current?.focus();
  }, [focusRequest, shown, ui]);
  if (!values) return null;
  return (
    <SettingsSection title="Documents">
      <Switch label={OFFICE_SETTING_LABEL} checked={values['documents.office']} switchRef={officeSwitch} onChange={(next) => set('documents.office', next)} />
      <p className="muted">{OFFICE_SETTING_TEXT}</p>
    </SettingsSection>
  );
}

import { DOCUMENT_MAX_MB_RANGE, IMAGE_MAX_MB_RANGE } from '../../shared/attachments/limits';
import { AUTO_VERSION_DAYS_RANGE, AUTO_VERSION_MAX_RANGE } from '../../shared/versions/retention';
import { NumberField, SelectField, SettingsSection } from './fields';
import { useSettingValues } from './use-settings';

export const VERSION_RETENTION_TEXT =
  'Versions saved before a conversion, a restore or a recovered draft are kept until the note is deleted forever. Dismissed recovered drafts are deleted after 30 days.';

const KEYS = ['attachments.imageMaxMb', 'attachments.documentMaxMb', 'retention.trashDays', 'retention.autoVersionDays', 'retention.autoVersionMax'] as const;

/** Settings > Notes and attachments (INF-PREF-05, INF-PORT-07): size limits, Trash and version retention. */
export function NotesSettings() {
  const { values, set } = useSettingValues(KEYS);
  if (!values) return null;
  return (
    <SettingsSection title="Notes and attachments">
      <div className="form-row">
        <NumberField
          label="Largest image"
          unit="MB"
          min={IMAGE_MAX_MB_RANGE.min}
          max={IMAGE_MAX_MB_RANGE.max}
          value={values['attachments.imageMaxMb']}
          onCommit={(v) => set('attachments.imageMaxMb', v)}
        />
        <NumberField
          label="Largest file"
          unit="MB"
          min={DOCUMENT_MAX_MB_RANGE.min}
          max={DOCUMENT_MAX_MB_RANGE.max}
          value={values['attachments.documentMaxMb']}
          onCommit={(v) => set('attachments.documentMaxMb', v)}
        />
      </div>
      <SelectField
        label="Empty Trash automatically"
        value={String(values['retention.trashDays'] ?? 'never')}
        options={[
          { value: 'never', label: 'Never' },
          { value: '30', label: 'After 30 days' },
          { value: '90', label: 'After 90 days' },
        ]}
        onChange={(v) => set('retention.trashDays', v === 'never' ? null : (Number(v) as 30 | 90))}
      />
      <div className="form-row">
        <NumberField
          label="Keep automatic versions for"
          unit="days"
          min={AUTO_VERSION_DAYS_RANGE.min}
          max={AUTO_VERSION_DAYS_RANGE.max}
          value={values['retention.autoVersionDays']}
          onCommit={(v) => set('retention.autoVersionDays', v)}
        />
        <NumberField
          label="Most automatic versions per note"
          unit="versions"
          min={AUTO_VERSION_MAX_RANGE.min}
          max={AUTO_VERSION_MAX_RANGE.max}
          value={values['retention.autoVersionMax']}
          onCommit={(v) => set('retention.autoVersionMax', v)}
        />
      </div>
      <p className="muted">{VERSION_RETENTION_TEXT}</p>
    </SettingsSection>
  );
}

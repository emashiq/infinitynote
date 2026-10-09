import type { AddFilesMode } from '../../shared/attachments/file-choice';
import { DOCUMENT_MAX_MB_RANGE, IMAGE_MAX_MB_RANGE } from '../../shared/attachments/limits';
import { AUTO_LOCK_MINUTES } from '../../shared/contracts/locks';
import { AUTO_VERSION_DAYS_RANGE, AUTO_VERSION_MAX_RANGE } from '../../shared/versions/retention';
import { NumberField, SelectField, SettingsSection } from './fields';
import { useSettingValues } from './use-settings';

export const VERSION_RETENTION_TEXT =
  'Versions saved before a conversion, a restore or a recovered draft are kept until the note is deleted forever. Dismissed recovered drafts are deleted after 30 days.';

export const ADD_FILES_OPTIONS: Array<{ value: AddFilesMode; label: string }> = [
  { value: 'ask', label: 'Ask every time' },
  { value: 'copy', label: 'Always copy into Infinity Notes' },
  { value: 'link', label: 'Always link to the original' },
];

export const ADD_FILES_SETTING_TEXT =
  `Copied files travel with backups and exports. Linked files stay where they are and are not in backups or exports. Files larger than the copy limit (at most ${DOCUMENT_MAX_MB_RANGE.max} MB) are always linked.`;

export const AUTO_LOCK_OPTIONS = AUTO_LOCK_MINUTES.map((m) => ({ value: String(m), label: m === 60 ? 'After 1 hour' : `After ${m} minute${m === 1 ? '' : 's'}` }));

export const AUTO_LOCK_TEXT =
  'An unlocked note locks again when it is not opened or edited for this long, when the computer locks or sleeps, and when Infinity Notes quits.';

const KEYS = ['locks.autoLockMinutes', 'attachments.addFiles', 'attachments.imageMaxMb', 'attachments.documentMaxMb', 'retention.trashDays', 'retention.autoVersionDays', 'retention.autoVersionMax'] as const;

/**
 * Settings > Notes and attachments (INF-PREF-05, INF-PORT-07, D-108, D-111): adding files, size limits, Trash and version
 * retention, and when locked notes lock again.
 */
export function NotesSettings() {
  const { values, set } = useSettingValues(KEYS);
  if (!values) return null;
  return (
    <SettingsSection title="Notes and attachments">
      <SelectField
        label="When adding files"
        value={values['attachments.addFiles']}
        options={ADD_FILES_OPTIONS}
        onChange={(v) => set('attachments.addFiles', v as AddFilesMode)}
      />
      <p className="muted">{ADD_FILES_SETTING_TEXT}</p>
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
          label="Largest file to copy"
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
      <SelectField
        label="Lock unlocked notes again"
        value={String(values['locks.autoLockMinutes'])}
        options={AUTO_LOCK_OPTIONS}
        onChange={(v) => set('locks.autoLockMinutes', Number(v) as (typeof AUTO_LOCK_MINUTES)[number])}
      />
      <p className="muted">{AUTO_LOCK_TEXT}</p>
    </SettingsSection>
  );
}

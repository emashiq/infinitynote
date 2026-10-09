import { useEffect, useState } from 'react';
import { AUTO_BACKUP_INTERVAL_DAYS, AUTO_BACKUP_KEEP_COUNTS, type BackupStatusType } from '../../shared/contracts/portability';
import { useServices } from '../state/use-store';
import { Switch } from '../ui/Switch';
import { SelectField, SettingsSection } from './fields';

export const BACKUP_TEXT = 'A backup keeps everything: notes, attachments, versions, Trash, reminders and settings. Restoring one replaces your current data.';
export const EXPORT_TEXT =
  'An export is for moving notes into another notebook: notes, folders, projects, tags, reminders and attachments, without versions, Trash or settings. Importing adds copies and never changes existing notes. Markdown and plain-text exports of a note leave out reminders, tags, sticky colors and image sizes.';
export const AUTO_BACKUP_NOTE = 'Automatic backups are made only while Infinity Notes is running.';

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

type Auto = BackupStatusType['auto'];

/** Settings > Backup (INF-PORT-01..06): manual backup and restore, export and import, automatic backups. */
export function BackupSettings() {
  const { bridge, notices, portability } = useServices();
  const [status, setStatus] = useState<BackupStatusType | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge.backup.status().then((res) => {
      if (!cancelled && res.ok) setStatus(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (!status) return null;
  const apply = async (request: ReturnType<typeof bridge.backup.status>) => {
    const res = await request;
    if (res.ok) setStatus(res.data);
    else notices.push(res.error.message, 'error');
    return res.ok ? res.data : null;
  };
  const setAuto = (patch: Partial<Pick<Auto, 'enabled' | 'intervalDays' | 'keep'>>) => {
    const { enabled, intervalDays, keep } = { ...status.auto, ...patch };
    void apply(bridge.backup.setAuto({ enabled, intervalDays, keep }));
  };
  // Switching automatic backups on without a folder asks for one first.
  const switchAuto = async (enabled: boolean) => {
    if (enabled && status.auto.directory === null) {
      const chosen = await apply(bridge.backup.chooseAutoFolder());
      if (!chosen?.auto.directory) return;
    }
    setAuto({ enabled });
  };
  const { auto, lastAuto, rollbackCopies } = status;
  return (
    <SettingsSection title="Backup">
      <p className="muted">{BACKUP_TEXT}</p>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void portability.backUp()}>
          Back up now…
        </button>
        <button type="button" className="btn" onClick={() => void portability.restore()}>
          Restore from backup…
        </button>
      </div>
      <p className="muted">{EXPORT_TEXT}</p>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void portability.exportAll()}>
          Export all notes…
        </button>
        <button type="button" className="btn" onClick={() => void portability.importNotes()}>
          Import notes…
        </button>
      </div>
      <Switch label="Back up automatically" checked={auto.enabled} onChange={(next) => void switchAuto(next)} />
      <div className="form-row">
        <p className="setting-value">
          <span className="field-label">Backup folder</span>
          <span className="path-text">{auto.directory ?? 'No folder chosen'}</span>
        </p>
        <button type="button" className="btn" onClick={() => void apply(bridge.backup.chooseAutoFolder())}>
          Choose folder…
        </button>
      </div>
      <div className="form-row">
        <SelectField
          label="Back up every"
          value={String(auto.intervalDays)}
          options={AUTO_BACKUP_INTERVAL_DAYS.map((n) => ({ value: String(n), label: n === 1 ? '1 day' : `${n} days` }))}
          onChange={(v) => setAuto({ intervalDays: Number(v) as Auto['intervalDays'] })}
        />
        <SelectField
          label="Keep"
          value={String(auto.keep)}
          options={AUTO_BACKUP_KEEP_COUNTS.map((n) => ({ value: String(n), label: `${n} backups` }))}
          onChange={(v) => setAuto({ keep: Number(v) as Auto['keep'] })}
        />
      </div>
      <p className="muted">{AUTO_BACKUP_NOTE}</p>
      {lastAuto ? (
        <p role="status" className={lastAuto.ok ? 'muted' : 'field-error'}>
          {lastAuto.ok ? `Last automatic backup: ${when(lastAuto.at)}` : `${lastAuto.message} (${when(lastAuto.at)})`}
        </p>
      ) : null}
      {rollbackCopies.length > 0 ? (
        <div className="form-row">
          <p className="muted">{`A copy of the data replaced by the restore on ${when(rollbackCopies[0]!.createdAt)} is kept.`}</p>
          <button type="button" className="btn" onClick={() => void apply(bridge.backup.deleteRollback())}>
            Delete previous data
          </button>
        </div>
      ) : null}
    </SettingsSection>
  );
}

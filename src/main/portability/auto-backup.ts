import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_EXTENSION, type LastAutoBackupType } from '../../shared/contracts/portability';
import { DAY_MS } from '../../shared/versions/retention';
import { errorDetail } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { Logger } from '../services/logger';
import type { SettingsService } from '../services/settings-service';

/** Only files with this exact name pattern are ever pruned from the user's folder. */
export const AUTO_BACKUP_NAME_RE = new RegExp(`^Infinity Notes auto \\d{4}-\\d{2}-\\d{2} \\d{6}\\.${BACKUP_EXTENSION}$`);
/** A failed automatic backup is tried again after an hour, not at every check. */
export const AUTO_BACKUP_RETRY_MS = 60 * 60 * 1000;
export const AUTO_BACKUP_FAILED = 'The automatic backup could not be written to the chosen folder.';

/** "Infinity Notes auto 2026-10-09 143005.infinitybackup" in local time; names sort by time. */
export function autoBackupName(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `Infinity Notes auto ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${BACKUP_EXTENSION}`;
}

export interface AutoBackupDeps {
  settings: Pick<SettingsService, 'getInternal' | 'setInternal'>;
  clock: Clock;
  logger: Logger;
  /** Writes one backup to the given file. */
  write(file: string): Promise<unknown>;
}

/**
 * Automatic backup (INF-PORT-06): off by default; when on, a backup goes to the chosen folder once the interval has
 * passed since the last successful one, and only the newest `keep` automatic backups stay there.
 */
export class AutoBackup {
  constructor(private readonly deps: AutoBackupDeps) {}

  isDue(now: number): boolean {
    const auto = this.deps.settings.getInternal('backup.auto');
    if (!auto.enabled || auto.directory === null) return false;
    const last = this.deps.settings.getInternal('backup.lastAuto');
    if (last === null) return true;
    return now - last.at >= (last.ok ? auto.intervalDays * DAY_MS : AUTO_BACKUP_RETRY_MS);
  }

  /** Writes a backup when one is due; returns the recorded result, or null when none was due. */
  async runIfDue(): Promise<LastAutoBackupType> {
    const now = this.deps.clock.now();
    if (!this.isDue(now)) return null;
    const { directory, keep } = this.deps.settings.getInternal('backup.auto');
    const file = path.join(directory!, autoBackupName(now));
    let result: NonNullable<LastAutoBackupType>;
    try {
      await this.deps.write(file);
      result = { at: now, ok: true, file, message: null };
      await this.prune(directory!, keep).catch((err: unknown) => this.deps.logger.warn(`auto backup: pruning failed ${errorDetail(err)}`));
    } catch (err) {
      this.deps.logger.error(`auto backup: failed ${errorDetail(err)}`);
      result = { at: now, ok: false, file: null, message: AUTO_BACKUP_FAILED };
    }
    this.deps.settings.setInternal('backup.lastAuto', result);
    return result;
  }

  private async prune(directory: string, keep: number): Promise<void> {
    const names = (await fs.promises.readdir(directory)).filter((n) => AUTO_BACKUP_NAME_RE.test(n)).sort().reverse();
    for (const old of names.slice(keep)) await fs.promises.rm(path.join(directory, old), { force: true });
  }
}

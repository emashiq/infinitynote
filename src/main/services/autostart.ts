import fs from 'node:fs';
import path from 'node:path';
import type { CapabilityStatusType } from '../../shared/contracts/app';
import { REMINDER_MESSAGES } from '../../shared/contracts/reminders';
import { LAUNCHED_AT_LOGIN_ARG, type AutostartStateType } from '../../shared/contracts/widget';
import { AppError, errorMessage } from './app-error';
import type { Logger } from './logger';

/** Reads and changes whether the OS starts the app at sign-in (D-082). */
export interface AutostartAdapter {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

/**
 * Launch at login exists only for installed builds: Windows login items, an XDG autostart entry on a Linux desktop.
 * Development builds and WSL (no desktop session autostart) report unsupported.
 */
export function autostartCapability(i: { platform: string; isPackaged: boolean; wsl: boolean }): CapabilityStatusType {
  if (!i.isPackaged) return { status: 'unsupported', reason: 'development-build' };
  if (i.platform === 'win32') return { status: 'supported', reason: 'login-items' };
  if (i.platform === 'linux') return i.wsl ? { status: 'unsupported', reason: 'wsl-no-session-autostart' } : { status: 'supported', reason: 'xdg-autostart' };
  return { status: 'unsupported', reason: 'unsupported-platform' };
}

/**
 * One Exec argument (Desktop Entry spec): double-quoted with `"`, `` ` ``, `$` and `\` escaped, then the string-level
 * escape of backslashes; `%` is doubled so it is never a field code.
 */
export function desktopExecArg(arg: string): string {
  const quoted = `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

export function desktopEntry(opts: { exec: string; name: string }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${opts.name}`,
    `Exec=${desktopExecArg(opts.exec)} ${LAUNCHED_AT_LOGIN_ARG}`,
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=true',
    '',
  ].join('\n');
}

export const AUTOSTART_FILE = 'infinity-notes.desktop';

/** `$XDG_CONFIG_HOME/autostart/infinity-notes.desktop`, written atomically and only for this executable. */
export function createXdgAutostart(opts: { configHome: string; exec: string; name: string }): AutostartAdapter {
  const dir = path.join(opts.configHome, 'autostart');
  const file = path.join(dir, AUTOSTART_FILE);
  const execLine = `Exec=${desktopExecArg(opts.exec)} ${LAUNCHED_AT_LOGIN_ARG}`;
  return {
    isEnabled() {
      try {
        return fs.readFileSync(file, 'utf8').split('\n').includes(execLine);
      } catch {
        return false;
      }
    },
    setEnabled(enabled) {
      if (!enabled) {
        fs.rmSync(file, { force: true });
        return;
      }
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, desktopEntry({ exec: opts.exec, name: opts.name }), { encoding: 'utf8', mode: 0o644 });
      fs.renameSync(tmp, file);
    },
  };
}

export interface AutostartControl {
  get(): AutostartStateType;
  set(enabled: boolean): AutostartStateType;
}

/** The `autostart:get|set` behavior: the OS state is read live; a change is refused where unsupported. */
export function createAutostartControl(deps: { adapter: AutostartAdapter; capability: () => CapabilityStatusType; logger: Logger }): AutostartControl {
  const get = (): AutostartStateType => {
    const capability = deps.capability();
    return { enabled: capability.status === 'supported' && deps.adapter.isEnabled(), capability };
  };
  return {
    get,
    set(enabled) {
      if (deps.capability().status !== 'supported') throw new AppError('UNSUPPORTED', REMINDER_MESSAGES.unsupported);
      try {
        deps.adapter.setEnabled(enabled);
        deps.logger.info(`autostart: set enabled=${enabled} result=ok`);
      } catch (err) {
        deps.logger.error(`autostart: set enabled=${enabled} result=error ${errorMessage(err)}`);
        throw new AppError('INTERNAL', REMINDER_MESSAGES.startupSetting);
      }
      return get();
    },
  };
}

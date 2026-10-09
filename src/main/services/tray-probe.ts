import { execFile } from 'node:child_process';

/** Whether a well-known name has an owner on the session bus: a tray host (D-067) or a notification server (D-076). */
export type BusNamePresence = 'present' | 'absent' | 'unknown';
export type TrayHost = BusNamePresence;

/** Runs a program without a shell; rejects on a non-zero exit, a missing program (code ENOENT) or the timeout. */
export type ExecFileFn = (file: string, args: readonly string[], options: { timeoutMs: number }) => Promise<string>;

export const TRAY_PROBE_TIMEOUT_MS = 2000;
const WATCHER = 'org.kde.StatusNotifierWatcher';

const gdbusArgs = (name: string) => [
  'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
  '--method', 'org.freedesktop.DBus.NameHasOwner', name,
];
const dbusSendArgs = (name: string) => [
  '--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus',
  'org.freedesktop.DBus.NameHasOwner', `string:${name}`,
];

/** Reads the NameHasOwner answer of gdbus (`(true,)`) or dbus-send (`boolean true`). */
export function parseNameHasOwner(stdout: string): BusNamePresence {
  const answer = /^\s*\(\s*(true|false)\s*,\s*\)\s*$/.exec(stdout)?.[1] ?? /\bboolean\s+(true|false)\b/.exec(stdout)?.[1];
  if (answer === 'true') return 'present';
  if (answer === 'false') return 'absent';
  return 'unknown';
}

const isMissingProgram = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === 'ENOENT';

/**
 * Asks the session bus whether a name has an owner: gdbus, or dbus-send when gdbus is not installed. A missing tool, a
 * failure, the overall timeout or an unreadable answer gives `unknown`.
 */
export async function detectBusName(exec: ExecFileFn, name: string, timeoutMs = TRAY_PROBE_TIMEOUT_MS, now: () => number = Date.now): Promise<BusNamePresence> {
  const deadline = now() + timeoutMs;
  for (const [program, args] of [['gdbus', gdbusArgs(name)], ['dbus-send', dbusSendArgs(name)]] as const) {
    const remaining = deadline - now();
    if (remaining <= 0) return 'unknown';
    try {
      return parseNameHasOwner(await exec(program, args, { timeoutMs: remaining }));
    } catch (err) {
      if (!isMissingProgram(err)) return 'unknown';
    }
  }
  return 'unknown';
}

/** Whether a StatusNotifier tray host is running (D-067). */
export function detectStatusNotifierHost(exec: ExecFileFn, timeoutMs = TRAY_PROBE_TIMEOUT_MS, now: () => number = Date.now): Promise<TrayHost> {
  return detectBusName(exec, WATCHER, timeoutMs, now);
}

export const nodeExecFile: ExecFileFn = (file, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });

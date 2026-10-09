import fs from 'node:fs';
import type { CapabilitiesType, CapabilityStatusType } from '../../shared/contracts/app';
import { autostartCapability } from './autostart';
import type { BusNamePresence, TrayHost } from './tray-probe';

export interface CapabilityInputs {
  platform: string;
  /** Launch at login exists only for installed builds (D-082). */
  isPackaged: boolean;
  ozonePlatform: string | null;
  xdgSessionType: string | null;
  waylandDisplay: string | null;
  display: string | null;
  wslDistro: string | null;
  wslgVersion: string | null;
  /** Linux only: whether a StatusNotifier tray host was found on the session bus (D-067); null elsewhere. */
  statusNotifierHost: TrayHost | null;
  /** Linux only: whether a notification server owns org.freedesktop.Notifications (D-076); null elsewhere. */
  notificationServer: BusNamePresence | null;
}

const supported = (reason: string): CapabilityStatusType => ({ status: 'supported', reason });
const unsupported = (reason: string): CapabilityStatusType => ({ status: 'unsupported', reason });
const unknown = (reason: string): CapabilityStatusType => ({ status: 'unknown', reason });

/** Electron reports notifications as supported even without a server, so the session bus decides (D-076). */
function linuxNotifications(server: BusNamePresence | null): CapabilityStatusType {
  if (server === 'present') return supported('notification-server');
  if (server === 'absent') return unsupported('no-notification-server');
  return unknown('notification-server-unknown');
}

function linuxTray(host: TrayHost | null): CapabilityStatusType {
  if (host === 'present') return supported('status-notifier-host');
  if (host === 'absent') return unsupported('no-status-notifier-host');
  return unknown('status-notifier-host-unknown');
}

/** Pure capability detection (W01-14). Never reports `supported` without detection. */
export function detectCapabilities(i: CapabilityInputs): CapabilitiesType {
  const platform = i.platform === 'win32' ? 'win32' : i.platform === 'linux' ? 'linux' : 'other';
  const base = {
    notificationActions: unsupported('not-promised-on-all-desktops'),
    launchAtLogin: autostartCapability({ platform: i.platform, isPackaged: i.isPackaged, wsl: i.wslDistro !== null }),
  };

  if (platform === 'win32') {
    return {
      platform,
      environment: 'windows',
      sessionType: 'windows',
      ozonePlatform: null,
      windowPositioning: supported('native-windows'),
      alwaysOnTop: supported('native-windows'),
      tray: supported('native-windows'),
      nativeNotifications: supported('native-windows'),
      globalShortcut: supported('native-windows'),
      ...base,
    };
  }

  if (platform === 'linux') {
    const wsl = i.wslDistro !== null;
    const ozone = i.ozonePlatform && i.ozonePlatform !== 'auto' ? i.ozonePlatform : null;
    const wayland = ozone === 'wayland' || (ozone === null && i.xdgSessionType === 'wayland');
    const x11 = ozone === 'x11' || (ozone === null && i.xdgSessionType === 'x11');
    const sessionType = wayland ? 'wayland' : x11 ? 'x11' : 'unknown';
    const environment = wsl ? 'wslg' : 'linux-desktop';
    if (wsl || wayland) {
      return {
        platform,
        environment,
        sessionType: wsl && !wayland && !x11 ? 'wayland' : sessionType,
        ozonePlatform: i.ozonePlatform,
        windowPositioning: unsupported('wayland-or-wslg'),
        alwaysOnTop: unsupported('wayland-or-wslg'),
        tray: linuxTray(i.statusNotifierHost),
        nativeNotifications: linuxNotifications(i.notificationServer),
        // Wayland gives no global key grabs to applications (D-099).
        globalShortcut: unsupported('wayland-or-wslg'),
        ...base,
      };
    }
    return {
      platform,
      environment,
      sessionType,
      ozonePlatform: i.ozonePlatform,
      windowPositioning: x11 ? supported('window-manager-may-adjust') : unknown('session-type-unknown'),
      alwaysOnTop: unknown('window-manager-dependent'),
      tray: linuxTray(i.statusNotifierHost),
      nativeNotifications: linuxNotifications(i.notificationServer),
      globalShortcut: x11 ? supported('x11') : unknown('session-type-unknown'),
      ...base,
    };
  }

  return {
    platform: 'other',
    environment: 'unknown',
    sessionType: 'unknown',
    ozonePlatform: null,
    windowPositioning: unknown('unsupported-platform'),
    alwaysOnTop: unknown('unsupported-platform'),
    tray: unknown('unsupported-platform'),
    nativeNotifications: unknown('unsupported-platform'),
    globalShortcut: unknown('unsupported-platform'),
    ...base,
  };
}

export function readWslgVersion(file = '/mnt/wslg/versions.txt'): string | null {
  try {
    const first = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]?.trim();
    return first ? first : null;
  } catch {
    return null;
  }
}

/** Capabilities a test run may force (unpackaged E2E only, plan section 8.9). */
const OVERRIDABLE = ['windowPositioning', 'alwaysOnTop', 'tray', 'nativeNotifications', 'launchAtLogin', 'globalShortcut'] as const;
const STATUSES: ReadonlySet<string> = new Set(['supported', 'unsupported', 'unknown']);

/**
 * Applies INFINITY_NOTES_TEST_CAPS, a JSON object mapping windowPositioning, alwaysOnTop, tray, nativeNotifications,
 * launchAtLogin and globalShortcut to a status.
 * Unknown keys and values are ignored; invalid JSON leaves the capabilities unchanged and returns a warning.
 */
export function applyCapabilityOverride(caps: CapabilitiesType, raw: string | undefined): { caps: CapabilitiesType; warning: string | null } {
  if (raw === undefined || raw === '') return { caps, warning: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { caps, warning: 'INFINITY_NOTES_TEST_CAPS ignored: invalid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { caps, warning: 'INFINITY_NOTES_TEST_CAPS ignored: not an object' };
  }
  const next = { ...caps };
  for (const key of OVERRIDABLE) {
    const status = (parsed as Record<string, unknown>)[key];
    if (typeof status === 'string' && STATUSES.has(status)) {
      next[key] = { status: status as CapabilityStatusType['status'], reason: 'test-override' };
    }
  }
  return { caps: next, warning: null };
}

/** Reads the live process environment. Electron's ozone switch and the session-bus probe results come from the caller. */
export function collectCapabilityInputs(
  ozoneSwitch: string | null,
  probes: { statusNotifierHost: TrayHost | null; notificationServer: BusNamePresence | null },
  isPackaged: boolean,
): CapabilityInputs {
  const env = process.env;
  return {
    platform: process.platform,
    isPackaged,
    ozonePlatform: ozoneSwitch && ozoneSwitch !== '' ? ozoneSwitch : null,
    xdgSessionType: env.XDG_SESSION_TYPE ?? null,
    waylandDisplay: env.WAYLAND_DISPLAY ?? null,
    display: env.DISPLAY ?? null,
    wslDistro: env.WSL_DISTRO_NAME ?? null,
    wslgVersion: process.platform === 'linux' ? readWslgVersion() : null,
    ...probes,
  };
}

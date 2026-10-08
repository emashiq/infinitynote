import fs from 'node:fs';
import type { CapabilitiesType, CapabilityStatusType } from '../../shared/contracts/app';

export interface CapabilityInputs {
  platform: string;
  ozonePlatform: string | null;
  xdgSessionType: string | null;
  waylandDisplay: string | null;
  display: string | null;
  wslDistro: string | null;
  wslgVersion: string | null;
}

const supported = (reason: string): CapabilityStatusType => ({ status: 'supported', reason });
const unsupported = (reason: string): CapabilityStatusType => ({ status: 'unsupported', reason });
const unknown = (reason: string): CapabilityStatusType => ({ status: 'unknown', reason });
const later = (): CapabilityStatusType => unknown('detected-in-later-phase');

/** Pure capability detection (W01-14). Never reports `supported` without detection. */
export function detectCapabilities(i: CapabilityInputs): CapabilitiesType {
  const platform = i.platform === 'win32' ? 'win32' : i.platform === 'linux' ? 'linux' : 'other';
  const base = {
    tray: later(),
    nativeNotifications: later(),
    notificationActions: unsupported('not-promised-on-all-desktops'),
    launchAtLogin: later(),
    globalShortcut: later(),
  };

  if (platform === 'win32') {
    return {
      platform,
      environment: 'windows',
      sessionType: 'windows',
      ozonePlatform: null,
      windowPositioning: supported('native-windows'),
      alwaysOnTop: supported('native-windows'),
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

/** Reads the live process environment. Electron's ozone switch is passed in by the caller. */
export function collectCapabilityInputs(ozoneSwitch: string | null): CapabilityInputs {
  const env = process.env;
  return {
    platform: process.platform,
    ozonePlatform: ozoneSwitch && ozoneSwitch !== '' ? ozoneSwitch : null,
    xdgSessionType: env.XDG_SESSION_TYPE ?? null,
    waylandDisplay: env.WAYLAND_DISPLAY ?? null,
    display: env.DISPLAY ?? null,
    wslDistro: env.WSL_DISTRO_NAME ?? null,
    wslgVersion: process.platform === 'linux' ? readWslgVersion() : null,
  };
}

import { detectBusName, TRAY_PROBE_TIMEOUT_MS, type BusNamePresence, type ExecFileFn } from './tray-probe';

/** The freedesktop notification service; Electron's Notification.isSupported() is true even without it (probe, D-076). */
export const NOTIFICATIONS_BUS_NAME = 'org.freedesktop.Notifications';

/** Whether a Linux notification server is running, with the same bounded, shell-free probe as the tray host. */
export function detectNotificationServer(exec: ExecFileFn, timeoutMs = TRAY_PROBE_TIMEOUT_MS, now: () => number = Date.now): Promise<BusNamePresence> {
  return detectBusName(exec, NOTIFICATIONS_BUS_NAME, timeoutMs, now);
}

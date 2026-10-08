import { z } from 'zod';
import { MAX_URL_LENGTH } from '../url-policy';
import { Uuid } from './ids';

export const StartupErrorCode = z.enum(['MIGRATION_FAILED', 'SCHEMA_TOO_NEW', 'DB_OPEN_FAILED']);
export type StartupErrorCodeType = z.infer<typeof StartupErrorCode>;

export const StartupState = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok') }),
  z.strictObject({ status: z.literal('error'), code: StartupErrorCode }),
]);
export type StartupStateType = z.infer<typeof StartupState>;

export const AppInfo = z.strictObject({
  name: z.string(),
  version: z.string(),
  isPackaged: z.boolean(),
  unsignedBuild: z.literal(true),
  platform: z.string(),
  arch: z.string(),
  versions: z.strictObject({ electron: z.string(), chrome: z.string(), node: z.string() }),
  sqlite: z
    .strictObject({
      driver: z.string(),
      version: z.string(),
      fts5: z.boolean(),
      json: z.boolean(),
    })
    .nullable(),
  schemaVersion: z.number().int().nullable(),
  startup: StartupState,
});
export type AppInfoType = z.infer<typeof AppInfo>;

export const CapabilityStatus = z.strictObject({
  status: z.enum(['supported', 'unsupported', 'unknown']),
  reason: z.string(),
});
export type CapabilityStatusType = z.infer<typeof CapabilityStatus>;

export const Capabilities = z.strictObject({
  platform: z.enum(['win32', 'linux', 'other']),
  environment: z.enum(['windows', 'wslg', 'linux-desktop', 'unknown']),
  sessionType: z.enum(['windows', 'wayland', 'x11', 'unknown']),
  ozonePlatform: z.string().nullable(),
  windowPositioning: CapabilityStatus,
  alwaysOnTop: CapabilityStatus,
  tray: CapabilityStatus,
  nativeNotifications: CapabilityStatus,
  notificationActions: CapabilityStatus,
  launchAtLogin: CapabilityStatus,
  globalShortcut: CapabilityStatus,
});
export type CapabilitiesType = z.infer<typeof Capabilities>;

/**
 * Acknowledged flush before a window closes or the app quits (INF-SAVE-01, D-072): main asks why, the renderer
 * answers whether its text is saved (or kept by main as a draft).
 */
export const FlushReason = z.enum(['close', 'quit']);
export type FlushReasonType = z.infer<typeof FlushReason>;
export const AppFlushRequestEvent = z.strictObject({ flushId: Uuid, reason: FlushReason });
export type AppFlushRequestEventType = z.infer<typeof AppFlushRequestEvent>;
export const AppFlushedRequest = z.strictObject({ flushId: Uuid, saved: z.boolean() });

export const ShellOpenExternalRequest = z.strictObject({ url: z.string().min(1).max(MAX_URL_LENGTH) });
export const ShellOpenExternalResponse = z.strictObject({ opened: z.literal(true) });

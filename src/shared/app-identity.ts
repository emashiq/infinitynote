export const APP_ID = 'com.infinitynotes.desktop';
/** The packaged app's Windows toast activator (COM) CLSID; the uninstaller removes its registration (installer.nsh). */
export const TOAST_ACTIVATOR_CLSID = '{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}';
export const DEV_APP_ID = `${APP_ID}.dev`;
export const DEV_TOAST_ACTIVATOR_CLSID = '{998F6E0F-58F6-4AC2-950E-A82981DA57C4}';

/**
 * How Windows identifies the app's notifications: the production IDs only for packaged builds. Electron registers a
 * Start menu shortcut and a COM activator for the IDs it is given; unpackaged runs (npm run dev, the E2E suites) with the
 * production ID made that development registration claim the installed app's toasts and clicks (N-D1). A pinned CLSID
 * also stops Electron from registering a new random one on every run, so the uninstaller knows the key it owns (N-D3).
 */
export function windowsNotificationIdentity(isPackaged: boolean): { appUserModelId: string; toastActivatorClsid: string } {
  return isPackaged
    ? { appUserModelId: APP_ID, toastActivatorClsid: TOAST_ACTIVATOR_CLSID }
    : { appUserModelId: DEV_APP_ID, toastActivatorClsid: DEV_TOAST_ACTIVATOR_CLSID };
}
export const PRODUCT_NAME = 'Infinity Notes';
export const NPM_NAME = 'infinity-notes';
export const LINUX_EXECUTABLE = 'infinity-notes';
export const RENDERER_SCHEME = 'infinity-app';
export const RENDERER_HOST = 'renderer';
export const ATTACHMENT_SCHEME = 'infinity-attachment';
export const APP_VERSION = '0.1.0';
export const AUTHOR_NAME = 'Ashiqur Rahman Emran';
export const DEVELOPER_CREDIT = `Developed by ${AUTHOR_NAME}`;
/** Also electron-builder's copyright field (checked by the app identity test). */
export const COPYRIGHT = `Copyright © 2026 ${AUTHOR_NAME}`;

/** The only URL form under which the renderer loads a stored image (INF-FND-08). */
export const attachmentUrl = (attachmentId: string): string => `${ATTACHMENT_SCHEME}://${attachmentId}`;

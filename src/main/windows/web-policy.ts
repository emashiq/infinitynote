import { HTML_DOCUMENT_SCHEME, RENDERER_HOST, RENDERER_SCHEME } from '../../shared/app-identity';

/** True if the URL has the renderer origin (or the dev server origin in development). */
export function isAllowedRendererUrl(raw: string, devOrigin: string | null): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === `${RENDERER_SCHEME}:` && u.host === RENDERER_HOST) return true;
    if (devOrigin) {
      const d = new URL(devOrigin);
      return u.protocol === d.protocol && u.host === d.host;
    }
  } catch {
    // fall through
  }
  return false;
}

/**
 * Whether a subframe may navigate (D-118): only the HTML viewer frame exists, and the app itself points it at an
 * `infinity-html:` document. Anything a page in the frame starts (a link, a refresh, a form) goes nowhere.
 */
export function isAllowedFrameNavigation(raw: string, initiatedByApp: boolean): boolean {
  if (!initiatedByApp) return false;
  try {
    return new URL(raw).protocol === `${HTML_DOCUMENT_SCHEME}:`;
  } catch {
    return false;
  }
}

/**
 * The only web permission the app grants (D-118): writing text to the clipboard ("Copy link"), and only to its own page.
 * Everything else (camera, notifications, reading the clipboard, …) stays denied.
 */
export function isAllowedPermission(permission: string, requestingUrl: string, devOrigin: string | null): boolean {
  return permission === 'clipboard-sanitized-write' && isAllowedRendererUrl(requestingUrl, devOrigin);
}

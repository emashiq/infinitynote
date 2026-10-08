import { app, session } from 'electron';
import { RENDERER_HOST, RENDERER_SCHEME } from '../../shared/app-identity';
import type { Logger } from '../services/logger';

function originOf(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'invalid-url';
  }
}

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

export function installWebSecurity(options: { logger: Logger; devOrigin: string | null }): void {
  const { logger, devOrigin } = options;

  app.on('web-contents-created', (_event, contents) => {
    const guard = (event: { preventDefault(): void }, url: string) => {
      if (!isAllowedRendererUrl(url, devOrigin)) {
        event.preventDefault();
        logger.warn(`blocked navigation url=${originOf(url)}`);
      }
    };
    contents.on('will-navigate', (event, url) => guard(event, url));
    contents.on('will-redirect', (event, url) => guard(event, url));
    contents.setWindowOpenHandler(() => {
      logger.warn('blocked window.open');
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      logger.warn('blocked webview attach');
    });
  });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

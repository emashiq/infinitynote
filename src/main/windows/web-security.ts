import { app, session } from 'electron';
import type { Logger } from '../services/logger';
import { isAllowedFrameNavigation, isAllowedPermission, isAllowedRendererUrl } from './web-policy';

function originOf(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'invalid-url';
  }
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
    contents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) return;
      if (!isAllowedFrameNavigation(event.url, event.initiator?.parent === null)) {
        event.preventDefault();
        logger.warn(`blocked frame navigation url=${originOf(event.url)}`);
      }
    });
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
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(isAllowedPermission(permission, details.requestingUrl, devOrigin)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => isAllowedPermission(permission, requestingOrigin, devOrigin));
  ses.setDevicePermissionHandler(() => false);
}

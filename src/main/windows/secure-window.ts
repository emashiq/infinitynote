import type { BrowserWindow, WebPreferences } from 'electron';
import { RENDERER_HOST, RENDERER_SCHEME } from '../../shared/app-identity';
import type { Logger } from '../services/logger';
import type { WindowHooks } from '../window-lifecycle';
import type { SenderInfo, WindowRegistry } from './window-registry';

/** The one hardened preference set of every app window (INF-FND-03). */
export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    safeDialogs: true,
  };
}

/** The bundled renderer (or the dev server in development) at a window route such as `#/` or `#/sticky/<id>`. */
export function rendererUrl(devUrl: string | null, hash: string): string {
  return devUrl ? `${devUrl}${hash}` : `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html${hash}`;
}

/**
 * Common wiring of an app window: its registry entry (added before the page loads, so its first IPC call passes the
 * sender policy, and removed when it closes), the renderer lifecycle hooks and the load log line.
 */
export function trackWindow(win: BrowserWindow, opts: { registry: WindowRegistry; sender: SenderInfo; hooks: WindowHooks; logger: Logger }): number {
  const wc = win.webContents;
  const id = wc.id;
  opts.registry.add({
    webContentsId: id,
    ...opts.sender,
    send: (channel, payload) => wc.send(channel, payload),
    isDestroyed: () => win.isDestroyed() || wc.isDestroyed(),
  });
  win.on('closed', () => opts.registry.remove(id));
  win.on('session-end', () => opts.hooks.onSessionEnd());
  wc.on('render-process-gone', (_event, details) =>
    opts.hooks.onRendererGone(id, details.reason, () => {
      if (!win.isDestroyed()) wc.reload();
    }),
  );
  wc.on('did-navigate', () => opts.hooks.onNavigated(id));
  wc.on('did-finish-load', () => {
    try {
      const u = new URL(wc.getURL());
      opts.logger.info(`renderer:loaded origin=${u.protocol}//${u.host} role=${opts.sender.role}`);
    } catch {
      opts.logger.info(`renderer:loaded origin=unknown role=${opts.sender.role}`);
    }
  });
  return id;
}

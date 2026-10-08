import type { Logger } from './logger';

export type NetworkDecision = 'allow' | 'cancel';

const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * Decides whether a request may proceed. Network schemes are cancelled except for the Vite
 * dev server and its HMR websocket (same hostname and port as devOrigin, development only).
 */
export function decideRequest(rawUrl: string, devOrigin?: string | null): NetworkDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'cancel';
  }
  if (!NETWORK_PROTOCOLS.has(url.protocol)) return 'allow';
  if (devOrigin) {
    try {
      const dev = new URL(devOrigin);
      if (url.hostname === dev.hostname && url.port === dev.port) return 'allow';
    } catch {
      // invalid dev origin: fall through to cancel
    }
  }
  return 'cancel';
}

export interface SessionLike {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void,
    ): void;
  };
}

export function installNetworkGuard(
  session: SessionLike,
  options: { devOrigin?: string | null; logger: Logger; onBlocked?: (origin: string) => void },
): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (decideRequest(details.url, options.devOrigin) === 'cancel') {
      let origin = 'invalid-url';
      try {
        const u = new URL(details.url);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        // keep placeholder
      }
      options.logger.warn(`network: blocked ${origin}`);
      options.onBlocked?.(details.url);
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });
}

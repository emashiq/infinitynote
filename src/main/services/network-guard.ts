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

/** The only hosts main itself may reach, each only for an AI action on its API (D-190). */
export const AI_API_HOSTS = { anthropic: 'api.anthropic.com', openai: 'api.openai.com' } as const;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A fetch for one AI request (D-190): it reaches `https://<host>` only, and only until the request is over (`close`).
 * The SDKs get it as their transport, so nothing they do reaches another host, and nothing reaches the network after
 * the action ends. A redirect is refused rather than followed, since it would lead past this check. Renderer requests
 * stay under the session guard above.
 */
export function aiRequestFetch(host: string, logger: Logger, base: FetchLike = fetch): { fetch: FetchLike; close(): void } {
  let open = true;
  const guarded: FetchLike = (input, init) => {
    let url: URL;
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    } catch {
      return Promise.reject(new Error('network: blocked invalid-url'));
    }
    if (!open || url.protocol !== 'https:' || url.hostname !== host || url.port !== '') {
      logger.warn(`network: blocked ${url.protocol}//${url.host} (AI request ${open ? 'to another host' : 'over'})`);
      return Promise.reject(new Error(`network: blocked ${url.protocol}//${url.host}`));
    }
    return base(input, { ...init, redirect: 'error' });
  };
  return {
    fetch: guarded,
    close: () => {
      open = false;
    },
  };
}

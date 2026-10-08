import { RENDERER_HOST, RENDERER_SCHEME } from '../../shared/app-identity';

export interface IpcEventLike {
  sender: { id: number };
  senderFrame: { url: string; parent: unknown | null } | null;
}

export type SenderPolicy = (event: IpcEventLike) => boolean;

/**
 * Allows only the top-level frame of a registered window whose URL is the renderer origin
 * (or the dev server origin in development). The custom scheme compares protocol and host
 * because URL.origin is "null" for non-special schemes.
 */
export function createSenderPolicy(options: {
  registry: { has(webContentsId: number): boolean };
  devOrigin?: string | null;
}): SenderPolicy {
  let dev: URL | null = null;
  if (options.devOrigin) {
    try {
      dev = new URL(options.devOrigin);
    } catch {
      dev = null;
    }
  }
  return (event) => {
    const frame = event.senderFrame;
    if (!frame) return false;
    if (frame.parent !== null) return false;
    if (!options.registry.has(event.sender.id)) return false;
    let url: URL;
    try {
      url = new URL(frame.url);
    } catch {
      return false;
    }
    if (url.protocol === `${RENDERER_SCHEME}:` && url.host === RENDERER_HOST) return true;
    if (dev && url.protocol === dev.protocol && url.host === dev.host) return true;
    return false;
  };
}

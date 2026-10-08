import { RENDERER_HOST, RENDERER_SCHEME } from '../../shared/app-identity';
import type { SenderInfo } from '../windows/window-registry';

export interface IpcEventLike {
  sender: { id: number };
  senderFrame: { url: string; parent: unknown | null } | null;
}

/** The sender's window role, or null when the request must be refused. */
export type SenderPolicy = (event: IpcEventLike) => SenderInfo | null;

/**
 * Allows only the top-level frame of a registered window whose URL is the renderer origin
 * (or the dev server origin in development). The custom scheme compares protocol and host
 * because URL.origin is "null" for non-special schemes. The role comes from the registry (D-064).
 */
export function createSenderPolicy(options: {
  registry: { info(webContentsId: number): SenderInfo | undefined };
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
    if (!frame) return null;
    if (frame.parent !== null) return null;
    const info = options.registry.info(event.sender.id);
    if (!info) return null;
    let url: URL;
    try {
      url = new URL(frame.url);
    } catch {
      return null;
    }
    if (url.protocol === `${RENDERER_SCHEME}:` && url.host === RENDERER_HOST) return info;
    if (dev && url.protocol === dev.protocol && url.host === dev.host) return info;
    return null;
  };
}

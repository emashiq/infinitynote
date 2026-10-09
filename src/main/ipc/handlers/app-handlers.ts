import type { AppInfoType, CapabilitiesType } from '../../../shared/contracts/app';
import { parseExternalUrl } from '../../../shared/url-policy';
import { AppError } from '../../services/app-error';
import type { ShellAdapter } from '../../services/shell-adapter';
import type { IpcRouter } from '../router';

export interface AppHandlerDeps {
  getInfo(): AppInfoType;
  /** Test hooks only (E2E): holds the answer back, so the startup loader stays up long enough to be seen. */
  beforeInfo?: () => Promise<void>;
  getCapabilities(): CapabilitiesType;
  shell: ShellAdapter;
  dataDir: string;
  quit(): void;
  /** Records a renderer's flush answer (is its text saved); false for an unknown flush or a different sender. */
  flushed(webContentsId: number, flushId: string, saved: boolean): boolean;
}

/** Channels that work even when the database failed to open. */
export function registerAppHandlers(router: IpcRouter, deps: AppHandlerDeps): void {
  router.register('app:getInfo', async () => {
    await deps.beforeInfo?.();
    return deps.getInfo();
  });
  router.register('app:showDataFolder', async () => {
    const error = await deps.shell.openPath(deps.dataDir);
    if (error) throw new AppError('UNSUPPORTED', 'The data folder could not be opened on this desktop');
    return { opened: true as const };
  });
  router.register('app:quit', () => {
    setImmediate(() => deps.quit());
    return {};
  });
  router.register('capabilities:get', () => deps.getCapabilities());
  router.register('app:flushed', (req, ctx) => {
    if (!deps.flushed(ctx.webContentsId, req.flushId, req.saved)) throw new AppError('VALIDATION_FAILED', 'Unknown flush request');
    return {};
  });
  // Links open only as http(s) in the default browser, never through a shell command line (INF-SEC-01).
  router.register('shell:openExternal', async (req) => {
    const url = parseExternalUrl(req.url);
    if (!url.ok) throw new AppError('FORBIDDEN', 'This link cannot be opened');
    await deps.shell.openExternal(url.href);
    return { opened: true as const };
  });
}

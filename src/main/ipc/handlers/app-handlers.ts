import type { AppInfoType, CapabilitiesType } from '../../../shared/contracts/app';
import { AppError } from '../../services/app-error';
import type { ShellAdapter } from '../../services/shell-adapter';
import type { IpcRouter } from '../router';

export interface AppHandlerDeps {
  getInfo(): AppInfoType;
  getCapabilities(): CapabilitiesType;
  shell: ShellAdapter;
  dataDir: string;
  quit(): void;
}

/** Phase 01 channels that work even when the database failed to open. */
export function registerAppHandlers(router: IpcRouter, deps: AppHandlerDeps): void {
  router.register('app:getInfo', () => deps.getInfo());
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
}

import type { AppInfoType } from '../../../shared/contracts/app';
import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import { AppError } from '../../services/app-error';
import type { ShellAdapter } from '../../services/shell-adapter';
import type { IpcRouter } from '../router';

export interface AppHandlerDeps {
  getInfo(): AppInfoType;
  shell: ShellAdapter;
  dataDir: string;
  quit(): void;
}

export function registerAppHandlers(router: IpcRouter, deps: AppHandlerDeps): void {
  router.register({
    channel: 'app:getInfo',
    ...CHANNEL_SCHEMAS['app:getInfo'],
    handler: () => deps.getInfo(),
  });
  router.register({
    channel: 'app:showDataFolder',
    ...CHANNEL_SCHEMAS['app:showDataFolder'],
    handler: async () => {
      const error = await deps.shell.openPath(deps.dataDir);
      if (error) throw new AppError('UNSUPPORTED', 'The data folder could not be opened on this desktop');
      return { opened: true as const };
    },
  });
  router.register({
    channel: 'app:quit',
    ...CHANNEL_SCHEMAS['app:quit'],
    handler: () => {
      setImmediate(() => deps.quit());
      return {};
    },
  });
}

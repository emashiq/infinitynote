import type { App } from 'electron';
import { LAUNCHED_AT_LOGIN_ARG } from '../../shared/contracts/widget';
import type { AutostartAdapter } from './autostart';

/** Windows login items through Electron (D-082); the entry starts this executable with `--launched-at-login`. */
export function createLoginItemsAutostart(app: Pick<App, 'getLoginItemSettings' | 'setLoginItemSettings'>, execPath: string): AutostartAdapter {
  const args = [LAUNCHED_AT_LOGIN_ARG];
  return {
    isEnabled: () => app.getLoginItemSettings({ path: execPath, args }).openAtLogin,
    setEnabled: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled, path: execPath, args }),
  };
}

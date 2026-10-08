import './windows/schemes';
import { Menu, app, ipcMain, nativeTheme, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, APP_VERSION, ATTACHMENT_SCHEME, PRODUCT_NAME, RENDERER_SCHEME } from '../shared/app-identity';
import type { AppInfoType, CapabilitiesType, StartupStateType } from '../shared/contracts/app';
import { ThemeSetting } from '../shared/contracts/settings';
import { assertNotInstallDir, ensureDataDirs, resolveDataPaths, resolveUserDataOverride } from './app-paths';
import { openDatabase } from './db/open-database';
import { createEventBus } from './ipc/event-bus';
import { registerIpcHandlers } from './ipc/register-handlers';
import { createIpcRouter } from './ipc/router';
import { createSenderPolicy } from './ipc/sender-policy';
import { createMainServices, type MainServices } from './main-services';
import { buildMenu } from './menu';
import { errorMessage } from './services/app-error';
import { collectCapabilityInputs, detectCapabilities } from './services/capabilities';
import { systemClock } from './services/clock';
import { systemIds } from './services/ids';
import { createFileLogger, nullLogger, type Logger } from './services/logger';
import { installNetworkGuard } from './services/network-guard';
import type { ShellAdapter } from './services/shell-adapter';
import { isSelfTestMode, runSelfTestMode } from './self-test-mode';
import { acquireSingleInstance, installSecondInstanceHandler } from './single-instance';
import { installTestHooks, testHooksEnabled } from './test-hooks';
import { createAttachmentHandler } from './windows/attachment-protocol';
import { createMainWindow } from './windows/main-window';
import { createRendererHandler } from './windows/renderer-protocol';
import { installWebSecurity } from './windows/web-security';
import { WindowRegistry } from './windows/window-registry';

const registry = new WindowRegistry();
let logger: Logger | null = null;

function bootstrap(): void {
  // Sandbox for every renderer and a stable Windows notification identity.
  app.enableSandbox();
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // Test and portable isolation of user data (D-037); honored in packaged builds too.
  const override = resolveUserDataOverride(process.env.INFINITY_NOTES_USER_DATA_DIR);
  if (override && 'dir' in override) {
    fs.mkdirSync(override.dir, { recursive: true });
    app.setPath('userData', override.dir);
  }
  const overrideWarning = override && 'ignored' in override ? `INFINITY_NOTES_USER_DATA_DIR ignored: ${override.ignored}` : null;

  // Self-test mode: no lock, no window, no user database.
  if (isSelfTestMode(process.argv)) {
    runSelfTestMode(process.argv);
    return;
  }

  if (!acquireSingleInstance()) {
    app.quit();
    return;
  }
  installSecondInstanceHandler(registry, () => logger);

  app.on('window-all-closed', () => app.quit());
  process.on('uncaughtException', (err) => (logger ?? nullLogger).error(`uncaughtException ${err.stack ?? err.message}`));
  process.on('unhandledRejection', (reason) => (logger ?? nullLogger).error(`unhandledRejection ${String(reason)}`));

  void app.whenReady().then(() => start(override !== null && 'dir' in override, overrideWarning));
}

async function start(overrideOn: boolean, overrideWarning: string | null): Promise<void> {
  const isPackaged = app.isPackaged;
  const paths = resolveDataPaths(app.getPath('userData'));
  const log = createFileLogger(paths.logsDir, { mirrorToConsole: !isPackaged });
  logger = log;
  if (overrideWarning) log.warn(overrideWarning);

  const ozoneSwitch = app.commandLine.getSwitchValue('ozone-platform');
  const display = collectCapabilityInputs(ozoneSwitch);
  log.info(
    `startup app=${APP_VERSION} electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} platform=${process.platform} arch=${process.arch} packaged=${isPackaged} userDataOverride=${overrideOn ? 'on' : 'off'}`,
  );
  log.info(
    `display ozone=${ozoneSwitch || 'unset'} hint=${app.commandLine.getSwitchValue('ozone-platform-hint') || 'unset'} XDG_SESSION_TYPE=${display.xdgSessionType ?? 'unset'} WAYLAND_DISPLAY=${display.waylandDisplay ? 'set' : 'unset'} DISPLAY=${display.display ?? 'unset'} wsl=${display.wslDistro ?? 'no'} wslg=${display.wslgVersion ?? 'no'}`,
  );

  // Web security and the network guard are installed before any window exists.
  const hooks = testHooksEnabled(isPackaged) ? installTestHooks() : null;
  const devUrl = !isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  installWebSecurity({ logger: log, devOrigin });
  installNetworkGuard(session.defaultSession, {
    devOrigin,
    logger: log,
    onBlocked: hooks ? (url) => hooks.blockedRequests.push(url) : undefined,
  });
  if (!devUrl) protocol.handle(RENDERER_SCHEME, createRendererHandler({ root: path.join(__dirname, '../renderer'), logger: log }));

  try {
    if (isPackaged) assertNotInstallDir(paths.dataDir, path.dirname(process.execPath));
    ensureDataDirs(paths);
  } catch (err) {
    log.error(`data directory setup failed: ${errorMessage(err)}`);
    app.exit(1);
    return;
  }
  const opened = await openDatabase({ dbFile: paths.dbFile, preMigrationDir: paths.preMigrationDir, logger: log });
  const db = opened.ok ? opened.db : null;
  protocol.handle(ATTACHMENT_SCHEME, createAttachmentHandler({ db, dataDir: paths.dataDir, logger: log }));

  const eventBus = createEventBus(registry);
  let services: MainServices | null = null;
  if (db) {
    services = createMainServices({
      db,
      clock: systemClock,
      ids: systemIds,
      logger: log,
      onSettingsChanged: (payload) => {
        if (payload.key === 'appearance.theme') applyNativeTheme(payload.value);
        eventBus.broadcast('settings:changed', payload);
      },
      onTreeChanged: (event) => eventBus.broadcast('tree:changed', event),
    });
    applyNativeTheme(services.settings.getInternal('appearance.theme'));
    const { leases } = services;
    app.on('web-contents-created', (_e, wc) => wc.on('destroyed', () => leases.webContentsDestroyed(wc.id)));
  }

  const startup: StartupStateType = opened.ok ? { status: 'ok' } : { status: 'error', code: opened.code };
  const getInfo = (): AppInfoType => ({
    name: PRODUCT_NAME,
    version: APP_VERSION,
    isPackaged,
    unsignedBuild: true,
    platform: process.platform,
    arch: process.arch,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    sqlite: opened.ok
      ? { driver: opened.diagnostics.driver, version: opened.diagnostics.sqliteVersion, fts5: opened.diagnostics.fts5, json: opened.diagnostics.json }
      : null,
    schemaVersion: opened.ok ? opened.schemaVersion : null,
    startup,
  });
  let capabilities: CapabilitiesType | null = null;
  const shellAdapter: ShellAdapter = hooks ? hooks.shell : { openPath: (p) => shell.openPath(p) };
  const router = createIpcRouter({
    ipcMain,
    senderPolicy: createSenderPolicy({ registry, devOrigin }),
    logger: log,
    validateResponses: !isPackaged,
  });
  registerIpcHandlers(router, {
    app: {
      getInfo,
      getCapabilities: () => (capabilities ??= detectCapabilities(display)),
      shell: shellAdapter,
      dataDir: paths.dataDir,
      quit: () => app.quit(),
    },
    services,
  });

  Menu.setApplicationMenu(buildMenu(isPackaged));
  createMainWindow({
    preloadPath: path.join(__dirname, '../preload/index.js'),
    iconPath: path.join(app.getAppPath(), 'resources', 'icon.png'),
    registry,
    logger: log,
    devUrl: devUrl ? `${devUrl}${devUrl.endsWith('/') ? '' : '/'}` : null,
  });

  app.on('will-quit', () => {
    try {
      db?.close();
    } catch {
      // The process is exiting; a failed close changes nothing.
    }
  });
}

function applyNativeTheme(value: unknown): void {
  const theme = ThemeSetting.safeParse(value);
  if (theme.success) nativeTheme.themeSource = theme.data;
}

bootstrap();

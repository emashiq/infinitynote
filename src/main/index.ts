import './windows/schemes';
import { Menu, app, ipcMain, nativeTheme, protocol, screen, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, APP_VERSION, ATTACHMENT_SCHEME, PRODUCT_NAME, RENDERER_SCHEME } from '../shared/app-identity';
import type { AppInfoType, CapabilitiesType, FlushReasonType, StartupStateType } from '../shared/contracts/app';
import type { NoteRevisionEventType } from '../shared/contracts/notes';
import { ThemeSetting } from '../shared/contracts/settings';
import { assertNotInstallDir, ensureDataDirs, resolveDataPaths, resolveUserDataOverride } from './app-paths';
import { openDatabase } from './db/open-database';
import { createDesktop, type Desktop } from './desktop';
import { createEventBus } from './ipc/event-bus';
import { registerIpcHandlers } from './ipc/register-handlers';
import { createIpcRouter } from './ipc/router';
import { createSenderPolicy } from './ipc/sender-policy';
import { createMainServices, type MainServices } from './main-services';
import { buildMenu } from './menu';
import { errorMessage } from './services/app-error';
import { applyCapabilityOverride, collectCapabilityInputs, detectCapabilities, type CapabilityInputs } from './services/capabilities';
import { systemClock } from './services/clock';
import { createElectronDialogAdapter } from './services/dialog-adapter';
import { FlushCoordinator, type FlushOutcome } from './services/flush-coordinator';
import { systemIds } from './services/ids';
import { createFileLogger, nullLogger, type Logger } from './services/logger';
import { installNetworkGuard } from './services/network-guard';
import type { ShellAdapter } from './services/shell-adapter';
import { detectStatusNotifierHost, nodeExecFile } from './services/tray-probe';
import { isSelfTestMode, runSelfTestMode } from './self-test-mode';
import { acquireSingleInstance, installSecondInstanceHandler } from './single-instance';
import { installTestHooks, testHooksEnabled } from './test-hooks';
import { createAttachmentHandler } from './windows/attachment-protocol';
import { createElectronDisplayProvider } from './windows/display-provider';
import { createElectronInspector } from './windows/electron-inspector';
import { createRendererHandler } from './windows/renderer-protocol';
import { installWebSecurity } from './windows/web-security';
import { WindowRegistry } from './windows/window-registry';

const registry = new WindowRegistry();
let logger: Logger | null = null;
let desktop: Desktop | null = null;

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
  installSecondInstanceHandler(() => desktop?.mainWindow.show(), () => logger);

  // Closing the last window does not quit: stickies, the tray and background mode keep the app running (D-066).
  // Quit comes from the menus, the tray, the close choice, or closing the startup error screen.
  app.on('window-all-closed', () => undefined);
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
  // Bounded (2 s) and before any window, so the capabilities never change while windows exist (D-067).
  const trayHost = process.platform === 'linux' ? await detectStatusNotifierHost(nodeExecFile) : null;
  const display = collectCapabilityInputs(ozoneSwitch, trayHost);
  log.info(
    `startup app=${APP_VERSION} electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} platform=${process.platform} arch=${process.arch} packaged=${isPackaged} userDataOverride=${overrideOn ? 'on' : 'off'}`,
  );
  log.info(
    `display ozone=${ozoneSwitch || 'unset'} hint=${app.commandLine.getSwitchValue('ozone-platform-hint') || 'unset'} XDG_SESSION_TYPE=${display.xdgSessionType ?? 'unset'} WAYLAND_DISPLAY=${display.waylandDisplay ? 'set' : 'unset'} DISPLAY=${display.display ?? 'unset'} wsl=${display.wslDistro ?? 'no'} wslg=${display.wslgVersion ?? 'no'}`,
  );

  // Web security and the network guard are installed before any window exists.
  const hooks = testHooksEnabled(isPackaged) ? installTestHooks() : null;
  const capabilities = computeCapabilities(display, hooks !== null, log);
  const devUrl = !isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  installWebSecurity({ logger: log, devOrigin });
  installNetworkGuard(session.defaultSession, {
    devOrigin,
    logger: log,
    onBlocked: hooks ? (url) => hooks.state.blockedRequests.push(url) : undefined,
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
  const coordinator = new FlushCoordinator({
    sendTo: (webContentsId, flushId, reason) => {
      if (!eventBus.sendTo(webContentsId, 'app:flush-request', { flushId, reason })) throw new Error('the window is gone');
    },
    ids: systemIds,
    logger: log,
  });
  const flush = async (webContentsIds: number[], reason: FlushReasonType): Promise<FlushOutcome> => {
    const outcome = await coordinator.flush(webContentsIds, reason);
    hooks?.state.flushLog.push(outcome);
    return outcome;
  };
  const dialog = hooks ? hooks.dialog : createElectronDialogAdapter();
  let services: MainServices | null = null;
  if (db) {
    const emitRevision = (event: NoteRevisionEventType) => eventBus.broadcast('note:revision', event);
    services = createMainServices({
      db,
      clock: systemClock,
      ids: systemIds,
      logger: log,
      dataDir: paths.dataDir,
      dialog,
      onSettingsChanged: (payload) => {
        if (payload.key === 'appearance.theme') applyNativeTheme(payload.value);
        eventBus.broadcast('settings:changed', payload);
      },
      onTreeChanged: (event) => {
        eventBus.broadcast('tree:changed', event);
        desktop?.stickies?.onTreeChanged();
      },
      onNoteRevision: emitRevision,
      onLeaseChanged: (event) => eventBus.broadcast('note:lease', event),
      requestLeaseRelease: (holder, noteId) => {
        if (hooks?.ownsWebContents(holder.webContentsId)) hooks.onReleaseRequest(noteId);
        else eventBus.sendTo(holder.webContentsId, 'lease:release-request', { noteId });
      },
      testFaults: hooks?.faults,
    });
    hooks?.attachServices({ services, db, clock: systemClock, emitRevision });
    applyNativeTheme(services.settings.getInternal('appearance.theme'));
    const { leases } = services;
    app.on('web-contents-created', (_e, wc) => wc.on('destroyed', () => leases.webContentsReset(wc.id)));
    void services.attachments.sweepTmp(systemClock.now()).then((removed) => {
      if (removed > 0) log.info(`attachments: removed ${removed} stale temporary file(s)`);
    });
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

  const shellAdapter: ShellAdapter = hooks ? hooks.shell : { openPath: (p) => shell.openPath(p), openExternal: (url) => shell.openExternal(url) };
  const router = createIpcRouter({
    ipcMain,
    senderPolicy: createSenderPolicy({ registry, devOrigin }),
    logger: log,
    validateResponses: !isPackaged,
  });
  const windowsSide = createDesktop({
    logger: log,
    services,
    caps: capabilities,
    eventBus,
    flush,
    dialog,
    displays: hooks?.displays ?? createElectronDisplayProvider(screen),
    windows: {
      preloadPath: path.join(__dirname, '../preload/index.js'),
      iconPath: path.join(app.getAppPath(), 'resources', 'icon.png'),
      registry,
      logger: log,
      devUrl: devUrl ? `${devUrl}${devUrl.endsWith('/') ? '' : '/'}` : null,
    },
    onStickyLayout: hooks ? (entry) => hooks.state.stickyLog.push(entry) : undefined,
  });
  desktop = windowsSide;
  registerIpcHandlers(router, {
    app: {
      getInfo,
      getCapabilities: () => capabilities,
      shell: shellAdapter,
      dataDir: paths.dataDir,
      quit: () => app.quit(),
      flushed: (webContentsId, flushId, saved) => coordinator.ack(webContentsId, flushId, saved),
    },
    services,
    desktop: windowsSide,
  });
  hooks?.attachDesktop({ desktop: windowsSide, registry, services, inspector: createElectronInspector() });

  Menu.setApplicationMenu(buildMenu(isPackaged));
  windowsSide.start();

  app.on('will-quit', () => {
    try {
      db?.close();
    } catch {
      // The process is exiting; a failed close changes nothing.
    }
  });
}

/** Capabilities are computed once per run; unpackaged E2E runs may override some of them (plan section 8.9). */
function computeCapabilities(inputs: CapabilityInputs, testOverrides: boolean, log: Logger): CapabilitiesType {
  const detected = detectCapabilities(inputs);
  const { caps, warning } = testOverrides ? applyCapabilityOverride(detected, process.env.INFINITY_NOTES_TEST_CAPS) : { caps: detected, warning: null };
  if (warning) log.warn(warning);
  log.info(
    `capabilities positioning=${caps.windowPositioning.status} alwaysOnTop=${caps.alwaysOnTop.status} tray=${caps.tray.status}(${caps.tray.reason}) session=${caps.sessionType} ozone=${caps.ozonePlatform ?? 'unset'}`,
  );
  return caps;
}

function applyNativeTheme(value: unknown): void {
  const theme = ThemeSetting.safeParse(value);
  if (theme.success) nativeTheme.themeSource = theme.data;
}

bootstrap();

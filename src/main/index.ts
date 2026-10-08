import './windows/schemes';
import { Menu, app, ipcMain, nativeTheme, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, APP_VERSION, ATTACHMENT_SCHEME, PRODUCT_NAME, RENDERER_SCHEME } from '../shared/app-identity';
import type { AppInfoType, CapabilitiesType, StartupStateType } from '../shared/contracts/app';
import type { TreeChangedEventType } from '../shared/contracts/hierarchy';
import type { SettingsChangedPayload } from '../shared/contracts/settings';
import { assertNotInstallDir, ensureDataDirs, resolveDataPaths, resolveUserDataOverride } from './app-paths';
import type { Db } from './db/driver';
import { openDatabase } from './db/open-database';
import { SettingsRepo } from './db/repositories/settings-repo';
import { createEventBus } from './ipc/event-bus';
import { registerAppHandlers } from './ipc/handlers/app-handlers';
import { registerHierarchyHandlers } from './ipc/handlers/hierarchy-handlers';
import { registerHomeHandlers } from './ipc/handlers/home-handlers';
import { registerNoteHandlers } from './ipc/handlers/note-handlers';
import { registerPaletteHandlers } from './ipc/handlers/palette-handlers';
import { registerSessionHandlers } from './ipc/handlers/session-handlers';
import { registerTrashHandlers } from './ipc/handlers/trash-handlers';
import { registerCapabilitiesHandlers } from './ipc/handlers/capabilities-handlers';
import { registerSettingsHandlers } from './ipc/handlers/settings-handlers';
import { createIpcRouter } from './ipc/router';
import { createSenderPolicy } from './ipc/sender-policy';
import { buildMenu } from './menu';
import { collectCapabilityInputs, detectCapabilities } from './services/capabilities';
import { systemClock } from './services/clock';
import { systemIds } from './services/ids';
import { HierarchyService } from './services/hierarchy-service';
import { HomeService } from './services/home-service';
import { LeaseManager } from './services/lease-manager';
import { createFileLogger, nullLogger, type Logger } from './services/logger';
import { installNetworkGuard } from './services/network-guard';
import { NoteReader } from './services/note-reader';
import { NoteWriter } from './services/note-writer';
import { PaletteService } from './services/palette-service';
import { SessionService } from './services/session-service';
import { TrashService } from './services/trash-service';
import { SettingsService } from './services/settings-service';
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
let db: Db | null = null;

function bootstrap(): void {
  // 1-2. Sandbox for every renderer and a stable Windows notification identity.
  app.enableSandbox();
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // 3. Test and portable isolation of user data (D-037); honored in packaged builds too.
  const override = resolveUserDataOverride(process.env.INFINITY_NOTES_USER_DATA_DIR);
  let overrideWarning: string | null = null;
  if (override && 'dir' in override) {
    fs.mkdirSync(override.dir, { recursive: true });
    app.setPath('userData', override.dir);
  } else if (override) {
    overrideWarning = `INFINITY_NOTES_USER_DATA_DIR ignored: ${override.ignored}`;
  }

  // 4. Self-test mode: no lock, no window, no user database.
  if (isSelfTestMode(process.argv)) {
    runSelfTestMode(process.argv);
    return;
  }

  // 5. Single instance.
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
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const log = createFileLogger(paths.logsDir, { mirrorToConsole: !isPackaged });
  logger = log;
  if (overrideWarning) log.warn(overrideWarning);

  log.info(
    `startup app=${APP_VERSION} electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} platform=${process.platform} arch=${process.arch} packaged=${isPackaged} userDataOverride=${overrideOn ? 'on' : 'off'}`,
  );
  const inputs = collectCapabilityInputs(app.commandLine.getSwitchValue('ozone-platform'));
  log.info(
    `display ozone=${app.commandLine.getSwitchValue('ozone-platform') || 'unset'} hint=${app.commandLine.getSwitchValue('ozone-platform-hint') || 'unset'} XDG_SESSION_TYPE=${inputs.xdgSessionType ?? 'unset'} WAYLAND_DISPLAY=${inputs.waylandDisplay ? 'set' : 'unset'} DISPLAY=${inputs.display ?? 'unset'} wsl=${inputs.wslDistro ?? 'no'} wslg=${inputs.wslgVersion ?? 'no'}`,
  );

  // Web security and network guard before any window exists.
  const hooks = testHooksEnabled(isPackaged) ? installTestHooks() : null;
  const devUrl = !isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  installWebSecurity({ logger: log, devOrigin });
  installNetworkGuard(session.defaultSession, {
    devOrigin,
    logger: log,
    onBlocked: hooks ? (url) => hooks.blockedRequests.push(url) : undefined,
  });

  // Protocols.
  const rendererRoot = path.join(__dirname, '../renderer');
  if (!devUrl) protocol.handle(RENDERER_SCHEME, createRendererHandler({ root: rendererRoot, logger: log }));

  // Data directories and database.
  try {
    if (isPackaged) assertNotInstallDir(paths.dataDir, path.dirname(process.execPath));
    ensureDataDirs(paths);
  } catch (err) {
    log.error(`data directory setup failed: ${err instanceof Error ? err.message : String(err)}`);
    app.exit(1);
    return;
  }
  const opened = await openDatabase({ dbFile: paths.dbFile, preMigrationDir: paths.preMigrationDir, logger: log });
  const startup: StartupStateType = opened.ok ? { status: 'ok' } : { status: 'error', code: opened.code };
  db = opened.ok ? opened.db : null;
  protocol.handle(ATTACHMENT_SCHEME, createAttachmentHandler({ db, dataDir: paths.dataDir, logger: log }));

  // Services.
  const eventBus = createEventBus(registry);
  const applyTheme = (value: unknown) => {
    if (value === 'system' || value === 'light' || value === 'dark') nativeTheme.themeSource = value;
  };
  let settings: SettingsService | null = null;
  let hierarchy: HierarchyService | null = null;
  let trash: TrashService | null = null;
  let home: HomeService | null = null;
  let sessions: SessionService | null = null;
  let palette: PaletteService | null = null;
  let reader: NoteReader | null = null;
  let writer: NoteWriter | null = null;
  let leaseManager: LeaseManager | null = null;
  if (opened.ok) {
    settings = new SettingsService({
      repo: new SettingsRepo(opened.db),
      clock: systemClock,
      logger: log,
      emit: (payload: SettingsChangedPayload) => {
        if (payload.key === 'appearance.theme') applyTheme(payload.value);
        eventBus.broadcast('settings:changed', payload);
      },
    });
    applyTheme(settings.get(['appearance.theme'])['appearance.theme']);
    const leases = new LeaseManager({
      ids: systemIds,
      clock: systemClock,
      requestRelease: () => {},
      emit: () => {},
    });
    // Single view in Phase 02: note:revision and note:lease events arrive with Phase 03.
    leaseManager = leases;
    writer = new NoteWriter({ db: opened.db, leases, clock: systemClock, ids: systemIds, emit: () => {} });
    const onChange = (event: TreeChangedEventType) => eventBus.broadcast('tree:changed', event);
    hierarchy = new HierarchyService({ db: opened.db, clock: systemClock, ids: systemIds, logger: log, onChange });
    trash = new TrashService({ db: opened.db, clock: systemClock, ids: systemIds, logger: log, onChange });
    home = new HomeService(opened.db);
    sessions = new SessionService(opened.db, settings, systemClock);
    palette = new PaletteService(opened.db);
    reader = new NoteReader(opened.db);
    app.on('web-contents-created', (_e, wc) => wc.on('destroyed', () => leases.webContentsDestroyed(wc.id)));
  }

  let capabilities: CapabilitiesType | null = null;
  const getCapabilities = () => (capabilities ??= detectCapabilities(collectCapabilityInputs(app.commandLine.getSwitchValue('ozone-platform'))));

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

  // IPC.
  const shellAdapter: ShellAdapter = hooks ? hooks.shell : { openPath: (p) => shell.openPath(p) };
  const router = createIpcRouter({
    ipcMain: ipcMain as unknown as Parameters<typeof createIpcRouter>[0]['ipcMain'],
    senderPolicy: createSenderPolicy({ registry, devOrigin }),
    logger: log,
    validateResponses: !isPackaged,
  });
  registerAppHandlers(router, { getInfo, shell: shellAdapter, dataDir: paths.dataDir, quit: () => app.quit() });
  registerSettingsHandlers(router, () => settings);
  registerCapabilitiesHandlers(router, getCapabilities);
  registerHierarchyHandlers(router, () => hierarchy);
  registerTrashHandlers(router, () => trash);
  registerHomeHandlers(router, () => home);
  registerSessionHandlers(router, () => sessions);
  registerPaletteHandlers(router, () => palette);
  registerNoteHandlers(router, { reader: () => reader, writer: () => writer, leases: () => leaseManager });

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
      // ignore
    }
  });
}

bootstrap();

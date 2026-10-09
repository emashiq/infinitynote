import { app, nativeTheme, powerMonitor } from 'electron';
import type { CapabilitiesType, FlushReasonType } from '../shared/contracts/app';
import type { EventBus } from './ipc/event-bus';
import type { MainServices } from './main-services';
import { closeDialogOptions } from './services/close-dialog';
import { allSaved, type FlushOutcome } from './services/flush-coordinator';
import type { DialogAdapter } from './services/dialog-adapter';
import type { Logger } from './services/logger';
import { TrayController } from './tray';
import { createWindowLifecycle, type WindowLifecycle } from './window-lifecycle';
import type { DisplayProvider } from './windows/display-provider';
import { createMainWindowFactory, type AppWindowFactoryOptions } from './windows/main-window';
import { MainWindowController } from './windows/main-window-controller';
import { StickyManager, type StickyLayoutEntry } from './windows/sticky-manager';
import { createStickyWindowFactory } from './windows/sticky-window';
import { WidgetManager } from './windows/widget-manager';
import { createWidgetWindowFactory } from './windows/widget-window';

export interface DesktopDeps {
  logger: Logger;
  /** Absent when the database failed to open: then there are no stickies and closing the window quits. */
  services: MainServices | null;
  caps: CapabilitiesType;
  eventBus: EventBus;
  /** Acknowledged flush of the given renderers (FlushCoordinator, bounded per renderer). */
  flush(webContentsIds: number[], reason: FlushReasonType): Promise<FlushOutcome>;
  dialog: Pick<DialogAdapter, 'showCloseChoice'>;
  displays: DisplayProvider;
  windows: Omit<AppWindowFactoryOptions, 'windowHooks'>;
  onStickyLayout?(entry: StickyLayoutEntry): void;
  /** Runs once the startup windows are back: after the main window's first load, or at once in a background start. */
  afterStartup?(): void;
  /** Started by a login item (D-082): with a tray, the app starts in the background without the main window. */
  launchedAtLogin: boolean;
}

export interface Desktop {
  mainWindow: MainWindowController;
  stickies: StickyManager | null;
  /** The reminder widget; absent without storage. */
  widget: WidgetManager | null;
  tray: TrayController;
  lifecycle: WindowLifecycle;
  displays: DisplayProvider;
  /** Creates a sticky at the Common root and floats it (tray, global shortcut; D-069). */
  newSticky(): Promise<void>;
  /**
   * Starts the tray and opens the main window; open stickies and the widget come back after its first load. A launch at
   * login with a tray starts in the background: no main window, the other windows come back at once.
   */
  start(): void;
}

/**
 * The windows side of the app (plan section 8.11): main window controller, sticky manager, tray and the quit and
 * session lifecycle, wired to the services, the event bus and the flush coordinator.
 */
export function createDesktop(deps: DesktopDeps): Desktop {
  const { logger, services, caps } = deps;
  let stickies: StickyManager | null = null;
  let widget: WidgetManager | null = null;
  // Closing one window waits for its renderer to confirm that its text is saved (D-055, D-072).
  const flushBeforeClose = async (webContentsIds: number[]) => allSaved(await deps.flush(webContentsIds, 'close'));
  const lifecycle = createWindowLifecycle({
    app,
    registry: deps.windows.registry,
    logger,
    flush: deps.flush,
    resetLeases: (webContentsId) => services?.leases.webContentsReset(webContentsId),
    onQuitStarting: () => {
      stickies?.prepareQuit();
      widget?.prepareQuit();
    },
    onQuitCanceled: () => {
      stickies?.cancelQuit();
      widget?.cancelQuit();
    },
  });
  const windows: AppWindowFactoryOptions = { ...deps.windows, windowHooks: lifecycle.windowHooks };

  const mainWindow = new MainWindowController({
    factory: createMainWindowFactory(windows),
    sendOpenNote: (webContentsId, event) => deps.eventBus.sendTo(webContentsId, 'app:openNote', event),
    sendOpenReminders: (webContentsId, event) => deps.eventBus.sendTo(webContentsId, 'app:openReminders', event),
    // Without storage the window shows the startup error screen, and closing it quits.
    closeBehavior: () => (services ? services.settings.getInternal('app.closeBehavior') : 'quit'),
    rememberCloseBehavior: (value) => services?.settings.set('app.closeBehavior', value),
    closeDialogOptions: () => closeDialogOptions({ platform: process.platform, trayStatus: caps.tray.status }),
    askClose: (parent, options) => deps.dialog.showCloseChoice(parent, options),
    flush: flushBeforeClose,
    quit: () => app.quit(),
    isQuitting: lifecycle.isQuitting,
    onFirstLoad: () => restoreStartupWindows(),
    logger,
  });

  if (services) {
    stickies = new StickyManager({
      service: services.stickies,
      factory: createStickyWindowFactory(windows),
      displays: deps.displays,
      caps: () => caps,
      flush: flushBeforeClose,
      resetLeases: (webContentsId) => services.leases.webContentsReset(webContentsId),
      sendState: (webContentsId, state) => deps.eventBus.sendTo(webContentsId, 'sticky:state', state),
      trash: services.trash,
      mainWindow,
      restoreOnStartupEnabled: () => services.settings.getInternal('stickies.restoreOnStartup'),
      theme: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
      logger,
      onLayout: deps.onStickyLayout,
    });
    widget = new WidgetManager({
      store: services.widgetState,
      factory: createWidgetWindowFactory(windows),
      displays: deps.displays,
      caps: () => caps,
      // The main window shows Show or Hide widget; the widget follows its own state.
      emitState: (state, widgetWebContentsId) => {
        const mainId = mainWindow.webContentsId();
        if (mainId !== null) deps.eventBus.sendTo(mainId, 'widget:state', state);
        if (widgetWebContentsId !== null) deps.eventBus.sendTo(widgetWebContentsId, 'widget:state', state);
      },
      logger,
    });
  }

  // Stickies and the widget open at most once per run (a main window recreated later does not restore them again).
  let startupRestored = false;
  function restoreStartupWindows(): void {
    if (startupRestored) return;
    startupRestored = true;
    stickies?.restoreOnStartup();
    widget?.restoreOnStartup();
    deps.afterStartup?.();
  }

  // A new sticky from the tray or the global shortcut lands at the Common root and floats (D-069).
  const newSticky = async (): Promise<void> => {
    if (!services || !stickies) return;
    const { note } = services.hierarchy.createNote({ projectId: null, folderId: null }, true);
    await stickies.float(note.id);
  };

  const tray = new TrayController({
    tray: caps.tray,
    iconPath: deps.windows.iconPath,
    platform: process.platform,
    openMainWindow: () => mainWindow.show(),
    newSticky,
    showWidget: () => widget?.show(),
    quit: () => app.quit(),
    logger,
  });

  // Linux shutdown or logoff: save without a dialog or a flush wait. Windows uses each window's session-end.
  if (process.platform === 'linux') powerMonitor.on('shutdown', () => lifecycle.markQuitting());
  app.on('will-quit', () => tray.destroy());

  return {
    mainWindow,
    stickies,
    widget,
    tray,
    lifecycle,
    displays: deps.displays,
    newSticky,
    start() {
      tray.start();
      if (deps.launchedAtLogin && tray.isPresent()) {
        logger.info('startup: launched at login, starting in the background');
        restoreStartupWindows();
        return;
      }
      mainWindow.ensure();
    },
  };
}

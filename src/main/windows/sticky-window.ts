import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { STICKY_MIN } from '../../shared/contracts/stickies';
import { stickyHash } from '../../shared/routes';
import type { AppWindowFactoryOptions } from './main-window';
import { rendererUrl, secureWebPreferences, trackWindow } from './secure-window';
import type { StickyWindowFactory, StickyWindowSpec } from './sticky-manager';

/**
 * Pure description of a sticky window (D-070): native frame, the shared hardened preferences, the sticky color as
 * background (no white flash), a position only where it was computed, and always-on-top only where allowed.
 */
export function stickyWindowOptions(spec: StickyWindowSpec & { preloadPath: string; iconPath: string; platform?: NodeJS.Platform }): BrowserWindowConstructorOptions {
  const { placement } = spec;
  return {
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y } : {}),
    minWidth: STICKY_MIN.width,
    minHeight: STICKY_MIN.height,
    show: false,
    title: spec.title,
    autoHideMenuBar: true,
    fullscreenable: false,
    ...(spec.alwaysOnTop ? { alwaysOnTop: true } : {}),
    backgroundColor: spec.backgroundColor,
    ...((spec.platform ?? process.platform) === 'linux' ? { icon: spec.iconPath } : {}),
    webPreferences: secureWebPreferences(spec.preloadPath),
  };
}

/** Creates sticky windows over BrowserWindow for the StickyManager. */
export function createStickyWindowFactory(options: AppWindowFactoryOptions): StickyWindowFactory {
  return {
    create(spec, events) {
      const win = new BrowserWindow(stickyWindowOptions({ ...spec, preloadPath: options.preloadPath, iconPath: options.iconPath }));
      // The application menu stays with the main window; Chromium still handles the editing keys.
      win.removeMenu();
      const webContentsId = trackWindow(win, {
        registry: options.registry,
        sender: { role: 'sticky', noteId: spec.noteId },
        hooks: options.windowHooks(),
        logger: options.logger,
      });
      // The OS title names the note ("<title> - Infinity Notes"); the page's own <title> must not replace it.
      win.on('page-title-updated', (event) => event.preventDefault());
      win.once('ready-to-show', () => events.onReadyToShow());
      win.on('close', (event) => events.onClose(event));
      win.on('closed', () => events.onClosed());
      win.on('move', () => events.onBoundsChanged());
      win.on('resize', () => events.onBoundsChanged());
      void win.loadURL(rendererUrl(options.devUrl, stickyHash(spec.noteId)));
      return {
        webContentsId,
        show: () => win.show(),
        showInactive: () => win.showInactive(),
        focus: () => win.focus(),
        destroy: () => win.destroy(),
        isDestroyed: () => win.isDestroyed(),
        getBounds: () => win.getBounds(),
        setBounds: (b) => win.setBounds(b),
        setSize: (w, h) => win.setSize(w, h),
        getContentSize: () => {
          const [w = 0, h = 0] = win.getContentSize();
          return [w, h];
        },
        setContentSize: (w, h) => win.setContentSize(w, h),
        setMinimumSize: (w, h) => win.setMinimumSize(w, h),
        setResizable: (r) => win.setResizable(r),
        setAlwaysOnTop: (on) => win.setAlwaysOnTop(on),
        setBackgroundColor: (c) => win.setBackgroundColor(c),
        setTitle: (t) => win.setTitle(t),
      };
    },
  };
}

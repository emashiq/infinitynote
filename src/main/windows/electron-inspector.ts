import { BrowserWindow, app, nativeTheme, webContents } from 'electron';

/** What the E2E hooks read from a native window. */
export interface NativeWindowInfo {
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  contentSize: number[];
  alwaysOnTop: boolean;
  resizable: boolean;
}

export interface WindowInspector {
  window(webContentsId: number): NativeWindowInfo | null;
  /** Listener and object counts that must return to their baseline after window cycles (INF-STKY-11). */
  counts(): Record<string, number>;
}

/** Reads native window state and Electron listener counts for the unpackaged E2E hooks. */
export function createElectronInspector(): WindowInspector {
  return {
    window(webContentsId) {
      const contents = webContents.fromId(webContentsId);
      const win = contents ? BrowserWindow.fromWebContents(contents) : null;
      if (!win || win.isDestroyed()) return null;
      return {
        visible: win.isVisible(),
        bounds: win.getBounds(),
        contentSize: win.getContentSize(),
        alwaysOnTop: win.isAlwaysOnTop(),
        resizable: win.isResizable(),
      };
    },
    counts: () => ({
      'app:web-contents-created': app.listenerCount('web-contents-created'),
      'app:second-instance': app.listenerCount('second-instance'),
      'app:before-quit': app.listenerCount('before-quit'),
      'nativeTheme:updated': nativeTheme.listenerCount('updated'),
      webContents: webContents.getAllWebContents().length,
      windows: BrowserWindow.getAllWindows().length,
    }),
  };
}

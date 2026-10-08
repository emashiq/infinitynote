/** Who sent an IPC request: the main window, or a sticky window bound to one note (D-064). */
export type SenderInfo = { role: 'main' } | { role: 'sticky'; noteId: string };

interface WindowChannel {
  webContentsId: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
}

/** A renderer window main talks to. For a sticky, `noteId` (not the URL hash) decides which note it may use. */
export type RegisteredWindow = WindowChannel & SenderInfo;

export class WindowRegistry {
  private readonly windows = new Map<number, RegisteredWindow>();

  add(win: RegisteredWindow): void {
    this.windows.set(win.webContentsId, win);
  }

  remove(webContentsId: number): void {
    this.windows.delete(webContentsId);
  }

  has(webContentsId: number): boolean {
    return this.windows.has(webContentsId);
  }

  get(webContentsId: number): RegisteredWindow | undefined {
    return this.windows.get(webContentsId);
  }

  all(): RegisteredWindow[] {
    return [...this.windows.values()];
  }

  size(): number {
    return this.windows.size;
  }

  main(): RegisteredWindow | undefined {
    return this.all().find((w) => w.role === 'main' && !w.isDestroyed());
  }

  stickyFor(noteId: string): RegisteredWindow | undefined {
    return this.all().find((w) => w.role === 'sticky' && w.noteId === noteId && !w.isDestroyed());
  }

  /** The role of a live registered window, or undefined when it is unknown or gone. */
  info(webContentsId: number): SenderInfo | undefined {
    const win = this.windows.get(webContentsId);
    if (!win || win.isDestroyed()) return undefined;
    return win.role === 'sticky' ? { role: 'sticky', noteId: win.noteId } : { role: 'main' };
  }
}

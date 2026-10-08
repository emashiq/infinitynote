export interface RegisteredWindow {
  webContentsId: number;
  role: 'main';
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  /** Restore and focus helpers used by the single-instance handler. */
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

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

  all(): RegisteredWindow[] {
    return [...this.windows.values()];
  }

  main(): RegisteredWindow | undefined {
    return this.all().find((w) => w.role === 'main' && !w.isDestroyed());
  }
}

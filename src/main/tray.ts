import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { CapabilityStatusType } from '../shared/contracts/app';
import { PRODUCT_NAME } from '../shared/app-identity';
import type { Logger } from './services/logger';

export interface TrayItem {
  label: string;
  run: () => void;
}

export interface TrayDeps {
  tray: CapabilityStatusType;
  iconPath: string;
  platform: NodeJS.Platform;
  openMainWindow(): void;
  newSticky(): Promise<void>;
  showWidget(): void;
  quit(): void;
  logger: Logger;
}

export const TRAY_LABELS = { open: 'Open Infinity Notes', newSticky: 'New sticky', showWidget: 'Show widget', quit: 'Quit Infinity Notes' } as const;

/**
 * The notification-area icon (D-067). It exists only where the tray capability is supported, so a desktop without
 * a tray host never gets an invisible icon that makes background mode look reachable.
 */
export class TrayController {
  private tray: Tray | null = null;
  readonly items: readonly TrayItem[];

  constructor(private readonly deps: TrayDeps) {
    this.items = [
      { label: TRAY_LABELS.open, run: () => deps.openMainWindow() },
      {
        label: TRAY_LABELS.newSticky,
        run: () => {
          void deps.newSticky().catch((err: unknown) => deps.logger.warn(`tray: new sticky failed ${String(err)}`));
        },
      },
      { label: TRAY_LABELS.showWidget, run: () => deps.showWidget() },
      { label: TRAY_LABELS.quit, run: () => deps.quit() },
    ];
  }

  start(): void {
    if (this.deps.tray.status !== 'supported') {
      this.deps.logger.info(`tray: not created reason=${this.deps.tray.reason}`);
      return;
    }
    const size = this.deps.platform === 'win32' ? 16 : 22;
    this.tray = new Tray(nativeImage.createFromPath(this.deps.iconPath).resize({ width: size, height: size }));
    this.tray.setToolTip(PRODUCT_NAME);
    const entries: MenuItemConstructorOptions[] = this.items.map((item) => ({ label: item.label, click: () => item.run() }));
    // Quit sits apart from the other items.
    entries.splice(entries.length - 1, 0, { type: 'separator' });
    this.tray.setContextMenu(Menu.buildFromTemplate(entries));
    this.tray.on('click', () => this.deps.openMainWindow());
    this.deps.logger.info('tray: created');
  }

  isPresent(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  /** Runs a menu item's handler, as a click on it would (E2E hooks). */
  click(label: string): void {
    const item = this.items.find((i) => i.label === label);
    if (!item) throw new Error(`no tray item ${label}`);
    item.run();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

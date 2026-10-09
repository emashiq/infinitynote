import path from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import type { CapabilityStatusType } from '../shared/contracts/app';
import { PRODUCT_NAME } from '../shared/app-identity';
import type { Logger } from './services/logger';

export interface TrayItem {
  label: string;
  run: () => void;
}

export interface TrayDeps {
  tray: CapabilityStatusType;
  /** Holds tray-16.png, tray-24.png and tray-32.png. */
  iconDir: string;
  platform: NodeJS.Platform;
  openMainWindow(): void;
  newSticky(): Promise<void>;
  showWidget(): void;
  quit(): void;
  logger: Logger;
}

/**
 * The tray icon files per platform: Windows gets one image with 16, 24 and 32 px representations for 100, 150 and 200%
 * display scaling; Linux tray hosts scale a single 32 px image to their panel.
 */
export function trayIconFiles(platform: NodeJS.Platform): Array<{ file: string; scaleFactor: number }> {
  if (platform === 'win32') {
    return [
      { file: 'tray-16.png', scaleFactor: 1 },
      { file: 'tray-24.png', scaleFactor: 1.5 },
      { file: 'tray-32.png', scaleFactor: 2 },
    ];
  }
  return [{ file: 'tray-32.png', scaleFactor: 1 }];
}

function trayImage(dir: string, platform: NodeJS.Platform): NativeImage {
  const image = nativeImage.createEmpty();
  for (const { file, scaleFactor } of trayIconFiles(platform)) {
    image.addRepresentation({ scaleFactor, buffer: nativeImage.createFromPath(path.join(dir, file)).toPNG() });
  }
  return image;
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
    this.tray = new Tray(trayImage(this.deps.iconDir, this.deps.platform));
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

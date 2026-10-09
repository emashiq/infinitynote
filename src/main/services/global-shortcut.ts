import type { CapabilityStatusType } from '../../shared/contracts/app';
import { SHORTCUT_MESSAGES, type QuickStickySettingType, type ShortcutStateType } from '../../shared/contracts/shortcuts';
import { AppError } from './app-error';
import type { Logger } from './logger';
import type { SettingsService } from './settings-service';

/** The OS-wide shortcut registry (Electron `globalShortcut`, or a recording fake under the E2E hooks). */
export interface GlobalShortcutAdapter {
  /** False when the OS or another app refused the accelerator. */
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface GlobalShortcutDeps {
  adapter: GlobalShortcutAdapter;
  settings: Pick<SettingsService, 'getInternal' | 'setInternal'>;
  capability: () => CapabilityStatusType;
  /** Creates a sticky and floats it, as the tray's New sticky does (D-069). */
  onTrigger(): void;
  logger: Logger;
}

/**
 * The optional global quick-sticky shortcut (INF-KEY-05): off by default, only where the desktop supports it, and a
 * refused registration is reported in Settings instead of pretending it works. A refused choice is not stored as on.
 */
export class GlobalShortcutService {
  private registered: string | null = null;
  private error: string | null = null;

  constructor(private readonly deps: GlobalShortcutDeps) {}

  private supported(): boolean {
    return this.deps.capability().status === 'supported';
  }

  private register(accelerator: string): boolean {
    const ok = this.deps.adapter.register(accelerator, () => this.deps.onTrigger());
    this.registered = ok ? accelerator : null;
    this.error = ok ? null : SHORTCUT_MESSAGES.taken;
    if (!ok) this.deps.logger.warn(`shortcut: registration refused accelerator=${accelerator}`);
    return ok;
  }

  private unregister(): void {
    if (this.registered) this.deps.adapter.unregister(this.registered);
    this.registered = null;
  }

  /** At startup: registers the stored shortcut when it is on and supported. */
  start(): void {
    const setting = this.deps.settings.getInternal('shortcut.quickSticky');
    if (setting.enabled && this.supported()) this.register(setting.accelerator);
  }

  stop(): void {
    this.unregister();
  }

  state(): ShortcutStateType {
    const setting = this.deps.settings.getInternal('shortcut.quickSticky');
    return { ...setting, registered: this.registered !== null, error: this.error, capability: this.deps.capability() };
  }

  set(next: QuickStickySettingType): ShortcutStateType {
    if (next.enabled && !this.supported()) throw new AppError('UNSUPPORTED', SHORTCUT_MESSAGES.unsupported);
    this.unregister();
    this.error = null;
    const enabled = next.enabled && this.register(next.accelerator);
    this.deps.settings.setInternal('shortcut.quickSticky', { enabled, accelerator: next.accelerator });
    return this.state();
  }
}

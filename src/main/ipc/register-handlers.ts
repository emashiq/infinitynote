import type { MainServices } from '../main-services';
import type { AutostartControl } from '../services/autostart';
import type { GlobalShortcutService } from '../services/global-shortcut';
import { AppError } from '../services/app-error';
import type { MainWindowController } from '../windows/main-window-controller';
import type { StickyManager } from '../windows/sticky-manager';
import type { WidgetManager } from '../windows/widget-manager';
import { registerAppHandlers, type AppHandlerDeps } from './handlers/app-handlers';
import { registerAttachmentHandlers } from './handlers/attachment-handlers';
import { registerContentHandlers } from './handlers/content-handlers';
import { registerHierarchyHandlers } from './handlers/hierarchy-handlers';
import { registerHomeHandlers } from './handlers/home-handlers';
import { registerNoteHandlers } from './handlers/note-handlers';
import { registerPaletteHandlers } from './handlers/palette-handlers';
import { registerPortabilityHandlers } from './handlers/portability-handlers';
import { registerReminderHandlers } from './handlers/reminder-handlers';
import { registerRetrievalHandlers } from './handlers/retrieval-handlers';
import { registerSessionHandlers } from './handlers/session-handlers';
import { registerSettingsHandlers } from './handlers/settings-handlers';
import { registerShortcutHandlers } from './handlers/shortcut-handlers';
import { registerStickyHandlers } from './handlers/sticky-handlers';
import { registerSuggestionHandlers } from './handlers/suggestion-handlers';
import { registerTrashHandlers } from './handlers/trash-handlers';
import { registerAutostartHandlers, registerWidgetHandlers } from './handlers/widget-handlers';
import { registerWindowHandlers } from './handlers/window-handlers';
import type { IpcRouter } from './router';

/** The windows side of the app; stickies and the widget need storage, so they are null when the database failed to open. */
export interface DesktopHandlerDeps {
  mainWindow: Pick<MainWindowController, 'rendererReady' | 'openNote'>;
  stickies: StickyManager | null;
  widget: WidgetManager | null;
  autostart: AutostartControl;
  /** The global quick-sticky shortcut; absent without storage (its choice is a setting). */
  shortcut: GlobalShortcutService | null;
}

const storageUnavailable = (): never => {
  throw new AppError('INTERNAL', 'Storage is unavailable');
};

/**
 * Registers every catalogue channel. When the database failed to open (`services` is null) the app channels
 * still work and every storage channel answers INTERNAL "Storage is unavailable".
 */
export function registerIpcHandlers(router: IpcRouter, deps: { app: AppHandlerDeps; services: MainServices | null; desktop: DesktopHandlerDeps }): void {
  const { services, desktop } = deps;
  const use =
    <K extends keyof MainServices>(key: K) =>
    (): MainServices[K] =>
      services ? services[key] : storageUnavailable();
  const stickies = (): StickyManager => desktop.stickies ?? storageUnavailable();
  const widget = (): WidgetManager => desktop.widget ?? storageUnavailable();
  registerAppHandlers(router, deps.app);
  registerSettingsHandlers(router, use('settings'));
  registerHierarchyHandlers(router, use('hierarchy'));
  registerTrashHandlers(router, use('trash'));
  registerHomeHandlers(router, use('home'));
  registerSessionHandlers(router, use('sessions'));
  registerPaletteHandlers(router, use('palette'));
  registerNoteHandlers(router, { reader: use('reader'), writer: use('writer'), leases: use('leases'), formats: use('formats') });
  registerContentHandlers(router, { versions: use('versions'), drafts: use('drafts') });
  registerAttachmentHandlers(router, use('attachments'), use('handoff'));
  registerRetrievalHandlers(router, { references: use('references'), search: use('search'), tags: use('tags') });
  registerStickyHandlers(router, stickies);
  registerWindowHandlers(router, {
    mainWindow: desktop.mainWindow,
    stickies,
    widget,
    widgetState: () => desktop.widget?.state() ?? { open: false, collapsed: false, alwaysOnTop: false },
  });
  registerReminderHandlers(router, {
    reminders: use('reminders'),
    openNote: (noteId, blockId) => desktop.mainWindow.openNote(noteId, false, blockId),
  });
  registerSuggestionHandlers(router, { reminders: use('reminders'), suggestions: use('suggestions') });
  registerWidgetHandlers(router, widget);
  registerAutostartHandlers(router, desktop.autostart);
  registerPortabilityHandlers(router, use('portability'));
  registerShortcutHandlers(router, () => desktop.shortcut ?? storageUnavailable());
}

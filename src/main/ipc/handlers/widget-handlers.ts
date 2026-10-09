import type { AutostartControl } from '../../services/autostart';
import type { WidgetManager } from '../../windows/widget-manager';
import type { IpcRouter } from '../router';

/** The reminder widget's window controls (D-081). */
export function registerWidgetHandlers(router: IpcRouter, widget: () => WidgetManager): void {
  router.register('widget:show', () => widget().show());
  router.register('widget:hide', () => widget().hide());
  router.register('widget:setPinned', (req) => widget().setPinned(req.pinned));
  router.register('widget:setCollapsed', (req) => widget().setCollapsed(req.collapsed));
}

/** Launch at login (D-082): read from the OS on every call, changed only where supported. */
export function registerAutostartHandlers(router: IpcRouter, autostart: AutostartControl): void {
  router.register('autostart:get', () => autostart.get());
  router.register('autostart:set', (req) => autostart.set(req.enabled));
}

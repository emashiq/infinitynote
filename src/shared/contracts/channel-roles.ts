import type { InvokeChannel } from './channel-names';
import type { WindowRoleType } from './windows';

/**
 * The channels a sticky window may call (plan section 6.4, D-064): its note's content, lease, versions, drafts and
 * attachments, links, settings reads, capabilities, the flush acknowledgment, quit, its window state and its own
 * sticky actions, and its note's reminders (listed, or opened in the main window; D-074).
 * Everything else (tabs, the tree, trash, creation, moves, settings writes) is main-window only.
 */
export const STICKY_ALLOWED_CHANNELS: ReadonlySet<InvokeChannel> = new Set<InvokeChannel>([
  'app:getInfo',
  'app:quit',
  'app:flushed',
  'capabilities:get',
  'settings:get',
  'note:open',
  'note:save',
  'note:rename',
  'note:trash',
  'note:convertFormat',
  'lease:acquire',
  'lease:release',
  'lease:take',
  'versions:list',
  'versions:restore',
  'drafts:list',
  'drafts:resolve',
  'attachment:importBytes',
  'attachment:importFromDialog',
  'shell:openExternal',
  'window:getState',
  'sticky:dock',
  'sticky:hide',
  'sticky:setColor',
  'sticky:setPinned',
  'sticky:setCollapsed',
  'sticky:remove',
  'sticky:restore',
  'reminder:listForNote',
  'reminder:open',
]);

/**
 * The channels the reminder widget may call (D-074, D-081): its reminder lists and their actions, opening a source in
 * the main window, its own window controls, settings reads and the app basics. It never reads note content, edits
 * reminders or touches tabs and the tree.
 */
export const WIDGET_ALLOWED_CHANNELS: ReadonlySet<InvokeChannel> = new Set<InvokeChannel>([
  'app:getInfo',
  'app:quit',
  'app:flushed',
  'capabilities:get',
  'settings:get',
  'window:getState',
  'reminders:listView',
  'occurrence:complete',
  'occurrence:snooze',
  'reminder:open',
  'widget:hide',
  'widget:setPinned',
  'widget:setCollapsed',
]);

/** The main window may call every channel; stickies and the widget only their allowlists. */
export function isChannelAllowed(role: WindowRoleType, channel: InvokeChannel): boolean {
  if (role === 'main') return true;
  return (role === 'sticky' ? STICKY_ALLOWED_CHANNELS : WIDGET_ALLOWED_CHANNELS).has(channel);
}

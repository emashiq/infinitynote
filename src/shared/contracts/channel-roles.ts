import type { InvokeChannel } from './channel-names';
import type { WindowRoleType } from './windows';

/**
 * The channels a sticky window may call (plan section 6.4, D-064): its note's content, live sync (D-103), versions, drafts and
 * attachments, links, settings reads, capabilities, the flush acknowledgment, quit, its window state and its own
 * sticky actions, and its note's reminders (listed, or opened in the main window; D-074). From Phase 06 (D-089) it may
 * also confirm suggestions and add reminders by hand for its note: the zone list, `reminder:create`,
 * `reminder:createFromSuggestion` and the dismissal channels. Editing a reminder (`reminder:update`,
 * `reminder:updateFromSource`, `reminder:delete`) stays in the main window. The router allows a `noteId` only for the
 * sticky's own note. From Phase 07 (D-098) it may open or show its note's attached files, and from
 * v0.2.0 (D-108) add files by copying or linking them and use its note's linked files. Everything else (tabs, the
 * tree, trash, creation, moves, settings writes, references, search and tags) is main-window only. From v0.3.0
 * (D-172) a sticky of a locked note asks for its lock state, reveals and blurs itself, reports activity and sets its
 * PIN; the `lock:*` channels stay main-window only.
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
  'collab:join',
  'collab:push',
  'collab:pull',
  'collab:flush',
  'collab:leave',
  'versions:list',
  'versions:restore',
  'drafts:list',
  'drafts:resolve',
  'attachment:importBytes',
  'attachment:pickFiles',
  'attachment:addPicked',
  'shell:openExternal',
  'window:getState',
  'sticky:dock',
  'sticky:hide',
  'sticky:setColor',
  'sticky:setTextColor',
  'sticky:setPinned',
  'sticky:setCollapsed',
  'sticky:remove',
  'sticky:restore',
  'reminder:listForNote',
  'reminder:open',
  'zones:list',
  'reminder:create',
  'reminder:createFromSuggestion',
  'suggestion:dismiss',
  'suggestion:listDismissed',
  'attachment:open',
  'attachment:showInFolder',
  'fileLink:create',
  'fileLink:status',
  'fileLink:open',
  'fileLink:showInFolder',
  'fileLink:copyIn',
  'sticky:lockStatus',
  'sticky:reveal',
  'sticky:activity',
  'sticky:blur',
  'sticky:setPin',
]);

/**
 * The sticky channels that read or change its note's content or what belongs to it (D-172). While the sticky of a
 * locked note is blurred, main refuses them for that window, whether or not the note's key is in memory.
 */
export const STICKY_CONTENT_CHANNELS: ReadonlySet<InvokeChannel> = new Set<InvokeChannel>([
  'note:open',
  'note:save',
  'note:convertFormat',
  'collab:join',
  'collab:push',
  'collab:pull',
  'collab:flush',
  'versions:list',
  'versions:restore',
  'drafts:list',
  'drafts:resolve',
  'attachment:importBytes',
  'attachment:pickFiles',
  'attachment:addPicked',
  'attachment:open',
  'attachment:showInFolder',
  'fileLink:create',
  'fileLink:status',
  'fileLink:open',
  'fileLink:showInFolder',
  'fileLink:copyIn',
  'reminder:listForNote',
  'reminder:create',
  'reminder:createFromSuggestion',
  'suggestion:dismiss',
  'suggestion:listDismissed',
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

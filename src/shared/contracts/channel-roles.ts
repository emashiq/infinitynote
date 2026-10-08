import type { InvokeChannel } from './channel-names';
import type { WindowRoleType } from './windows';

/**
 * The channels a sticky window may call (plan section 6.4, D-064): its note's content, lease, versions, drafts and
 * attachments, links, settings reads, capabilities, the flush acknowledgment, quit, its window state and its own
 * sticky actions.
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
]);

export function isChannelAllowed(role: WindowRoleType, channel: InvokeChannel): boolean {
  return role === 'main' || STICKY_ALLOWED_CHANNELS.has(channel);
}

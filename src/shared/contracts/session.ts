import { z } from 'zod';
import { Uuid } from './ids';

export const TabKinds = ['home', 'note', 'document', 'stickies', 'reminders', 'settings', 'graph'] as const;
export type TabKind = (typeof TabKinds)[number];

export const MAX_TABS = 200;

export const NoteTab = z
  .strictObject({
    id: z.string().max(64),
    kind: z.literal('note'),
    noteId: Uuid,
    scrollTop: z.number().int().min(0).max(10_000_000).optional(),
  })
  .refine((t) => t.id === `note:${t.noteId}`, { message: 'Tab id must be note:<noteId>', path: ['id'] });

/** A document's tab (D-118): id `document:<documentId>`. */
export const DocumentTab = z
  .strictObject({ id: z.string().max(64), kind: z.literal('document'), documentId: Uuid })
  .refine((t) => t.id === `document:${t.documentId}`, { message: 'Tab id must be document:<documentId>', path: ['id'] });

export const Tab = z.union([
  z.strictObject({ id: z.literal('home'), kind: z.literal('home') }),
  NoteTab,
  DocumentTab,
  z.strictObject({ id: z.literal('page:stickies'), kind: z.literal('stickies') }),
  z.strictObject({ id: z.literal('page:reminders'), kind: z.literal('reminders') }),
  z.strictObject({ id: z.literal('page:settings'), kind: z.literal('settings') }),
  /** The relation graph (D-170); its scope and filters live in the window, not in the session. */
  z.strictObject({ id: z.literal('page:graph'), kind: z.literal('graph') }),
]);
export type TabType = z.infer<typeof Tab>;

export const TabSession = z.strictObject({
  version: z.literal(1),
  tabs: z.array(Tab).min(1).max(MAX_TABS),
  activeTabId: z.string().max(64),
});
export type TabSessionType = z.infer<typeof TabSession>;

/** Strict validation used by session:set: Home first, unique ids, active tab present. */
export const TabSessionStrict = TabSession.superRefine((s, ctx) => {
  if (s.tabs[0]?.kind !== 'home') ctx.addIssue({ code: 'custom', path: ['tabs', 0], message: 'Home must be the first tab' });
  const ids = new Set<string>();
  for (const [i, t] of s.tabs.entries()) {
    if (ids.has(t.id)) ctx.addIssue({ code: 'custom', path: ['tabs', i], message: 'Duplicate tab id' });
    ids.add(t.id);
  }
  if (!ids.has(s.activeTabId)) ctx.addIssue({ code: 'custom', path: ['activeTabId'], message: 'Active tab is not open' });
});

export const DEFAULT_SESSION: TabSessionType = { version: 1, tabs: [{ id: 'home', kind: 'home' }], activeTabId: 'home' };

export const SessionGetResponse = z.strictObject({
  session: TabSession,
  dropped: z.strictObject({ trashed: z.number().int(), missing: z.number().int(), duplicates: z.number().int() }),
});
export type SessionGetResponseType = z.infer<typeof SessionGetResponse>;
export const SessionSetRequest = z.strictObject({ session: TabSessionStrict });
export const SessionSetResponse = z.strictObject({ savedAt: z.number().int() });

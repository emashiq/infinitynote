import { z } from 'zod';
import { Uuid } from './ids';
import { StickyState } from './stickies';

export const WindowRole = z.enum(['main', 'sticky']);
export type WindowRoleType = z.infer<typeof WindowRole>;

/** What closing the main window does (D-066). */
export const CloseBehavior = z.enum(['ask', 'background', 'quit']);
export type CloseBehaviorType = z.infer<typeof CloseBehavior>;

/** At most this many note opens wait for a main window that is still loading (D-071). */
export const MAX_QUEUED_OPENS = 50;

export const AppOpenNoteEvent = z.strictObject({ noteId: Uuid, takeEdit: z.boolean() });
export type AppOpenNoteEventType = z.infer<typeof AppOpenNoteEvent>;

export const WindowGetStateResponse = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('main'), openNotes: z.array(AppOpenNoteEvent).max(MAX_QUEUED_OPENS) }),
  z.strictObject({ role: z.literal('sticky'), sticky: StickyState }),
]);
export type WindowGetStateResponseType = z.infer<typeof WindowGetStateResponse>;

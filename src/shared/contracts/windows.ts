import { z } from 'zod';
import { Uuid } from './ids';
import { ReminderView } from './reminders';
import { StickyState } from './stickies';
import { WidgetState } from './widget';

export const WindowRole = z.enum(['main', 'sticky', 'widget']);
export type WindowRoleType = z.infer<typeof WindowRole>;

/** What closing the main window does (D-066). */
export const CloseBehavior = z.enum(['ask', 'background', 'quit']);
export type CloseBehaviorType = z.infer<typeof CloseBehavior>;

/** At most this many note opens wait for a main window that is still loading (D-071). */
export const MAX_QUEUED_OPENS = 50;

/** A note main asks the main window to open; `blockId` reveals an anchored block (notification click, D-074). */
export const AppOpenNoteEvent = z.strictObject({ noteId: Uuid, takeEdit: z.boolean(), blockId: Uuid.nullable().default(null) });
export type AppOpenNoteEventType = z.infer<typeof AppOpenNoteEvent>;

export const WindowGetStateResponse = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('main'),
    openNotes: z.array(AppOpenNoteEvent).max(MAX_QUEUED_OPENS),
    /** A Reminders view main asked to show while the window loaded (summary notification click). */
    openReminders: ReminderView.nullable(),
    /** The reminder widget's state, so Show widget / Hide widget is right from the start (D-086). */
    widget: WidgetState,
  }),
  z.strictObject({ role: z.literal('sticky'), sticky: StickyState }),
  z.strictObject({ role: z.literal('widget'), widget: WidgetState }),
]);
export type WindowGetStateResponseType = z.infer<typeof WindowGetStateResponse>;

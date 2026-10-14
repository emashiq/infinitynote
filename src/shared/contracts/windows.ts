import { z } from 'zod';
import { Uuid } from './ids';
import { ReminderView } from './reminders';
import { StickyState } from './stickies';
import { WidgetState } from './widget';
import { ZOOM_ACTIONS, ZOOM_PERCENTS } from '../zoom';

export const WindowRole = z.enum(['main', 'sticky', 'widget']);
export type WindowRoleType = z.infer<typeof WindowRole>;

/** What closing the main window does (D-066). */
export const CloseBehavior = z.enum(['ask', 'background', 'quit']);
export type CloseBehaviorType = z.infer<typeof CloseBehavior>;

/** At most this many note opens wait for a main window that is still loading (D-071). */
export const MAX_QUEUED_OPENS = 50;

/** A note main asks the main window to open; `blockId` reveals an anchored block (notification click, D-074). */
export const AppOpenNoteEvent = z.strictObject({ noteId: Uuid, blockId: Uuid.nullable().default(null) });
export type AppOpenNoteEventType = z.infer<typeof AppOpenNoteEvent>;

/** A window's zoom in percent, one of the browser steps (D-186). */
export const ZoomPercentSchema = z.literal(ZOOM_PERCENTS);

/** Zoom the sender's window in, out or back to actual size; every window of its kind follows (all stickies share one). */
export const WindowZoomRequest = z.strictObject({ action: z.enum(ZOOM_ACTIONS) });
export const WindowZoomResponse = z.strictObject({ percent: ZoomPercentSchema });
/** Sent to the windows of a kind when their zoom changed. */
export const WindowZoomEvent = WindowZoomResponse;
export type WindowZoomEventType = z.infer<typeof WindowZoomEvent>;

export const WindowGetStateResponse = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('main'),
    openNotes: z.array(AppOpenNoteEvent).max(MAX_QUEUED_OPENS),
    /** A Reminders view main asked to show while the window loaded (summary notification click). */
    openReminders: ReminderView.nullable(),
    /** The reminder widget's state, so Show widget / Hide widget is right from the start (D-086). */
    widget: WidgetState,
    /** The main window's zoom, for the title bar's indicator (D-186). */
    zoom: ZoomPercentSchema,
  }),
  z.strictObject({ role: z.literal('sticky'), sticky: StickyState }),
  z.strictObject({ role: z.literal('widget'), widget: WidgetState }),
]);
export type WindowGetStateResponseType = z.infer<typeof WindowGetStateResponse>;

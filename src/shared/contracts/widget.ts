import { z } from 'zod';
import { CapabilityStatus } from './app';

/** Reminder widget geometry (D-081). Sizes are outer window bounds in DIP. */
export const WIDGET_DEFAULT = { width: 300, height: 420 } as const;
export const WIDGET_MIN = { width: 240, height: 160 } as const;
export const WIDGET_HEADER_PX = 36;
export const WIDGET_TITLE = 'Reminders - Infinity Notes';

export const WidgetState = z.strictObject({ open: z.boolean(), collapsed: z.boolean(), alwaysOnTop: z.boolean() });
export type WidgetStateType = z.infer<typeof WidgetState>;

export const WidgetSetPinnedRequest = z.strictObject({ pinned: z.boolean() });
export const WidgetSetCollapsedRequest = z.strictObject({ collapsed: z.boolean() });

/** Launch at login (D-082): what the OS has registered and whether this build can change it. */
export const AutostartState = z.strictObject({ enabled: z.boolean(), capability: CapabilityStatus });
export type AutostartStateType = z.infer<typeof AutostartState>;
export const AutostartSetRequest = z.strictObject({ enabled: z.boolean() });

/** The command-line flag of a launch at login; such a start goes to the background when a tray exists. */
export const LAUNCHED_AT_LOGIN_ARG = '--launched-at-login';

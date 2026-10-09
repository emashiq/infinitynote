/** Natural-language reminder limits and defaults (plan sections 3.2 and 9, D-090 to D-092). */

/** Stored with every confirmed source; a later parser change bumps it. */
export const PARSER_VERSION = 1;

// Detection (D-091) -------------------------------------------------------------------------
/** Idle time after the last user edit before a detection pass. */
export const IDLE_MS = 1000;
/** Longest stretch of parsing before the pass yields to the event loop. */
export const SLICE_MS = 8;
export const MAX_BLOCKS_PER_PASS = 2000;
/** Live candidates per editor, and candidates returned by one parse. */
export const MAX_CANDIDATES = 100;
/** A single change that inserts more text than this (a large paste) is not scanned automatically. */
export const SKIP_INSERT_CHARS = 65_536;
/** Blocks longer than this are scanned only within LONG_BLOCK_WINDOW characters of the changed text. */
export const LONG_BLOCK_CHARS = 5000;
export const LONG_BLOCK_WINDOW = 300;
/** Notes whose candidates survive an editor remount in one window session. */
export const MEMORY_NOTES = 20;

// Sources and the card (D-092, D-093) -----------------------------------------------------------
export const MAX_SOURCE_TEXT = 500;
export const MAX_SELECTION_CHARS = 2000;
export const MAX_TITLE = 120;
/** Manual entry titles a reminder with the selected text, up to the reminder title limit. */
export const MAX_MANUAL_TITLE = 200;

/** The fixed, disclosed times of day-part words (D-090). */
export const DAY_PART_TIMES = { morning: '09:00', afternoon: '15:00', evening: '19:00', tonight: '20:00' } as const;
export type DayPart = keyof typeof DAY_PART_TIMES;

/** One of these words directly before (or after, at the end) a phrase is removed from the title with it. */
export const CONNECTORS = ['by', 'on', 'at', 'before', 'until', 'till', 'due'] as const;

// Dismissals (D-092) ----------------------------------------------------------------------------
export const MAX_DISMISSALS_PER_NOTE = 500;
/** Dismissals whose reference date is more than this many days before today (UTC) are pruned at startup. */
export const DISMISSAL_KEEP_DAYS = 2;
/** A duration phrase longer than this is not a reminder suggestion. */
export const MAX_DURATION_MS = 1000 * 3_600_000;

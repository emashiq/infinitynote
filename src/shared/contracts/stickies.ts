import { z } from 'zod';
import { HexColor, NoteColor } from './hierarchy';
import { Uuid } from './ids';

/** Sticky window geometry (UX_SPEC section 5, D-070). Sizes are outer window bounds in DIP. */
export const STICKY_HEADER_PX = 36;
export const STICKY_DEFAULT = { width: 320, height: 300 } as const;
export const STICKY_MIN = { width: 220, height: 120 } as const;
export const MAX_OPEN_STICKIES = 50;

export const STICKY_MESSAGES = {
  limit: `You have ${MAX_OPEN_STICKIES} open stickies. Hide some to open more.`,
  unsupported: 'Not supported by this desktop',
  notSticky: 'This note is not a sticky',
  notInTrash: 'This note is not in Trash',
  missing: 'This note no longer exists',
  notSaved: 'Could not save this note. The window stays open.',
} as const;

/** Stored outer bounds of the expanded window; x/y are null where positioning is unsupported (D-062). */
export const StoredBounds = z.strictObject({
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  width: z.number().int().min(100).max(20_000),
  height: z.number().int().min(STICKY_HEADER_PX).max(20_000),
});
export type StoredBoundsType = z.infer<typeof StoredBounds>;

export const StickyNoteRequest = z.strictObject({ noteId: Uuid });
export const StickyFloatResponse = z.strictObject({ noteId: Uuid, created: z.boolean() });
export const StickySetColorRequest = z.strictObject({ noteId: Uuid, color: NoteColor });
/** The sticky's default text color; null is Automatic (dark or light ink from the background). */
export const StickySetTextColorRequest = z.strictObject({ noteId: Uuid, textColor: HexColor.nullable() });
export const StickySetPinnedRequest = z.strictObject({ noteId: Uuid, pinned: z.boolean() });
export const StickySetCollapsedRequest = z.strictObject({ noteId: Uuid, collapsed: z.boolean() });

/** Everything a sticky window shows besides the note content; sent as `sticky:state` to that window only. */
export const StickyState = z.strictObject({
  noteId: Uuid,
  title: z.string().max(200),
  color: NoteColor,
  /** The default text color, or null for Automatic. */
  textColor: HexColor.nullable(),
  path: z.array(z.string()).max(66),
  /** Null while the note is live. */
  trashed: z.strictObject({ batchId: Uuid.nullable() }).nullable(),
  collapsed: z.boolean(),
  alwaysOnTop: z.boolean(),
  /** Explicit user activations (Float) since this window was created; an increase means "take edit control". */
  activation: z.number().int().min(0),
});
export type StickyStateType = z.infer<typeof StickyState>;

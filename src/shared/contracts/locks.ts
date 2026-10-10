import { z } from 'zod';
import { Location, NoteResponse } from './hierarchy';
import { Uuid } from './ids';

/** Locked notes (D-111..D-113): what the lock channels carry. Passwords travel only in these requests to main. */

export const MIN_PASSWORD_CHARS = 8;
export const MAX_PASSWORD_CHARS = 1024;

/** Minutes without use after which an unlocked note locks again. */
export const AUTO_LOCK_MINUTES = [1, 5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

/** Seconds without interaction after which a revealed locked sticky is blurred again (D-172). */
export const BLUR_STICKY_SECONDS = [30, 60, 120, 300] as const;
export const DEFAULT_BLUR_STICKY_SECONDS = 60;

/** A sticky PIN: 4 to 8 digits, a quick re-reveal while the note's key is in memory (D-173). */
export const MIN_PIN_DIGITS = 4;
export const MAX_PIN_DIGITS = 8;
export const PIN_RE = /^[0-9]{4,8}$/;
/** Wrong PINs in a row after which only the password or Windows Hello reveals the sticky. */
export const PIN_STRIKES = 5;

export const LOCK_MESSAGES = {
  locked: 'This note is locked',
  wrongPassword: 'That password is not correct.',
  tooShort: `Use at least ${MIN_PASSWORD_CHARS} characters.`,
  mismatch: 'The passwords do not match.',
  acknowledge: 'Confirm that a forgotten password cannot be recovered.',
  wait: (seconds: number) => `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
  notLocked: 'This note is not locked.',
  alreadyLocked: 'This note is already locked.',
  noConvert: 'Remove the lock to change the format of this note.',
  noSuggestions: 'Reminders from text are off in locked notes.',
  helloOff: 'Windows Hello is not set up for this note.',
  helloCanceled: 'Windows Hello was canceled.',
  helloFailed: 'Windows Hello could not confirm it is you.',
  helloTimeout: 'Windows Hello did not answer in time.',
  exportLocked: 'Unlock this note to export it.',
  busy: 'Another lock change of this note is still running.',
  pinFormat: `Use ${MIN_PIN_DIGITS} to ${MAX_PIN_DIGITS} digits.`,
  pinMismatch: 'The PINs do not match.',
  pinNotSet: 'No PIN is set for this sticky.',
  wrongPin: 'That PIN is not correct.',
  pinStrikes: 'Too many wrong PINs. Use the password or Windows Hello.',
  pinNeedsKey: 'The note is locked again, so the PIN cannot reveal it. Use the password or Windows Hello.',
  blurred: 'This sticky is blurred.',
} as const;

/** A password as typed; length rules for new passwords are checked by main with a readable message. */
const Password = z.string().min(1).max(MAX_PASSWORD_CHARS);
/** A PIN as typed; its format is checked by main with a readable message. */
const Pin = z.string().min(1).max(64);

export const LockNoteRequest = z.strictObject({ noteId: Uuid });
export const LockSetRequest = z.strictObject({
  noteId: Uuid,
  password: Password,
  /** Also unlock with Windows Hello (only where it is available). */
  hello: z.boolean(),
  /** The user ticked "I understand a forgotten password cannot be recovered". */
  acknowledged: z.literal(true),
  /** A PIN for revealing the note's sticky (D-173); null or absent sets none. */
  pin: Pin.nullable().optional(),
});
/** "New locked note" and "New locked sticky": the note is created already locked (D-171). */
export const LockCreateRequest = z.strictObject({
  location: Location,
  sticky: z.boolean(),
  password: Password,
  hello: z.boolean(),
  acknowledged: z.literal(true),
  pin: Pin.nullable().optional(),
});
export const LockCreateResponse = NoteResponse;
/** Sets (or with null clears) the PIN of a locked note; the password confirms it is the owner (D-173). */
export const LockSetPinRequest = z.strictObject({ noteId: Uuid, password: Password, pin: Pin.nullable() });
export const LockUnlockRequest = z.strictObject({ noteId: Uuid, password: Password });
export const LockChangePasswordRequest = z.strictObject({ noteId: Uuid, currentPassword: Password, newPassword: Password });
export const LockSetHelloRequest = z.strictObject({ noteId: Uuid, password: Password, enabled: z.boolean() });
export const LockRemoveRequest = z.strictObject({ noteId: Uuid, password: Password });

export const OsKeyAvailabilitySchema = z.strictObject({
  status: z.enum(['available', 'unavailable', 'unsupported']),
  /** Why it is not offered (empty when available). */
  reason: z.string().max(300),
});
export type OsKeyAvailabilityType = z.infer<typeof OsKeyAvailabilitySchema>;

export const LockStatus = z.strictObject({
  noteId: Uuid,
  locked: z.boolean(),
  /** Unlocked for this session (the note's key is in main's memory). */
  unlocked: z.boolean(),
  /** Windows Hello can unlock it. */
  hello: z.boolean(),
  /** A PIN can reveal its sticky while it is unlocked (D-173). */
  pin: z.boolean(),
  /** Seconds before another password attempt is accepted. */
  retryInSeconds: z.number().int().nonnegative(),
});
export type LockStatusType = z.infer<typeof LockStatus>;

/** How a sticky window asks main to show a locked note's text (D-172). */
export const StickyRevealRequest = z.strictObject({
  noteId: Uuid,
  with: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pin'), pin: Pin }),
    z.strictObject({ kind: z.literal('password'), password: Password }),
    z.strictObject({ kind: z.literal('hello') }),
  ]),
});

/** What a sticky window of a note knows about its lock; sent as `sticky:lockState` to that window only. */
export const StickyLockState = z.strictObject({
  noteId: Uuid,
  locked: z.boolean(),
  /** Main serves the text to this window (it is not blurred). */
  revealed: z.boolean(),
  /** The note's key is in main's memory, so a PIN can reveal it. */
  keyInMemory: z.boolean(),
  pinSet: z.boolean(),
  /** Five wrong PINs in a row: only the password or Windows Hello reveals it now. */
  pinBlocked: z.boolean(),
  hello: z.boolean(),
  /** Seconds before another PIN or password attempt is accepted. */
  retryInSeconds: z.number().int().nonnegative(),
});
export type StickyLockStateType = z.infer<typeof StickyLockState>;

export const LockAllResponse = z.strictObject({ locked: z.number().int().nonnegative() });

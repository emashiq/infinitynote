import { z } from 'zod';
import { Uuid } from './ids';

/** Locked notes (D-111..D-113): what the lock channels carry. Passwords travel only in these requests to main. */

export const MIN_PASSWORD_CHARS = 8;
export const MAX_PASSWORD_CHARS = 1024;

/** Minutes without use after which an unlocked note locks again. */
export const AUTO_LOCK_MINUTES = [1, 5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

export const LOCK_MESSAGES = {
  locked: 'This note is locked',
  wrongPassword: 'That password is not correct.',
  tooShort: `Use at least ${MIN_PASSWORD_CHARS} characters.`,
  mismatch: 'The passwords do not match.',
  acknowledge: 'Confirm that a forgotten password cannot be recovered.',
  wait: (seconds: number) => `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
  notLocked: 'This note is not locked.',
  alreadyLocked: 'This note is already locked.',
  sticky: 'Remove this note from stickies before locking it.',
  noFloat: 'Locked notes cannot float as stickies. Remove the lock first.',
  noConvert: 'Remove the lock to change the format of this note.',
  noSuggestions: 'Reminders from text are off in locked notes.',
  helloOff: 'Windows Hello is not set up for this note.',
  helloCanceled: 'Windows Hello was canceled.',
  helloFailed: 'Windows Hello could not confirm it is you.',
  helloTimeout: 'Windows Hello did not answer in time.',
  exportLocked: 'Unlock this note to export it.',
  busy: 'Another lock change of this note is still running.',
} as const;

/** A password as typed; length rules for new passwords are checked by main with a readable message. */
const Password = z.string().min(1).max(MAX_PASSWORD_CHARS);

export const LockNoteRequest = z.strictObject({ noteId: Uuid });
export const LockSetRequest = z.strictObject({
  noteId: Uuid,
  password: Password,
  /** Also unlock with Windows Hello (only where it is available). */
  hello: z.boolean(),
  /** The user ticked "I understand a forgotten password cannot be recovered". */
  acknowledged: z.literal(true),
});
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
  /** Seconds before another password attempt is accepted. */
  retryInSeconds: z.number().int().nonnegative(),
});
export type LockStatusType = z.infer<typeof LockStatus>;

export const LockAllResponse = z.strictObject({ locked: z.number().int().nonnegative() });

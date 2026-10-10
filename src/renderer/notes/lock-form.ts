import { LOCK_MESSAGES, MIN_PASSWORD_CHARS, PIN_RE } from '../../shared/contracts/locks';

/** The problem with a new password typed twice, or null (main checks the length again). */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if ([...password].length < MIN_PASSWORD_CHARS) return LOCK_MESSAGES.tooShort;
  if (password !== confirm) return LOCK_MESSAGES.mismatch;
  return null;
}

/** What the lock dialog says before a note is locked (D-111, D-112). */
export const LOCK_DIALOG_POINTS = [
  'The text is encrypted on this computer. The note title is not encrypted: the title stays visible in the tree, tabs, Home and search.',
  'Version history, recovered drafts and the search text of this note are deleted now and cannot be restored.',
  'Attached images and files, and linked files, are not encrypted.',
  'Backups made before now still contain the text.',
  'Reminders keep working. Reminder titles are not encrypted and stay visible in the Reminders page; notifications do not show them.',
] as const;

export const NO_RECOVERY = 'I understand a forgotten password cannot be recovered';

/** What the dialog of "New locked note" and "New locked sticky" says (D-171). */
export const CREATE_LOCKED_POINTS = [
  'The text is encrypted on this computer from the start: it is never stored unencrypted, not even empty.',
  'The title is not encrypted: it stays visible in the tree, tabs, Home and search.',
  'Attached images and files, and linked files, are not encrypted.',
  'Reminders work. Reminder titles are not encrypted and stay visible in the Reminders page; notifications do not show them.',
] as const;

/** What a sticky PIN is and is not (D-173), said wherever one is set. */
export const PIN_EXPLANATION =
  'The PIN shows the sticky again quickly while the note is unlocked in this session. After the note locks again (idle time, the computer locks or sleeps, Lock now, quit) only the password or Windows Hello opens it. The PIN does not protect your files; the password does.';

/** The problem with a new PIN typed twice, or null (main checks the format again). */
export function newPinProblem(pin: string, confirm: string): string | null {
  if (!PIN_RE.test(pin)) return LOCK_MESSAGES.pinFormat;
  if (pin !== confirm) return LOCK_MESSAGES.pinMismatch;
  return null;
}

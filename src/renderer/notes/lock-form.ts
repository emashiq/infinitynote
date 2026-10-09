import { LOCK_MESSAGES, MIN_PASSWORD_CHARS } from '../../shared/contracts/locks';

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

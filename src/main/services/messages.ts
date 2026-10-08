/** User-facing messages for hierarchy and trash failures. */
export const MSG = {
  cycle: 'A folder cannot be moved into itself or one of its subfolders.',
  depth: 'Folders can be nested at most 32 levels deep.',
  inTrash: 'That location is in Trash.',
  missing: 'That item no longer exists.',
  noteInTrash: 'This note is in Trash',
  scope: 'That folder belongs to a different scope.',
  noBatch: 'That item is no longer in Trash.',
} as const;

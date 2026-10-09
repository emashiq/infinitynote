import { describe, expect, it } from 'vitest';
import { LOCK_DIALOG_POINTS, newPasswordProblem } from '../../../src/renderer/notes/lock-form';
import { LOCK_MESSAGES } from '../../../src/shared/contracts/locks';

describe('lock dialog rules (D-111, D-112)', () => {
  it('needs at least 8 characters typed the same twice', () => {
    expect(newPasswordProblem('short', 'short')).toBe(LOCK_MESSAGES.tooShort);
    expect(newPasswordProblem('long enough', 'long enougH')).toBe(LOCK_MESSAGES.mismatch);
    expect(newPasswordProblem('long enough', 'long enough')).toBeNull();
    // Characters, not UTF-16 units: four emoji are four characters.
    expect(newPasswordProblem('😀😀😀😀', '😀😀😀😀')).toBe(LOCK_MESSAGES.tooShort);
  });

  it('says what stays visible, what is destroyed and what is not encrypted', () => {
    const text = LOCK_DIALOG_POINTS.join(' ');
    for (const words of ['note title is not encrypted', 'title stays visible', 'cannot be restored', 'not encrypted', 'Backups made before now still contain the text', 'Reminder titles are not encrypted and stay visible in the Reminders page']) expect(text).toContain(words);
  });
});

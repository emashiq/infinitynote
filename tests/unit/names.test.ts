import { describe, expect, it } from 'vitest';
import { NAME_MESSAGE, TITLE_MESSAGE, displayTitle, normalizeName, validateName, validateTitle } from '../../src/shared/names';

describe('names', () => {
  it('normalizeName trims and NFC-normalizes', () => {
    expect(normalizeName('  Alpha \t')).toBe('Alpha');
    expect(normalizeName('é')).toBe('é');
    expect(normalizeName('বাংলা')).toBe('বাংলা');
  });

  it('validateName: 1..200 code points, no control characters', () => {
    expect(validateName('A')).toBeNull();
    expect(validateName('')).toBe(NAME_MESSAGE);
    expect(validateName('x'.repeat(200))).toBeNull();
    expect(validateName('x'.repeat(201))).toBe(NAME_MESSAGE);
    for (const code of [0x00, 0x07, 0x1f, 0x7f, 0x2028, 0x2029]) {
      expect(validateName('a' + String.fromCharCode(code) + 'b'), code.toString(16)).toBe(NAME_MESSAGE);
    }
    expect(validateName('tab\there')).toBe(NAME_MESSAGE);
    expect(validateName('line\nbreak')).toBe(NAME_MESSAGE);
  });

  it('counts code points, not UTF-16 units', () => {
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2);
    expect(validateName(emoji.repeat(200))).toBeNull();
    expect(validateName(emoji.repeat(201))).toBe(NAME_MESSAGE);
    const bangla = 'ক'.repeat(200);
    expect(validateName(bangla)).toBeNull();
  });

  it('validateTitle allows empty titles', () => {
    expect(validateTitle('')).toBeNull();
    expect(validateTitle('x'.repeat(200))).toBeNull();
    expect(validateTitle('x'.repeat(201))).toBe(TITLE_MESSAGE);
    expect(validateTitle('a\u0007')).toBe(TITLE_MESSAGE);
  });

  it('displayTitle falls back to Untitled', () => {
    expect(displayTitle('')).toBe('Untitled');
    expect(displayTitle('Plan')).toBe('Plan');
  });
});

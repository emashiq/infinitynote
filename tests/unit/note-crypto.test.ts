import { describe, expect, it } from 'vitest';
import {
  DATA_KEY_BYTES,
  DEFAULT_KDF,
  derivePasswordKey,
  newDataKey,
  newSalt,
  open,
  openText,
  parseKdfParams,
  SealError,
  seal,
  sealText,
  unwrapKey,
  wrapKey,
  type KdfParams,
} from '../../src/main/locks/note-crypto';

const NOTE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FAST: KdfParams = { name: 'scrypt', N: 1024, r: 8, p: 1 };

describe('locked note crypto (D-111)', () => {
  it('seals and opens text; every seal has its own IV, and the plaintext is not in the sealed bytes', () => {
    const key = newDataKey();
    const text = 'Bank PIN 4321 — বাংলা';
    const a = sealText(key, 'content', NOTE, text);
    const b = sealText(key, 'content', NOTE, text);
    expect(openText(key, 'content', NOTE, a)).toBe(text);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(1, 13).equals(b.subarray(1, 13))).toBe(false);
    expect(a.includes(Buffer.from('Bank PIN'))).toBe(false);
    expect(a[0]).toBe(1);
    expect(a.length).toBe(1 + 12 + 16 + Buffer.byteLength(text));
  });

  it('refuses a wrong key, another note, another purpose, and any changed byte (IV, tag, ciphertext, version)', () => {
    const key = newDataKey();
    const sealed = seal(key, 'content', NOTE, Buffer.from('secret body'));
    expect(() => open(newDataKey(), 'content', NOTE, sealed)).toThrow(SealError);
    expect(() => open(key, 'content', OTHER, sealed)).toThrow(SealError);
    expect(() => open(key, 'draft', NOTE, sealed)).toThrow(SealError);
    for (const index of [0, 1, 12, 13, 28, 29, sealed.length - 1]) {
      const tampered = Buffer.from(sealed);
      tampered[index] = tampered[index]! ^ 0x01;
      expect(() => open(key, 'content', NOTE, tampered), `byte ${index}`).toThrow(SealError);
    }
    expect(() => open(key, 'content', NOTE, sealed.subarray(0, 20))).toThrow(SealError);
    expect(open(key, 'content', NOTE, sealed).toString()).toBe('secret body');
  });

  it('wraps the data key with a password key; the wrong password fails and says nothing more', async () => {
    const salt = newSalt();
    const dataKey = newDataKey();
    const kek = await derivePasswordKey('correct horse battery', salt, FAST);
    const wrapped = wrapKey(kek, NOTE, dataKey);
    expect(unwrapKey(await derivePasswordKey('correct horse battery', salt, FAST), NOTE, wrapped).equals(dataKey)).toBe(true);
    const wrong = await derivePasswordKey('correct horse batterz', salt, FAST);
    expect(() => unwrapKey(wrong, NOTE, wrapped)).toThrow(new SealError());
    expect(() => unwrapKey(kek, OTHER, wrapped)).toThrow(SealError);
    expect(dataKey).toHaveLength(DATA_KEY_BYTES);
    expect(salt).toHaveLength(16);
  });

  it('derives with the stored parameters and salt: same input same key, other salt or cost another key', async () => {
    const salt = newSalt();
    const a = await derivePasswordKey('pässword', salt, FAST);
    expect(a).toHaveLength(32);
    expect((await derivePasswordKey('pässword', salt, FAST)).equals(a)).toBe(true);
    // NFC and NFD spellings of the same password give the same key.
    expect((await derivePasswordKey('pässword', salt, FAST)).equals(a)).toBe(true);
    expect((await derivePasswordKey('pässword', newSalt(), FAST)).equals(a)).toBe(false);
    expect((await derivePasswordKey('pässword', salt, { ...FAST, N: 2048 })).equals(a)).toBe(false);
  });

  it('uses strong default scrypt parameters and accepts only sane stored ones', () => {
    expect(DEFAULT_KDF).toEqual({ name: 'scrypt', N: 131072, r: 8, p: 1 });
    expect(parseKdfParams(JSON.stringify(DEFAULT_KDF))).toEqual(DEFAULT_KDF);
    expect(parseKdfParams(JSON.stringify(FAST))).toEqual(FAST);
    for (const bad of [
      'not json',
      '{}',
      JSON.stringify({ ...DEFAULT_KDF, name: 'pbkdf2' }),
      JSON.stringify({ ...DEFAULT_KDF, N: 1000 }),
      JSON.stringify({ ...DEFAULT_KDF, N: 512 }),
      JSON.stringify({ ...DEFAULT_KDF, N: 2 ** 21 }),
      JSON.stringify({ ...DEFAULT_KDF, r: 0 }),
      JSON.stringify({ ...DEFAULT_KDF, p: 99 }),
      'null',
    ]) {
      expect(parseKdfParams(bad), bad).toBeNull();
    }
  });
});

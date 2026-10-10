import { createCipheriv, createDecipheriv, randomBytes, scrypt, type ScryptOptions } from 'node:crypto';

/**
 * The cryptography of locked notes (D-111), main process only. Every secret is a Buffer the caller zeroes when done.
 *
 * - Data key: 32 random bytes per note; it encrypts the note's content, sealed drafts and its comments (D-165).
 * - Sealed value: AES-256-GCM with a random 96-bit IV per write and a purpose string bound as additional data (the note
 *   ID and what the value is), stored as `version(1) | iv(12) | tag(16) | ciphertext`. The tag is checked on open, so
 *   a changed byte, a value of another note or another purpose fails instead of decrypting to garbage.
 * - Password key: scrypt over the NFC-normalized password with a random 16-byte salt and stored parameters; it seals
 *   the data key. A wrong password fails the tag check of that seal.
 */

export const DATA_KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** scrypt cost parameters, stored with each lock so stronger defaults later do not break existing notes. */
export interface KdfParams {
  name: 'scrypt';
  /** CPU and memory cost (a power of two). */
  N: number;
  r: number;
  p: number;
}

/** About 128 MiB and a few hundred milliseconds per derivation on a current desktop. */
export const DEFAULT_KDF: KdfParams = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 };

/** Bounds a stored parameter set must stay in: never weaker than these minimums, never so costly it cannot run. */
const KDF_LIMITS = { minLogN: 10, maxLogN: 20, maxR: 32, maxP: 16 };

/** The value could not be opened: wrong key, or the stored bytes were changed. Carries no detail on purpose. */
export class SealError extends Error {
  constructor() {
    super('The value could not be opened');
    this.name = 'SealError';
  }
}

/** What a sealed value is, bound into its tag: a value sealed for one purpose or note never opens as another. */
export type SealPurpose = 'content' | 'draft' | 'key' | 'comment' | 'quote';

const additionalData = (purpose: SealPurpose, noteId: string): Buffer => Buffer.from(`infinity-notes/v1/${purpose}/${noteId}`, 'utf8');

export function newDataKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES);
}

export function newSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

export function seal(key: Buffer, purpose: SealPurpose, noteId: string, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(purpose, noteId));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), body]);
}

export function open(key: Buffer, purpose: SealPurpose, noteId: string, sealed: Buffer): Buffer {
  if (sealed.length < HEADER_BYTES || sealed[0] !== FORMAT_VERSION) throw new SealError();
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(additionalData(purpose, noteId));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(sealed.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new SealError();
  }
}

export const sealText = (key: Buffer, purpose: SealPurpose, noteId: string, text: string): Buffer => seal(key, purpose, noteId, Buffer.from(text, 'utf8'));

export function openText(key: Buffer, purpose: SealPurpose, noteId: string, sealed: Buffer): string {
  const plain = open(key, purpose, noteId, sealed);
  const text = plain.toString('utf8');
  plain.fill(0);
  return text;
}

/** Parses stored KDF parameters; null when they are not a parameter set this app accepts. */
export function parseKdfParams(json: string): KdfParams | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { name, N, r, p } = value as Record<string, unknown>;
  if (name !== 'scrypt' || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  const logN = Math.log2(N as number);
  if (!Number.isInteger(logN) || logN < KDF_LIMITS.minLogN || logN > KDF_LIMITS.maxLogN) return null;
  if ((r as number) < 1 || (r as number) > KDF_LIMITS.maxR || (p as number) < 1 || (p as number) > KDF_LIMITS.maxP) return null;
  return { name: 'scrypt', N: N as number, r: r as number, p: p as number };
}

/** The key a password gives with these parameters; runs on the thread pool, so the main process stays responsive. */
export function derivePasswordKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  const secret = Buffer.from(password.normalize('NFC'), 'utf8');
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, DATA_KEY_BYTES, options, (err, key) => {
      secret.fill(0);
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** The data key sealed with a password key (or any key-encryption key). */
export const wrapKey = (kek: Buffer, noteId: string, dataKey: Buffer): Buffer => seal(kek, 'key', noteId, dataKey);

/** The data key from its seal; SealError for a wrong key-encryption key. */
export function unwrapKey(kek: Buffer, noteId: string, wrapped: Buffer): Buffer {
  const key = open(kek, 'key', noteId, wrapped);
  if (key.length !== DATA_KEY_BYTES) {
    key.fill(0);
    throw new SealError();
  }
  return key;
}

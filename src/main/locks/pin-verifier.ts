import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { PIN_RE } from '../../shared/contracts/locks';

/**
 * Sticky PINs (D-173), main process only. A PIN is a quick re-reveal of a locked sticky while its note's data key is in
 * memory; it never wraps or derives that key. What is stored is a verifier: scrypt over the PIN with its own random
 * salt and stored, bounded parameters. Recovering a PIN from the files (4 to 8 digits can be guessed offline) opens
 * nothing: the note's content stays sealed by its data key, which only the password or Windows Hello releases.
 */

const SALT_BYTES = 16;
export const PIN_VERIFIER_BYTES = 32;

export interface PinKdf {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
}

/** About 16 MiB and a few tens of milliseconds per check: a PIN is typed often, and it guards no key. */
export const DEFAULT_PIN_KDF: PinKdf = { name: 'scrypt', N: 2 ** 14, r: 8, p: 1 };

/** Bounds a stored PIN parameter set must stay in, so a changed row can neither weaken nor stall the check. */
export const PIN_KDF_LIMITS = { minLogN: 10, maxLogN: 16, maxR: 16, maxP: 4 } as const;

export interface PinRecord {
  kdf: string;
  salt: Buffer;
  verifier: Buffer;
}

export const isPinFormat = (pin: string): boolean => PIN_RE.test(pin);

/** Parses stored PIN parameters; null when they are outside the bounds this app accepts. */
export function parsePinKdf(json: string): PinKdf | null {
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
  if (!Number.isInteger(logN) || logN < PIN_KDF_LIMITS.minLogN || logN > PIN_KDF_LIMITS.maxLogN) return null;
  if ((r as number) < 1 || (r as number) > PIN_KDF_LIMITS.maxR || (p as number) < 1 || (p as number) > PIN_KDF_LIMITS.maxP) return null;
  return { name: 'scrypt', N: N as number, r: r as number, p: p as number };
}

function derive(pin: string, salt: Buffer, params: PinKdf): Promise<Buffer> {
  const secret = Buffer.from(`infinity-notes/v1/pin/${pin}`, 'utf8');
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, PIN_VERIFIER_BYTES, { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r }, (err, key) => {
      secret.fill(0);
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** A new verifier for a PIN that already passed `isPinFormat`. */
export async function createPinRecord(pin: string, params: PinKdf = DEFAULT_PIN_KDF): Promise<PinRecord> {
  const salt = randomBytes(SALT_BYTES);
  return { kdf: JSON.stringify(params), salt, verifier: await derive(pin, salt, params) };
}

/** Whether the PIN matches the stored verifier (constant-time comparison); false for unusable stored parameters. */
export async function verifyPin(pin: string, stored: PinRecord): Promise<boolean> {
  const params = parsePinKdf(stored.kdf);
  if (!params || stored.verifier.length !== PIN_VERIFIER_BYTES || !isPinFormat(pin)) return false;
  const candidate = await derive(pin, stored.salt, params);
  try {
    return timingSafeEqual(candidate, stored.verifier);
  } finally {
    candidate.fill(0);
  }
}

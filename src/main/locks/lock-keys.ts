import { LOCK_MESSAGES, MIN_PASSWORD_CHARS, type OsKeyAvailabilityType } from '../../shared/contracts/locks';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { Logger } from '../services/logger';
import { AttemptBackoff, SerialAttempts } from './attempt-backoff';
import { DEFAULT_KDF, derivePasswordKey, newSalt, parseKdfParams, SealError, unwrapKey, wrapKey, type KdfParams } from './note-crypto';
import { OS_KEY_MESSAGES, type KeyProtector, type OsKeyVerifier } from './os-key';

/** The stored copies of an item's data key (a note_locks or document_locks row). */
export interface StoredKey {
  kdf: string;
  salt: Buffer;
  password_key: Buffer;
  os_key: Buffer | null;
}

/** A new password copy of a data key, as it is stored. */
export interface PasswordCopy {
  kdf: string;
  salt: Buffer;
  passwordKey: Buffer;
}

export interface LockKeysDeps {
  clock: Clock;
  logger: Logger;
  /** Windows Hello where the platform has it (D-113). */
  verifier: OsKeyVerifier;
  /** Protects the Windows Hello copy of a data key (safeStorage); null where the OS cannot. */
  protector: KeyProtector | null;
  /** The main window's native handle, so the Windows Hello prompt belongs to it. */
  windowHandle: () => Buffer | null;
  kdf?: KdfParams;
}

/**
 * The key handling every lock shares, for notes (D-111) and documents (D-185): the password copy of a data key (scrypt,
 * wrapped with the item's ID bound in), the wrong-password delay, password attempts one at a time per item, Windows Hello
 * (confirm, protect, unprotect) and one lock change at a time per item. Passwords exist only inside these calls.
 */
export class LockKeys {
  private readonly kdf: KdfParams;
  private readonly failures: AttemptBackoff;
  private readonly attempts = new SerialAttempts();
  /** Items with a lock change in progress (a key derivation runs outside any transaction). */
  private readonly busy = new Set<string>();

  constructor(private readonly deps: LockKeysDeps) {
    this.kdf = deps.kdf ?? DEFAULT_KDF;
    this.failures = new AttemptBackoff(() => deps.clock.now());
  }

  /** The KDF parameters new password copies are made with, as stored. */
  kdfJson(): string {
    return JSON.stringify(this.kdf);
  }

  retryInSeconds(id: string): number {
    return this.failures.retryInSeconds(id);
  }

  clearFailures(id: string): void {
    this.failures.clear(id);
  }

  /** The password key of a new password, for a lock made from it; the caller zeroes it. */
  async newPasswordKey(password: string, salt: Buffer): Promise<Buffer> {
    checkNewPassword(password);
    return derivePasswordKey(password, salt, this.kdf);
  }

  /** A password copy of the data key with a fresh salt. */
  async passwordCopy(id: string, password: string, dataKey: Buffer): Promise<PasswordCopy> {
    const salt = newSalt();
    const kek = await this.newPasswordKey(password, salt);
    try {
      return { kdf: this.kdfJson(), salt, passwordKey: wrapKey(kek, id, dataKey) };
    } finally {
      kek.fill(0);
    }
  }

  /**
   * The item's data key from its password, with the wrong-password delay; the caller zeroes it. Attempts on an item run
   * one at a time and each counts as a failure until its password is verified, so parallel requests cannot get past the
   * delay. `stored` is read inside the attempt, so a lock removed meanwhile is seen.
   */
  keyFromPassword(id: string, stored: () => StoredKey, password: string): Promise<Buffer> {
    return this.attempts.run(id, async () => {
      const lock = stored();
      const wait = this.failures.retryInSeconds(id);
      if (wait > 0) throw new AppError('LIMIT_EXCEEDED', LOCK_MESSAGES.wait(wait), { retryInSeconds: wait });
      const params = parseKdfParams(lock.kdf);
      if (!params) throw new AppError('INTERNAL', 'This lock could not be opened');
      this.failures.record(id);
      const kek = await derivePasswordKey(password, lock.salt, params);
      try {
        const dataKey = unwrapKey(kek, id, lock.password_key);
        this.failures.clear(id);
        return dataKey;
      } catch (err) {
        if (!(err instanceof SealError)) throw err;
        this.deps.logger.info(`locks: wrong password item=${id}`);
        throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.wrongPassword, { wrongPassword: true, retryInSeconds: this.failures.retryInSeconds(id) });
      } finally {
        kek.fill(0);
      }
    });
  }

  /**
   * The data key from its Windows Hello copy after Windows Hello confirmed the user; `verify` must prove it is this
   * item's key (it opens something sealed with it), otherwise the unlock fails.
   */
  async keyFromHello(id: string, stored: StoredKey, verify: (dataKey: Buffer) => void): Promise<Buffer> {
    if (!stored.os_key) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.helloOff);
    await this.confirmHello();
    let dataKey: Buffer | null = null;
    try {
      dataKey = this.requireProtector().unprotect(stored.os_key);
      verify(dataKey);
      return dataKey;
    } catch (err) {
      dataKey?.fill(0);
      if (err instanceof AppError) throw err;
      this.deps.logger.warn(`locks: the Windows Hello key of item=${id} could not be used`);
      throw new AppError('INTERNAL', LOCK_MESSAGES.helloFailed);
    }
  }

  /** Whether Windows Hello can be offered here, and why not when it cannot. */
  async availability(): Promise<OsKeyAvailabilityType> {
    const found = await this.deps.verifier.availability();
    if (found.status !== 'available') return { status: found.status, reason: found.reason };
    if (!this.deps.protector?.available()) return { status: 'unavailable', reason: OS_KEY_MESSAGES.noProtection };
    return { status: 'available', reason: '' };
  }

  /** Windows Hello must be available and confirm the user now. */
  async confirmHello(): Promise<void> {
    const available = await this.availability();
    if (available.status !== 'available') throw new AppError('UNSUPPORTED', available.reason);
    const verdict = await this.deps.verifier.verify(this.deps.windowHandle());
    if (verdict === 'verified') return;
    const message = { canceled: LOCK_MESSAGES.helloCanceled, timeout: LOCK_MESSAGES.helloTimeout, failed: LOCK_MESSAGES.helloFailed, unavailable: OS_KEY_MESSAGES.notConfigured }[verdict];
    throw new AppError(verdict === 'unavailable' ? 'UNSUPPORTED' : 'FORBIDDEN', message);
  }

  /** The Windows Hello copy of a data key. */
  protect(dataKey: Buffer): Buffer {
    return this.requireProtector().protect(dataKey);
  }

  private requireProtector(): KeyProtector {
    const protector = this.deps.protector;
    if (!protector?.available()) throw new AppError('UNSUPPORTED', OS_KEY_MESSAGES.noProtection);
    return protector;
  }

  /** One lock change per item at a time: a second one while a key is derived is refused with `busyMessage`. */
  async exclusive<T>(id: string, busyMessage: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new AppError('CONFLICT', busyMessage);
    this.busy.add(id);
    try {
      return await fn();
    } finally {
      this.busy.delete(id);
    }
  }
}

export function checkNewPassword(password: string): void {
  if ([...password].length < MIN_PASSWORD_CHARS) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.tooShort);
}

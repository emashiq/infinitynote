import type { LocationType, NoteDtoType, TreeChangedEventType } from '../../shared/contracts/hierarchy';
import {
  LOCK_MESSAGES,
  MIN_PASSWORD_CHARS,
  type LockStatusType,
  type OsKeyAvailabilityType,
} from '../../shared/contracts/locks';
import type { ReminderChangedEventType } from '../../shared/contracts/reminders';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
import { DraftsRepo } from '../db/repositories/drafts-repo';
import { LocksRepo, type LockRow } from '../db/repositories/locks-repo';
import { NotesRepo, serializedContent, type ContentRow } from '../db/repositories/notes-repo';
import { PinsRepo } from '../db/repositories/pins-repo';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { CollabHub } from '../services/collab-hub';
import { EMPTY_DOC_JSON, type HierarchyService } from '../services/hierarchy-service';
import type { Logger } from '../services/logger';
import { MSG } from '../services/messages';
import type { PowerEvents } from '../services/power-events';
import type { SettingsService } from '../services/settings-service';
import { realTimers, type Timers } from '../services/timers';
import { runTx } from '../services/transaction';
import { openNoteComments, sealNoteComments } from '../comments/comment-cipher';
import { AttemptBackoff, SerialAttempts } from './attempt-backoff';
import { purgePlaintext, scrubDatabase } from './lock-purge';
import {
  DEFAULT_KDF,
  derivePasswordKey,
  newDataKey,
  newSalt,
  openText,
  parseKdfParams,
  SealError,
  sealText,
  unwrapKey,
  wrapKey,
  type KdfParams,
} from './note-crypto';
import { openDraft, type NoteVault } from './note-vault';
import { OS_KEY_MESSAGES, type KeyProtector, type OsKeyVerifier } from './os-key';
import { createPinRecord, isPinFormat, type PinKdf, type PinRecord } from './pin-verifier';

/** How often unlocked notes are checked for the idle timeout. */
export const SWEEP_INTERVAL_MS = 15_000;

export interface LockServiceDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  vault: NoteVault;
  collab: Pick<CollabHub, 'settle' | 'evict'>;
  settings: Pick<SettingsService, 'getInternal'>;
  /** Creates the row of a note made locked (D-171), inside the same transaction as its lock. */
  hierarchy: Pick<HierarchyService, 'createNote'>;
  /** Windows Hello where the platform has it (D-113). */
  verifier: OsKeyVerifier;
  /** Protects the Windows Hello copy of a data key (safeStorage); null where the OS cannot. */
  protector: KeyProtector | null;
  /** The main window's native handle, so the Windows Hello prompt belongs to it. */
  windowHandle: () => Buffer | null;
  onTreeChanged: (event: TreeChangedEventType) => void;
  onReminderChanged: (event: ReminderChangedEventType) => void;
  /** Screen lock and suspend lock every note again. */
  power?: PowerEvents;
  kdf?: KdfParams;
  /** Sticky PIN verifier parameters (cheap ones in tests). */
  pinKdf?: PinKdf;
  timers?: Timers;
}

/** What a new lock is made from: the password (checked for length), Windows Hello and an optional sticky PIN. */
interface NewLockRequest {
  password: string;
  hello: boolean;
  pin?: string | null;
}

/**
 * Locked notes (D-111..D-113): locking (encryption and the purge of every plaintext copy), unlocking with the password
 * or Windows Hello for the session, creating a note already locked (D-171), locking again (idle, screen lock, suspend, quit, Lock now, Lock all), changing the
 * password, Windows Hello on or off, the sticky PIN (D-173), and removing the lock. Passwords exist only inside these calls: they are never
 * stored, logged or put in an error.
 */
export class LockService {
  private readonly notes: NotesRepo;
  private readonly locks: LocksRepo;
  private readonly pins: PinsRepo;
  private readonly drafts: DraftsRepo;
  private readonly timers: Timers;
  private readonly kdf: KdfParams;
  private readonly failures: AttemptBackoff;
  /** A scrub after a lock was blocked: the idle sweep and quit run it again (scrubDatabase). */
  private scrubPending = false;
  /** Password attempts on a note run one at a time (keyFromPassword). */
  private readonly attempts = new SerialAttempts();
  /** Notes with a lock change in progress (a key derivation runs outside any transaction). */
  private readonly busy = new Set<string>();
  private sweepTimer: unknown = null;
  private unsubscribe: Array<() => void> = [];

  constructor(private readonly deps: LockServiceDeps) {
    this.notes = new NotesRepo(deps.db);
    this.locks = new LocksRepo(deps.db);
    this.pins = new PinsRepo(deps.db);
    this.drafts = new DraftsRepo(deps.db);
    this.timers = deps.timers ?? realTimers;
    this.kdf = deps.kdf ?? DEFAULT_KDF;
    this.failures = new AttemptBackoff(() => deps.clock.now());
  }

  // Lifecycle ------------------------------------------------------------------------------------------------------
  /** Starts the idle check and follows screen lock and suspend. */
  start(): void {
    const power = this.deps.power;
    if (power) this.unsubscribe = (['lock-screen', 'suspend'] as const).map((event) => power.on(event, () => this.lockAll()));
    this.scheduleSweep();
  }

  /** Quitting: every key is dropped (after live sync saved what it held); a blocked scrub gets a last try. */
  stop(): void {
    if (this.sweepTimer !== null) this.timers.clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    for (const off of this.unsubscribe.splice(0)) off();
    for (const noteId of this.deps.vault.unlockedNotes()) this.deps.vault.drop(noteId);
    if (this.scrubPending) this.scrub();
  }

  private scheduleSweep(): void {
    this.sweepTimer = this.timers.setTimeout(() => {
      this.sweep();
      this.scheduleSweep();
    }, SWEEP_INTERVAL_MS);
  }

  /** Locks again every note not used (opened, edited, saved) for the idle setting; retries a blocked scrub. */
  sweep(): number {
    if (this.scrubPending) this.scrub();
    const minutes = this.deps.settings.getInternal('locks.autoLockMinutes');
    const idle = this.deps.vault.idleSince(this.deps.clock.now() - minutes * 60_000);
    for (const noteId of idle) this.relock(noteId, 'idle');
    return idle.length;
  }

  // Queries --------------------------------------------------------------------------------------------------------
  /** Whether Windows Hello can be offered here, and why not when it cannot. */
  async availability(): Promise<OsKeyAvailabilityType> {
    const found = await this.deps.verifier.availability();
    if (found.status !== 'available') return { status: found.status, reason: found.reason };
    if (!this.deps.protector?.available()) return { status: 'unavailable', reason: OS_KEY_MESSAGES.noProtection };
    return { status: 'available', reason: '' };
  }

  status(noteId: string): LockStatusType {
    const row = this.liveRow(noteId);
    const lock = row.locked === 1 ? this.locks.get(noteId) : undefined;
    return {
      noteId,
      locked: lock !== undefined,
      unlocked: lock !== undefined && this.deps.vault.isUnlocked(noteId),
      hello: lock?.os_key != null,
      pin: lock !== undefined && this.pins.has(noteId),
      retryInSeconds: this.failures.retryInSeconds(noteId),
    };
  }

  // Lock -------------------------------------------------------------------------------------------------------------
  /**
   * Locks a note: its edits are saved, then in one step its live-sync session closes, the content is encrypted and
   * every plaintext copy is destroyed; the database is then scrubbed. The note is locked at once.
   */
  async lock(req: NewLockRequest & { noteId: string }): Promise<LockStatusType> {
    const { noteId } = req;
    checkNewLock(req);
    this.lockable(this.liveRow(noteId));
    return this.exclusive(noteId, async () => {
      if (req.hello) await this.confirmHello();
      const dataKey = newDataKey();
      try {
        const salt = newSalt();
        const passwordKey = await this.wrapWithPassword(noteId, req.password, salt, dataKey);
        const osKey = req.hello ? this.protect(dataKey) : null;
        const pin = req.pin ? await createPinRecord(req.pin, this.deps.pinKdf) : null;
        this.deps.collab.settle(noteId);
        this.deps.collab.evict(noteId);
        const counts = runTx(this.deps.db, this.deps.logger, () => {
          const row = this.lockable(this.liveRow(noteId));
          const content = sealText(dataKey, 'content', noteId, serializedContent(row));
          const purged = purgePlaintext(this.deps.db, noteId);
          sealNoteComments(this.deps.db, noteId, dataKey);
          this.locks.insert({ noteId, kdf: JSON.stringify(this.kdf), salt, passwordKey, osKey, content, now: this.deps.clock.now() });
          if (pin) this.pins.put(noteId, pin, this.deps.clock.now());
          return purged;
        });
        this.scrub();
        this.deps.logger.info(
          `locks: locked note=${noteId} hello=${req.hello} pin=${pin !== null} purged versions=${counts.versions} drafts=${counts.drafts} sources=${counts.sources} dismissals=${counts.dismissals}`,
        );
        this.deps.onTreeChanged({ reason: 'lock', trashedNoteIds: [], trashedDocumentIds: [] });
        if (counts.sources > 0) this.deps.onReminderChanged({ reason: 'anchor', noteIds: [noteId] });
      } finally {
        dataKey.fill(0);
      }
      return this.status(noteId);
    });
  }

  /** Scrubs the database after a lock; a blocked scrub is retried by the next sweep or at quit. */
  private scrub(): void {
    this.scrubPending = !scrubDatabase(this.deps.db, this.deps.logger);
  }

  /** A note that can be locked now: live and not locked. A floating sticky stays floating, blurred (D-172). */
  private lockable(row: ContentRow): ContentRow {
    if (row.locked === 1) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.alreadyLocked);
    return row;
  }

  // Create locked ----------------------------------------------------------------------------------------------------
  /**
   * "New locked note" and "New locked sticky" (D-171): the note row and its lock are written in one transaction, so its
   * content never exists in plaintext: the row has no content, the lock holds the sealed empty document, and there is
   * no first save, version, draft, index text or reminder source. The key stays in memory: the new note is open.
   */
  async create(req: NewLockRequest & { location: LocationType; sticky: boolean }): Promise<{ note: NoteDtoType }> {
    checkNewLock(req);
    if (req.hello) await this.confirmHello();
    const salt = newSalt();
    const kek = await derivePasswordKey(req.password, salt, this.kdf);
    const dataKey = newDataKey();
    try {
      const osKey = req.hello ? this.protect(dataKey) : null;
      const pin = req.pin ? await createPinRecord(req.pin, this.deps.pinKdf) : null;
      const created = this.deps.hierarchy.createNote(req.location, req.sticky, undefined, 'rich', (noteId) => this.insertLock(noteId, { kek, salt, dataKey, osKey, pin }));
      this.deps.vault.put(created.note.id, dataKey);
      this.deps.logger.info(`locks: created locked note=${created.note.id} sticky=${req.sticky} hello=${req.hello} pin=${pin !== null}`);
      return created;
    } catch (err) {
      dataKey.fill(0);
      throw err;
    } finally {
      kek.fill(0);
    }
  }

  /** The lock row (and PIN) of a note created locked; runs inside the transaction that inserts its row. */
  private insertLock(noteId: string, key: { kek: Buffer; salt: Buffer; dataKey: Buffer; osKey: Buffer | null; pin: PinRecord | null }): void {
    const now = this.deps.clock.now();
    const content = sealText(key.dataKey, 'content', noteId, EMPTY_DOC_JSON);
    this.locks.insert({ noteId, kdf: JSON.stringify(this.kdf), salt: key.salt, passwordKey: wrapKey(key.kek, noteId, key.dataKey), osKey: key.osKey, content, now });
    if (key.pin) this.pins.put(noteId, key.pin, now);
  }

  // Unlock -----------------------------------------------------------------------------------------------------------
  /** Unlocks for the session with the password; wrong passwords are counted and slowed down. */
  async unlock(req: { noteId: string; password: string }): Promise<LockStatusType> {
    const dataKey = await this.keyFromPassword(req.noteId, req.password);
    this.deps.vault.put(req.noteId, dataKey);
    this.deps.logger.info(`locks: unlocked note=${req.noteId} with=password`);
    return this.status(req.noteId);
  }

  /** Unlocks for the session after Windows Hello confirmed the user. */
  async unlockWithHello(noteId: string): Promise<LockStatusType> {
    const lock = this.lockedRow(noteId);
    if (!lock.os_key) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.helloOff);
    await this.confirmHello();
    let dataKey: Buffer;
    try {
      dataKey = this.requireProtector().unprotect(lock.os_key);
      // The OS returned a key: it must be this note's (it opens the content).
      openText(dataKey, 'content', noteId, lock.content);
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.deps.logger.warn(`locks: the Windows Hello key of note=${noteId} could not be used`);
      throw new AppError('INTERNAL', LOCK_MESSAGES.helloFailed);
    }
    this.deps.vault.put(noteId, dataKey);
    this.deps.logger.info(`locks: unlocked note=${noteId} with=hello`);
    return this.status(noteId);
  }

  // Lock again -------------------------------------------------------------------------------------------------------
  lockNow(noteId: string): LockStatusType {
    this.lockedRow(noteId);
    this.relock(noteId, 'now');
    return this.status(noteId);
  }

  /** Locks every unlocked note again; returns how many were unlocked. */
  lockAll(): number {
    const unlocked = this.deps.vault.unlockedNotes();
    for (const noteId of unlocked) this.relock(noteId, 'all');
    return unlocked.length;
  }

  /** Its views' edits are saved and its session closes, then the key is zeroed. */
  private relock(noteId: string, reason: string): void {
    try {
      this.deps.collab.evict(noteId);
    } catch (err) {
      this.deps.logger.error(`locks: saving note=${noteId} before locking it again failed: ${err instanceof Error ? err.message : 'error'}`);
    }
    this.deps.vault.drop(noteId);
    this.deps.logger.info(`locks: locked again note=${noteId} reason=${reason}`);
  }

  // Change -----------------------------------------------------------------------------------------------------------
  async changePassword(req: { noteId: string; currentPassword: string; newPassword: string }): Promise<LockStatusType> {
    checkNewPassword(req.newPassword);
    return this.exclusive(req.noteId, async () => {
      const dataKey = await this.keyFromPassword(req.noteId, req.currentPassword);
      try {
        const salt = newSalt();
        const passwordKey = await this.wrapWithPassword(req.noteId, req.newPassword, salt, dataKey);
        runTx(this.deps.db, this.deps.logger, () => {
          this.lockedRow(req.noteId);
          this.locks.setPasswordKey(req.noteId, JSON.stringify(this.kdf), salt, passwordKey, this.deps.clock.now());
        });
      } finally {
        dataKey.fill(0);
      }
      this.deps.logger.info(`locks: password changed note=${req.noteId}`);
      return this.status(req.noteId);
    });
  }

  /** Windows Hello on (confirmed once now) or off for a note; the password is required either way. */
  async setHello(req: { noteId: string; password: string; enabled: boolean }): Promise<LockStatusType> {
    return this.exclusive(req.noteId, async () => {
      const dataKey = await this.keyFromPassword(req.noteId, req.password);
      try {
        if (req.enabled) await this.confirmHello();
        const osKey = req.enabled ? this.protect(dataKey) : null;
        runTx(this.deps.db, this.deps.logger, () => {
          this.lockedRow(req.noteId);
          this.locks.setOsKey(req.noteId, osKey, this.deps.clock.now());
        });
      } finally {
        dataKey.fill(0);
      }
      this.deps.logger.info(`locks: hello ${req.enabled ? 'on' : 'off'} note=${req.noteId}`);
      return this.status(req.noteId);
    });
  }

  /** Sets (or with null clears) the sticky PIN; the password confirms the owner. The PIN never touches the data key. */
  async setPin(req: { noteId: string; password: string; pin: string | null }): Promise<LockStatusType> {
    if (req.pin !== null && !isPinFormat(req.pin)) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.pinFormat);
    return this.exclusive(req.noteId, async () => {
      (await this.keyFromPassword(req.noteId, req.password)).fill(0);
      const pin = req.pin === null ? null : await createPinRecord(req.pin, this.deps.pinKdf);
      runTx(this.deps.db, this.deps.logger, () => {
        this.lockedRow(req.noteId);
        if (pin) this.pins.put(req.noteId, pin, this.deps.clock.now());
        else this.pins.delete(req.noteId);
      });
      this.deps.logger.info(`locks: pin ${pin ? 'set' : 'cleared'} note=${req.noteId}`);
      return this.status(req.noteId);
    });
  }

  /**
   * Removes the lock: the content is stored as plaintext again from now on and sealed drafts are opened. What was
   * destroyed when the note was locked (versions, earlier drafts, source texts) stays gone.
   */
  async remove(req: { noteId: string; password: string }): Promise<LockStatusType> {
    return this.exclusive(req.noteId, async () => {
      const dataKey = await this.keyFromPassword(req.noteId, req.password);
      try {
        this.deps.collab.settle(req.noteId);
        this.deps.collab.evict(req.noteId);
        runTx(this.deps.db, this.deps.logger, () => {
          const lock = this.lockedRow(req.noteId);
          const row = this.liveRow(req.noteId);
          const text = openText(dataKey, 'content', req.noteId, lock.content);
          const drafts = this.drafts.allForNote(req.noteId).map((d) => ({ id: d.id, text: openDraft(() => dataKey, req.noteId, d.content) }));
          this.locks.delete(req.noteId);
          openNoteComments(this.deps.db, req.noteId, dataKey);
          this.notes.restoreContent(req.noteId, row.format, text, extractPlainText(row.format, row.format === 'rich' ? JSON.parse(text) : text));
          for (const d of drafts) this.drafts.setContent(d.id, d.text);
        });
      } finally {
        dataKey.fill(0);
      }
      this.deps.vault.drop(req.noteId);
      this.failures.clear(req.noteId);
      this.deps.logger.info(`locks: lock removed note=${req.noteId}`);
      this.deps.onTreeChanged({ reason: 'lock', trashedNoteIds: [], trashedDocumentIds: [] });
      return this.status(req.noteId);
    });
  }

  // Keys ---------------------------------------------------------------------------------------------------------------
  /**
   * The note's data key from its password, with the wrong-password delay; the caller zeroes it. Attempts on a note run
   * one at a time and each counts as a failure until its password is verified, so parallel requests cannot get past
   * the delay.
   */
  private keyFromPassword(noteId: string, password: string): Promise<Buffer> {
    return this.attempts.run(noteId, async () => {
      const lock = this.lockedRow(noteId);
      const wait = this.failures.retryInSeconds(noteId);
      if (wait > 0) throw new AppError('LIMIT_EXCEEDED', LOCK_MESSAGES.wait(wait), { retryInSeconds: wait });
      const params = parseKdfParams(lock.kdf);
      if (!params) throw new AppError('INTERNAL', 'This note could not be opened');
      this.failures.record(noteId);
      const kek = await derivePasswordKey(password, lock.salt, params);
      try {
        const dataKey = unwrapKey(kek, noteId, lock.password_key);
        this.failures.clear(noteId);
        return dataKey;
      } catch (err) {
        if (!(err instanceof SealError)) throw err;
        this.deps.logger.info(`locks: wrong password note=${noteId}`);
        throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.wrongPassword, { wrongPassword: true, retryInSeconds: this.failures.retryInSeconds(noteId) });
      } finally {
        kek.fill(0);
      }
    });
  }

  private async wrapWithPassword(noteId: string, password: string, salt: Buffer, dataKey: Buffer): Promise<Buffer> {
    const kek = await derivePasswordKey(password, salt, this.kdf);
    try {
      return wrapKey(kek, noteId, dataKey);
    } finally {
      kek.fill(0);
    }
  }

  // Windows Hello ------------------------------------------------------------------------------------------------------
  /** Windows Hello must be available and confirm the user now. */
  private async confirmHello(): Promise<void> {
    const available = await this.availability();
    if (available.status !== 'available') throw new AppError('UNSUPPORTED', available.reason);
    const verdict = await this.deps.verifier.verify(this.deps.windowHandle());
    if (verdict === 'verified') return;
    const message = { canceled: LOCK_MESSAGES.helloCanceled, timeout: LOCK_MESSAGES.helloTimeout, failed: LOCK_MESSAGES.helloFailed, unavailable: OS_KEY_MESSAGES.notConfigured }[verdict];
    throw new AppError(verdict === 'unavailable' ? 'UNSUPPORTED' : 'FORBIDDEN', message);
  }

  private requireProtector(): KeyProtector {
    const protector = this.deps.protector;
    if (!protector?.available()) throw new AppError('UNSUPPORTED', OS_KEY_MESSAGES.noProtection);
    return protector;
  }

  private protect(dataKey: Buffer): Buffer {
    return this.requireProtector().protect(dataKey);
  }

  // Rows -----------------------------------------------------------------------------------------------------------------
  private liveRow(noteId: string): ContentRow {
    const row = this.notes.getContentRow(noteId);
    if (!row) throw new AppError('NOT_FOUND', MSG.missing);
    if (row.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.noteInTrash, { trashed: true, trashBatchId: row.trash_batch_id });
    return row;
  }

  private lockedRow(noteId: string): LockRow {
    this.liveRow(noteId);
    const lock = this.locks.get(noteId);
    if (!lock) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.notLocked);
    return lock;
  }

  /** One lock change per note at a time: a second one while a key is derived is refused. */
  private async exclusive<T>(noteId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(noteId)) throw new AppError('CONFLICT', LOCK_MESSAGES.busy);
    this.busy.add(noteId);
    try {
      return await fn();
    } finally {
      this.busy.delete(noteId);
    }
  }
}

function checkNewPassword(password: string): void {
  if ([...password].length < MIN_PASSWORD_CHARS) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.tooShort);
}

function checkNewLock(req: NewLockRequest): void {
  checkNewPassword(req.password);
  if (req.pin && !isPinFormat(req.pin)) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.pinFormat);
}

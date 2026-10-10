import type { LocationType, NoteDtoType, TreeChangedEventType } from '../../shared/contracts/hierarchy';
import { LOCK_MESSAGES, type LockStatusType, type OsKeyAvailabilityType } from '../../shared/contracts/locks';
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
import { openComments, sealComments } from '../comments/comment-cipher';
import { checkNewPassword, type LockKeys, type PasswordCopy } from './lock-keys';
import { purgePlaintext, type DatabaseScrubber } from './lock-purge';
import { newDataKey, newSalt, openText, sealText, wrapKey } from './note-crypto';
import { heldKey, openDraft, type LockVault } from './lock-vault';
import { createPinRecord, isPinFormat, type PinKdf } from './pin-verifier';

/** How often unlocked notes and documents are checked for the idle timeout. */
export const SWEEP_INTERVAL_MS = 15_000;

export interface LockServiceDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  vault: LockVault;
  collab: Pick<CollabHub, 'settle' | 'evict'>;
  settings: Pick<SettingsService, 'getInternal'>;
  /** Creates the row of a note made locked (D-171), inside the same transaction as its lock. */
  hierarchy: Pick<HierarchyService, 'createNote'>;
  /** Password copies, the wrong-password delay and Windows Hello, shared with locked documents (D-185). */
  keys: LockKeys;
  /** Scrubs the database after a lock, again later when it was blocked (shared with locked documents). */
  scrubber: DatabaseScrubber;
  /** Locked documents lock again by the same rules; their open edits are saved first (D-185). */
  documents: { relock(documentIds: readonly string[], reason: string): Promise<void> };
  onTreeChanged: (event: TreeChangedEventType) => void;
  onReminderChanged: (event: ReminderChangedEventType) => void;
  /** Screen lock and suspend lock every note and document again. */
  power?: PowerEvents;
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
 * or Windows Hello for the session, creating a note already locked (D-171), changing the password, Windows Hello on or
 * off, the sticky PIN (D-173), and removing the lock. It also runs the session of every unlocked item, notes and
 * documents (D-185): locking again after the idle time, on screen lock, suspend and quit, and Lock all. Passwords exist
 * only inside these calls: they are never stored, logged or put in an error.
 */
export class LockService {
  private readonly notes: NotesRepo;
  private readonly locks: LocksRepo;
  private readonly pins: PinsRepo;
  private readonly drafts: DraftsRepo;
  private readonly timers: Timers;
  private sweepTimer: unknown = null;
  private unsubscribe: Array<() => void> = [];

  constructor(private readonly deps: LockServiceDeps) {
    this.notes = new NotesRepo(deps.db);
    this.locks = new LocksRepo(deps.db);
    this.pins = new PinsRepo(deps.db);
    this.drafts = new DraftsRepo(deps.db);
    this.timers = deps.timers ?? realTimers;
  }

  // Lifecycle ------------------------------------------------------------------------------------------------------
  /** Starts the idle check and follows screen lock and suspend. */
  start(): void {
    const power = this.deps.power;
    if (power) this.unsubscribe = (['lock-screen', 'suspend'] as const).map((event) => power.on(event, () => void this.lockAll()));
    this.scheduleSweep();
  }

  /** Quitting: every key is dropped (after live sync and the window flush saved what they held); a blocked scrub gets a last try. */
  stop(): void {
    if (this.sweepTimer !== null) this.timers.clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    for (const off of this.unsubscribe.splice(0)) off();
    for (const id of [...this.deps.vault.unlocked('note'), ...this.deps.vault.unlocked('document')]) this.deps.vault.drop(id);
    this.deps.scrubber.retry();
  }

  private scheduleSweep(): void {
    this.sweepTimer = this.timers.setTimeout(() => {
      void this.sweep();
      this.scheduleSweep();
    }, SWEEP_INTERVAL_MS);
  }

  /**
   * Locks again every note and document not used (opened, edited, saved, worked in) for the idle setting; retries a
   * blocked scrub. Documents lock once their open edits are saved; the promise settles then.
   */
  async sweep(): Promise<number> {
    this.deps.scrubber.retry();
    const minutes = this.deps.settings.getInternal('locks.autoLockMinutes');
    const idle = this.deps.vault.idleSince(this.deps.clock.now() - minutes * 60_000);
    for (const { id } of idle.filter((item) => item.kind === 'note')) this.relock(id, 'idle');
    const documents = idle.filter((item) => item.kind === 'document').map((item) => item.id);
    if (documents.length > 0) await this.deps.documents.relock(documents, 'idle');
    return idle.length;
  }

  // Queries --------------------------------------------------------------------------------------------------------
  /** Whether Windows Hello can be offered here, and why not when it cannot. */
  availability(): Promise<OsKeyAvailabilityType> {
    return this.deps.keys.availability();
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
      retryInSeconds: this.deps.keys.retryInSeconds(noteId),
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
      if (req.hello) await this.deps.keys.confirmHello();
      const dataKey = newDataKey();
      try {
        const copy = await this.deps.keys.passwordCopy(noteId, req.password, dataKey);
        const osKey = req.hello ? this.deps.keys.protect(dataKey) : null;
        const pin = req.pin ? await createPinRecord(req.pin, this.deps.pinKdf) : null;
        this.deps.collab.settle(noteId);
        this.deps.collab.evict(noteId);
        const counts = runTx(this.deps.db, this.deps.logger, () => {
          const row = this.lockable(this.liveRow(noteId));
          const content = sealText(dataKey, 'content', noteId, serializedContent(row));
          const purged = purgePlaintext(this.deps.db, noteId);
          sealComments(this.deps.db, { kind: 'note', id: noteId }, dataKey);
          this.insertLockRow(noteId, copy, osKey, content);
          if (pin) this.pins.put(noteId, pin, this.deps.clock.now());
          return purged;
        });
        this.deps.scrubber.scrub();
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

  /** A note that can be locked now: live and not locked. A floating sticky stays floating, blurred (D-172). */
  private lockable(row: ContentRow): ContentRow {
    if (row.locked === 1) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.alreadyLocked);
    return row;
  }

  private insertLockRow(noteId: string, copy: PasswordCopy, osKey: Buffer | null, content: Buffer): void {
    this.locks.insert({ noteId, kdf: copy.kdf, salt: copy.salt, passwordKey: copy.passwordKey, osKey, content, now: this.deps.clock.now() });
  }

  // Create locked ----------------------------------------------------------------------------------------------------
  /**
   * "New locked note" and "New locked sticky" (D-171): the note row and its lock are written in one transaction, so its
   * content never exists in plaintext: the row has no content, the lock holds the sealed empty document, and there is
   * no first save, version, draft, index text or reminder source. The key stays in memory: the new note is open.
   */
  async create(req: NewLockRequest & { location: LocationType; sticky: boolean }): Promise<{ note: NoteDtoType }> {
    checkNewLock(req);
    if (req.hello) await this.deps.keys.confirmHello();
    // The password copy is bound to the note's ID, which exists only inside the transaction: it is wrapped there.
    const salt = newSalt();
    const kek = await this.deps.keys.newPasswordKey(req.password, salt);
    const dataKey = newDataKey();
    try {
      const osKey = req.hello ? this.deps.keys.protect(dataKey) : null;
      const pin = req.pin ? await createPinRecord(req.pin, this.deps.pinKdf) : null;
      const created = this.deps.hierarchy.createNote(req.location, req.sticky, undefined, 'rich', (noteId) => {
        const copy = { kdf: this.deps.keys.kdfJson(), salt, passwordKey: wrapKey(kek, noteId, dataKey) };
        this.insertLockRow(noteId, copy, osKey, sealText(dataKey, 'content', noteId, EMPTY_DOC_JSON));
        if (pin) this.pins.put(noteId, pin, this.deps.clock.now());
      });
      this.deps.vault.put(created.note.id, dataKey, 'note');
      this.deps.logger.info(`locks: created locked note=${created.note.id} sticky=${req.sticky} hello=${req.hello} pin=${pin !== null}`);
      return created;
    } catch (err) {
      dataKey.fill(0);
      throw err;
    } finally {
      kek.fill(0);
    }
  }

  // Unlock -----------------------------------------------------------------------------------------------------------
  /** Unlocks for the session with the password; wrong passwords are counted and slowed down. */
  async unlock(req: { noteId: string; password: string }): Promise<LockStatusType> {
    const dataKey = await this.keyFromPassword(req.noteId, req.password);
    this.deps.vault.put(req.noteId, dataKey, 'note');
    this.deps.logger.info(`locks: unlocked note=${req.noteId} with=password`);
    return this.status(req.noteId);
  }

  /** Unlocks for the session after Windows Hello confirmed the user. */
  async unlockWithHello(noteId: string): Promise<LockStatusType> {
    const lock = this.lockedRow(noteId);
    // The OS returned a key: it must be this note's (it opens the content).
    const dataKey = await this.deps.keys.keyFromHello(noteId, lock, (key) => void openText(key, 'content', noteId, lock.content));
    this.deps.vault.put(noteId, dataKey, 'note');
    this.deps.logger.info(`locks: unlocked note=${noteId} with=hello`);
    return this.status(noteId);
  }

  // Lock again -------------------------------------------------------------------------------------------------------
  lockNow(noteId: string): LockStatusType {
    this.lockedRow(noteId);
    this.relock(noteId, 'now');
    return this.status(noteId);
  }

  /** Locks every unlocked note and document again (documents once their edits are saved); returns how many were unlocked. */
  async lockAll(): Promise<number> {
    const notes = this.deps.vault.unlocked('note');
    for (const noteId of notes) this.relock(noteId, 'all');
    const documents = this.deps.vault.unlocked('document');
    if (documents.length > 0) await this.deps.documents.relock(documents, 'all');
    return notes.length + documents.length;
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
        const copy = await this.deps.keys.passwordCopy(req.noteId, req.newPassword, dataKey);
        runTx(this.deps.db, this.deps.logger, () => {
          this.lockedRow(req.noteId);
          this.locks.setPasswordKey(req.noteId, copy.kdf, copy.salt, copy.passwordKey, this.deps.clock.now());
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
        if (req.enabled) await this.deps.keys.confirmHello();
        const osKey = req.enabled ? this.deps.keys.protect(dataKey) : null;
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
          const drafts = this.drafts.allForNote(req.noteId).map((d) => ({ id: d.id, text: openDraft(heldKey(dataKey), req.noteId, d.content) }));
          this.locks.delete(req.noteId);
          openComments(this.deps.db, { kind: 'note', id: req.noteId }, dataKey);
          this.notes.restoreContent(req.noteId, row.format, text, extractPlainText(row.format, row.format === 'rich' ? JSON.parse(text) : text));
          for (const d of drafts) this.drafts.setContent(d.id, d.text);
        });
      } finally {
        dataKey.fill(0);
      }
      this.deps.vault.drop(req.noteId);
      this.deps.keys.clearFailures(req.noteId);
      this.deps.logger.info(`locks: lock removed note=${req.noteId}`);
      this.deps.onTreeChanged({ reason: 'lock', trashedNoteIds: [], trashedDocumentIds: [] });
      return this.status(req.noteId);
    });
  }

  // Keys and rows -----------------------------------------------------------------------------------------------------
  /** The note's data key from its password, with the wrong-password delay; the caller zeroes it. */
  private keyFromPassword(noteId: string, password: string): Promise<Buffer> {
    return this.deps.keys.keyFromPassword(noteId, () => this.lockedRow(noteId), password);
  }

  private exclusive<T>(noteId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.keys.exclusive(noteId, LOCK_MESSAGES.busy, fn);
  }

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
}

function checkNewLock(req: NewLockRequest): void {
  checkNewPassword(req.password);
  if (req.pin && !isPinFormat(req.pin)) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.pinFormat);
}

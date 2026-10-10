import { LOCK_MESSAGES, PIN_STRIKES, type LockStatusType, type StickyLockStateType } from '../../shared/contracts/locks';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import { PinsRepo } from '../db/repositories/pins-repo';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { CollabHub } from '../services/collab-hub';
import type { Logger } from '../services/logger';
import type { SettingsService } from '../services/settings-service';
import { realTimers, type Timers } from '../services/timers';
import { AttemptBackoff, SerialAttempts } from './attempt-backoff';
import type { LockService } from './lock-service';
import type { NoteVault } from './note-vault';
import { isPinFormat, verifyPin } from './pin-verifier';
import { RevealTimers } from './reveal-timers';

/** How often revealed stickies are checked against their blur deadline. */
export const BLUR_CHECK_INTERVAL_MS = 1_000;

export type RevealWith = { kind: 'pin'; pin: string } | { kind: 'password'; password: string } | { kind: 'hello' };

/** Why a revealed sticky blurred again (logged). */
type BlurReason = 'idle' | 'now' | 'key' | 'window';

export interface StickyLockDeps {
  db: Db;
  /** The reminder clock: the frozen test clock under the E2E hooks, so a spec can move past the blur time. */
  clock: Clock;
  logger: Logger;
  vault: NoteVault;
  locks: Pick<LockService, 'status' | 'unlock' | 'unlockWithHello' | 'setPin'>;
  collab: Pick<CollabHub, 'release'>;
  settings: Pick<SettingsService, 'getInternal'>;
  /** Sends `sticky:lockState` to one window. */
  send: (webContentsId: number, state: StickyLockStateType) => void;
  timers?: Timers;
}

/**
 * Locked stickies (D-172, D-173). A sticky window of a locked note is blurred until it is revealed there with the PIN
 * (only while the note's key is in memory), the password or Windows Hello. Main holds the reveal per window and serves
 * the note's content to that window only while it is revealed (`assertRevealed`, applied to every content channel of a
 * sticky), so a renderer cannot unblur itself. A reveal ends after the blur setting without interaction, at Blur now,
 * when the note's key is dropped (Lock now, Lock all, auto-lock, screen lock, suspend, quit) and when the window closes;
 * the session's edits are saved first. PINs never come near the data key; five wrong ones in a row need the password.
 */
export class StickyLockService {
  private readonly notes: NotesRepo;
  private readonly pins: PinsRepo;
  private readonly timers: Timers;
  private readonly reveals: RevealTimers;
  private readonly pinFailures: AttemptBackoff;
  private readonly pinAttempts = new SerialAttempts();
  /** The sticky window of each floating note. */
  private readonly windows = new Map<string, number>();
  private checkTimer: unknown = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: StickyLockDeps) {
    this.notes = new NotesRepo(deps.db);
    this.pins = new PinsRepo(deps.db);
    this.timers = deps.timers ?? realTimers;
    this.reveals = new RevealTimers(() => deps.settings.getInternal('locks.blurStickySeconds') * 1000);
    this.pinFailures = new AttemptBackoff(() => deps.clock.now());
  }

  // Lifecycle --------------------------------------------------------------------------------------------------------
  start(): void {
    this.unsubscribe = this.deps.vault.onKeyChange((noteId, held) => this.keyChanged(noteId, held));
    this.scheduleCheck();
  }

  /** Quitting: every revealed sticky blurs (its edits saved) and the check stops. */
  stop(): void {
    if (this.checkTimer !== null) this.timers.clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const noteId of this.reveals.revealed()) this.conceal(noteId, 'window');
  }

  private scheduleCheck(): void {
    this.checkTimer = this.timers.setTimeout(() => {
      this.check();
      this.scheduleCheck();
    }, BLUR_CHECK_INTERVAL_MS);
  }

  /** Blurs every revealed sticky whose time without interaction has run out; returns how many. */
  check(): number {
    const expired = this.reveals.expired(this.deps.clock.now());
    for (const noteId of expired) this.conceal(noteId, 'idle');
    return expired.length;
  }

  private keyChanged(noteId: string, held: boolean): void {
    if (held) this.pinFailures.clear(noteId);
    else this.conceal(noteId, 'key');
    this.push(noteId);
  }

  // Windows ----------------------------------------------------------------------------------------------------------
  /** A sticky window of the note was created; it starts blurred. */
  windowOpened(noteId: string, webContentsId: number): void {
    this.conceal(noteId, 'window');
    this.windows.set(noteId, webContentsId);
  }

  windowClosed(noteId: string, webContentsId: number): void {
    if (this.windows.get(noteId) !== webContentsId) return;
    this.conceal(noteId, 'window');
    this.windows.delete(noteId);
  }

  // Queries ----------------------------------------------------------------------------------------------------------
  status(noteId: string, webContentsId: number): StickyLockStateType {
    const lock = this.deps.locks.status(noteId);
    const keyInMemory = lock.unlocked;
    const pinBlocked = this.pinFailures.count(noteId) >= PIN_STRIKES;
    const pinUsable = lock.pin && keyInMemory && !pinBlocked;
    return {
      noteId,
      locked: lock.locked,
      revealed: lock.locked && keyInMemory && this.reveals.isRevealed(noteId, webContentsId, this.deps.clock.now()),
      keyInMemory,
      pinSet: lock.pin,
      pinBlocked,
      hello: lock.hello,
      retryInSeconds: pinUsable ? this.pinFailures.retryInSeconds(noteId) : lock.retryInSeconds,
    };
  }

  /**
   * The gate of every content channel of a sticky window: a locked note's content (and what belongs to it) goes only to
   * the window where it is revealed, and only while its key is in memory.
   */
  assertRevealed(noteId: string, webContentsId: number): void {
    if (!this.notes.isLocked(noteId)) return;
    if (this.deps.vault.isUnlocked(noteId) && this.reveals.isRevealed(noteId, webContentsId, this.deps.clock.now())) return;
    throw new AppError('FORBIDDEN', LOCK_MESSAGES.blurred, { locked: true, blurred: true });
  }

  // Reveal -----------------------------------------------------------------------------------------------------------
  async reveal(noteId: string, webContentsId: number, how: RevealWith): Promise<StickyLockStateType> {
    this.ownWindow(noteId, webContentsId);
    if (!this.notes.isLocked(noteId)) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.notLocked);
    if (how.kind === 'pin') await this.checkPin(noteId, how.pin);
    else if (how.kind === 'password') await this.deps.locks.unlock({ noteId, password: how.password });
    else await this.deps.locks.unlockWithHello(noteId);
    // The key may have been dropped while the PIN was checked.
    if (!this.deps.vault.isUnlocked(noteId)) throw new AppError('FORBIDDEN', LOCK_MESSAGES.pinNeedsKey, { needsPassword: true });
    this.reveals.reveal(noteId, webContentsId, this.deps.clock.now());
    this.deps.logger.info(`locks: sticky revealed note=${noteId} with=${how.kind}`);
    return this.push(noteId) ?? this.status(noteId, webContentsId);
  }

  /** Reveals the sticky of a note just created locked (its key is in memory: the user typed the password now). */
  grant(noteId: string): void {
    const webContentsId = this.windows.get(noteId);
    if (webContentsId === undefined || !this.deps.vault.isUnlocked(noteId)) return;
    this.reveals.reveal(noteId, webContentsId, this.deps.clock.now());
    this.push(noteId);
  }

  /**
   * One PIN attempt: only while the key is in memory and fewer than five wrong PINs in a row, with the password's
   * backoff. Attempts run one at a time and count as wrong until verified, like passwords (D-117).
   */
  private checkPin(noteId: string, pin: string): Promise<void> {
    return this.pinAttempts.run(noteId, async () => {
      const stored = this.pins.get(noteId);
      if (!stored) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.pinNotSet);
      if (!this.deps.vault.isUnlocked(noteId)) throw new AppError('FORBIDDEN', LOCK_MESSAGES.pinNeedsKey, { needsPassword: true });
      if (this.pinFailures.count(noteId) >= PIN_STRIKES) throw new AppError('FORBIDDEN', LOCK_MESSAGES.pinStrikes, { needsPassword: true });
      const wait = this.pinFailures.retryInSeconds(noteId);
      if (wait > 0) throw new AppError('LIMIT_EXCEEDED', LOCK_MESSAGES.wait(wait), { retryInSeconds: wait });
      if (!isPinFormat(pin)) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.pinFormat);
      this.pinFailures.record(noteId);
      if (await verifyPin(pin, stored)) {
        this.pinFailures.clear(noteId);
        return;
      }
      this.deps.logger.info(`locks: wrong sticky pin note=${noteId}`);
      const blocked = this.pinFailures.count(noteId) >= PIN_STRIKES;
      throw new AppError('VALIDATION_FAILED', blocked ? LOCK_MESSAGES.pinStrikes : LOCK_MESSAGES.wrongPin, {
        wrongPin: true,
        needsPassword: blocked,
        retryInSeconds: this.pinFailures.retryInSeconds(noteId),
      });
    });
  }

  /** Interaction in a revealed sticky (typing, clicks, scrolling, the pointer over its text): its blur moves out. */
  activity(noteId: string, webContentsId: number): void {
    this.reveals.touch(noteId, webContentsId, this.deps.clock.now());
  }

  /** "Blur now" in the sticky's menu. */
  blur(noteId: string, webContentsId: number): StickyLockStateType {
    this.ownWindow(noteId, webContentsId);
    this.conceal(noteId, 'now');
    return this.status(noteId, webContentsId);
  }

  /** Sets or clears the PIN (password required); a new PIN starts without strikes. */
  async setPin(req: { noteId: string; password: string; pin: string | null }): Promise<LockStatusType> {
    const status = await this.deps.locks.setPin(req);
    this.pinFailures.clear(req.noteId);
    this.push(req.noteId);
    return status;
  }

  // Blur ---------------------------------------------------------------------------------------------------------------
  /** Ends a reveal: the window's views leave live sync (edits saved first) and the window shows the blur. */
  private conceal(noteId: string, reason: BlurReason): void {
    const webContentsId = this.reveals.conceal(noteId);
    if (webContentsId === null) return;
    try {
      this.deps.collab.release(noteId, webContentsId);
    } catch (err) {
      this.deps.logger.error(`locks: releasing the sticky of note=${noteId} failed: ${err instanceof Error ? err.name : 'error'}`);
    }
    this.deps.logger.info(`locks: sticky blurred note=${noteId} reason=${reason}`);
    this.push(noteId);
  }

  /** Sends the lock state to the note's sticky window, if it floats; returns what was sent. */
  private push(noteId: string): StickyLockStateType | null {
    const webContentsId = this.windows.get(noteId);
    // A trashed or purged note has no lock state to show; its window shows the trash state or closes.
    if (webContentsId === undefined || this.notes.getContentRow(noteId)?.deleted_at !== null) return null;
    const state = this.status(noteId, webContentsId);
    this.deps.send(webContentsId, state);
    return state;
  }

  private ownWindow(noteId: string, webContentsId: number): void {
    if (this.windows.get(noteId) !== webContentsId) throw new AppError('FORBIDDEN', 'Not allowed');
  }
}

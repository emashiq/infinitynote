import { LOCK_MESSAGES } from '../../shared/contracts/locks';
import type { Db } from '../db/driver';
import { LocksRepo } from '../db/repositories/locks-repo';
import { serializedContent, type ContentRow } from '../db/repositories/notes-repo';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import { openText, SealError, sealText } from './note-crypto';

/** How a sealed draft is stored in the draft's text column (the migration 010 trigger checks the prefix). */
const SEALED_PREFIX = 'sealed:';

/** A draft's text sealed with its note's data key, as stored. */
const sealDraft = (key: Buffer, noteId: string, text: string): string =>
  SEALED_PREFIX + sealText(key, 'draft', noteId, text).toString('base64');

/** A stored draft's text: sealed ones are opened with the note's data key, others are returned as they are. */
export function openDraft(key: () => Buffer, noteId: string, stored: string): string {
  if (!stored.startsWith(SEALED_PREFIX)) return stored;
  return openText(key(), 'draft', noteId, Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64'));
}

/** The error every path gives for a locked note whose key is not in memory; the renderer shows the lock screen. */
const lockedError = (): AppError => new AppError('FORBIDDEN', LOCK_MESSAGES.locked, { locked: true });

/** Told when a note's key comes into memory (held) or is dropped. */
export type KeyListener = (noteId: string, held: boolean) => void;

interface Unlocked {
  key: Buffer;
  lastUsed: number;
}

/**
 * The keys of the locked notes unlocked in this session (memory only) and the one place that turns a locked note's
 * stored ciphertext into text and back (D-111). Every content path asks the vault, so a locked note is readable or
 * writable only while its key is here; without it they fail with FORBIDDEN `{locked: true}`.
 */
export class NoteVault {
  private readonly keys = new Map<string, Unlocked>();
  private readonly listeners = new Set<KeyListener>();
  private readonly locks: LocksRepo;

  constructor(
    db: Db,
    private readonly clock: Clock,
  ) {
    this.locks = new LocksRepo(db);
  }

  // Keys ---------------------------------------------------------------------------------------------------------
  /** Holds a note's data key for the session; the vault owns the buffer from now on. */
  put(noteId: string, key: Buffer): void {
    // A key replaced by a new unlock is zeroed; the note stays unlocked throughout.
    this.keys.get(noteId)?.key.fill(0);
    this.keys.set(noteId, { key, lastUsed: this.clock.now() });
    this.notify(noteId, true);
  }

  /** Follows keys coming into memory and being dropped (locked stickies blur when their key goes, D-172). */
  onKeyChange(listener: KeyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(noteId: string, held: boolean): void {
    for (const listener of [...this.listeners]) listener(noteId, held);
  }

  isUnlocked(noteId: string): boolean {
    return this.keys.has(noteId);
  }

  /** Zeroes and forgets a note's key. */
  drop(noteId: string): void {
    const unlocked = this.keys.get(noteId);
    if (!unlocked) return;
    unlocked.key.fill(0);
    this.keys.delete(noteId);
    this.notify(noteId, false);
  }

  unlockedNotes(): string[] {
    return [...this.keys.keys()];
  }

  /** Notes whose key was not used since `before`. */
  idleSince(before: number): string[] {
    return [...this.keys].filter(([, u]) => u.lastUsed < before).map(([noteId]) => noteId);
  }

  /** The key of an unlocked note (a use that keeps it unlocked); FORBIDDEN while it is locked. */
  keyOf(noteId: string): Buffer {
    const unlocked = this.keys.get(noteId);
    if (!unlocked) throw lockedError();
    unlocked.lastUsed = this.clock.now();
    return unlocked.key;
  }

  // Content ------------------------------------------------------------------------------------------------------
  /** The stored content of any note as serialized text; a locked note's is decrypted with its key. */
  serialized(row: ContentRow): string {
    if (row.locked !== 1) return serializedContent(row);
    const lock = this.locks.get(row.id);
    if (!lock) throw new AppError('INTERNAL', 'This note could not be opened');
    return this.openOrFail(() => openText(this.keyOf(row.id), 'content', row.id, lock.content));
  }

  /** The row with its content readable: a locked note's decrypted content in the column of its format. */
  readable(row: ContentRow): ContentRow {
    if (row.locked !== 1) return row;
    const text = this.serialized(row);
    return { ...row, content_json: row.format === 'rich' ? text : null, content_text: row.format === 'plain' ? text : null };
  }

  /** Encrypts and stores the content of a locked note (inside the caller's transaction). */
  storeContent(noteId: string, serialized: string, now: number): void {
    this.locks.setContent(noteId, sealText(this.keyOf(noteId), 'content', noteId, serialized), now);
  }

  /** A draft's text as stored: sealed with the note's key when the note is locked. */
  draftText(noteId: string, locked: boolean, text: string): string {
    return locked ? sealDraft(this.keyOf(noteId), noteId, text) : text;
  }

  /** A stored draft's text; a sealed one needs the note unlocked. */
  openDraft(noteId: string, stored: string): string {
    return this.openOrFail(() => openDraft(() => this.keyOf(noteId), noteId, stored));
  }

  private openOrFail(fn: () => string): string {
    try {
      return fn();
    } catch (err) {
      if (err instanceof SealError) throw new AppError('INTERNAL', 'This note could not be opened');
      throw err;
    }
  }
}

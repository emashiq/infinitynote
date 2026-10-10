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

/** Runs a synchronous use of a data key: the vault's (resolved at that moment) or a key a lock change holds. */
export type KeyAccess = <T>(use: (key: Buffer) => T) => T;

/** The key access of a key the caller holds (and zeroes) itself. */
export const heldKey =
  (key: Buffer): KeyAccess =>
  (use) =>
    use(key);

/** A stored draft's text: sealed ones are opened with the note's data key, others are returned as they are. */
export function openDraft(key: KeyAccess, noteId: string, stored: string): string {
  if (!stored.startsWith(SEALED_PREFIX)) return stored;
  return key((k) => openText(k, 'draft', noteId, Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64')));
}

/** The error every path gives for a locked note whose key is not in memory; the renderer shows the lock screen. */
const lockedError = (message: string): AppError => new AppError('FORBIDDEN', message, { locked: true });

/** What a key in the vault unlocks: a locked note (D-111) or a locked document (D-185). */
export type LockedItemKind = 'note' | 'document';

/** Told when a key comes into memory (held) or is dropped. */
export type KeyListener = (id: string, held: boolean, kind: LockedItemKind) => void;

interface Unlocked {
  key: Buffer;
  lastUsed: number;
  kind: LockedItemKind;
}

/**
 * The keys of the locked notes and documents unlocked in this session (memory only, D-111, D-185) and the one place
 * that turns a locked note's stored ciphertext into text and back. Every content path asks the vault, so a locked item
 * is readable or writable only while its key is here; without it they fail with FORBIDDEN `{locked: true}`. IDs are
 * UUIDs, so notes and documents share one map.
 */
export class LockVault {
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
  /** Holds a note's or document's data key for the session; the vault owns the buffer from now on. */
  put(id: string, key: Buffer, kind: LockedItemKind): void {
    // A key replaced by a new unlock is zeroed; the item stays unlocked throughout.
    this.keys.get(id)?.key.fill(0);
    this.keys.set(id, { key, lastUsed: this.clock.now(), kind });
    this.notify(id, true, kind);
  }

  /** Follows keys coming into memory and being dropped (locked stickies blur when their key goes, D-172). */
  onKeyChange(listener: KeyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(id: string, held: boolean, kind: LockedItemKind): void {
    for (const listener of [...this.listeners]) listener(id, held, kind);
  }

  isUnlocked(noteId: string): boolean {
    return this.keys.has(noteId);
  }

  /** Zeroes and forgets a key. */
  drop(id: string): void {
    const unlocked = this.keys.get(id);
    if (!unlocked) return;
    unlocked.key.fill(0);
    this.keys.delete(id);
    this.notify(id, false, unlocked.kind);
  }

  /** The unlocked notes or documents. */
  unlocked(kind: LockedItemKind): string[] {
    return [...this.keys].filter(([, u]) => u.kind === kind).map(([id]) => id);
  }

  /** Items whose key was not used since `before`. */
  idleSince(before: number): Array<{ id: string; kind: LockedItemKind }> {
    return [...this.keys].filter(([, u]) => u.lastUsed < before).map(([id, u]) => ({ id, kind: u.kind }));
  }

  /** Counts as a use of an unlocked item (someone works in an unlocked document); nothing for a locked one. */
  touch(id: string): void {
    const unlocked = this.keys.get(id);
    if (unlocked) unlocked.lastUsed = this.clock.now();
  }

  /** FORBIDDEN `{locked: true}` with `message` unless the item is unlocked (a check, not a use). */
  requireUnlocked(id: string, message: string = LOCK_MESSAGES.locked): void {
    if (!this.keys.has(id)) throw lockedError(message);
  }

  /**
   * Runs `use` with the key of an unlocked note or document (a use that keeps it unlocked); FORBIDDEN while it is locked.
   * The key is the vault's own buffer, zeroed when the item locks again or is unlocked anew, so `use` must be
   * synchronous and must not keep it: the key is taken at the moment it seals or opens, never across an await (a save
   * or read that waits is resolved again afterwards, and fails if the item locked meanwhile).
   */
  withKey<T>(id: string, use: (key: Buffer) => T, message: string = LOCK_MESSAGES.locked): T {
    const unlocked = this.keys.get(id);
    if (!unlocked) throw lockedError(message);
    unlocked.lastUsed = this.clock.now();
    const result = use(unlocked.key);
    if (result instanceof Promise) throw new Error('A vault key was used asynchronously');
    return result;
  }

  /** The key access of one item for ciphers that seal or open several values: each use resolves the key again. */
  keyAccess(id: string, message: string = LOCK_MESSAGES.locked): KeyAccess {
    return (use) => this.withKey(id, use, message);
  }

  // Content ------------------------------------------------------------------------------------------------------
  /** The stored content of any note as serialized text; a locked note's is decrypted with its key. */
  serialized(row: ContentRow): string {
    if (row.locked !== 1) return serializedContent(row);
    const lock = this.locks.get(row.id);
    if (!lock) throw new AppError('INTERNAL', 'This note could not be opened');
    return this.openOrFail(() => this.withKey(row.id, (key) => openText(key, 'content', row.id, lock.content)));
  }

  /** The row with its content readable: a locked note's decrypted content in the column of its format. */
  readable(row: ContentRow): ContentRow {
    if (row.locked !== 1) return row;
    const text = this.serialized(row);
    return { ...row, content_json: row.format === 'rich' ? text : null, content_text: row.format === 'plain' ? text : null };
  }

  /** Encrypts and stores the content of a locked note (inside the caller's transaction). */
  storeContent(noteId: string, serialized: string, now: number): void {
    this.locks.setContent(noteId, this.withKey(noteId, (key) => sealText(key, 'content', noteId, serialized)), now);
  }

  /** A draft's text as stored: sealed with the note's key when the note is locked. */
  draftText(noteId: string, locked: boolean, text: string): string {
    return locked ? this.withKey(noteId, (key) => sealDraft(key, noteId, text)) : text;
  }

  /** A stored draft's text; a sealed one needs the note unlocked. */
  openDraft(noteId: string, stored: string): string {
    return this.openOrFail(() => openDraft(this.keyAccess(noteId), noteId, stored));
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

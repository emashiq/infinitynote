import fs from 'node:fs';
import { maxBytes } from '../../shared/attachments/limits';
import { DOCUMENT_LOCK_MESSAGES, type DocumentLockStatusType } from '../../shared/contracts/locks';
import type { TreeChangedEventType } from '../../shared/contracts/hierarchy';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import { openComments, sealComments } from '../comments/comment-cipher';
import type { Db } from '../db/driver';
import { DocumentBlobsRepo, type DocumentBlobRow } from '../db/repositories/document-blobs-repo';
import { DocumentLocksRepo, type DocumentLockRow } from '../db/repositories/document-locks-repo';
import { DocumentVersionsRepo } from '../db/repositories/document-versions-repo';
import { DocumentsRepo, type DocumentRow } from '../db/repositories/documents-repo';
import type { DocumentFiles } from '../documents/document-files';
import type { DocumentStore } from '../documents/document-store';
import type { DocumentText } from '../documents/text/document-text';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { Logger } from '../services/logger';
import type { KeyedQueue } from '../services/keyed-queue';
import type { SettingsService } from '../services/settings-service';
import { runTx } from '../services/transaction';
import { checkNewPassword, type LockKeys } from './lock-keys';
import type { DatabaseScrubber } from './lock-purge';
import type { LockVault } from './lock-vault';
import { newDataKey, open, seal, SealError } from './note-crypto';

export interface DocumentLocksDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  vault: LockVault;
  keys: LockKeys;
  store: DocumentStore;
  files: DocumentFiles;
  /** The searchable text of a document whose lock is removed. */
  text: DocumentText;
  settings: Pick<SettingsService, 'getInternal'>;
  scrubber: DatabaseScrubber;
  /** The per-document queue of content changes DocumentService's saves and restores run in. */
  writes: KeyedQueue;
  /** Saves the edits open in the main window's document tab (an acknowledged flush), before a document locks again. */
  saveOpenEdits: () => Promise<void>;
  onTreeChanged: (event: TreeChangedEventType) => void;
  /** A locked document's key left memory: the main window shows its lock screen. */
  onLocked: (documentId: string) => void;
}

/** Decrypted bytes kept in memory for the protocol's range requests; a few blobs at most, dropped with their key. */
const PLAINTEXT_CACHE_ENTRIES = 3;

/**
 * Locked documents (D-185): the lock of notes (D-111) on a document's stored bytes, with the same password copy and
 * Windows Hello (LockKeys), the same session (LockVault: idle time, Lock now, Lock all, screen lock, suspend, quit) and
 * the same one-way purge. Locking seals the current bytes into a blob of their own, deletes the plaintext versions and
 * the searchable text, seals the document's comments, deletes the replaced plaintext blobs at once and scrubs the
 * database. While it is unlocked its bytes are decrypted in memory only, for the viewers, editors and Export a copy;
 * saves, restores and new versions are sealed. A linked file is copied in first (within the copy limit), since a file
 * outside the app cannot be encrypted in place.
 */
export class DocumentLocks {
  private readonly documents: DocumentsRepo;
  private readonly locks: DocumentLocksRepo;
  private readonly versions: DocumentVersionsRepo;
  private readonly blobs: DocumentBlobsRepo;
  /** blobId → the document it belongs to and its decrypted bytes, most recently used last. */
  private readonly plaintext = new Map<string, { documentId: string; bytes: Uint8Array }>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: DocumentLocksDeps) {
    this.documents = new DocumentsRepo(deps.db);
    this.locks = new DocumentLocksRepo(deps.db);
    this.versions = new DocumentVersionsRepo(deps.db);
    this.blobs = new DocumentBlobsRepo(deps.db);
    this.unsubscribe = deps.vault.onKeyChange((id, held, kind) => {
      if (kind !== 'document' || held) return;
      this.forget(id);
      // A removed lock drops its key too, but nothing is locked then.
      if (this.locks.get(id)) deps.onLocked(id);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // Queries ----------------------------------------------------------------------------------------------------------
  status(documentId: string): DocumentLockStatusType {
    this.liveRow(documentId);
    const lock = this.locks.get(documentId);
    return {
      documentId,
      locked: lock !== undefined,
      unlocked: lock !== undefined && this.deps.vault.isUnlocked(documentId),
      hello: lock?.os_key != null,
      retryInSeconds: this.deps.keys.retryInSeconds(documentId),
    };
  }

  // Lock -------------------------------------------------------------------------------------------------------------
  /**
   * Locks a document (its open edits were saved by the caller): the current bytes are sealed into a blob of their own;
   * then in one transaction the document points at it (a linked one becomes managed, its original file stays where it
   * is), its versions and searchable text go, its comments are sealed and the lock is stored. The plaintext blobs it no
   * longer uses are deleted at once and the database is scrubbed. The document is locked at once.
   */
  async lock(req: { documentId: string; password: string; hello: boolean; copyIn: boolean }): Promise<DocumentLockStatusType> {
    const { documentId } = req;
    checkNewPassword(req.password);
    const checked = this.lockable(this.liveRow(documentId));
    if (checked.storage === 'linked' && !req.copyIn) throw new AppError('VALIDATION_FAILED', DOCUMENT_LOCK_MESSAGES.linkedNeedsCopy);
    return this.exclusive(documentId, async () => {
      if (req.hello) await this.deps.keys.confirmHello();
      // After the saves under way (their bytes are the ones sealed) and before any that follow (refused: it is locked).
      return this.deps.writes.run(documentId, () => this.lockQueued(req));
    });
  }

  private async lockQueued(req: { documentId: string; password: string; hello: boolean }): Promise<DocumentLockStatusType> {
    const { documentId } = req;
    const row = this.lockable(this.liveRow(documentId));
    const bytes = await this.currentBytes(row);
    const dataKey = newDataKey();
    try {
      const copy = await this.deps.keys.passwordCopy(documentId, req.password, dataKey);
      const osKey = req.hello ? this.deps.keys.protect(dataKey) : null;
      const sealed = await this.deps.store.putSealed(row.kind, bytes, (plain) => seal(dataKey, 'document', documentId, Buffer.from(plain)));
      const replaced = runTx(this.deps.db, this.deps.logger, () => {
        const fresh = this.lockable(this.liveRow(documentId));
        if (fresh.revision !== row.revision || fresh.blob_id !== row.blob_id)
          throw new AppError('CONFLICT', DOCUMENT_MESSAGES.revisionChanged, {
            reason: 'revision',
            currentRevision: fresh.revision,
          });
        const versions = this.versions.list(documentId);
        this.versions.deleteIds(versions.map((v) => v.id));
        this.documents.replaceContent(documentId, sealed.id, bytes.byteLength, '', this.deps.clock.now());
        sealComments(this.deps.db, { kind: 'document', id: documentId }, dataKey);
        this.locks.insert({
          documentId,
          kdf: copy.kdf,
          salt: copy.salt,
          passwordKey: copy.passwordKey,
          osKey,
          now: this.deps.clock.now(),
        });
        return [...(fresh.blob_id ? [fresh.blob_id] : []), ...versions.map((v) => v.blob_id)];
      });
      const removed = await this.deps.store.removeUnused(replaced);
      this.deps.scrubber.scrub();
      this.deps.logger.info(`locks: locked document=${documentId} hello=${req.hello} linked=${row.storage === 'linked'} purged blobs=${removed}`);
      this.deps.onTreeChanged({
        reason: 'lock',
        trashedNoteIds: [],
        trashedDocumentIds: [],
      });
    } finally {
      dataKey.fill(0);
    }
    return this.status(documentId);
  }

  /** The bytes a lock seals: the stored blob, or a linked original within the copy limit. */
  private async currentBytes(row: DocumentRow): Promise<Uint8Array> {
    const resolved = await this.deps.files.resolve(row);
    if (!resolved) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.missing);
    if (row.storage === 'linked') {
      const limitMb = this.deps.settings.getInternal('attachments.documentMaxMb');
      // Checked before reading, so an oversized file is never copied.
      if (resolved.sizeBytes > maxBytes(limitMb)) throw new AppError('LIMIT_EXCEEDED', DOCUMENT_LOCK_MESSAGES.linkedTooLarge(limitMb));
    }
    return fs.promises.readFile(resolved.file);
  }

  private lockable(row: DocumentRow): DocumentRow {
    if (row.locked === 1) throw new AppError('VALIDATION_FAILED', DOCUMENT_LOCK_MESSAGES.alreadyLocked);
    return row;
  }

  // Unlock -----------------------------------------------------------------------------------------------------------
  async unlock(req: { documentId: string; password: string }): Promise<DocumentLockStatusType> {
    const dataKey = await this.keyFromPassword(req.documentId, req.password);
    this.deps.vault.put(req.documentId, dataKey, 'document');
    this.deps.logger.info(`locks: unlocked document=${req.documentId} with=password`);
    return this.status(req.documentId);
  }

  async unlockWithHello(documentId: string): Promise<DocumentLockStatusType> {
    const lock = this.lockedRow(documentId);
    const blob = this.currentBlob(documentId);
    const sealed = await this.deps.store.read(blob.id);
    // The OS returned a key: it must be this document's (it opens its bytes).
    const dataKey = await this.deps.keys.keyFromHello(documentId, lock, (key) => void open(key, 'document', documentId, sealed).fill(0));
    this.deps.vault.put(documentId, dataKey, 'document');
    this.deps.logger.info(`locks: unlocked document=${documentId} with=hello`);
    return this.status(documentId);
  }

  // Use and lock again -----------------------------------------------------------------------------------------------
  /** Someone works in the unlocked document (reported by its tab): the idle time starts again. */
  activity(documentId: string): void {
    this.deps.vault.touch(documentId);
  }

  async lockNow(documentId: string): Promise<DocumentLockStatusType> {
    this.lockedRow(documentId);
    await this.relock([documentId], 'now');
    return this.status(documentId);
  }

  /** The documents' open edits are saved (sealed, with the key still here), then their keys are zeroed. */
  async relock(documentIds: readonly string[], reason: string): Promise<void> {
    try {
      await this.deps.saveOpenEdits();
    } catch (err) {
      this.deps.logger.error(`locks: saving open document edits before locking failed: ${err instanceof Error ? err.message : 'error'}`);
    }
    // A save already under way finishes with the key (its bytes are sealed); the key goes before any that follows.
    await Promise.all(
      documentIds.map((documentId) =>
        this.deps.writes.run(documentId, async () => {
          if (!this.deps.vault.isUnlocked(documentId)) return;
          this.deps.vault.drop(documentId);
          this.deps.logger.info(`locks: locked again document=${documentId} reason=${reason}`);
        }),
      ),
    );
  }

  // Change -----------------------------------------------------------------------------------------------------------
  async changePassword(req: { documentId: string; currentPassword: string; newPassword: string }): Promise<DocumentLockStatusType> {
    checkNewPassword(req.newPassword);
    return this.exclusive(req.documentId, async () => {
      const dataKey = await this.keyFromPassword(req.documentId, req.currentPassword);
      try {
        const copy = await this.deps.keys.passwordCopy(req.documentId, req.newPassword, dataKey);
        runTx(this.deps.db, this.deps.logger, () => {
          this.lockedRow(req.documentId);
          this.locks.setPasswordKey(req.documentId, copy.kdf, copy.salt, copy.passwordKey, this.deps.clock.now());
        });
      } finally {
        dataKey.fill(0);
      }
      this.deps.logger.info(`locks: password changed document=${req.documentId}`);
      return this.status(req.documentId);
    });
  }

  async setHello(req: { documentId: string; password: string; enabled: boolean }): Promise<DocumentLockStatusType> {
    return this.exclusive(req.documentId, async () => {
      const dataKey = await this.keyFromPassword(req.documentId, req.password);
      try {
        if (req.enabled) await this.deps.keys.confirmHello();
        const osKey = req.enabled ? this.deps.keys.protect(dataKey) : null;
        runTx(this.deps.db, this.deps.logger, () => {
          this.lockedRow(req.documentId);
          this.locks.setOsKey(req.documentId, osKey, this.deps.clock.now());
        });
      } finally {
        dataKey.fill(0);
      }
      this.deps.logger.info(`locks: hello ${req.enabled ? 'on' : 'off'} document=${req.documentId}`);
      return this.status(req.documentId);
    });
  }

  /**
   * Removes the lock: the current bytes and every version are stored unencrypted again and the comments are opened;
   * the searchable text is read again. What was destroyed when the document was locked stays gone.
   */
  async remove(req: { documentId: string; password: string }): Promise<DocumentLockStatusType> {
    const { documentId } = req;
    return this.exclusive(documentId, () => this.deps.writes.run(documentId, () => this.removeQueued(req)));
  }

  private async removeQueued(req: { documentId: string; password: string }): Promise<DocumentLockStatusType> {
    const { documentId } = req;
    const dataKey = await this.keyFromPassword(documentId, req.password);
    try {
      const row = this.liveRow(documentId);
      const opened = async (blobId: string) => this.deps.store.putBytes(row.kind, open(dataKey, 'document', documentId, await this.deps.store.read(blobId)));
      const current = await opened(row.blob_id!);
      const versions = await Promise.all(
        this.versions.list(documentId).map(async (v) => ({
          id: v.id,
          sealedBlobId: v.blob_id,
          blob: await opened(v.blob_id),
        })),
      );
      const file = await this.deps.store.fileOf(current);
      const bodyText = file ? await this.deps.text.of(row.kind, file) : '';
      runTx(this.deps.db, this.deps.logger, () => {
        this.lockedRow(documentId);
        const fresh = this.liveRow(documentId);
        if (fresh.revision !== row.revision || fresh.blob_id !== row.blob_id)
          throw new AppError('CONFLICT', DOCUMENT_MESSAGES.revisionChanged, {
            reason: 'revision',
            currentRevision: fresh.revision,
          });
        this.locks.delete(documentId);
        this.documents.replaceContent(documentId, current.id, current.size_bytes, bodyText, this.deps.clock.now());
        for (const v of versions) this.versions.setBlob(v.id, v.blob.id);
        openComments(this.deps.db, { kind: 'document', id: documentId }, dataKey);
      });
      await this.deps.store.removeUnused([row.blob_id!, ...versions.map((v) => v.sealedBlobId)]);
    } catch (err) {
      if (err instanceof SealError) throw new AppError('INTERNAL', DOCUMENT_MESSAGES.damaged(this.liveRow(documentId).kind));
      throw err;
    } finally {
      dataKey.fill(0);
    }
    this.deps.vault.drop(documentId);
    this.deps.keys.clearFailures(documentId);
    this.deps.logger.info(`locks: lock removed document=${documentId}`);
    this.deps.onTreeChanged({
      reason: 'lock',
      trashedNoteIds: [],
      trashedDocumentIds: [],
    });
    return this.status(documentId);
  }

  // Content ----------------------------------------------------------------------------------------------------------
  /**
   * The decrypted bytes of one of a locked document's sealed blobs, from memory when they were opened recently; FORBIDDEN
   * `{locked: true}` while the document is locked. Reading counts as a use. Callers never change the bytes.
   */
  async plaintextOf(documentId: string, blob: Pick<DocumentBlobRow, 'id'>): Promise<Uint8Array> {
    this.deps.vault.requireUnlocked(documentId, DOCUMENT_LOCK_MESSAGES.locked);
    const cached = this.plaintext.get(blob.id);
    if (cached?.documentId === documentId) {
      this.plaintext.delete(blob.id);
      this.plaintext.set(blob.id, cached);
      return cached.bytes;
    }
    const sealed = await this.deps.store.read(blob.id);
    let bytes: Buffer;
    try {
      // The key is taken after the read: if the document locked meanwhile this is FORBIDDEN (its lock screen), not damage.
      bytes = this.deps.vault.withKey(documentId, (key) => open(key, 'document', documentId, sealed), DOCUMENT_LOCK_MESSAGES.locked);
    } catch (err) {
      if (err instanceof SealError) throw new AppError('INTERNAL', DOCUMENT_MESSAGES.damaged(this.liveRow(documentId).kind));
      throw err;
    }
    this.plaintext.set(blob.id, { documentId, bytes });
    for (const [id] of this.plaintext) {
      if (this.plaintext.size <= PLAINTEXT_CACHE_ENTRIES) break;
      this.plaintext.delete(id);
    }
    return bytes;
  }

  /**
   * Seals bytes saved into an unlocked locked document; FORBIDDEN while it is locked. The key is taken when the bytes
   * are sealed, not when the save starts: a save that waits (the content check) while the document locks again is
   * refused with `lockedDuringSave` instead of being sealed with a dropped key.
   */
  sealerOf(documentId: string): (bytes: Uint8Array) => Buffer {
    this.deps.vault.requireUnlocked(documentId, DOCUMENT_LOCK_MESSAGES.locked);
    return (bytes) =>
      this.deps.vault.withKey(
        documentId,
        (key) => seal(key, 'document', documentId, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
        DOCUMENT_LOCK_MESSAGES.lockedDuringSave,
      );
  }

  /** Drops the decrypted bytes of a document from memory. */
  private forget(documentId: string): void {
    for (const [blobId, entry] of this.plaintext) if (entry.documentId === documentId) this.plaintext.delete(blobId);
  }

  // Keys and rows ----------------------------------------------------------------------------------------------------
  private keyFromPassword(documentId: string, password: string): Promise<Buffer> {
    return this.deps.keys.keyFromPassword(documentId, () => this.lockedRow(documentId), password);
  }

  private exclusive<T>(documentId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.keys.exclusive(documentId, DOCUMENT_LOCK_MESSAGES.busy, fn);
  }

  private liveRow(documentId: string): DocumentRow {
    const row = this.documents.get(documentId);
    if (!row) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.missing);
    if (row.deleted_at !== null) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.inTrash);
    return row;
  }

  private lockedRow(documentId: string): DocumentLockRow {
    this.liveRow(documentId);
    const lock = this.locks.get(documentId);
    if (!lock) throw new AppError('VALIDATION_FAILED', DOCUMENT_LOCK_MESSAGES.notLocked);
    return lock;
  }

  private currentBlob(documentId: string): DocumentBlobRow {
    const blobId = this.liveRow(documentId).blob_id;
    const blob = blobId ? this.blobs.get(blobId) : undefined;
    if (!blob) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.missing);
    return blob;
  }
}

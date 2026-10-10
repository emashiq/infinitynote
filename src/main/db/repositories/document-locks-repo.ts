import type { Db } from '../driver';

/** One locked document: the copies of its data key (D-185). Its bytes are sealed blobs in document_blobs. */
export interface DocumentLockRow {
  document_id: string;
  kdf: string;
  salt: Buffer;
  password_key: Buffer;
  os_key: Buffer | null;
  created_at: number;
  updated_at: number;
}

const COLS = 'document_id, kdf, salt, password_key, os_key, created_at, updated_at';

export class DocumentLocksRepo {
  constructor(private readonly db: Db) {}

  get(documentId: string): DocumentLockRow | undefined {
    return this.db.prepare<[string], DocumentLockRow>(`SELECT ${COLS} FROM document_locks WHERE document_id = ?`).get(documentId);
  }

  insert(lock: { documentId: string; kdf: string; salt: Buffer; passwordKey: Buffer; osKey: Buffer | null; now: number }): void {
    this.db
      .prepare<[string, string, Buffer, Buffer, Buffer | null, number, number]>(`INSERT INTO document_locks(${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(lock.documentId, lock.kdf, lock.salt, lock.passwordKey, lock.osKey, lock.now, lock.now);
  }

  setPasswordKey(documentId: string, kdf: string, salt: Buffer, passwordKey: Buffer, now: number): void {
    this.db
      .prepare<[string, Buffer, Buffer, number, string]>('UPDATE document_locks SET kdf = ?, salt = ?, password_key = ?, updated_at = ? WHERE document_id = ?')
      .run(kdf, salt, passwordKey, now, documentId);
  }

  setOsKey(documentId: string, osKey: Buffer | null, now: number): void {
    this.db.prepare<[Buffer | null, number, string]>('UPDATE document_locks SET os_key = ?, updated_at = ? WHERE document_id = ?').run(osKey, now, documentId);
  }

  delete(documentId: string): void {
    this.db.prepare<[string]>('DELETE FROM document_locks WHERE document_id = ?').run(documentId);
  }
}

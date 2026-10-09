import type { Db } from '../driver';

/** One locked note: its sealed content and the copies of its data key (D-111). */
export interface LockRow {
  note_id: string;
  kdf: string;
  salt: Buffer;
  password_key: Buffer;
  os_key: Buffer | null;
  content: Buffer;
  created_at: number;
  updated_at: number;
}

export interface NewLock {
  noteId: string;
  kdf: string;
  salt: Buffer;
  passwordKey: Buffer;
  osKey: Buffer | null;
  content: Buffer;
  now: number;
}

const COLS = 'note_id, kdf, salt, password_key, os_key, content, created_at, updated_at';

export class LocksRepo {
  constructor(private readonly db: Db) {}

  get(noteId: string): LockRow | undefined {
    return this.db.prepare<[string], LockRow>(`SELECT ${COLS} FROM note_locks WHERE note_id = ?`).get(noteId);
  }

  insert(lock: NewLock): void {
    this.db
      .prepare<[string, string, Buffer, Buffer, Buffer | null, Buffer, number, number]>(`INSERT INTO note_locks(${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(lock.noteId, lock.kdf, lock.salt, lock.passwordKey, lock.osKey, lock.content, lock.now, lock.now);
  }

  setContent(noteId: string, content: Buffer, now: number): void {
    this.db.prepare<[Buffer, number, string]>('UPDATE note_locks SET content = ?, updated_at = ? WHERE note_id = ?').run(content, now, noteId);
  }

  setPasswordKey(noteId: string, kdf: string, salt: Buffer, passwordKey: Buffer, now: number): void {
    this.db
      .prepare<[string, Buffer, Buffer, number, string]>('UPDATE note_locks SET kdf = ?, salt = ?, password_key = ?, updated_at = ? WHERE note_id = ?')
      .run(kdf, salt, passwordKey, now, noteId);
  }

  setOsKey(noteId: string, osKey: Buffer | null, now: number): void {
    this.db.prepare<[Buffer | null, number, string]>('UPDATE note_locks SET os_key = ?, updated_at = ? WHERE note_id = ?').run(osKey, now, noteId);
  }

  delete(noteId: string): void {
    this.db.prepare<[string]>('DELETE FROM note_locks WHERE note_id = ?').run(noteId);
  }
}

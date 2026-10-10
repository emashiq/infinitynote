import type { Db } from '../driver';

/** The stored verifier of a locked note's sticky PIN (D-173); never anything that opens the note. */
export interface PinRow {
  note_id: string;
  kdf: string;
  salt: Buffer;
  verifier: Buffer;
}

export class PinsRepo {
  constructor(private readonly db: Db) {}

  get(noteId: string): PinRow | undefined {
    return this.db.prepare<[string], PinRow>('SELECT note_id, kdf, salt, verifier FROM note_pins WHERE note_id = ?').get(noteId);
  }

  has(noteId: string): boolean {
    return this.db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM note_pins WHERE note_id = ?').get(noteId)!.n > 0;
  }

  /** Stores or replaces the PIN of a locked note (the note_locks row must exist). */
  put(noteId: string, pin: { kdf: string; salt: Buffer; verifier: Buffer }, now: number): void {
    this.db
      .prepare<[string, string, Buffer, Buffer, number, number]>(
        `INSERT INTO note_pins(note_id, kdf, salt, verifier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(note_id) DO UPDATE SET kdf = excluded.kdf, salt = excluded.salt, verifier = excluded.verifier, updated_at = excluded.updated_at`,
      )
      .run(noteId, pin.kdf, pin.salt, pin.verifier, now, now);
  }

  delete(noteId: string): void {
    this.db.prepare<[string]>('DELETE FROM note_pins WHERE note_id = ?').run(noteId);
  }
}

import type { Db } from '../driver';

/** Tags and their notes (D-098). Tags no note uses any more are removed. */
export class TagsRepo {
  constructor(private readonly db: Db) {}

  forNote(noteId: string): string[] {
    return this.db
      .prepare<[string], { name: string }>('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name')
      .all(noteId)
      .map((r) => r.name);
  }

  /** Every tag with the number of live notes that carry it, by name. */
  withLiveCounts(): Array<{ name: string; count: number }> {
    return this.db
      .prepare<[], { name: string; count: number }>(
        `SELECT t.name, count(n.id) AS count
           FROM tags t JOIN note_tags nt ON nt.tag_id = t.id LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
          GROUP BY t.id HAVING count(n.id) > 0 ORDER BY t.name`,
      )
      .all();
  }

  replaceForNote(noteId: string, names: readonly string[]): void {
    this.db.prepare<[string]>('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
    const ensure = this.db.prepare<[string]>('INSERT OR IGNORE INTO tags(name) VALUES (?)');
    const link = this.db.prepare<[string, string]>('INSERT INTO note_tags(note_id, tag_id) SELECT ?, id FROM tags WHERE name = ?');
    for (const name of names) {
      ensure.run(name);
      link.run(noteId, name);
    }
    this.db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)');
  }
}

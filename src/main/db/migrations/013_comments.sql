-- Comments (v0.3.0, D-165): threads anchored to a note or a document, each with its comments, single user. A target is
-- not a foreign key (notes and documents are two tables); a thread goes when its item is purged. A note's thread is
-- anchored by the `comment` mark in its text; anchor_json keeps the block it was made in, or the app-side anchor of a
-- document (page and area, cell, slide, paragraph, text quote). The quote is the commented text, '' when there is none.
CREATE TABLE comment_threads (
  id           TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('note', 'document')),
  target_id    TEXT NOT NULL CHECK (length(target_id) = 36),
  anchor_json  TEXT NOT NULL CHECK (json_valid(anchor_json) AND length(anchor_json) <= 1000),
  quote        TEXT CHECK (quote IS NULL OR length(quote) <= 500),
  sealed_quote BLOB CHECK (sealed_quote IS NULL OR length(sealed_quote) > 0),
  resolved_at  INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  CHECK ((quote IS NULL) <> (sealed_quote IS NULL))
) STRICT;
CREATE INDEX comment_threads_target ON comment_threads(target_kind, target_id);

-- A comment's text is in body, or sealed with its note's data key in sealed_body while the note is locked (D-111).
CREATE TABLE comments (
  key         INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
  thread_id   TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  body        TEXT CHECK (body IS NULL OR length(body) BETWEEN 1 AND 10000),
  sealed_body BLOB CHECK (sealed_body IS NULL OR length(sealed_body) > 0),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK ((body IS NULL) <> (sealed_body IS NULL))
) STRICT;
CREATE INDEX comments_thread ON comments(thread_id, created_at);

-- Comment text is searchable (same tokenizer as notes_fts, D-029); sealed comments have no body and are not indexed.
CREATE VIRTUAL TABLE comments_fts USING fts5(
  body,
  content = 'comments', content_rowid = 'key',
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'"
);
CREATE TRIGGER comments_fts_ai AFTER INSERT ON comments WHEN NEW.body IS NOT NULL BEGIN
  INSERT INTO comments_fts(rowid, body) VALUES (NEW.key, NEW.body);
END;
CREATE TRIGGER comments_fts_ad AFTER DELETE ON comments WHEN OLD.body IS NOT NULL BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, body) VALUES ('delete', OLD.key, OLD.body);
END;
CREATE TRIGGER comments_fts_au AFTER UPDATE OF body ON comments BEGIN
  INSERT INTO comments_fts(comments_fts, rowid, body) SELECT 'delete', OLD.key, OLD.body WHERE OLD.body IS NOT NULL;
  INSERT INTO comments_fts(rowid, body) SELECT NEW.key, NEW.body WHERE NEW.body IS NOT NULL;
END;

-- Threads leave with their purged item (Trash keeps them while the item is only trashed).
CREATE TRIGGER notes_comments_purged AFTER DELETE ON notes BEGIN
  DELETE FROM comment_threads WHERE target_kind = 'note' AND target_id = OLD.id;
END;
CREATE TRIGGER documents_comments_purged AFTER DELETE ON documents BEGIN
  DELETE FROM comment_threads WHERE target_kind = 'document' AND target_id = OLD.id;
END;

-- No plaintext comment of a locked note reaches the database (D-111): its quotes and bodies are written sealed, and
-- locking a note fails if any of its comments is still in the clear.
CREATE TRIGGER comment_threads_locked_insert BEFORE INSERT ON comment_threads
  WHEN NEW.quote IS NOT NULL AND NEW.target_kind = 'note' AND (SELECT locked FROM notes WHERE id = NEW.target_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER comment_threads_locked_update BEFORE UPDATE OF quote ON comment_threads
  WHEN NEW.quote IS NOT NULL AND NEW.target_kind = 'note' AND (SELECT locked FROM notes WHERE id = NEW.target_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER comments_locked_insert BEFORE INSERT ON comments
  WHEN NEW.body IS NOT NULL
   AND (SELECT n.locked FROM comment_threads t JOIN notes n ON n.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'note') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER comments_locked_update BEFORE UPDATE OF body ON comments
  WHEN NEW.body IS NOT NULL
   AND (SELECT n.locked FROM comment_threads t JOIN notes n ON n.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'note') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER note_locks_comments_sealed AFTER INSERT ON note_locks
  WHEN EXISTS (
    SELECT 1 FROM comment_threads t
     WHERE t.target_kind = 'note' AND t.target_id = NEW.note_id
       AND (t.quote IS NOT NULL OR EXISTS (SELECT 1 FROM comments c WHERE c.thread_id = t.id AND c.body IS NOT NULL))
  )
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;

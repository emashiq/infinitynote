-- AI threads (v0.4.0, D-190): an AI action on a selected part is a comment thread of kind 'ai' with the same anchors
-- and quote. Its question, answers and follow-ups are its comments, each with a role, and an AI message keeps its
-- details in meta (engine, model, the names and sizes of the files sent, the cost reported, the session to resume). A
-- locked item's meta is sealed with its data key like the text (sealed_meta). Answers can be longer than comments, so
-- `comments` is rebuilt with a larger body limit (the app keeps comments at 10,000 characters); the triggers on it, and
-- those of the lock tables that read it, are created again with the meta checks.
ALTER TABLE comment_threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'ai'));

DROP TRIGGER note_locks_comments_sealed;
DROP TRIGGER document_locks_sealed;

CREATE TABLE comments_v16 (
  key         INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
  thread_id   TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'assistant', 'error')),
  body        TEXT CHECK (body IS NULL OR length(body) BETWEEN 1 AND 100000),
  sealed_body BLOB CHECK (sealed_body IS NULL OR length(sealed_body) > 0),
  meta        TEXT CHECK (meta IS NULL OR (json_valid(meta) AND length(meta) <= 12000)),
  sealed_meta BLOB CHECK (sealed_meta IS NULL OR length(sealed_meta) > 0),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK ((body IS NULL) <> (sealed_body IS NULL)),
  CHECK (meta IS NULL OR sealed_meta IS NULL)
) STRICT;
-- The keys stay, so the search index (comments_fts, keyed by them) still matches its rows.
INSERT INTO comments_v16 (key, id, thread_id, body, sealed_body, created_at, updated_at)
  SELECT key, id, thread_id, body, sealed_body, created_at, updated_at FROM comments;
DROP TABLE comments;
ALTER TABLE comments_v16 RENAME TO comments;
CREATE INDEX comments_thread ON comments(thread_id, created_at);

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

-- No plaintext text or meta of a locked note's or document's comments reaches the database (D-111, D-185).
CREATE TRIGGER comments_locked_insert BEFORE INSERT ON comments
  WHEN (NEW.body IS NOT NULL OR NEW.meta IS NOT NULL)
   AND (SELECT n.locked FROM comment_threads t JOIN notes n ON n.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'note') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER comments_locked_update BEFORE UPDATE OF body, meta ON comments
  WHEN (NEW.body IS NOT NULL OR NEW.meta IS NOT NULL)
   AND (SELECT n.locked FROM comment_threads t JOIN notes n ON n.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'note') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER document_comments_locked_insert BEFORE INSERT ON comments
  WHEN (NEW.body IS NOT NULL OR NEW.meta IS NOT NULL)
   AND (SELECT d.locked FROM comment_threads t JOIN documents d ON d.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'document') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked documents must be encrypted');
END;
CREATE TRIGGER document_comments_locked_update BEFORE UPDATE OF body, meta ON comments
  WHEN (NEW.body IS NOT NULL OR NEW.meta IS NOT NULL)
   AND (SELECT d.locked FROM comment_threads t JOIN documents d ON d.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'document') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked documents must be encrypted');
END;

-- Locking fails while any of the item's comments, AI messages included, is still in the clear.
CREATE TRIGGER note_locks_comments_sealed AFTER INSERT ON note_locks
  WHEN EXISTS (
    SELECT 1 FROM comment_threads t
     WHERE t.target_kind = 'note' AND t.target_id = NEW.note_id
       AND (t.quote IS NOT NULL OR EXISTS (SELECT 1 FROM comments c WHERE c.thread_id = t.id AND (c.body IS NOT NULL OR c.meta IS NOT NULL)))
  )
BEGIN
  SELECT RAISE(ABORT, 'comments of locked notes must be encrypted');
END;
CREATE TRIGGER document_locks_sealed AFTER INSERT ON document_locks
  WHEN EXISTS (SELECT 1 FROM document_versions v JOIN document_blobs b ON b.id = v.blob_id WHERE v.document_id = NEW.document_id AND b.sealed = 0)
    OR EXISTS (
      SELECT 1 FROM comment_threads t
       WHERE t.target_kind = 'document' AND t.target_id = NEW.document_id
         AND (t.quote IS NOT NULL OR json_extract(t.anchor_json, '$.type') IS NOT 'sealed'
              OR EXISTS (SELECT 1 FROM comments c WHERE c.thread_id = t.id AND (c.body IS NOT NULL OR c.meta IS NOT NULL)))
    )
BEGIN
  SELECT RAISE(ABORT, 'locked document content must be encrypted');
END;

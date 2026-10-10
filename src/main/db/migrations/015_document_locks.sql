-- Locked documents (v0.3.1, D-185): the lock of notes (D-111) on a document's stored bytes. The data key encrypts the
-- document's blobs (current and versions) with AES-256-GCM; it is stored wrapped by a key derived from the password
-- (scrypt, parameters in kdf) and, with Windows Hello, protected by the OS (os_key). The password copy is required.
CREATE TABLE document_locks (
  document_id  TEXT PRIMARY KEY NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kdf          TEXT NOT NULL CHECK (json_valid(kdf)),
  salt         BLOB NOT NULL CHECK (length(salt) = 16),
  password_key BLOB NOT NULL CHECK (length(password_key) > 0),
  os_key       BLOB CHECK (os_key IS NULL OR length(os_key) > 0),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

-- A sealed blob holds ciphertext (its sha256 is that of the ciphertext, so it is never shared with another document).
ALTER TABLE document_blobs ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1));

-- Derived from document_locks, so every document query can tell a locked document without a join.
ALTER TABLE documents ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));
CREATE TRIGGER document_locks_ai AFTER INSERT ON document_locks BEGIN
  UPDATE documents SET locked = 1 WHERE id = NEW.document_id;
END;
CREATE TRIGGER document_locks_ad AFTER DELETE ON document_locks BEGIN
  UPDATE documents SET locked = 0 WHERE id = OLD.document_id;
END;

-- Plaintext never reaches the database or the document store for a locked document: it is managed, its bytes are a
-- sealed blob, its search text is empty (the search index keeps only its title), every version is sealed, and its
-- comments are sealed. Locking fails when any of that is not done first.
CREATE TRIGGER documents_locked_plaintext BEFORE UPDATE ON documents
  WHEN NEW.locked = 1
   AND (NEW.storage <> 'managed' OR NEW.body_text <> '' OR (SELECT sealed FROM document_blobs WHERE id = NEW.blob_id) IS NOT 1)
BEGIN
  SELECT RAISE(ABORT, 'locked document content must be encrypted');
END;
CREATE TRIGGER document_versions_locked BEFORE INSERT ON document_versions
  WHEN (SELECT locked FROM documents WHERE id = NEW.document_id) = 1
   AND (SELECT sealed FROM document_blobs WHERE id = NEW.blob_id) IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'versions of locked documents must be encrypted');
END;
CREATE TRIGGER document_locks_sealed AFTER INSERT ON document_locks
  WHEN EXISTS (SELECT 1 FROM document_versions v JOIN document_blobs b ON b.id = v.blob_id WHERE v.document_id = NEW.document_id AND b.sealed = 0)
    OR EXISTS (
      SELECT 1 FROM comment_threads t
       WHERE t.target_kind = 'document' AND t.target_id = NEW.document_id
         AND (t.quote IS NOT NULL OR json_extract(t.anchor_json, '$.type') IS NOT 'sealed'
              OR EXISTS (SELECT 1 FROM comments c WHERE c.thread_id = t.id AND c.body IS NOT NULL))
    )
BEGIN
  SELECT RAISE(ABORT, 'locked document content must be encrypted');
END;
-- Its threads' anchors are sealed too (a cell anchor names a sheet), stored as {"type": "sealed", "data": ...}.
CREATE TRIGGER document_comment_threads_locked_insert BEFORE INSERT ON comment_threads
  WHEN (NEW.quote IS NOT NULL OR json_extract(NEW.anchor_json, '$.type') IS NOT 'sealed')
   AND NEW.target_kind = 'document' AND (SELECT locked FROM documents WHERE id = NEW.target_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked documents must be encrypted');
END;
CREATE TRIGGER document_comment_threads_locked_update BEFORE UPDATE OF quote, anchor_json ON comment_threads
  WHEN (NEW.quote IS NOT NULL OR json_extract(NEW.anchor_json, '$.type') IS NOT 'sealed')
   AND NEW.target_kind = 'document' AND (SELECT locked FROM documents WHERE id = NEW.target_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked documents must be encrypted');
END;
CREATE TRIGGER document_comments_locked_insert BEFORE INSERT ON comments
  WHEN NEW.body IS NOT NULL
   AND (SELECT d.locked FROM comment_threads t JOIN documents d ON d.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'document') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked documents must be encrypted');
END;
CREATE TRIGGER document_comments_locked_update BEFORE UPDATE OF body ON comments
  WHEN NEW.body IS NOT NULL
   AND (SELECT d.locked FROM comment_threads t JOIN documents d ON d.id = t.target_id WHERE t.id = NEW.thread_id AND t.target_kind = 'document') = 1
BEGIN
  SELECT RAISE(ABORT, 'comments of locked documents must be encrypted');
END;

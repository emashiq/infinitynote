-- Documents (v0.3.0, D-118): PDF, Word, PowerPoint, Excel, CSV and HTML files kept in the tree next to notes. A managed
-- document's bytes are a content-addressed blob under data/documents/; a linked document names a linked_files row and its
-- bytes stay in the original file. A save keeps the bytes it replaced as a version (blobs are shared by hash).
CREATE TABLE document_blobs (
  id                 TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  sha256             TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  relative_path      TEXT NOT NULL UNIQUE
    CHECK (relative_path GLOB 'documents/[0-9a-f][0-9a-f]/*'
           AND instr(relative_path, '..') = 0
           AND instr(relative_path, '\') = 0),
  size_bytes         INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at         INTEGER NOT NULL,
  unreferenced_since INTEGER
) STRICT;

CREATE TABLE documents (
  doc_key              INTEGER PRIMARY KEY AUTOINCREMENT,
  id                   TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
  project_id           TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  folder_id            TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind                 TEXT NOT NULL CHECK (kind IN ('pdf', 'docx', 'pptx', 'xlsx', 'csv', 'html')),
  storage              TEXT NOT NULL CHECK (storage IN ('managed', 'linked')),
  blob_id              TEXT REFERENCES document_blobs(id) ON DELETE RESTRICT,
  linked_file_id       TEXT REFERENCES linked_files(id) ON DELETE RESTRICT,
  -- The note attachment an "Open in Infinity Notes" copied, so opening it again finds this document.
  source_attachment_id TEXT CHECK (source_attachment_id IS NULL OR length(source_attachment_id) = 36),
  revision             INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  size_bytes           INTEGER NOT NULL CHECK (size_bytes >= 0),
  -- Linked documents: the original's modification time when the text below was taken from it.
  source_modified_at   INTEGER,
  -- Text extracted for search (title and body are indexed by documents_fts).
  body_text            TEXT NOT NULL DEFAULT '',
  favorite             INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER,
  trash_batch_id       TEXT,
  CHECK ((storage = 'managed' AND blob_id IS NOT NULL AND linked_file_id IS NULL)
      OR (storage = 'linked' AND linked_file_id IS NOT NULL AND blob_id IS NULL))
) STRICT;
CREATE INDEX documents_scope   ON documents(project_id, folder_id) WHERE deleted_at IS NULL;
CREATE INDEX documents_updated ON documents(updated_at) WHERE deleted_at IS NULL;
CREATE INDEX documents_trash   ON documents(trash_batch_id) WHERE trash_batch_id IS NOT NULL;
CREATE INDEX documents_blob    ON documents(blob_id) WHERE blob_id IS NOT NULL;
CREATE INDEX documents_link    ON documents(linked_file_id) WHERE linked_file_id IS NOT NULL;
CREATE INDEX documents_source  ON documents(source_attachment_id) WHERE source_attachment_id IS NOT NULL;

CREATE TABLE document_versions (
  id          TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision    INTEGER NOT NULL CHECK (revision >= 0),
  blob_id     TEXT NOT NULL REFERENCES document_blobs(id) ON DELETE RESTRICT,
  reason      TEXT NOT NULL CHECK (reason IN ('save', 'restore')),
  created_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX document_versions_document ON document_versions(document_id, created_at);
CREATE INDEX document_versions_blob     ON document_versions(blob_id);

-- Same tokenizer and trigger pattern as notes_fts (D-029, D-036): only rows with deleted_at IS NULL are indexed.
CREATE VIRTUAL TABLE documents_fts USING fts5(
  title, body_text,
  content = 'documents', content_rowid = 'doc_key',
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'"
);
CREATE TRIGGER documents_fts_ai AFTER INSERT ON documents WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO documents_fts(rowid, title, body_text) VALUES (NEW.doc_key, NEW.title, NEW.body_text);
END;
CREATE TRIGGER documents_fts_ad AFTER DELETE ON documents WHEN OLD.deleted_at IS NULL BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, body_text) VALUES ('delete', OLD.doc_key, OLD.title, OLD.body_text);
END;
CREATE TRIGGER documents_fts_au AFTER UPDATE OF title, body_text, deleted_at ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, body_text)
    SELECT 'delete', OLD.doc_key, OLD.title, OLD.body_text WHERE OLD.deleted_at IS NULL;
  INSERT INTO documents_fts(rowid, title, body_text)
    SELECT NEW.doc_key, NEW.title, NEW.body_text WHERE NEW.deleted_at IS NULL;
END;

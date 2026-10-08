CREATE TABLE settings (
  key        TEXT PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 100),
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE projects (
  id             TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  trash_batch_id TEXT
) STRICT;

CREATE TABLE folders (
  id             TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  project_id     TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  parent_id      TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  trash_batch_id TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;
CREATE INDEX folders_parent  ON folders(parent_id);
CREATE INDEX folders_project ON folders(project_id);

CREATE TABLE notes (
  doc_key        INTEGER PRIMARY KEY AUTOINCREMENT,
  id             TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
  project_id     TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  folder_id      TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  title          TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  format         TEXT NOT NULL CHECK (format IN ('rich', 'plain')),
  content_json   TEXT CHECK (content_json IS NULL OR json_valid(content_json)),
  content_text   TEXT,
  plain_text     TEXT NOT NULL DEFAULT '',
  revision       INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  sticky_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sticky_enabled IN (0, 1)),
  color          TEXT,
  pinned_at      INTEGER,
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  trash_batch_id TEXT,
  CHECK ((format = 'rich' AND content_text IS NULL) OR (format = 'plain' AND content_json IS NULL))
) STRICT;
CREATE INDEX notes_scope   ON notes(project_id, folder_id) WHERE deleted_at IS NULL;
CREATE INDEX notes_updated ON notes(updated_at) WHERE deleted_at IS NULL;
CREATE INDEX notes_pinned  ON notes(pinned_at) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX notes_sticky  ON notes(sticky_enabled) WHERE sticky_enabled = 1 AND deleted_at IS NULL;
CREATE INDEX notes_trash   ON notes(trash_batch_id) WHERE trash_batch_id IS NOT NULL;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, plain_text,
  content = 'notes', content_rowid = 'doc_key',
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'"
);
CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO notes_fts(rowid, title, plain_text) VALUES (NEW.doc_key, NEW.title, NEW.plain_text);
END;
CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes WHEN OLD.deleted_at IS NULL BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text) VALUES ('delete', OLD.doc_key, OLD.title, OLD.plain_text);
END;
-- One trigger so the delete of the old index entry always runs before the insert of the new one
-- (relative firing order of separate triggers is not something to rely on; a duplicate rowid corrupts FTS5).
CREATE TRIGGER notes_fts_au AFTER UPDATE OF title, plain_text, deleted_at ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
    SELECT 'delete', OLD.doc_key, OLD.title, OLD.plain_text WHERE OLD.deleted_at IS NULL;
  INSERT INTO notes_fts(rowid, title, plain_text)
    SELECT NEW.doc_key, NEW.title, NEW.plain_text WHERE NEW.deleted_at IS NULL;
END;

CREATE TABLE note_versions (
  id               TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  note_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  revision         INTEGER NOT NULL CHECK (revision >= 0),
  format           TEXT NOT NULL CHECK (format IN ('rich', 'plain')),
  content_snapshot TEXT NOT NULL,
  attachment_ids   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachment_ids)),
  reason           TEXT NOT NULL CHECK (reason IN ('auto', 'conversion', 'conflict', 'restore', 'import')),
  created_at       INTEGER NOT NULL
) STRICT;
CREATE INDEX note_versions_note ON note_versions(note_id, created_at);

CREATE TABLE note_drafts (
  id            TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  view_id       TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  format        TEXT NOT NULL CHECK (format IN ('rich', 'plain')),
  title         TEXT,
  content       TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('conflict', 'lease_lost')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
) STRICT;
CREATE INDEX note_drafts_open ON note_drafts(note_id) WHERE resolved_at IS NULL;

CREATE TABLE attachments (
  id                    TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  managed_relative_path TEXT NOT NULL UNIQUE
    CHECK (managed_relative_path GLOB 'attachments/[0-9a-f][0-9a-f]/*'
           AND instr(managed_relative_path, '..') = 0
           AND instr(managed_relative_path, '\') = 0),
  sha256                TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  mime                  TEXT NOT NULL,
  size_bytes            INTEGER NOT NULL CHECK (size_bytes >= 0),
  original_name         TEXT,
  kind                  TEXT NOT NULL CHECK (kind IN ('image', 'document')),
  created_at            INTEGER NOT NULL,
  unreferenced_since    INTEGER
) STRICT;

CREATE TABLE note_attachments (
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  block_id      TEXT
) STRICT;
CREATE UNIQUE INDEX note_attachments_unique ON note_attachments(note_id, attachment_id, ifnull(block_id, ''));
CREATE INDEX note_attachments_attachment ON note_attachments(attachment_id);

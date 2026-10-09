-- Locked notes (v0.2.0, D-111). A locked note's content lives only here, encrypted: AES-256-GCM with the note's data
-- key, which is stored wrapped by a key derived from the password (scrypt, parameters in kdf) and, when Windows Hello is
-- set up, protected by the OS (os_key). The password copy is required, so a note is never Hello-only.
CREATE TABLE note_locks (
  note_id      TEXT PRIMARY KEY NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kdf          TEXT NOT NULL CHECK (json_valid(kdf)),
  salt         BLOB NOT NULL CHECK (length(salt) = 16),
  password_key BLOB NOT NULL CHECK (length(password_key) > 0),
  os_key       BLOB CHECK (os_key IS NULL OR length(os_key) > 0),
  content      BLOB NOT NULL CHECK (length(content) > 0),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

-- Derived from note_locks, so every note query can tell a locked note without a join.
ALTER TABLE notes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));
CREATE TRIGGER note_locks_ai AFTER INSERT ON note_locks BEGIN
  UPDATE notes SET locked = 1 WHERE id = NEW.note_id;
END;
CREATE TRIGGER note_locks_ad AFTER DELETE ON note_locks BEGIN
  UPDATE notes SET locked = 0 WHERE id = OLD.note_id;
END;

-- Plaintext never reaches the database for a locked note: its row keeps no content or plain text (so the search index
-- holds only its title), no version or reminder source or suggestion dismissal is stored for it, and its drafts are sealed.
CREATE TRIGGER notes_locked_plaintext BEFORE UPDATE ON notes
  WHEN NEW.locked = 1 AND (NEW.content_json IS NOT NULL OR NEW.content_text IS NOT NULL OR NEW.plain_text <> '')
BEGIN
  SELECT RAISE(ABORT, 'locked note content must be encrypted');
END;
CREATE TRIGGER note_versions_locked BEFORE INSERT ON note_versions
  WHEN (SELECT locked FROM notes WHERE id = NEW.note_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'locked notes keep no versions');
END;
CREATE TRIGGER note_drafts_locked BEFORE INSERT ON note_drafts
  WHEN (SELECT locked FROM notes WHERE id = NEW.note_id) = 1 AND (substr(NEW.content, 1, 7) <> 'sealed:' OR NEW.title IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'drafts of locked notes must be sealed');
END;
CREATE TRIGGER reminder_sources_locked BEFORE INSERT ON reminder_sources
  WHEN (SELECT locked FROM notes WHERE id = NEW.note_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'locked notes keep no reminder sources');
END;
CREATE TRIGGER suggestion_dismissals_locked BEFORE INSERT ON suggestion_dismissals
  WHEN (SELECT locked FROM notes WHERE id = NEW.note_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'locked notes keep no suggestion dismissals');
END;

-- Sticky PINs of locked notes (v0.3.0, D-173). A PIN only re-reveals a locked sticky while the note's data key is
-- already in main's memory: it never wraps or derives the data key. Only its scrypt verifier is stored (salt and
-- parameters per row), so the files reveal neither the PIN nor anything it could open. A PIN belongs to a lock and goes
-- with it when the lock is removed or the note is purged.
CREATE TABLE note_pins (
  note_id    TEXT PRIMARY KEY NOT NULL REFERENCES note_locks(note_id) ON DELETE CASCADE,
  kdf        TEXT NOT NULL CHECK (json_valid(kdf)),
  salt       BLOB NOT NULL CHECK (length(salt) = 16),
  verifier   BLOB NOT NULL CHECK (length(verifier) = 32),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- Reminder sources and suggestion dismissals (Phase 06, D-088). Offsets are JavaScript string (UTF-16) indices.
CREATE TABLE reminder_sources (
  reminder_id            TEXT PRIMARY KEY NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  note_id                TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id               TEXT,                                   -- NULL for plain-text notes (note-level)
  source_text            TEXT NOT NULL CHECK (length(source_text) BETWEEN 1 AND 500),
  span_start             INTEGER CHECK (span_start IS NULL OR span_start >= 0),
  span_end               INTEGER,
  span_ordinal           INTEGER NOT NULL CHECK (span_ordinal >= 0),
  reference_instant_utc  INTEGER NOT NULL,
  reference_zone         TEXT NOT NULL CHECK (length(reference_zone) BETWEEN 1 AND 64),
  parser_version         INTEGER NOT NULL CHECK (parser_version >= 1),
  origin                 TEXT NOT NULL CHECK (origin IN ('suggestion', 'selection')),
  source_state           TEXT NOT NULL DEFAULT 'ok' CHECK (source_state IN ('ok', 'changed', 'missing', 'detached')),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK ((block_id IS NULL) = (span_start IS NULL)),
  CHECK ((span_start IS NULL) = (span_end IS NULL)),
  CHECK (span_end IS NULL OR span_end > span_start)
) STRICT;
CREATE INDEX reminder_sources_note ON reminder_sources(note_id);

CREATE TABLE suggestion_dismissals (
  dedupe_key      TEXT PRIMARY KEY NOT NULL CHECK (length(dedupe_key) = 64),
  note_id         TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id        TEXT,
  span_text       TEXT NOT NULL CHECK (length(span_text) BETWEEN 1 AND 500),
  span_ordinal    INTEGER NOT NULL CHECK (span_ordinal >= 0),
  reference_date  TEXT NOT NULL CHECK (reference_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at      INTEGER NOT NULL
) STRICT;
CREATE INDEX suggestion_dismissals_note ON suggestion_dismissals(note_id, created_at);
CREATE INDEX suggestion_dismissals_date ON suggestion_dismissals(reference_date);

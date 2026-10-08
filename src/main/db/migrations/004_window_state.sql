-- Presentation state of floating sticky windows (Phase 04, D-062); keys 'main' and 'widget' are reserved for later phases.
CREATE TABLE window_state (
  key           TEXT PRIMARY KEY NOT NULL,
  note_id       TEXT REFERENCES notes(id) ON DELETE CASCADE,
  bounds        TEXT CHECK (bounds IS NULL OR json_valid(bounds)),
  display_id    INTEGER,
  open          INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1)),
  collapsed     INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  always_on_top INTEGER NOT NULL DEFAULT 0 CHECK (always_on_top IN (0, 1)),
  updated_at    INTEGER NOT NULL,
  CHECK ((note_id IS NOT NULL AND key = 'sticky:' || note_id) OR (note_id IS NULL AND key IN ('main', 'widget')))
) STRICT;
CREATE UNIQUE INDEX window_state_note ON window_state(note_id);

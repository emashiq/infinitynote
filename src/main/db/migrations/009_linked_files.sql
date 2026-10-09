-- Files linked at their original location (v0.2.0, D-108): nothing is copied. The path lives only here, never in a
-- document; notes name a link by its ID (fileLink nodes) and note_linked_files records which notes use which link.
CREATE TABLE linked_files (
  id                 TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  path               TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 4096 AND instr(path, char(0)) = 0),
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  size_bytes         INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at         INTEGER NOT NULL,
  unreferenced_since INTEGER
) STRICT;

CREATE TABLE note_linked_files (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL REFERENCES linked_files(id) ON DELETE RESTRICT,
  PRIMARY KEY (note_id, link_id)
) STRICT;
CREATE INDEX note_linked_files_link ON note_linked_files(link_id);

-- Note references and tags (Phase 07, D-098). References are ID-based; a target is not a foreign key because a
-- reference must survive the target's purge and show "no longer exists" with the title it had.
CREATE TABLE note_references (
  id                    INTEGER PRIMARY KEY,
  source_note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  source_block_id       TEXT CHECK (source_block_id IS NULL OR length(source_block_id) = 36),
  target_note_id        TEXT NOT NULL CHECK (length(target_note_id) = 36),
  target_block_id       TEXT CHECK (target_block_id IS NULL OR length(target_block_id) = 36),
  target_title_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(target_title_snapshot) <= 200)
) STRICT;
CREATE UNIQUE INDEX note_references_unique
  ON note_references(source_note_id, ifnull(source_block_id, ''), target_note_id, ifnull(target_block_id, ''));
CREATE INDEX note_references_target ON note_references(target_note_id);

-- A purged target keeps its last title in every reference to it.
CREATE TRIGGER note_references_target_purged BEFORE DELETE ON notes BEGIN
  UPDATE note_references SET target_title_snapshot = OLD.title WHERE target_note_id = OLD.id;
END;

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 32)
) STRICT;

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX note_tags_tag ON note_tags(tag_id);

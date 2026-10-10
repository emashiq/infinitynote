-- Links from notes to documents (v0.3.0, D-156), kept beside note_references in the same way (D-098): written per
-- source note inside each content write, ID-based, and not a foreign key to the target, so a link survives the
-- document's purge and shows "no longer exists" with the title it had. `target_json` is the place inside the document
-- (a page, a sheet and cell, a heading or paragraph, a slide; '' for the whole document).
CREATE TABLE document_references (
  id                    INTEGER PRIMARY KEY,
  source_note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  source_block_id       TEXT CHECK (source_block_id IS NULL OR length(source_block_id) = 36),
  target_document_id    TEXT NOT NULL CHECK (length(target_document_id) = 36),
  target_json           TEXT NOT NULL DEFAULT '' CHECK (length(target_json) <= 1000),
  target_title_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(target_title_snapshot) <= 200)
) STRICT;
CREATE UNIQUE INDEX document_references_unique
  ON document_references(source_note_id, ifnull(source_block_id, ''), target_document_id, target_json);
CREATE INDEX document_references_target ON document_references(target_document_id);

-- A purged document keeps its last title in every link to it.
CREATE TRIGGER document_references_target_purged BEFORE DELETE ON documents BEGIN
  UPDATE document_references SET target_title_snapshot = OLD.title WHERE target_document_id = OLD.id;
END;

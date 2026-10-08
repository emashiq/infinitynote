-- Trash batches whose root was re-anchored by a purge of its original parent (D-046). Restore reports them as relocated.
CREATE TABLE trash_reanchored (
  batch_id TEXT PRIMARY KEY
) WITHOUT ROWID;

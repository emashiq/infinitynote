CREATE INDEX notes_folder_all   ON notes(folder_id);
CREATE INDEX notes_project_all  ON notes(project_id);
CREATE INDEX notes_deleted      ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX folders_deleted    ON folders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX folders_trash      ON folders(trash_batch_id) WHERE trash_batch_id IS NOT NULL;
CREATE INDEX projects_trash     ON projects(trash_batch_id) WHERE trash_batch_id IS NOT NULL;

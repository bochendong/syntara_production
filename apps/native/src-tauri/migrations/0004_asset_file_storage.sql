ALTER TABLE assets ADD COLUMN storage_path TEXT;

CREATE INDEX IF NOT EXISTS assets_storage_path_idx
  ON assets(storage_path);

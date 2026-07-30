PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  source TEXT,
  data_base64 TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_sha256_idx
  ON assets(sha256);

CREATE TABLE IF NOT EXISTS page_assets (
  id TEXT PRIMARY KEY NOT NULL,
  page_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'image',
  sort_order INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(page_id) REFERENCES notebook_pages(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS page_assets_page_asset_role_idx
  ON page_assets(page_id, asset_id, role);

CREATE INDEX IF NOT EXISTS page_assets_page_order_idx
  ON page_assets(page_id, sort_order);

CREATE TABLE IF NOT EXISTS notebook_assets (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS notebook_assets_notebook_asset_idx
  ON notebook_assets(notebook_id, asset_id);

CREATE INDEX IF NOT EXISTS notebook_assets_notebook_idx
  ON notebook_assets(notebook_id);

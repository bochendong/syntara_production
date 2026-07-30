PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS course_events (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'other',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS course_events_course_date_idx
  ON course_events(course_id, event_date ASC);

CREATE INDEX IF NOT EXISTS course_events_course_status_date_idx
  ON course_events(course_id, status, event_date ASC);

CREATE TABLE IF NOT EXISTS lecture_decks (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'generated',
  package_name TEXT,
  package_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready',
  generator_meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lecture_decks_status_updated_idx
  ON lecture_decks(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS lecture_decks_package_idx
  ON lecture_decks(package_name, package_version);

CREATE TABLE IF NOT EXISTS lecture_pages (
  id TEXT PRIMARY KEY NOT NULL,
  deck_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  image_asset_id TEXT NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  recovery_status TEXT NOT NULL DEFAULT 'pending',
  regions_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(deck_id) REFERENCES lecture_decks(id) ON DELETE CASCADE,
  FOREIGN KEY(image_asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS lecture_pages_deck_order_idx
  ON lecture_pages(deck_id, sort_order);

CREATE INDEX IF NOT EXISTS lecture_pages_image_asset_idx
  ON lecture_pages(image_asset_id);

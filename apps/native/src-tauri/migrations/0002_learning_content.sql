PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notebook_pages (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  course_id TEXT,
  source_scene_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'slide',
  sort_order INTEGER NOT NULL DEFAULT 0,
  content_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL DEFAULT '[]',
  whiteboard_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS notebook_pages_notebook_order_idx
  ON notebook_pages(notebook_id, sort_order);

CREATE INDEX IF NOT EXISTS notebook_pages_course_order_idx
  ON notebook_pages(course_id, sort_order);

CREATE TABLE IF NOT EXISTS markdown_sections (
  id TEXT PRIMARY KEY NOT NULL,
  notebook_id TEXT NOT NULL,
  course_id TEXT,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  markdown TEXT NOT NULL DEFAULT '',
  summary TEXT,
  source_meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS markdown_sections_notebook_order_idx
  ON markdown_sections(notebook_id, sort_order);

CREATE INDEX IF NOT EXISTS markdown_sections_course_order_idx
  ON markdown_sections(course_id, sort_order);

CREATE TABLE IF NOT EXISTS problem_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  answer_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  score REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS problem_attempts_problem_created_idx
  ON problem_attempts(problem_id, created_at DESC);

CREATE TABLE IF NOT EXISTS problem_progress (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL UNIQUE,
  latest_attempt_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  score REAL,
  attempted_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE,
  FOREIGN KEY(latest_attempt_id) REFERENCES problem_attempts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS problem_progress_status_idx
  ON problem_progress(status, last_attempt_at DESC);

CREATE TABLE IF NOT EXISTS study_memories (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT,
  notebook_id TEXT,
  target_type TEXT NOT NULL DEFAULT 'course',
  scope TEXT NOT NULL DEFAULT 'private',
  kind TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'migration',
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  reason TEXT,
  question TEXT,
  source_references_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS study_memories_course_updated_idx
  ON study_memories(course_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS study_memories_notebook_updated_idx
  ON study_memories(notebook_id, updated_at DESC);

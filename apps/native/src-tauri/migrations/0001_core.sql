PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'zh-CN',
  tags_json TEXT NOT NULL DEFAULT '[]',
  purpose TEXT NOT NULL DEFAULT 'daily',
  university TEXT,
  course_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS courses_updated_idx
  ON courses(updated_at DESC);

CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'image',
  tags_json TEXT NOT NULL DEFAULT '[]',
  section_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notebooks_course_updated_idx
  ON notebooks(course_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  notebook_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  difficulty TEXT NOT NULL DEFAULT 'medium',
  tags_json TEXT NOT NULL DEFAULT '[]',
  public_content_json TEXT NOT NULL DEFAULT '{}',
  grading_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS problems_course_updated_idx
  ON problems(course_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS problems_notebook_updated_idx
  ON problems(notebook_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  notebook_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS conversations_course_updated_idx
  ON conversations(course_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages(conversation_id, created_at ASC);

ALTER TABLE problems ADD COLUMN chapter_id TEXT;
ALTER TABLE problems ADD COLUMN chapter_name TEXT;

CREATE INDEX IF NOT EXISTS problems_course_chapter_updated_idx
  ON problems(course_id, chapter_id, updated_at DESC);

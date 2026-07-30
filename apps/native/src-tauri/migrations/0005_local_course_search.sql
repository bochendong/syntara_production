PRAGMA foreign_keys = ON;

CREATE VIRTUAL TABLE IF NOT EXISTS local_course_search USING fts5(
  source_id UNINDEXED,
  resource_id UNINDEXED,
  course_id UNINDEXED,
  source_type UNINDEXED,
  title,
  body,
  updated_at UNINDEXED,
  tokenize = 'trigram'
);

INSERT INTO local_course_search
  (source_id, resource_id, course_id, source_type, title, body, updated_at)
SELECT
  id,
  NULL,
  course_id,
  'memory',
  title,
  trim(text || char(10) || coalesce(reason, '') || char(10) || coalesce(question, '')),
  updated_at
FROM study_memories
WHERE course_id IS NOT NULL AND status = 'active';

INSERT INTO local_course_search
  (source_id, resource_id, course_id, source_type, title, body, updated_at)
SELECT
  markdown_sections.id,
  markdown_sections.notebook_id,
  coalesce(markdown_sections.course_id, notebooks.course_id),
  'notebook',
  notebooks.name || ' / ' || markdown_sections.title,
  trim(coalesce(markdown_sections.summary, '') || char(10) || markdown_sections.markdown),
  markdown_sections.updated_at
FROM markdown_sections
INNER JOIN notebooks ON notebooks.id = markdown_sections.notebook_id;

INSERT INTO local_course_search
  (source_id, resource_id, course_id, source_type, title, body, updated_at)
SELECT
  notebook_pages.id,
  notebook_pages.notebook_id,
  coalesce(notebook_pages.course_id, notebooks.course_id),
  'notebook',
  notebooks.name || ' / ' || notebook_pages.title,
  notebook_pages.content_json,
  notebook_pages.updated_at
FROM notebook_pages
INNER JOIN notebooks ON notebooks.id = notebook_pages.notebook_id;

INSERT INTO local_course_search
  (source_id, resource_id, course_id, source_type, title, body, updated_at)
SELECT
  id,
  id,
  course_id,
  'problem',
  title,
  trim(tags_json || char(10) || public_content_json),
  updated_at
FROM problems
WHERE status != 'archived';

CREATE TRIGGER IF NOT EXISTS study_memories_search_insert
AFTER INSERT ON study_memories
WHEN new.course_id IS NOT NULL AND new.status = 'active'
BEGIN
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  VALUES (
    new.id,
    NULL,
    new.course_id,
    'memory',
    new.title,
    trim(new.text || char(10) || coalesce(new.reason, '') || char(10) || coalesce(new.question, '')),
    new.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS study_memories_search_update
AFTER UPDATE ON study_memories
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'memory';
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  SELECT
    new.id,
    NULL,
    new.course_id,
    'memory',
    new.title,
    trim(new.text || char(10) || coalesce(new.reason, '') || char(10) || coalesce(new.question, '')),
    new.updated_at
  WHERE new.course_id IS NOT NULL AND new.status = 'active';
END;

CREATE TRIGGER IF NOT EXISTS study_memories_search_delete
AFTER DELETE ON study_memories
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'memory';
END;

CREATE TRIGGER IF NOT EXISTS markdown_sections_search_insert
AFTER INSERT ON markdown_sections
BEGIN
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  SELECT
    new.id,
    new.notebook_id,
    coalesce(new.course_id, notebooks.course_id),
    'notebook',
    notebooks.name || ' / ' || new.title,
    trim(coalesce(new.summary, '') || char(10) || new.markdown),
    new.updated_at
  FROM notebooks
  WHERE notebooks.id = new.notebook_id;
END;

CREATE TRIGGER IF NOT EXISTS markdown_sections_search_update
AFTER UPDATE ON markdown_sections
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'notebook';
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  SELECT
    new.id,
    new.notebook_id,
    coalesce(new.course_id, notebooks.course_id),
    'notebook',
    notebooks.name || ' / ' || new.title,
    trim(coalesce(new.summary, '') || char(10) || new.markdown),
    new.updated_at
  FROM notebooks
  WHERE notebooks.id = new.notebook_id;
END;

CREATE TRIGGER IF NOT EXISTS markdown_sections_search_delete
AFTER DELETE ON markdown_sections
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'notebook';
END;

CREATE TRIGGER IF NOT EXISTS notebook_pages_search_insert
AFTER INSERT ON notebook_pages
BEGIN
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  SELECT
    new.id,
    new.notebook_id,
    coalesce(new.course_id, notebooks.course_id),
    'notebook',
    notebooks.name || ' / ' || new.title,
    new.content_json,
    new.updated_at
  FROM notebooks
  WHERE notebooks.id = new.notebook_id;
END;

CREATE TRIGGER IF NOT EXISTS notebook_pages_search_update
AFTER UPDATE ON notebook_pages
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'notebook';
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  SELECT
    new.id,
    new.notebook_id,
    coalesce(new.course_id, notebooks.course_id),
    'notebook',
    notebooks.name || ' / ' || new.title,
    new.content_json,
    new.updated_at
  FROM notebooks
  WHERE notebooks.id = new.notebook_id;
END;

CREATE TRIGGER IF NOT EXISTS notebook_pages_search_delete
AFTER DELETE ON notebook_pages
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'notebook';
END;

CREATE TRIGGER IF NOT EXISTS problems_search_insert
AFTER INSERT ON problems
WHEN new.status != 'archived'
BEGIN
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  VALUES (
    new.id,
    new.id,
    new.course_id,
    'problem',
    new.title,
    trim(new.tags_json || char(10) || new.public_content_json),
    new.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS problems_search_update
AFTER UPDATE ON problems
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'problem';
  INSERT INTO local_course_search
    (source_id, resource_id, course_id, source_type, title, body, updated_at)
  SELECT
    new.id,
    new.id,
    new.course_id,
    'problem',
    new.title,
    trim(new.tags_json || char(10) || new.public_content_json),
    new.updated_at
  WHERE new.status != 'archived';
END;

CREATE TRIGGER IF NOT EXISTS problems_search_delete
AFTER DELETE ON problems
BEGIN
  DELETE FROM local_course_search
  WHERE source_id = old.id AND source_type = 'problem';
END;

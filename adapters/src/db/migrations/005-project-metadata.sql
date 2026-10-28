-- Restore original-client column names for actual product data. JSONB replaces
-- SQLite's JSON text; unrelated compatibility keys stay intact.
-- Fail instead of silently discarding unexpected historical values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM projects
    WHERE legacy ? 'metadata'
      AND jsonb_typeof(legacy->'metadata') NOT IN ('object', 'null')
  ) THEN
    RAISE EXCEPTION 'projects.legacy.metadata must be an object or null';
  END IF;
  IF EXISTS (
    SELECT 1 FROM conversations
    WHERE legacy ? 'title'
      AND jsonb_typeof(legacy->'title') NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'conversations.legacy.title must be a string or null';
  END IF;
END $$;

ALTER TABLE projects ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD CONSTRAINT projects_metadata_object
  CHECK (jsonb_typeof(metadata_json) = 'object');
UPDATE projects
SET metadata_json = COALESCE(NULLIF(legacy->'metadata', 'null'::jsonb), '{}'::jsonb),
    legacy = NULLIF(legacy - 'metadata', '{}'::jsonb)
WHERE legacy ? 'metadata';

ALTER TABLE conversations ADD COLUMN title text;
UPDATE conversations
SET title = legacy->>'title',
    legacy = NULLIF(legacy - 'title', '{}'::jsonb)
WHERE legacy ? 'title';

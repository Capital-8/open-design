-- POC attachment bytes live in the isolated business database until object
-- storage is available. No daemon-local paths or Runtime file writes.
CREATE TABLE project_attachments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  content bytea NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, path),
  CHECK (octet_length(content) <= 20971520)
);
CREATE INDEX project_attachments_project_idx ON project_attachments(project_id, created_at);

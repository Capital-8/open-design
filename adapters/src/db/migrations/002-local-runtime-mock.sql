-- Explicit local development simulation only; never populated by remote Runtime mode.
CREATE TABLE runtime_mock_projects (
 runtime_id text NOT NULL CHECK (runtime_id LIKE 'mock:%'),
 id uuid NOT NULL,
 owner_id text NOT NULL,
 state jsonb NOT NULL,
 PRIMARY KEY (runtime_id, id)
);

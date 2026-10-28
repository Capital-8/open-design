-- Add durable application auth and fenced recovery without rewriting POC migrations.
CREATE TABLE cloud_credentials (
 id text PRIMARY KEY, principal_id text NOT NULL, provider_actor_id text NOT NULL,
 environment text NOT NULL, ciphertext text NOT NULL, key_version text NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, revision text NOT NULL
);
CREATE TABLE cloud_sessions (
 token_hash text PRIMARY KEY, client_ref text NOT NULL, principal_id text NOT NULL,
 credential_ref text NOT NULL REFERENCES cloud_credentials(id), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, revision text NOT NULL
);
CREATE INDEX cloud_sessions_principal_idx ON cloud_sessions(principal_id);
ALTER TABLE projects ADD COLUMN workspace_id text,
 ADD COLUMN operation_owner text, ADD COLUMN operation_expires_at timestamptz,
 ADD COLUMN revision integer NOT NULL DEFAULT 1;
UPDATE projects SET workspace_id=legacy->>'workspaceId' WHERE jsonb_typeof(legacy->'workspaceId')='string';
ALTER TABLE conversations ADD COLUMN operation_owner text, ADD COLUMN operation_expires_at timestamptz,
 ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN principal_id text, ADD COLUMN workspace_id text,
 ADD COLUMN credential_ref text REFERENCES cloud_credentials(id), ADD COLUMN provider_environment text,
 ADD COLUMN authorization_state text NOT NULL DEFAULT 'waiting' CHECK(authorization_state IN ('ready','waiting','revoked')),
 ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE outbox ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN claimed_by text;
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK(kind IN ('submit','cancel','reconcile','recover'));

-- POC business schema only. Vela owns the separate authentication database.
CREATE TABLE app_users (
 id text PRIMARY KEY, auth_user_id text NOT NULL UNIQUE, email text NOT NULL, name text, image text,
 status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, access_revoked_at timestamptz
);
CREATE TABLE projects (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES app_users(id), name text NOT NULL, runtime_id text NOT NULL,
 runtime_project_id text, creation_status text NOT NULL CHECK (creation_status IN ('provisioning','ready','creation_unknown','failed')),
 creation_error text, upstream_request_id text, active_run_id uuid, edit_state text NOT NULL DEFAULT 'idle' CHECK (edit_state IN ('idle','editing','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(runtime_id, runtime_project_id)
);
CREATE INDEX projects_owner_idx ON projects(owner_id, created_at);
CREATE TABLE conversations (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), runtime_session_id text,
 creation_status text NOT NULL CHECK (creation_status IN ('provisioning','ready','creation_unknown','failed')),
 creation_error text, upstream_request_id text,
 runtime_cursor bigint NOT NULL DEFAULT 0 CHECK(runtime_cursor >= 0), event_sequence bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id, runtime_session_id)
);
CREATE TABLE runs (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id), client_request_id text NOT NULL,
 input text NOT NULL, input_hash text NOT NULL, runtime_run_id text,
 submission text NOT NULL DEFAULT 'pending' CHECK(submission IN ('pending','confirmed','unconfirmed','rejected')),
 cancel_requested boolean NOT NULL DEFAULT false, cancel_confirmed boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','cancelling','succeeded','failed','cancelled','blocked')),
 files text NOT NULL DEFAULT 'not_attested' CHECK(files IN ('saved','unknown','not_attested')), cleanup text,
 error_code text, upstream_request_id text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id, client_request_id), UNIQUE(conversation_id, runtime_run_id)
);
ALTER TABLE projects ADD CONSTRAINT projects_active_run_fk FOREIGN KEY(active_run_id) REFERENCES runs(id);
CREATE TABLE messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id), run_id uuid NOT NULL REFERENCES runs(id),
 role text NOT NULL, content text NOT NULL, complete boolean NOT NULL DEFAULT true,
 runtime_sequence bigint, turn text, calls jsonb, tool_call_id text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id, runtime_sequence)
);
CREATE UNIQUE INDEX messages_user_run_idx ON messages(run_id) WHERE role='user';
CREATE TABLE events (
 conversation_id uuid NOT NULL REFERENCES conversations(id), sequence bigint NOT NULL,
 runtime_sequence bigint, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id, sequence), UNIQUE(conversation_id, runtime_sequence)
);
CREATE TABLE outbox (
 id bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id), kind text NOT NULL CHECK(kind IN ('submit','cancel','reconcile')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), claimed_until timestamptz,
 claim_token uuid, done boolean NOT NULL DEFAULT false, last_error text, UNIQUE(run_id, kind)
);
CREATE INDEX outbox_due_idx ON outbox(available_at) WHERE NOT done;
CREATE TABLE mock_wallets (
 owner_id text PRIMARY KEY REFERENCES app_users(id), initial_credits bigint NOT NULL CHECK(initial_credits >= 0),
 balance bigint NOT NULL CHECK(balance >= 0), reserved bigint NOT NULL DEFAULT 0 CHECK(reserved >= 0), fixture_version text NOT NULL
);
CREATE TABLE mock_usage (
 run_id uuid PRIMARY KEY REFERENCES runs(id), owner_id text NOT NULL REFERENCES app_users(id), source text NOT NULL CHECK(source='mock'),
 fixture_version text NOT NULL, rule_version text NOT NULL, state text NOT NULL CHECK(state IN ('reserved','settled','review')),
 reservation bigint NOT NULL CHECK(reservation >= 0), credits bigint, measurement jsonb
);

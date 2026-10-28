-- Original-client compatibility is stored in the isolated business DB only.
ALTER TABLE projects ADD COLUMN legacy jsonb;
ALTER TABLE conversations ADD COLUMN legacy jsonb;
ALTER TABLE runs ADD COLUMN legacy jsonb;
CREATE TABLE legacy_message_drafts (
 conversation_id uuid NOT NULL REFERENCES conversations(id),
 id text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id,id)
);

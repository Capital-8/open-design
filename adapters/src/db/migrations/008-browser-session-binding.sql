CREATE TABLE cloud_browser_sessions (
 cookie_hash text PRIMARY KEY, session_ref text NOT NULL, client_ref text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX cloud_browser_sessions_expiry_idx ON cloud_browser_sessions(expires_at);

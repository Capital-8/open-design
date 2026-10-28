-- Temporary, per-account privacy compatibility; never write to Vela auth DB.
-- POC-016 will move ownership to the frontend and retire this bridge.
ALTER TABLE app_users ADD COLUMN legacy_privacy jsonb;

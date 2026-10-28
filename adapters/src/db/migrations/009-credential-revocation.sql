ALTER TABLE cloud_credentials ADD COLUMN revocation_reason text CHECK (revocation_reason IN ('logout','provider'));

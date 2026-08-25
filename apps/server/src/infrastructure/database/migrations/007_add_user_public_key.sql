ALTER TABLE users ADD COLUMN public_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_key
ON users(public_key)
WHERE public_key IS NOT NULL;

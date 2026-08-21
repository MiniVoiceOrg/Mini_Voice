-- 002_fix_nickname_constraint.sql
-- Removes the UNIQUE constraint on users.nickname. Nickname uniqueness is
-- enforced at runtime only among currently online users (see AuthService),
-- so a persistent UNIQUE constraint incorrectly rejected returning users and
-- caused unhandled constraint-violation errors. SQLite cannot drop a column
-- constraint in place, so the table is recreated without it.

CREATE TABLE users_new (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL COLLATE NOCASE,
    avatar_path TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

INSERT INTO users_new (id, client_id, nickname, avatar_path, created_at, last_seen_at)
    SELECT id, client_id, nickname, avatar_path, created_at, last_seen_at FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);

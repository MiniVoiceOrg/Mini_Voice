-- 005_add_mentions.sql
-- Tracks unread @-mentions per user so that a user mentioned while offline still
-- sees the mention (red @ on the channel) when they next connect (#14). A row
-- exists only while the mention is unread; opening the channel deletes it.
CREATE TABLE IF NOT EXISTS mentions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(user_id);
CREATE INDEX IF NOT EXISTS idx_mentions_user_channel ON mentions(user_id, channel_id);

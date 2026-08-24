-- 006_add_attachments.sql
-- Chat file attachments (#11). The binary itself lives on the host's disk
-- (server-data/attachments) and is served over HTTP, mirroring how avatars are
-- handled; this table stores only metadata + the on-disk filename. A message may
-- have several attachments (1:N). `message_id` is NULL while an upload is pending
-- (the file is uploaded before the chat message is sent) and is set when the
-- message is created. When total storage exceeds the configured budget the oldest
-- rows are evicted FIFO: the disk file is deleted and the row is marked
-- `evicted = 1` (filename cleared) so the owning message keeps a placeholder
-- instead of a broken link. Deleting a message/channel cascade-deletes its
-- attachment rows; the application layer removes the matching disk files.
CREATE TABLE IF NOT EXISTS message_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,            -- 'image' | 'video' | 'file'
    filename TEXT NOT NULL,        -- on-disk uuid.ext ('' once evicted)
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    evicted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
-- FIFO eviction and usage accounting walk non-evicted rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_attachments_evict ON message_attachments(evicted, created_at);

-- Per-server attachment storage limits, in bytes (#11). NULL falls back to the
-- shared defaults (LIMITS.MAX_ATTACHMENT_*) at read time.
ALTER TABLE server_meta ADD COLUMN max_attachment_file_bytes INTEGER;
ALTER TABLE server_meta ADD COLUMN max_attachment_storage_bytes INTEGER;

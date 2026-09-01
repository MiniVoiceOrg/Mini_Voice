-- 013_add_message_edit_delete.sql
-- Editing and deleting chat messages (#504).
--
-- A deleted message keeps its row: the client draws a "message deleted"
-- placeholder in its place instead of letting it vanish, so the conversation
-- still reads in order for everyone. The content is blanked on deletion, so
-- nothing recoverable stays behind.
ALTER TABLE messages ADD COLUMN edited_at INTEGER;
ALTER TABLE messages ADD COLUMN deleted_at INTEGER;

-- Server-wide switch for editing. Defaults to enabled so existing servers keep
-- behaving as their owners expect after an upgrade.
ALTER TABLE server_meta ADD COLUMN allow_message_edit INTEGER NOT NULL DEFAULT 1;

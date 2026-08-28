-- Private channels (#384).
--
-- A channel can be restricted so that only members holding one of the selected
-- roles are able to see and use it. Visibility is enforced on the server: a
-- channel the caller cannot access is never sent to them, so not even its name
-- leaks to people outside the allowed roles.
--
-- Channels that already exist stay public (is_private = 0), preserving the
-- current behaviour on servers created before this migration.
ALTER TABLE channels ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;

-- Roles allowed into a private channel. Rows are meaningless while the channel
-- is public, and both foreign keys cascade so deleting a role or a channel
-- cleans its links up automatically (verified: sql.js does enforce them).
--
-- A private channel with no rows here is intentionally valid: it collapses to
-- "managers only", which is the safe direction to fail towards when the last
-- allowed role is deleted.
CREATE TABLE IF NOT EXISTS channel_allowed_roles (
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, role_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

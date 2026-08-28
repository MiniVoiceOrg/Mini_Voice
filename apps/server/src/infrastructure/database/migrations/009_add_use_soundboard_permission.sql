-- Grants USE_SOUNDBOARD (1 << 12 = 4096) to every existing role.
--
-- Until this permission existed, the soundboard was gated only by the
-- server-wide `allow_soundboard` switch, so every member could use it. Adding
-- the bit to the roles already in the database keeps that behaviour: without
-- this backfill, enforcing the new permission would silently take the
-- soundboard away from everyone on servers created before it.
UPDATE roles SET permissions = permissions | 4096;

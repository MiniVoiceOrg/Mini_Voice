-- 012_add_allow_everyone_mention.sql
-- Server-wide switch for the @todos / @everyone mention (#464). Defaults to
-- enabled so existing servers keep behaving the way their owners expect after
-- an upgrade; owners who find it noisy can turn it off in server settings.
ALTER TABLE server_meta ADD COLUMN allow_everyone_mention INTEGER NOT NULL DEFAULT 1;

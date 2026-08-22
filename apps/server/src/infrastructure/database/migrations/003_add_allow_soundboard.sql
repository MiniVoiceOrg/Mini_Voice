-- 003_add_allow_soundboard.sql
ALTER TABLE server_meta ADD COLUMN allow_soundboard INTEGER NOT NULL DEFAULT 1;

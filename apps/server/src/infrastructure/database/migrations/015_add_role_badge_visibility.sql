-- Role badges are public by default, matching how every server behaved before
-- this setting existed (#530).
ALTER TABLE server_meta ADD COLUMN show_role_badges_to_everyone INTEGER NOT NULL DEFAULT 1;

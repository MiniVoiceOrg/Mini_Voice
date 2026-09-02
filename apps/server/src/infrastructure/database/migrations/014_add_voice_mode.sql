-- 014_add_voice_mode.sql
-- Server-wide voice mode ('p2p' | 'sfu') (#515). Defaults to 'p2p' so existing servers
-- maintain their exact P2P Mesh behavior without any intervention.
ALTER TABLE server_meta ADD COLUMN voice_mode TEXT NOT NULL DEFAULT 'p2p';

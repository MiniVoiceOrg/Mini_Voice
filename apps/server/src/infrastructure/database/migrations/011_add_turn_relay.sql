-- Built-in TURN relay (#425).
--
-- Members behind CGNAT (carrier-grade NAT) frequently cannot reach each other
-- directly: STUN can only report the public address, it cannot open a path when
-- both sides sit behind a symmetric NAT. A TURN server relays the media through
-- the host as a last resort, which is the only reliable fix for those pairs.
--
-- Relaying costs the host real bandwidth, so it stays off unless the operator
-- turns it on: existing servers keep the current STUN-only behaviour.
ALTER TABLE server_meta ADD COLUMN turn_enabled INTEGER NOT NULL DEFAULT 0;

-- Shared secret for TURN's REST-API auth (draft-uberti-behave-turn-rest-00).
--
-- Clients never see this value; they receive short-lived credentials derived
-- from it. Keeping it in the database (rather than regenerating per boot) means
-- credentials already handed out survive a restart, and it is generated lazily
-- the first time the relay is enabled -- hence nullable.
ALTER TABLE server_meta ADD COLUMN turn_secret TEXT;

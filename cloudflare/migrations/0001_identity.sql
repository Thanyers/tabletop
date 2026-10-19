-- Applied explicitly to the selected Tabletop D1 database; no remote auto-migration.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS web_sessions_user_idx ON web_sessions(user_id);
CREATE INDEX IF NOT EXISTS web_sessions_expiry_idx ON web_sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);
-- Directory entries carry opaque identifiers, not private display metadata.
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'teaching', 'encounter')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  epoch INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  directory_sequence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, room_id)
);
CREATE INDEX IF NOT EXISTS room_members_room_idx ON room_members(room_id, active);
CREATE TABLE IF NOT EXISTS edge_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);

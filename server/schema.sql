CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS authority_meta (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  created_at BIGINT NOT NULL
);

INSERT INTO authority_meta (singleton, created_at)
VALUES (TRUE, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  hard_expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  workspace_id TEXT,
  rotated_to_token_hash TEXT,
  rotation_ticket_hash TEXT
);

CREATE INDEX IF NOT EXISTS sessions_actor_idx ON sessions (actor_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (hard_expires_at, last_seen_at);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'teaching', 'encounter')),
  owner_actor_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  revision BIGINT NOT NULL CHECK (revision > 0),
  projection_salt TEXT NOT NULL,
  domain_state JSONB NOT NULL,
  state_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  purged_at BIGINT
);

CREATE INDEX IF NOT EXISTS workspaces_expiry_idx ON workspaces (expires_at);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner_actor_id);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS projection_salt TEXT;
UPDATE workspaces SET projection_salt = gen_random_uuid()::text WHERE projection_salt IS NULL;
ALTER TABLE workspaces ALTER COLUMN projection_salt SET NOT NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS purged_at BIGINT;

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'teacher', 'learner', 'dm', 'player')),
  seat TEXT CHECK (seat IS NULL OR seat IN ('learner-1', 'learner-2', 'mira', 'pip')),
  created_at BIGINT NOT NULL,
  revoked_at BIGINT,
  PRIMARY KEY (workspace_id, epoch, actor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS memberships_active_seat_idx
  ON memberships (workspace_id, epoch, seat)
  WHERE seat IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS memberships_actor_idx ON memberships (actor_id, revoked_at);

CREATE TABLE IF NOT EXISTS invitations (
  ticket_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('learner', 'player')),
  seat TEXT NOT NULL CHECK (seat IN ('learner-1', 'learner-2', 'mira', 'pip')),
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  redeemed_at BIGINT,
  redeemed_by TEXT,
  revoked_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_active_seat_idx
  ON invitations (workspace_id, epoch, seat)
  WHERE redeemed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS invitations_workspace_idx ON invitations (workspace_id, epoch);

CREATE TABLE IF NOT EXISTS snapshots (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  revision BIGINT NOT NULL,
  schema_version INTEGER NOT NULL,
  state JSONB NOT NULL,
  state_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, epoch, revision)
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  workspace_sequence BIGINT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (workspace_id, epoch, workspace_sequence)
);

CREATE INDEX IF NOT EXISTS events_workspace_idx ON events (workspace_id, epoch, workspace_sequence);

CREATE TABLE IF NOT EXISTS commands (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(event_id),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, epoch, actor_id, command_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  outbox_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(event_id),
  created_at BIGINT NOT NULL,
  delivered_at BIGINT
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (created_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS artifact_cleanup (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  requested_at BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, epoch, object_key)
);

CREATE INDEX IF NOT EXISTS artifact_cleanup_pending_idx ON artifact_cleanup (requested_at);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  approving_actor_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL,
  approval_data JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS approvals_candidate_idx
  ON approvals (workspace_id, epoch, candidate_hash, proof_hash);

CREATE TABLE IF NOT EXISTS model_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  epoch INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE INDEX IF NOT EXISTS model_jobs_workspace_idx ON model_jobs (workspace_id, epoch, status);

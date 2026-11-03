-- Additive only: no existing account, membership or research is changed.
CREATE TABLE account_deletions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  email_hash TEXT NOT NULL CHECK(length(email_hash)=64),
  deleted_at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','client','meta','maintenance')),
  actor_id TEXT,
  reason TEXT NOT NULL CHECK(reason IN ('owner_request','self_service','meta_request','setup_cleanup')),
  lead_event_id TEXT,
  crm_follow_up_required INTEGER NOT NULL DEFAULT 0,
  cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK(cleanup_status IN ('pending','completed')),
  completed_at TEXT
);
CREATE TABLE account_deletion_files (
  deletion_id TEXT NOT NULL REFERENCES account_deletions(id),
  workspace_id TEXT NOT NULL UNIQUE CHECK(workspace_id <> 'levr'),
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  last_error TEXT,
  PRIMARY KEY(deletion_id,workspace_id)
);
CREATE TABLE account_deletion_challenges (
  state_hash TEXT PRIMARY KEY REFERENCES signup_oauth_states(state_hash) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE
);
CREATE TABLE account_deletion_reauth (
  session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE meta_deletion_requests (
  code_hash TEXT PRIMARY KEY,
  deletion_id TEXT REFERENCES account_deletions(id),
  created_at TEXT NOT NULL
);
-- Stop OAuth responses started before a deletion from recreating pending PII.
-- Future deliberate signups remain possible; raw provider subjects are not kept.
CREATE TABLE deleted_social_identities (
  provider TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  deletion_id TEXT REFERENCES account_deletions(id),
  PRIMARY KEY(provider,subject_hash)
);

-- Signup details are separate from client research. Only the owner can read
-- the catalog's lead records. Never store passwords or webhook credentials here.
CREATE TABLE signup_leads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
  email TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(delivery_status IN ('pending','sending','delivered','failed','unconfigured')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  delivered_at TEXT,
  last_error TEXT
);
CREATE INDEX signup_leads_created ON signup_leads(created_at,id);
CREATE TABLE signup_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Existing research remains in the Levr workspace. New clients use separate DBs.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO workspaces(id,name,created_at) VALUES ('levr','Levr',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1))
);
CREATE TABLE memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) CHECK(workspace_id <> 'levr'),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) CHECK(workspace_id <> 'levr'),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE INDEX invites_workspace ON invites(workspace_id,created_at);
ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id);

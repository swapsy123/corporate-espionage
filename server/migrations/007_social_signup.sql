CREATE TABLE social_identities (
  provider TEXT NOT NULL CHECK(provider IN ('google','facebook')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider,subject),
  UNIQUE(user_id,provider)
);
CREATE TABLE signup_oauth_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google','facebook')),
  expires_at INTEGER NOT NULL
);
CREATE TABLE pending_social_signups (
  token_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('google','facebook')),
  subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)),
  full_name TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL
);

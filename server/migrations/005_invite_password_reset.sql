-- Keep invitation enrollment and account recovery tokens purpose-bound.
ALTER TABLE invites ADD COLUMN purpose TEXT NOT NULL DEFAULT 'invite'
CHECK(purpose IN ('invite','password_reset'));

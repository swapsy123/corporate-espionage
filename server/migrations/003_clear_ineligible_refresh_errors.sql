-- Earlier bulk refreshes queued competitors that were not ready to collect.
-- Remove that obsolete watchlist error; retain all historical refresh records.
UPDATE competitors SET last_error=NULL
WHERE last_error='Confirm at least one profile before refreshing this competitor.';

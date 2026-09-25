-- J4: replay validation state for each score.
ALTER TABLE scores ADD COLUMN status TEXT NOT NULL DEFAULT 'unverifiable';
CREATE INDEX IF NOT EXISTS scores_status ON scores (status, created_at);

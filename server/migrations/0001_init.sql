-- Hot Tail leaderboard + anonymous analytics schema (J3/J6/J8).
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  mode TEXT NOT NULL,
  stage INTEGER NOT NULL,
  jet TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  seed INTEGER NOT NULL,
  version TEXT NOT NULL,
  replay TEXT,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_mode_score ON scores (mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_mode_created ON scores (mode, created_at);
CREATE INDEX IF NOT EXISTS scores_player ON scores (player_id, created_at);
CREATE INDEX IF NOT EXISTS scores_ip ON scores (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  stage INTEGER NOT NULL,
  count INTEGER NOT NULL,
  total REAL NOT NULL,
  PRIMARY KEY (day, type, stage)
);

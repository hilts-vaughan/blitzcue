CREATE TABLE IF NOT EXISTS players (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS games (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, day)
);

CREATE INDEX IF NOT EXISTS games_by_day ON games (guild_id, day);

CREATE TABLE IF NOT EXISTS reminders (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  last_day TEXT
);

CREATE TABLE IF NOT EXISTS daily_cards (
  guild_id TEXT NOT NULL,
  day TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  signature TEXT,
  desired_version INTEGER NOT NULL DEFAULT 0,
  applied_version INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day)
);

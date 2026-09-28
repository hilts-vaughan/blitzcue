CREATE TABLE IF NOT EXISTS answer_cache (
  version INTEGER NOT NULL,
  category_key TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
  provider TEXT NOT NULL,
  jev_probability REAL CHECK (jev_probability IS NULL OR jev_probability BETWEEN 0 AND 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (version, category_key, answer_key)
);

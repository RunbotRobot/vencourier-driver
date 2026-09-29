CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,           -- Gmail thread id
  status TEXT NOT NULL,          -- offered | declined | active | completed
  updated_at TEXT NOT NULL,
  json TEXT NOT NULL             -- the Job document
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, updated_at);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seen_messages (id TEXT PRIMARY KEY);

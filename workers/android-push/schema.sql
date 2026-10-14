CREATE TABLE IF NOT EXISTS devices (
 tenant TEXT NOT NULL, device_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(tenant,device_id)
);
CREATE TABLE IF NOT EXISTS deliveries (
 tenant TEXT NOT NULL, event_id TEXT NOT NULL, device_id TEXT NOT NULL,
 user_id TEXT NOT NULL, token TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
 PRIMARY KEY(tenant,event_id,device_id)
);
CREATE INDEX IF NOT EXISTS deliveries_pending ON deliveries(done,next_attempt);
CREATE TABLE IF NOT EXISTS cursors (tenant TEXT PRIMARY KEY, at TEXT NOT NULL, id TEXT NOT NULL DEFAULT '');

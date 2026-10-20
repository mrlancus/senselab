-- Every row is owned by an anonymous device ID until real accounts exist.

CREATE TABLE containers (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  shape TEXT NOT NULL DEFAULT 'frustum',
  top_diameter_cm REAL,
  bottom_diameter_cm REAL,
  height_cm REAL,
  material TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX containers_device ON containers (device_id, created_at);

CREATE TABLE calibration_points (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL REFERENCES containers (id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('tap', 'echo')),
  known_litres REAL NOT NULL,
  measured_value REAL NOT NULL,
  recording_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX calibration_points_container ON calibration_points (container_id, method);

CREATE TABLE measurements (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL REFERENCES containers (id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('tap', 'echo', 'camera')),
  raw_value REAL NOT NULL,
  estimated_litres REAL NOT NULL,
  confidence REAL NOT NULL,
  recording_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX measurements_container ON measurements (container_id, created_at);

-- Opt-in debug uploads. The audio/video bytes live in R2 under r2_key.
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sample_rate REAL,
  labels TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX recordings_device ON recordings (device_id, created_at);

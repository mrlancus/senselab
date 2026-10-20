-- Examples the user teaches a mode: labelled knock features, taught alert sounds, fruit
-- firmness readings. `data` is the mode's JSON payload (feature vectors, fingerprints).

CREATE TABLE examples (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('knock', 'alert', 'fruit')),
  label TEXT NOT NULL,
  data TEXT NOT NULL,
  recording_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX examples_device_mode ON examples (device_id, mode, label);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS provider_configs (
  provider_id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL DEFAULT 'unknown',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  model_id TEXT,
  secret_reference_id TEXT UNIQUE,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS prompt_profiles (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  built_in_profile_id TEXT,
  prompt_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES prompt_profiles(profile_id) ON DELETE SET NULL,
  capture_config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS transcript_segments (
  segment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  ended_at_ms INTEGER NOT NULL CHECK (ended_at_ms >= started_at_ms),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  provider_id TEXT,
  model_id TEXT,
  status TEXT NOT NULL,
  text TEXT NOT NULL,
  latency_ms INTEGER CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS attachments (
  attachment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  approved_file_reference TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS recordings (
  recording_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  file_reference TEXT NOT NULL,
  retention_policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS diagnostic_events (
  event_id TEXT PRIMARY KEY,
  subsystem TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS transcript_segments_session_started_idx
  ON transcript_segments(session_id, started_at_ms);
CREATE INDEX IF NOT EXISTS turns_session_created_idx ON turns(session_id, created_at);
CREATE INDEX IF NOT EXISTS diagnostic_events_occurred_idx ON diagnostic_events(occurred_at);

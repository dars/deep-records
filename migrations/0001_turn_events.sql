CREATE TABLE IF NOT EXISTS turn_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL,
  scene_id TEXT,
  action_kind TEXT,
  player_action TEXT,
  selected_action_id TEXT,
  turn_source TEXT,
  belief_stage TEXT,
  sanity INTEGER,
  ending_id TEXT,
  latency_ms INTEGER,
  occupation TEXT
);

CREATE INDEX IF NOT EXISTS idx_turn_events_session ON turn_events(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_turn_events_ts ON turn_events(ts);
CREATE INDEX IF NOT EXISTS idx_turn_events_ending ON turn_events(ending_id) WHERE ending_id IS NOT NULL;

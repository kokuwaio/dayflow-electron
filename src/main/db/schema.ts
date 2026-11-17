// Migrations, applied in order and tracked in PRAGMA user_version. Table and
// column names follow upstream Dayflow (Core/Recording/StorageManager.swift)
// so its prompts, CLI and MCP tools port with few changes. Times are Unix
// seconds.

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    idle_seconds_at_capture INTEGER,
    frame_index INTEGER,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_screenshots_captured_at ON screenshots(captured_at);

  CREATE TABLE analysis_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_start_ts INTEGER NOT NULL,
    batch_end_ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    llm_metadata TEXT,
    detailed_transcription TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_analysis_batches_status ON analysis_batches(status);

  CREATE TABLE batch_screenshots (
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE RESTRICT,
    PRIMARY KEY (batch_id, screenshot_id)
  );
  CREATE INDEX idx_batch_screenshots_screenshot ON batch_screenshots(screenshot_id);

  CREATE TABLE timeline_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES analysis_batches(id) ON DELETE CASCADE,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    start_ts INTEGER,
    end_ts INTEGER,
    day DATE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    detailed_summary TEXT,
    metadata TEXT,
    video_summary_url TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_timeline_cards_day ON timeline_cards(day);
  CREATE INDEX idx_timeline_cards_time_range ON timeline_cards(start_ts, end_ts);

  CREATE TABLE llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    batch_id INTEGER NULL,
    call_group_id TEXT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    model TEXT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success','failure')),
    latency_ms INTEGER NULL,
    http_status INTEGER NULL,
    request_method TEXT NULL,
    request_url TEXT NULL,
    request_headers TEXT NULL,
    request_body TEXT NULL,
    response_headers TEXT NULL,
    response_body TEXT NULL,
    error_domain TEXT NULL,
    error_code INTEGER NULL,
    error_message TEXT NULL
  );
  CREATE INDEX idx_llm_calls_created ON llm_calls(created_at DESC);
  CREATE INDEX idx_llm_calls_batch ON llm_calls(batch_id);
  `,
  // 2: observations from the two-step path
  `
  CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    observation TEXT NOT NULL,
    metadata TEXT,
    llm_model TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_observations_batch_id ON observations(batch_id);
  CREATE INDEX idx_observations_time_range ON observations(start_ts, end_ts);
  `
]

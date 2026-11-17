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
  `,
  // 3: placeholders for frames not saved because a blocked app was in front
  `
  ALTER TABLE screenshots ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
  `,
  // 4: thumbs up/down on time ranges (upstream timeline_review_ratings, plus feedback text)
  `
  CREATE TABLE timeline_review_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    rating TEXT NOT NULL,
    feedback TEXT
  );
  CREATE INDEX idx_review_ratings_time ON timeline_review_ratings(start_ts, end_ts);
  `,
  // 5: daily focus and distraction goals (upstream day_goals, day_goal_categories)
  `
  CREATE TABLE day_goals (
    day TEXT NOT NULL PRIMARY KEY,
    focus_target_minutes INTEGER NOT NULL,
    distraction_limit_minutes INTEGER NOT NULL,
    is_skipped INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE day_goal_categories (
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('focus', 'distraction')),
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    category_color_hex TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (day, kind, category_id)
  );
  CREATE INDEX idx_day_goal_categories_day_kind ON day_goal_categories(day, kind, sort_order);
  `,
  // 6: Daily standups (upstream daily_standup_entries: one JSON payload per standup day)
  `
  CREATE TABLE daily_standup_entries (
    standup_day TEXT NOT NULL PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_daily_standup_entries_created_at ON daily_standup_entries(created_at DESC);
  `,
  // 7: Chat history (upstream StorageManager: conversations and their messages)
  `
  CREATE TABLE chat_conversations (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    cli_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_chat_conversations_updated ON chat_conversations(updated_at DESC);
  CREATE TABLE chat_messages (
    id TEXT NOT NULL PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
  );
  CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, sort_order);
  `
]

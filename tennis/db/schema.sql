-- Tennis Cancellation Bot Schema

-- Tracked tennis matches
CREATE TABLE IF NOT EXISTS tracked_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  odds_api_id TEXT UNIQUE NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  commence_time INTEGER NOT NULL,
  sport_key TEXT NOT NULL,
  polymarket_condition_id TEXT,
  player1_token_id TEXT,
  player2_token_id TEXT,
  polymarket_slug TEXT,              -- Event slug for fetching ALL markets
  status TEXT DEFAULT 'pending',
  walkover_detected_at INTEGER,
  orders_placed_at INTEGER,
  notes TEXT,
  last_seen_in_api INTEGER,          -- When we last saw this match in Odds API
  consecutive_missing INTEGER DEFAULT 0, -- How many polls it's been missing
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Orders placed for walkover arbitrage
CREATE TABLE IF NOT EXISTS placed_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES tracked_matches(id),
  condition_id TEXT,                 -- Which market (conditionId)
  market_question TEXT,              -- Market type (e.g., "Player vs Player", "Set Handicap -1.5")
  outcome TEXT NOT NULL,             -- Outcome we're betting on
  token_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  side TEXT DEFAULT 'BUY',
  price REAL NOT NULL,
  size REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Walkover detection events with full context
CREATE TABLE IF NOT EXISTS walkover_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES tracked_matches(id),
  detection_reason TEXT NOT NULL,
  confidence TEXT NOT NULL,
  detected_at INTEGER DEFAULT (strftime('%s', 'now')),
  notified INTEGER DEFAULT 0,
  -- Store the data that led to this detection
  current_api_state TEXT,      -- JSON snapshot of current Odds API state (or null if disappeared)
  previous_api_state TEXT,     -- JSON snapshot of previous Odds API state
  detection_context TEXT       -- JSON with additional context (match start time, detection time, etc.)
);

-- Trading wallet configuration (single wallet for this bot)
CREATE TABLE IF NOT EXISTS trading_wallet (
  id INTEGER PRIMARY KEY DEFAULT 1,
  wallet_address TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  proxy_address TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Match state snapshots for walkover detection
CREATE TABLE IF NOT EXISTS match_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  odds_api_id TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  captured_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_matches_status ON tracked_matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_commence ON tracked_matches(commence_time);
CREATE INDEX IF NOT EXISTS idx_matches_odds_api_id ON tracked_matches(odds_api_id);
CREATE INDEX IF NOT EXISTS idx_orders_match ON placed_orders(match_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_odds_id ON match_snapshots(odds_api_id);

-- Polymarket Wallet Tracker - Multi-User Schema
-- Version: 1.0.0

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_username TEXT,
  subscription_tier TEXT DEFAULT 'free',
  subscription_expires_at INTEGER,
  stripe_customer_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  last_active_at INTEGER,
  is_active INTEGER DEFAULT 1,
  is_banned INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- =============================================
-- USER SETTINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  min_trade_size REAL DEFAULT 500,
  min_wallet_pnl REAL DEFAULT 10000,
  min_win_rate REAL DEFAULT 0.55,
  categories_include TEXT DEFAULT '[]',
  categories_exclude TEXT DEFAULT '["sports"]',
  alert_on_buy INTEGER DEFAULT 1,
  alert_on_sell INTEGER DEFAULT 1,
  alert_whale_type_active INTEGER DEFAULT 1,
  alert_whale_type_dormant INTEGER DEFAULT 1,
  alert_whale_type_sniper INTEGER DEFAULT 1,
  quiet_hours_start INTEGER,
  quiet_hours_end INTEGER,
  max_alerts_per_hour INTEGER DEFAULT 50,
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- =============================================
-- USER WALLETS (Subscriptions)
-- =============================================
CREATE TABLE IF NOT EXISTS user_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  total_pnl REAL,
  win_rate REAL,
  total_trades INTEGER,
  whale_type TEXT DEFAULT 'active',
  custom_name TEXT,
  min_trade_size_override REAL,
  notify_enabled INTEGER DEFAULT 1,
  added_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(wallet_address);

-- =============================================
-- GLOBAL WALLET CACHE
-- =============================================
CREATE TABLE IF NOT EXISTS wallet_cache (
  address TEXT PRIMARY KEY,
  total_pnl REAL,
  win_rate REAL,
  total_trades INTEGER,
  avg_trade_size REAL,
  whale_type TEXT,
  last_trade_at INTEGER,
  pnl_per_trade REAL,
  trade_frequency REAL,
  category_pnl TEXT,
  cached_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- =============================================
-- USER SEEN TRADES
-- =============================================
CREATE TABLE IF NOT EXISTS user_seen_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_hash TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  seen_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, trade_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_seen_trades_user ON user_seen_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_user_seen_trades_hash ON user_seen_trades(trade_hash);

-- =============================================
-- ALERT HISTORY
-- =============================================
CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  trade_hash TEXT NOT NULL,
  market_title TEXT,
  trade_side TEXT,
  trade_size REAL,
  trade_price REAL,
  sent_at INTEGER DEFAULT (strftime('%s', 'now')),
  telegram_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_alert_history_user ON alert_history(user_id);

-- =============================================
-- SUBSCRIPTION TIERS
-- =============================================
CREATE TABLE IF NOT EXISTS subscription_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_wallets INTEGER NOT NULL,
  max_alerts_per_day INTEGER NOT NULL,
  can_use_copy_trading INTEGER DEFAULT 0,
  price_monthly_cents INTEGER,
  stripe_price_id TEXT
);

-- Insert default tiers (ignore if exists)
INSERT OR IGNORE INTO subscription_tiers VALUES
  ('free', 'Free', 5, 100, 0, 0, NULL),
  ('pro', 'Pro', 50, 1000, 1, 999, NULL),
  ('enterprise', 'Enterprise', 500, 10000, 1, 4999, NULL);

-- =============================================
-- COPY TRADING (Phase 3)
-- =============================================
CREATE TABLE IF NOT EXISTS user_trading_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  encrypted_credentials TEXT,
  copy_enabled INTEGER DEFAULT 0,
  copy_percentage REAL DEFAULT 100,
  max_trade_size REAL,
  daily_limit REAL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS user_copy_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_wallet TEXT NOT NULL,
  mode TEXT DEFAULT 'recommend',
  PRIMARY KEY(user_id, source_wallet)
);

-- =============================================
-- SCHEMA VERSION
-- =============================================
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER DEFAULT (strftime('%s', 'now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);

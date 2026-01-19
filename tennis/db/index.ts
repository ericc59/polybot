import { Database } from "bun:sqlite";
import { tennisConfig } from "../config";
import { logger } from "../../lib/logger";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

let database: Database | null = null;

/**
 * Get or create the database singleton
 */
export function getDb(): Database {
  if (!database) {
    // Ensure data directory exists
    const dbDir = dirname(tennisConfig.DB_PATH);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    database = new Database(tennisConfig.DB_PATH, { create: true });
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA foreign_keys = ON;");

    initSchema();
    logger.success(`Tennis database initialized at ${tennisConfig.DB_PATH}`);
  }
  return database;
}

/**
 * Shorthand for getDb()
 */
export function db(): Database {
  return getDb();
}

/**
 * Initialize database schema
 */
function initSchema(): void {
  const schema = `
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
      polymarket_slug TEXT,
      status TEXT DEFAULT 'pending',
      walkover_detected_at INTEGER,
      orders_placed_at INTEGER,
      notes TEXT,
      last_seen_in_api INTEGER,
      consecutive_missing INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Orders placed for walkover arbitrage
    CREATE TABLE IF NOT EXISTS placed_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES tracked_matches(id),
      condition_id TEXT,
      market_question TEXT,
      outcome TEXT NOT NULL,
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
      current_api_state TEXT,
      previous_api_state TEXT,
      detection_context TEXT
    );

    -- Trading wallet configuration
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_matches_status ON tracked_matches(status);
    CREATE INDEX IF NOT EXISTS idx_matches_commence ON tracked_matches(commence_time);
    CREATE INDEX IF NOT EXISTS idx_matches_odds_api_id ON tracked_matches(odds_api_id);
    CREATE INDEX IF NOT EXISTS idx_orders_match ON placed_orders(match_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_odds_id ON match_snapshots(odds_api_id);
  `;

  database!.exec(schema);

  // Run migrations for existing databases
  runMigrations();
}

/**
 * Run database migrations for schema updates
 */
function runMigrations(): void {
  // Migration 1: Add detection data columns to walkover_events
  try {
    const weColumns = database!.prepare("PRAGMA table_info(walkover_events)").all() as Array<{ name: string }>;
    const weColumnNames = weColumns.map((c) => c.name);

    if (!weColumnNames.includes("current_api_state")) {
      database!.exec("ALTER TABLE walkover_events ADD COLUMN current_api_state TEXT");
      logger.debug("Migration: Added current_api_state column to walkover_events");
    }
    if (!weColumnNames.includes("previous_api_state")) {
      database!.exec("ALTER TABLE walkover_events ADD COLUMN previous_api_state TEXT");
      logger.debug("Migration: Added previous_api_state column to walkover_events");
    }
    if (!weColumnNames.includes("detection_context")) {
      database!.exec("ALTER TABLE walkover_events ADD COLUMN detection_context TEXT");
      logger.debug("Migration: Added detection_context column to walkover_events");
    }
  } catch (error) {
    logger.debug("walkover_events migration check completed");
  }

  // Migration 2: Add tracking columns to tracked_matches
  try {
    const tmColumns = database!.prepare("PRAGMA table_info(tracked_matches)").all() as Array<{ name: string }>;
    const tmColumnNames = tmColumns.map((c) => c.name);

    if (!tmColumnNames.includes("last_seen_in_api")) {
      database!.exec("ALTER TABLE tracked_matches ADD COLUMN last_seen_in_api INTEGER");
      logger.debug("Migration: Added last_seen_in_api column to tracked_matches");
    }
    if (!tmColumnNames.includes("consecutive_missing")) {
      database!.exec("ALTER TABLE tracked_matches ADD COLUMN consecutive_missing INTEGER DEFAULT 0");
      logger.debug("Migration: Added consecutive_missing column to tracked_matches");
    }
    if (!tmColumnNames.includes("polymarket_slug")) {
      database!.exec("ALTER TABLE tracked_matches ADD COLUMN polymarket_slug TEXT");
      logger.debug("Migration: Added polymarket_slug column to tracked_matches");
    }
  } catch (error) {
    logger.debug("tracked_matches migration check completed");
  }

  // Migration 3: Add market tracking columns to placed_orders
  try {
    const poColumns = database!.prepare("PRAGMA table_info(placed_orders)").all() as Array<{ name: string }>;
    const poColumnNames = poColumns.map((c) => c.name);

    if (!poColumnNames.includes("condition_id")) {
      database!.exec("ALTER TABLE placed_orders ADD COLUMN condition_id TEXT");
      logger.debug("Migration: Added condition_id column to placed_orders");
    }
    if (!poColumnNames.includes("market_question")) {
      database!.exec("ALTER TABLE placed_orders ADD COLUMN market_question TEXT");
      logger.debug("Migration: Added market_question column to placed_orders");
    }
    if (!poColumnNames.includes("outcome")) {
      database!.exec("ALTER TABLE placed_orders ADD COLUMN outcome TEXT");
      logger.debug("Migration: Added outcome column to placed_orders");
    }
    // Rename 'player' to 'outcome' concept - keep 'player' for backwards compat
  } catch (error) {
    logger.debug("placed_orders migration check completed");
  }
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (database) {
    database.close();
    database = null;
    logger.info("Tennis database closed");
  }
}

import { Database } from "bun:sqlite";
import { config } from "../config";
import { logger } from "../utils/logger";

let _db: Database | null = null;

export function db(): Database {
  if (!_db) {
    throw new Error("Database not initialized. Call getDb() first.");
  }
  return _db;
}

export async function getDb(): Promise<Database> {
  if (_db) return _db;

  // Ensure data directory exists
  const dataDir = config.DB_PATH.substring(0, config.DB_PATH.lastIndexOf("/"));
  await Bun.write(`${dataDir}/.gitkeep`, "");

  _db = new Database(config.DB_PATH);

  // Enable WAL mode for better concurrent performance
  _db.run("PRAGMA journal_mode=WAL");
  _db.run("PRAGMA foreign_keys=ON");

  // Run migrations
  await runMigrations(_db);

  logger.info(`Database initialized at ${config.DB_PATH}`);
  return _db;
}

async function runMigrations(database: Database) {
  // Read and execute schema
  const schemaPath = new URL("./schema.sql", import.meta.url).pathname;
  const schema = await Bun.file(schemaPath).text();

  // Split by semicolons but handle multi-line statements properly
  // Remove SQL comments first
  const cleanedSchema = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  // Split by semicolons and filter empty statements
  const statements = cleanedSchema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    try {
      database.run(statement);
    } catch (error) {
      const errorMsg = String(error);
      // Only warn for unexpected errors, not "already exists" or constraint violations on insert
      if (!errorMsg.includes("already exists") && !errorMsg.includes("UNIQUE constraint")) {
        logger.warn(`Migration statement warning: ${errorMsg.slice(0, 100)}`);
      }
    }
  }

  logger.info("Database migrations complete");
}

// Close database connection
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Export types for use in repositories
export interface User {
  id: number;
  telegram_id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  subscription_tier: string;
  subscription_expires_at: number | null;
  stripe_customer_id: string | null;
  created_at: number;
  last_active_at: number | null;
  is_active: number;
  is_banned: number;
}

export interface UserSettings {
  user_id: number;
  min_trade_size: number;
  min_wallet_pnl: number;
  min_win_rate: number;
  categories_include: string;
  categories_exclude: string;
  alert_on_buy: number;
  alert_on_sell: number;
  alert_whale_type_active: number;
  alert_whale_type_dormant: number;
  alert_whale_type_sniper: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  max_alerts_per_hour: number;
  updated_at: number;
}

export interface UserWallet {
  id: number;
  user_id: number;
  wallet_address: string;
  total_pnl: number | null;
  win_rate: number | null;
  total_trades: number | null;
  whale_type: string;
  custom_name: string | null;
  min_trade_size_override: number | null;
  notify_enabled: number;
  added_at: number;
}

export interface SubscriptionTier {
  id: string;
  name: string;
  max_wallets: number;
  max_alerts_per_day: number;
  can_use_copy_trading: number;
  price_monthly_cents: number;
  stripe_price_id: string | null;
}

export interface UserSeenTrade {
  id: number;
  user_id: number;
  trade_hash: string;
  wallet_address: string;
  seen_at: number;
}

import { getDb, type UserWallet, type User, type UserSettings } from "../index";
import type { WalletScore } from "../../tracker/analyzer";

export interface WalletSubscriber {
  userId: number;
  telegramChatId: string;
  walletAddress: string;
  walletPnl: number | null;
  walletWinRate: number | null;
  walletWhaleType: string;
  customName: string | null;
  minTradeSize: number;
  minTradeSizeOverride: number | null;
  categoriesExclude: string;
  alertOnBuy: number;
  alertOnSell: number;
  alertWhaleTypeActive: number;
  alertWhaleTypeDormant: number;
  alertWhaleTypeSniper: number;
  maxAlertsPerHour: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

// Add wallet subscription for user
export async function addWallet(
  userId: number,
  walletAddress: string,
  stats?: WalletScore
): Promise<UserWallet> {
  const db = await getDb();

  db.run(
    `INSERT INTO user_wallets
     (user_id, wallet_address, total_pnl, win_rate, total_trades, whale_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      walletAddress.toLowerCase(),
      stats?.totalPnl || null,
      stats?.winRate || null,
      stats?.totalTrades || null,
      stats?.whaleType || "active",
    ]
  );

  // Also update global cache
  if (stats) {
    await updateWalletCache(walletAddress, stats);
  }

  const wallet = db
    .query("SELECT * FROM user_wallets WHERE user_id = ? AND wallet_address = ?")
    .get(userId, walletAddress.toLowerCase()) as UserWallet;

  return wallet;
}

// Remove wallet subscription
export async function removeWallet(userId: number, walletAddress: string): Promise<boolean> {
  const db = await getDb();

  const result = db.run(
    "DELETE FROM user_wallets WHERE user_id = ? AND wallet_address = ?",
    [userId, walletAddress.toLowerCase()]
  );

  return result.changes > 0;
}

// Get all wallets for a user
export async function getUserWallets(userId: number): Promise<UserWallet[]> {
  const db = await getDb();

  const rows = db
    .query(
      `SELECT * FROM user_wallets
       WHERE user_id = ?
       ORDER BY total_pnl DESC NULLS LAST`
    )
    .all(userId) as UserWallet[];

  return rows;
}

// Check if user is subscribed to wallet
export async function isSubscribed(userId: number, walletAddress: string): Promise<boolean> {
  const db = await getDb();

  const row = db
    .query(
      "SELECT 1 FROM user_wallets WHERE user_id = ? AND wallet_address = ?"
    )
    .get(userId, walletAddress.toLowerCase());

  return !!row;
}

// Count wallets for user (for tier limit check)
export async function countUserWallets(userId: number): Promise<number> {
  const db = await getDb();

  const row = db
    .query("SELECT COUNT(*) as count FROM user_wallets WHERE user_id = ?")
    .get(userId) as { count: number };

  return row.count;
}

// Get all subscribers for a wallet address (for alert dispatch)
export async function getWalletSubscribers(walletAddress: string): Promise<WalletSubscriber[]> {
  const db = await getDb();

  const rows = db.query(`
    SELECT
      u.id as userId,
      u.telegram_chat_id as telegramChatId,
      uw.wallet_address as walletAddress,
      uw.total_pnl as walletPnl,
      uw.win_rate as walletWinRate,
      uw.whale_type as walletWhaleType,
      uw.custom_name as customName,
      us.min_trade_size as minTradeSize,
      uw.min_trade_size_override as minTradeSizeOverride,
      us.categories_exclude as categoriesExclude,
      us.alert_on_buy as alertOnBuy,
      us.alert_on_sell as alertOnSell,
      us.alert_whale_type_active as alertWhaleTypeActive,
      us.alert_whale_type_dormant as alertWhaleTypeDormant,
      us.alert_whale_type_sniper as alertWhaleTypeSniper,
      us.max_alerts_per_hour as maxAlertsPerHour,
      us.quiet_hours_start as quietHoursStart,
      us.quiet_hours_end as quietHoursEnd
    FROM user_wallets uw
    JOIN users u ON uw.user_id = u.id
    JOIN user_settings us ON u.id = us.user_id
    WHERE uw.wallet_address = ?
      AND uw.notify_enabled = 1
      AND u.is_active = 1
      AND u.is_banned = 0
  `).all(walletAddress.toLowerCase()) as WalletSubscriber[];

  return rows;
}

// Get all unique tracked wallet addresses (for monitor polling)
export async function getAllTrackedWalletAddresses(): Promise<string[]> {
  const db = await getDb();

  const rows = db.query(`
    SELECT DISTINCT wallet_address
    FROM user_wallets
    WHERE notify_enabled = 1
  `).all() as { wallet_address: string }[];

  return rows.map((r) => r.wallet_address);
}

// Update wallet stats for a user's subscription
export async function updateWalletStats(
  userId: number,
  walletAddress: string,
  stats: Partial<WalletScore>
): Promise<void> {
  const db = await getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (stats.totalPnl !== undefined) {
    fields.push("total_pnl = ?");
    values.push(stats.totalPnl);
  }
  if (stats.winRate !== undefined) {
    fields.push("win_rate = ?");
    values.push(stats.winRate);
  }
  if (stats.totalTrades !== undefined) {
    fields.push("total_trades = ?");
    values.push(stats.totalTrades);
  }
  if (stats.whaleType !== undefined) {
    fields.push("whale_type = ?");
    values.push(stats.whaleType);
  }

  if (fields.length === 0) return;

  values.push(userId, walletAddress.toLowerCase());

  db.run(
    `UPDATE user_wallets SET ${fields.join(", ")} WHERE user_id = ? AND wallet_address = ?`,
    values as (string | number | null)[]
  );
}

// Toggle wallet notifications
export async function toggleNotifications(
  userId: number,
  walletAddress: string,
  enabled: boolean
): Promise<void> {
  const db = await getDb();

  db.run(
    "UPDATE user_wallets SET notify_enabled = ? WHERE user_id = ? AND wallet_address = ?",
    [enabled ? 1 : 0, userId, walletAddress.toLowerCase()]
  );
}

// Set custom name for wallet
export async function setCustomName(
  userId: number,
  walletAddress: string,
  name: string | null
): Promise<void> {
  const db = await getDb();

  db.run(
    "UPDATE user_wallets SET custom_name = ? WHERE user_id = ? AND wallet_address = ?",
    [name, userId, walletAddress.toLowerCase()]
  );
}

// Override min trade size for specific wallet
export async function setMinTradeSizeOverride(
  userId: number,
  walletAddress: string,
  minTradeSize: number | null
): Promise<void> {
  const db = await getDb();

  db.run(
    "UPDATE user_wallets SET min_trade_size_override = ? WHERE user_id = ? AND wallet_address = ?",
    [minTradeSize, userId, walletAddress.toLowerCase()]
  );
}

// =============================================
// GLOBAL WALLET CACHE (shared across users)
// =============================================

export interface WalletCacheEntry {
  address: string;
  total_pnl: number;
  win_rate: number;
  total_trades: number;
  avg_trade_size: number;
  whale_type: string;
  last_trade_at: number;
  pnl_per_trade: number;
  trade_frequency: number;
  category_pnl: string | null;
  cached_at: number;
}

export async function getWalletFromCache(address: string): Promise<WalletCacheEntry | null> {
  const db = await getDb();
  const row = db
    .query("SELECT * FROM wallet_cache WHERE address = ?")
    .get(address.toLowerCase()) as WalletCacheEntry | null;
  return row;
}

export async function updateWalletCache(address: string, stats: WalletScore): Promise<void> {
  const db = await getDb();

  db.run(
    `INSERT OR REPLACE INTO wallet_cache
     (address, total_pnl, win_rate, total_trades, avg_trade_size, whale_type,
      last_trade_at, pnl_per_trade, trade_frequency, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`,
    [
      address.toLowerCase(),
      stats.totalPnl,
      stats.winRate,
      stats.totalTrades,
      stats.avgTradeSize,
      stats.whaleType,
      stats.lastTradeAt,
      stats.pnlPerTrade,
      stats.tradeFrequency,
    ]
  );
}

// Check if cache is stale (older than given minutes)
export async function isCacheStale(address: string, maxAgeMinutes = 60): Promise<boolean> {
  const cached = await getWalletFromCache(address);
  if (!cached) return true;

  const now = Math.floor(Date.now() / 1000);
  const age = now - cached.cached_at;
  return age > maxAgeMinutes * 60;
}

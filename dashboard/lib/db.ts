import Database from 'better-sqlite3';
import path from 'path';

// Connect to the bot's SQLite database (read-only)
const dbPath = path.join(process.cwd(), '..', 'data', 'polybot.db');
const db = new Database(dbPath, { readonly: true });

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Types
export interface Wallet {
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
  subscriber_count?: number;
}

export interface User {
  id: number;
  telegram_id: string;
  telegram_username: string | null;
  subscription_tier: string;
  created_at: number;
  last_active_at: number;
  is_active: number;
}

export interface Alert {
  id: number;
  wallet_address: string;
  market_title: string;
  trade_side: string;
  trade_size: number;
  trade_price: number;
  sent_at: number;
}

export interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalWalletsTracked: number;
  uniqueWalletsTracked: number;
  alertsToday: number;
  subscriptionBreakdown: {
    free: number;
    pro: number;
    enterprise: number;
  };
}

// Get system stats
export function getStats(): Stats {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND is_banned = 0').get() as { count: number };
  const totalWalletsTracked = db.prepare('SELECT COUNT(*) as count FROM user_wallets').get() as { count: number };
  const uniqueWalletsTracked = db.prepare('SELECT COUNT(DISTINCT wallet_address) as count FROM user_wallets').get() as { count: number };

  const todayStart = Math.floor(Date.now() / 1000) - 86400;
  const alertsToday = db.prepare('SELECT COUNT(*) as count FROM alert_history WHERE sent_at > ?').get(todayStart) as { count: number };

  const freeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_tier = 'free'").get() as { count: number };
  const proUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_tier = 'pro'").get() as { count: number };
  const enterpriseUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_tier = 'enterprise'").get() as { count: number };

  return {
    totalUsers: totalUsers.count,
    activeUsers: activeUsers.count,
    totalWalletsTracked: totalWalletsTracked.count,
    uniqueWalletsTracked: uniqueWalletsTracked.count,
    alertsToday: alertsToday.count,
    subscriptionBreakdown: {
      free: freeUsers.count,
      pro: proUsers.count,
      enterprise: enterpriseUsers.count,
    },
  };
}

// Get all tracked wallets with subscriber counts
export function getWallets(limit = 100, offset = 0): Wallet[] {
  const wallets = db.prepare(`
    SELECT
      wc.*,
      COUNT(uw.id) as subscriber_count
    FROM wallet_cache wc
    LEFT JOIN user_wallets uw ON wc.address = uw.wallet_address
    GROUP BY wc.address
    ORDER BY wc.total_pnl DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Wallet[];

  return wallets;
}

// Get total wallet count
export function getWalletCount(): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM wallet_cache').get() as { count: number };
  return result.count;
}

// Get single wallet details
export function getWallet(address: string): Wallet | null {
  const wallet = db.prepare(`
    SELECT
      wc.*,
      COUNT(uw.id) as subscriber_count
    FROM wallet_cache wc
    LEFT JOIN user_wallets uw ON wc.address = uw.wallet_address
    WHERE wc.address = ?
    GROUP BY wc.address
  `).get(address) as Wallet | null;

  return wallet;
}

// Get recent alerts (as proxy for trades)
export function getRecentTrades(limit = 50): Alert[] {
  const alerts = db.prepare(`
    SELECT
      id,
      wallet_address,
      market_title,
      trade_side,
      trade_size,
      trade_price,
      sent_at
    FROM alert_history
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit) as Alert[];

  return alerts;
}

// Get trades for a specific wallet
export function getWalletTrades(address: string, limit = 50): Alert[] {
  const alerts = db.prepare(`
    SELECT
      id,
      wallet_address,
      market_title,
      trade_side,
      trade_size,
      trade_price,
      sent_at
    FROM alert_history
    WHERE wallet_address = ?
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(address, limit) as Alert[];

  return alerts;
}

// Get top performing wallets (only profitable ones)
export function getTopWallets(limit = 10): Wallet[] {
  const wallets = db.prepare(`
    SELECT
      wc.*,
      COUNT(uw.id) as subscriber_count
    FROM wallet_cache wc
    LEFT JOIN user_wallets uw ON wc.address = uw.wallet_address
    WHERE wc.total_pnl > 0
    GROUP BY wc.address
    ORDER BY wc.total_pnl DESC
    LIMIT ?
  `).all(limit) as Wallet[];

  return wallets;
}

// =============================================
// COPY TRADING DATA
// =============================================

export interface CopyTrade {
  id: number;
  userId: number;
  sourceWallet: string;
  marketTitle: string;
  side: string;
  size: number;
  price: number;
  status: string;
  createdAt: number;
  executedAt: number | null;
}

export interface CopyTradingStats {
  totalTrades: number;
  executedTrades: number;
  failedTrades: number;
  totalVolume: number;
  todayVolume: number;
  todayTrades: number;
}

export interface TradingAccount {
  walletAddress: string;
  proxyAddress: string | null;
  copyEnabled: boolean;
  copyPercentage: number;
  maxTradeSize: number | null;
  dailyLimit: number | null;
}

// Get recent copy trades
export function getCopyTrades(limit = 50): CopyTrade[] {
  const trades = db.prepare(`
    SELECT
      id,
      user_id as userId,
      source_wallet as sourceWallet,
      market_title as marketTitle,
      side,
      size,
      price,
      status,
      created_at as createdAt,
      executed_at as executedAt
    FROM copy_trade_history
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as CopyTrade[];

  return trades;
}

// Get copy trading stats
export function getCopyTradingStats(): CopyTradingStats {
  const total = db.prepare('SELECT COUNT(*) as count FROM copy_trade_history').get() as { count: number };
  const executed = db.prepare("SELECT COUNT(*) as count FROM copy_trade_history WHERE status = 'executed'").get() as { count: number };
  const failed = db.prepare("SELECT COUNT(*) as count FROM copy_trade_history WHERE status = 'failed'").get() as { count: number };

  const volumeResult = db.prepare(`
    SELECT COALESCE(SUM(size * price), 0) as volume
    FROM copy_trade_history
    WHERE status = 'executed'
  `).get() as { volume: number };

  const todayStart = Math.floor(Date.now() / 1000) - 86400;
  const todayVolumeResult = db.prepare(`
    SELECT COALESCE(SUM(size * price), 0) as volume, COUNT(*) as count
    FROM copy_trade_history
    WHERE status = 'executed' AND created_at > ?
  `).get(todayStart) as { volume: number; count: number };

  return {
    totalTrades: total.count,
    executedTrades: executed.count,
    failedTrades: failed.count,
    totalVolume: volumeResult.volume,
    todayVolume: todayVolumeResult.volume,
    todayTrades: todayVolumeResult.count,
  };
}

// Get trading account info
export function getTradingAccount(): TradingAccount | null {
  const account = db.prepare(`
    SELECT
      wallet_address as walletAddress,
      proxy_address as proxyAddress,
      copy_enabled as copyEnabled,
      copy_percentage as copyPercentage,
      max_trade_size as maxTradeSize,
      daily_limit as dailyLimit
    FROM user_trading_wallets
    LIMIT 1
  `).get() as TradingAccount | null;

  return account;
}

export default db;

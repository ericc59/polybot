import { Database } from "bun:sqlite";
import { config } from "../config";
import type { WalletScore } from "./analyzer";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  // Ensure directory exists
  await mkdir(dirname(config.DB_PATH), { recursive: true });

  db = new Database(config.DB_PATH);

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      total_pnl REAL,
      win_rate REAL,
      total_trades INTEGER,
      avg_trade_size REAL,
      last_trade_at INTEGER,
      pnl_per_trade REAL,
      trade_frequency REAL,
      whale_type TEXT DEFAULT 'active',
      added_at INTEGER DEFAULT (strftime('%s', 'now')),
      enabled INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS seen_trades (
      trade_hash TEXT PRIMARY KEY,
      wallet TEXT,
      seen_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_seen_trades_wallet ON seen_trades(wallet)
  `);

  return db;
}

export async function addWallet(score: WalletScore): Promise<void> {
  const db = await getDb();

  db.run(
    `
    INSERT OR REPLACE INTO wallets (address, total_pnl, win_rate, total_trades, avg_trade_size, last_trade_at, pnl_per_trade, trade_frequency, whale_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      score.address.toLowerCase(),
      score.totalPnl,
      score.winRate,
      score.totalTrades,
      score.avgTradeSize,
      score.lastTradeAt,
      score.pnlPerTrade,
      score.tradeFrequency,
      score.whaleType,
    ]
  );
}

export async function removeWallet(address: string): Promise<void> {
  const db = await getDb();
  db.run("DELETE FROM wallets WHERE address = ?", [address.toLowerCase()]);
}

export async function getTrackedWallets(): Promise<
  Array<{
    address: string;
    totalPnl: number;
    winRate: number;
    totalTrades: number;
    whaleType: "active" | "dormant" | "sniper";
    enabled: boolean;
  }>
> {
  const db = await getDb();

  const rows = db
    .query(
      `
    SELECT address, total_pnl, win_rate, total_trades, whale_type, enabled
    FROM wallets
    WHERE enabled = 1
    ORDER BY total_pnl DESC
  `
    )
    .all() as Array<{
    address: string;
    total_pnl: number;
    win_rate: number;
    total_trades: number;
    whale_type: string;
    enabled: number;
  }>;

  return rows.map((r) => ({
    address: r.address,
    totalPnl: r.total_pnl,
    winRate: r.win_rate,
    totalTrades: r.total_trades,
    whaleType: (r.whale_type || "active") as "active" | "dormant" | "sniper",
    enabled: r.enabled === 1,
  }));
}

export async function hasSeenTrade(tradeHash: string): Promise<boolean> {
  const db = await getDb();
  const row = db.query("SELECT 1 FROM seen_trades WHERE trade_hash = ?").get(tradeHash);
  return row !== null;
}

export async function markTradeSeen(tradeHash: string, wallet: string): Promise<void> {
  const db = await getDb();
  db.run("INSERT OR IGNORE INTO seen_trades (trade_hash, wallet) VALUES (?, ?)", [
    tradeHash,
    wallet.toLowerCase(),
  ]);
}

export async function cleanOldSeenTrades(olderThanDays = 7): Promise<void> {
  const db = await getDb();
  const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;
  db.run("DELETE FROM seen_trades WHERE seen_at < ?", [cutoff]);
}

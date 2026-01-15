#!/usr/bin/env bun
/**
 * Refresh wallet cache with correct PnL data from leaderboard API
 */
import { Database } from "bun:sqlite";
import { analyzeWallet } from "../tracker/analyzer";

const db = new Database("./data/polybot.db");

// Get all tracked wallets
const wallets = db
  .query("SELECT DISTINCT wallet_address FROM user_wallets")
  .all() as { wallet_address: string }[];

console.log(`Found ${wallets.length} tracked wallets to refresh\n`);

for (const { wallet_address } of wallets) {
  try {
    console.log(`Refreshing ${wallet_address.slice(0, 10)}...`);
    const score = await analyzeWallet(wallet_address, 1);

    if (score) {
      // Update the cache
      db.run(
        `INSERT OR REPLACE INTO wallet_cache
         (address, total_pnl, win_rate, total_trades, avg_trade_size, last_trade_at, pnl_per_trade, trade_frequency, whale_type, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet_address.toLowerCase(),
          score.totalPnl,
          score.winRate,
          score.totalTrades,
          score.avgTradeSize,
          score.lastTradeAt,
          score.pnlPerTrade,
          score.tradeFrequency,
          score.whaleType,
          Math.floor(Date.now() / 1000),
        ]
      );
      console.log(`  -> PnL: $${score.totalPnl.toLocaleString()}, Win: ${(score.winRate * 100).toFixed(0)}%`);
    } else {
      console.log(`  -> No data available`);
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  } catch (error) {
    console.error(`  -> Error: ${error}`);
  }
}

console.log("\nDone!");
db.close();

import { getTrades, type Trade } from "../api/polymarket";
import * as walletRepo from "../db/repositories/wallet.repo";
import { dispatchAlerts, generateTradeHash, cleanupOldData } from "./alert.service";
import { analyzeWallet } from "../tracker/analyzer";
import { config } from "../config";
import { logger } from "../utils/logger";

// Global set to track recently processed trades (in-memory cache)
const recentlyProcessed = new Set<string>();
const MAX_CACHE_SIZE = 10000;

// Monitor service state
let isRunning = false;
let pollCount = 0;

// Start the multi-user monitor
export async function startMonitor(): Promise<void> {
  if (isRunning) {
    logger.warn("Monitor already running");
    return;
  }

  isRunning = true;
  logger.info("Starting multi-user monitor service...");

  // Initial seed pass - mark existing trades as seen
  await pollAllWallets(true);

  logger.info("Initial seed complete, starting monitoring loop...");

  // Main polling loop
  while (isRunning) {
    try {
      await pollAllWallets(false);
      pollCount++;

      // Periodic cleanup every 100 polls
      if (pollCount % 100 === 0) {
        await cleanupOldData();
        clearOldCache();
      }
    } catch (error) {
      logger.error("Monitor poll error", error);
    }

    await Bun.sleep(config.POLL_INTERVAL_MS);
  }
}

// Stop the monitor
export function stopMonitor(): void {
  isRunning = false;
  logger.info("Monitor stopped");
}

// Poll all tracked wallets for new trades
async function pollAllWallets(isSeedPass: boolean): Promise<void> {
  // Get all unique wallet addresses being tracked by any user
  const walletAddresses = await walletRepo.getAllTrackedWalletAddresses();

  if (walletAddresses.length === 0) {
    if (!isSeedPass) {
      logger.debug("No wallets to monitor");
    }
    return;
  }

  logger.debug(`Polling ${walletAddresses.length} wallets...`);

  for (const address of walletAddresses) {
    try {
      await pollWallet(address, isSeedPass);
      // Small delay between wallets to avoid rate limiting
      await Bun.sleep(100);
    } catch (error) {
      logger.error(`Error polling wallet ${address.slice(0, 10)}...`, error);
    }
  }
}

// Poll a single wallet for new trades
async function pollWallet(address: string, isSeedPass: boolean): Promise<void> {
  // Fetch recent trades
  const trades = await getTrades({ user: address, limit: 20 });

  if (trades.length === 0) return;

  // Get wallet stats from cache or analyze
  let walletStats = await walletRepo.getWalletFromCache(address);

  // Refresh cache if stale or missing
  if (!walletStats || (await walletRepo.isCacheStale(address, 60))) {
    const freshStats = await analyzeWallet(address, 3);
    if (freshStats) {
      await walletRepo.updateWalletCache(address, freshStats);
      walletStats = await walletRepo.getWalletFromCache(address);
    }
  }

  if (!walletStats) {
    logger.warn(`No stats available for wallet ${address.slice(0, 10)}...`);
    return;
  }

  // Process each trade
  for (const trade of trades) {
    const tradeHash = generateTradeHash(trade);

    // Skip if recently processed (in-memory dedup)
    if (recentlyProcessed.has(tradeHash)) {
      continue;
    }

    // Mark as processed
    recentlyProcessed.add(tradeHash);

    // If seed pass, just mark as seen without dispatching
    if (isSeedPass) {
      continue;
    }

    // Dispatch alerts to all subscribed users
    await dispatchAlerts({
      walletAddress: address,
      trade,
      walletStats: {
        address: walletStats.address,
        totalPnl: walletStats.total_pnl,
        realizedPnl: 0,
        unrealizedPnl: 0,
        winRate: walletStats.win_rate,
        totalTrades: walletStats.total_trades,
        winningTrades: 0,
        losingTrades: 0,
        avgTradeSize: walletStats.avg_trade_size,
        lastTradeAt: walletStats.last_trade_at,
        daysSinceLastTrade: 0,
        pnlPerTrade: walletStats.pnl_per_trade,
        tradeFrequency: walletStats.trade_frequency,
        whaleType: walletStats.whale_type as "active" | "dormant" | "sniper",
      },
    });
  }
}

// Clear old entries from in-memory cache
function clearOldCache(): void {
  if (recentlyProcessed.size > MAX_CACHE_SIZE) {
    const toRemove = recentlyProcessed.size - MAX_CACHE_SIZE / 2;
    const iterator = recentlyProcessed.values();
    for (let i = 0; i < toRemove; i++) {
      const next = iterator.next();
      if (next.done) break;
      recentlyProcessed.delete(next.value);
    }
    logger.debug(`Cleared ${toRemove} entries from trade cache`);
  }
}

// Get monitor status
export function getMonitorStatus(): {
  isRunning: boolean;
  pollCount: number;
  cacheSize: number;
} {
  return {
    isRunning,
    pollCount,
    cacheSize: recentlyProcessed.size,
  };
}

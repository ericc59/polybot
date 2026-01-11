import { getTrades, type Trade } from "../api/polymarket";
import { getTrackedWallets, hasSeenTrade, markTradeSeen } from "./db";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface NewTrade {
  wallet: string;
  walletPnl: number;
  walletWinRate: number;
  whaleType: "active" | "dormant" | "sniper";
  trade: Trade;
}

let lastPollTime = 0;

export async function pollForNewTrades(): Promise<NewTrade[]> {
  const wallets = await getTrackedWallets();

  if (wallets.length === 0) {
    return [];
  }

  const newTrades: NewTrade[] = [];
  let totalNewTrades = 0;

  for (const wallet of wallets) {
    try {
      // Get recent trades for this wallet
      const trades = await getTrades({
        user: wallet.address,
        limit: 20,
      });

      for (const trade of trades) {
        // Generate a unique hash for this trade
        const tradeHash = `${trade.transactionHash}-${trade.asset}-${trade.side}`;

        // Skip if we've already seen this trade
        if (await hasSeenTrade(tradeHash)) {
          continue;
        }

        // Mark as seen
        await markTradeSeen(tradeHash, wallet.address);

        // Only alert on trades after the first poll
        if (lastPollTime > 0) {
          const tradeSize = parseFloat(trade.size) * parseFloat(trade.price);

          // Skip small trades (unless from dormant whales - their trades are always notable)
          if (tradeSize < config.MIN_TRADE_SIZE && wallet.whaleType === "active") {
            continue;
          }

          // Skip sports markets
          const slug = (trade.slug || "").toLowerCase();
          const title = (trade.title || "").toLowerCase();
          const isSports =
            slug.startsWith("nba-") ||
            slug.startsWith("nfl-") ||
            slug.startsWith("nhl-") ||
            slug.startsWith("mlb-") ||
            slug.startsWith("epl-") ||
            slug.startsWith("ucl-") ||
            slug.startsWith("mls-") ||
            slug.startsWith("ufc-") ||
            slug.includes("-vs-") ||
            title.includes(" vs ") ||
            title.includes(" vs. ");

          if (isSports) {
            continue;
          }

          newTrades.push({
            wallet: wallet.address,
            walletPnl: wallet.totalPnl,
            walletWinRate: wallet.winRate,
            whaleType: wallet.whaleType,
            trade,
          });
          totalNewTrades++;

          logger.alert(
            wallet.address,
            trade.title || "Unknown Market",
            trade.side,
            tradeSize
          );
        }
      }

      // Rate limit between wallet queries
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      logger.error(`Failed to poll wallet ${wallet.address}`, error);
    }
  }

  lastPollTime = Date.now();
  logger.poll(wallets.length, totalNewTrades);

  return newTrades;
}

export function formatTradeAlert(newTrade: NewTrade): string {
  const { wallet, walletPnl, walletWinRate, whaleType, trade } = newTrade;
  const usdValue = parseFloat(trade.size) * parseFloat(trade.price);

  const sideEmoji = trade.side === "BUY" ? "🟢" : "🔴";

  // Special badges for trader types
  const typeLabel = {
    active: "🐋 WHALE",
    dormant: "💤 DORMANT WHALE",
    sniper: "🎯 SNIPER",
  };

  const urgency = whaleType === "dormant" ? "🚨 " : whaleType === "sniper" ? "⚡ " : "";

  return [
    `${urgency}${sideEmoji} *${typeLabel[whaleType]} ALERT*`,
    ``,
    `*Market:* ${trade.title}`,
    `*Outcome:* ${trade.outcome}`,
    `*Side:* ${trade.side}`,
    `*Size:* $${usdValue.toFixed(2)}`,
    `*Price:* ${(parseFloat(trade.price) * 100).toFixed(1)}¢`,
    ``,
    `*Trader Stats:*`,
    `• Total PnL: $${walletPnl.toFixed(0)}`,
    `• Win Rate: ${(walletWinRate * 100).toFixed(1)}%`,
    `• Wallet: \`${wallet.slice(0, 10)}...\``,
    ``,
    `[View on Polymarket](https://polymarket.com/event/${trade.slug})`,
  ].join("\n");
}

export async function startMonitoring(onNewTrade: (trade: NewTrade) => Promise<void>): Promise<void> {
  logger.info(`Starting trade monitor (interval: ${config.POLL_INTERVAL_MS}ms)`);

  // Initial poll to mark existing trades as seen
  await pollForNewTrades();
  logger.info("Initial poll complete, now watching for new trades...");

  while (true) {
    try {
      const newTrades = await pollForNewTrades();

      for (const trade of newTrades) {
        await onNewTrade(trade);
      }
    } catch (error) {
      logger.error("Monitor error", error);
    }

    await new Promise((r) => setTimeout(r, config.POLL_INTERVAL_MS));
  }
}

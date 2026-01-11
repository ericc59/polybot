import { sendMessage, createInlineKeyboard } from "../telegram/index";
import * as walletRepo from "../db/repositories/wallet.repo";
import * as alertRepo from "../db/repositories/alert.repo";
import { logger } from "../utils/logger";
import type { Trade } from "../api/polymarket";
import type { WalletScore } from "../tracker/analyzer";

export interface TradeEvent {
  walletAddress: string;
  trade: Trade;
  walletStats: WalletScore;
}

// Generate unique hash for a trade
export function generateTradeHash(trade: Trade): string {
  return `${trade.transactionHash}-${trade.id}`;
}

// Detect market category from slug/title
export function detectCategory(slug: string, title: string): string {
  const s = slug.toLowerCase();
  const t = title.toLowerCase();

  // Sports
  if (
    s.match(/^(nba|nfl|nhl|mlb|epl|ucl|mls|ufc)-/) ||
    s.includes("-vs-") ||
    t.includes(" vs ") ||
    t.includes(" vs. ")
  ) {
    return "sports";
  }

  // Politics
  if (s.includes("election") || s.includes("trump") || s.includes("biden") || t.includes("election")) {
    return "politics";
  }

  // Crypto
  if (s.includes("bitcoin") || s.includes("ethereum") || s.includes("btc") || s.includes("eth") || t.includes("crypto")) {
    return "crypto";
  }

  return "other";
}

// Check if user should receive alert based on their settings
function shouldAlertUser(
  subscriber: walletRepo.WalletSubscriber,
  event: TradeEvent
): { should: boolean; reason?: string } {
  const tradeSize = parseFloat(event.trade.size) * parseFloat(event.trade.price);

  // Check trade size threshold
  const minTradeSize = subscriber.minTradeSizeOverride ?? subscriber.minTradeSize;
  if (tradeSize < minTradeSize) {
    return { should: false, reason: "Trade too small" };
  }

  // Check category filters
  const excludedCategories = JSON.parse(subscriber.categoriesExclude || "[]") as string[];
  const category = detectCategory(event.trade.slug || "", event.trade.title || "");
  if (excludedCategories.includes(category)) {
    return { should: false, reason: `Category ${category} excluded` };
  }

  // Check side filters
  if (event.trade.side === "BUY" && !subscriber.alertOnBuy) {
    return { should: false, reason: "Buy alerts disabled" };
  }
  if (event.trade.side === "SELL" && !subscriber.alertOnSell) {
    return { should: false, reason: "Sell alerts disabled" };
  }

  // Check whale type filters
  const whaleType = event.walletStats.whaleType;
  if (whaleType === "active" && !subscriber.alertWhaleTypeActive) {
    return { should: false, reason: "Active whale alerts disabled" };
  }
  if (whaleType === "dormant" && !subscriber.alertWhaleTypeDormant) {
    return { should: false, reason: "Dormant whale alerts disabled" };
  }
  if (whaleType === "sniper" && !subscriber.alertWhaleTypeSniper) {
    return { should: false, reason: "Sniper alerts disabled" };
  }

  // Check quiet hours (UTC)
  if (subscriber.quietHoursStart !== null && subscriber.quietHoursEnd !== null) {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const start = subscriber.quietHoursStart;
    const end = subscriber.quietHoursEnd;

    // Handle overnight quiet hours (e.g., 23:00 - 07:00)
    if (start > end) {
      if (currentHour >= start || currentHour < end) {
        return { should: false, reason: "Quiet hours" };
      }
    } else if (currentHour >= start && currentHour < end) {
      return { should: false, reason: "Quiet hours" };
    }
  }

  return { should: true };
}

// Format alert message for user
function formatAlertMessage(
  subscriber: walletRepo.WalletSubscriber,
  event: TradeEvent
): string {
  const { trade, walletStats } = event;
  const tradeSize = parseFloat(trade.size) * parseFloat(trade.price);

  // Determine urgency based on trade size
  let urgency = "";
  if (tradeSize >= 10000) urgency = "!!!";
  else if (tradeSize >= 5000) urgency = "!!";
  else if (tradeSize >= 1000) urgency = "!";

  const sideEmoji = trade.side === "BUY" ? "BUY" : "SELL";
  const typeLabel = {
    active: "WHALE",
    dormant: "DORMANT WHALE",
    sniper: "SNIPER",
  };

  const walletName = subscriber.customName || subscriber.walletAddress.slice(0, 10) + "...";
  const pnl = subscriber.walletPnl ? `$${subscriber.walletPnl.toFixed(0)}` : "N/A";
  const winRate = subscriber.walletWinRate ? `${(subscriber.walletWinRate * 100).toFixed(0)}%` : "N/A";

  const lines = [
    `${urgency} *${sideEmoji}* - ${typeLabel[walletStats.whaleType]}`,
    ``,
    `*Market:* ${trade.title}`,
    `*Outcome:* ${trade.outcome}`,
    `*Size:* $${tradeSize.toFixed(0)} @ ${(parseFloat(trade.price) * 100).toFixed(0)}c`,
    ``,
    `*Trader:* ${walletName}`,
    `*PnL:* ${pnl} | *Win:* ${winRate}`,
  ];

  // Add category expertise (top 2 profitable categories)
  if (walletStats.categoryBreakdown && walletStats.categoryBreakdown.length > 0) {
    const topCategories = walletStats.categoryBreakdown
      .filter((cat) => cat.pnl > 0)
      .slice(0, 2)
      .map((cat) => `${cat.category} +$${(cat.pnl / 1000).toFixed(0)}k`)
      .join(", ");
    if (topCategories) {
      lines.push(`*Expertise:* ${topCategories}`);
    }
  }

  // Add taker ratio if significant
  if (walletStats.takerRatio !== undefined) {
    const takerPct = (walletStats.takerRatio * 100).toFixed(0);
    lines.push(`*Style:* ${walletStats.takerRatio >= 0.7 ? "Aggressive" : walletStats.takerRatio <= 0.3 ? "Patient" : "Mixed"} (${takerPct}% taker)`);
  }

  // Add Polymarket link
  if (trade.slug) {
    lines.push(`\n[View Market](https://polymarket.com/event/${trade.slug})`);
  }

  return lines.join("\n");
}

// Dispatch alerts to all subscribed users for a trade
export async function dispatchAlerts(event: TradeEvent): Promise<number> {
  const subscribers = await walletRepo.getWalletSubscribers(event.walletAddress);

  if (subscribers.length === 0) {
    return 0;
  }

  const tradeHash = generateTradeHash(event.trade);
  let sent = 0;

  for (const subscriber of subscribers) {
    try {
      // Check if user already saw this trade
      const alreadySeen = await alertRepo.hasUserSeenTrade(subscriber.userId, tradeHash);
      if (alreadySeen) {
        continue;
      }

      // Check rate limit
      const isLimited = await alertRepo.isRateLimited(subscriber.userId, subscriber.maxAlertsPerHour);
      if (isLimited) {
        logger.warn(`Rate limited user ${subscriber.userId}`);
        continue;
      }

      // Check user settings
      const { should, reason } = shouldAlertUser(subscriber, event);
      if (!should) {
        logger.debug(`Skipping alert for user ${subscriber.userId}: ${reason}`);
        continue;
      }

      // Format and send message
      const message = formatAlertMessage(subscriber, event);

      // Create action buttons
      const keyboard = createInlineKeyboard([
        [
          {
            text: "View on Polymarket",
            url: `https://polymarket.com/event/${event.trade.slug || ""}`,
          },
        ],
      ]);

      const sentMsg = await sendMessage(subscriber.telegramChatId, message, {
        parseMode: "Markdown",
        replyMarkup: keyboard,
      });

      // Mark as seen and log
      await alertRepo.markTradeSeen(subscriber.userId, tradeHash, event.walletAddress);
      await alertRepo.logAlert({
        userId: subscriber.userId,
        walletAddress: event.walletAddress,
        tradeHash,
        marketTitle: event.trade.title,
        tradeSide: event.trade.side,
        tradeSize: parseFloat(event.trade.size) * parseFloat(event.trade.price),
        tradePrice: parseFloat(event.trade.price),
        telegramMessageId: sentMsg.message_id.toString(),
      });

      sent++;
    } catch (error) {
      logger.error(`Failed to send alert to user ${subscriber.userId}`, error);
    }
  }

  if (sent > 0) {
    logger.info(`Dispatched ${sent} alerts for trade ${tradeHash.slice(0, 16)}...`);
  }

  return sent;
}

// Cleanup old data (call periodically)
export async function cleanupOldData(): Promise<void> {
  const seenCleaned = await alertRepo.cleanupOldSeenTrades(7);
  const historyCleaned = await alertRepo.cleanupOldAlertHistory(30);

  if (seenCleaned > 0 || historyCleaned > 0) {
    logger.info(`Cleanup: ${seenCleaned} seen trades, ${historyCleaned} alert history records`);
  }
}

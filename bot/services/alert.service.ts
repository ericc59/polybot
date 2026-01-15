import { sendMessage, createInlineKeyboard } from "../telegram/index";
import * as walletRepo from "../db/repositories/wallet.repo";
import * as alertRepo from "../db/repositories/alert.repo";
import * as copyService from "./copy.service";
import * as paperService from "./paper.service";
import { config } from "../config";
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

// Copy trade result info for channel message
interface CopyTradeResult {
  executed: number;
  totalCopySize: number;  // Total $ amount of copy trades executed
  recommended: number;
  fillPrice?: number;     // Price we got on our copy trade
}

// Format message for channel broadcast (public-facing, no user-specific data)
function formatChannelMessage(event: TradeEvent, copyResult?: CopyTradeResult): string {
  const { trade, walletStats } = event;
  const tradeSize = parseFloat(trade.size) * parseFloat(trade.price);

  // Determine size indicator
  let sizeIndicator = "";
  if (tradeSize >= 50000) sizeIndicator = "🐋🐋🐋";
  else if (tradeSize >= 10000) sizeIndicator = "🐋🐋";
  else if (tradeSize >= 5000) sizeIndicator = "🐋";
  else if (tradeSize >= 1000) sizeIndicator = "💰";

  const sideEmoji = trade.side === "BUY" ? "🟢" : "🔴";
  const typeEmoji = walletStats?.whaleType ? {
    active: "🔥",
    dormant: "💤",
    sniper: "🎯",
  }[walletStats.whaleType] || "👀" : "👀";

  const shortAddr = event.walletAddress.slice(0, 6) + "..." + event.walletAddress.slice(-4);

  // Safe access to wallet stats
  const pnl = walletStats?.totalPnl ?? 0;
  const winRate = walletStats?.winRate ?? 0;

  const lines = [
    `${sideEmoji} *${trade.side}* ${sizeIndicator}`,
    ``,
    `*${trade.title}*`,
    `Outcome: ${trade.outcome}`,
    `Whale: *$${tradeSize.toLocaleString()}* @ ${(parseFloat(trade.price) * 100).toFixed(0)}¢`,
  ];

  // Add copy trade info if we executed any
  if (copyResult && copyResult.executed > 0) {
    const copyPriceStr = copyResult.fillPrice
      ? ` @ ${(copyResult.fillPrice * 100).toFixed(0)}¢`
      : "";
    lines.push(`📋 Copied: *$${copyResult.totalCopySize.toFixed(2)}*${copyPriceStr}`);
  }

  lines.push(``);
  lines.push(`${typeEmoji} Trader: \`${shortAddr}\``);
  lines.push(`PnL: $${pnl.toLocaleString()} | Win: ${(winRate * 100).toFixed(0)}%`);

  if (trade.slug) {
    lines.push(`\n[View on Polymarket](https://polymarket.com/event/${trade.slug})`);
  }

  return lines.join("\n");
}

// Post trade to the public channel/group (if configured)
async function postToChannel(event: TradeEvent, copyResult?: CopyTradeResult): Promise<boolean> {
  if (!config.TELEGRAM_CHAT_ID) {
    return false;
  }

  try {
    const message = formatChannelMessage(event, copyResult);

    const keyboard = createInlineKeyboard([
      [
        {
          text: "View Market",
          url: `https://polymarket.com/event/${event.trade.slug || ""}`,
        },
      ],
    ]);

    await sendMessage(config.TELEGRAM_CHAT_ID, message, {
      parseMode: "Markdown",
      replyMarkup: keyboard,
    });

    logger.debug(`Posted trade to channel: ${event.trade.title?.slice(0, 30)}...`);
    return true;
  } catch (error) {
    logger.error("Failed to post to channel", error);
    return false;
  }
}

// Dispatch alerts to all subscribed users for a trade
export async function dispatchAlerts(event: TradeEvent): Promise<number> {
  const subscribers = await walletRepo.getWalletSubscribers(event.walletAddress);
  const tradeHash = generateTradeHash(event.trade);
  let sent = 0;

  // Process copy trades FIRST so we know the copy amounts for the channel message
  let copyResult: CopyTradeResult | undefined;
  try {
    const copyStats = await copyService.processCopyTrade(event.walletAddress, event.trade, tradeHash);
    if (copyStats.recommended > 0 || copyStats.executed > 0) {
      logger.info(`Copy trading: ${copyStats.recommended} recommended, ${copyStats.executed} executed, ${copyStats.failed} failed`);
    }
    copyResult = {
      executed: copyStats.executed,
      totalCopySize: copyStats.totalCopySize,
      recommended: copyStats.recommended,
      fillPrice: copyStats.fillPrice,
    };
  } catch (error) {
    logger.error("Failed to process copy trades", error);
  }

  // Only post to channel if a copy trade was executed
  if (copyResult && copyResult.executed > 0) {
    await postToChannel(event, copyResult);
  }

  for (const subscriber of subscribers) {
    try {
      // Check if user already saw this trade
      const alreadySeen = await alertRepo.hasUserSeenTrade(subscriber.userId, tradeHash);
      if (alreadySeen) {
        continue;
      }

      // Check hourly rate limit
      const isHourlyLimited = await alertRepo.isRateLimited(subscriber.userId, subscriber.maxAlertsPerHour);
      if (isHourlyLimited) {
        logger.warn(`Hourly rate limited user ${subscriber.userId}`);
        continue;
      }

      // Check daily tier limit
      const isDailyLimited = await alertRepo.isDailyLimitExceeded(subscriber.userId, subscriber.tierMaxAlertsPerDay);
      if (isDailyLimited) {
        logger.warn(`Daily tier limit exceeded for user ${subscriber.userId}`);
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

      // Create action buttons with copy trade link
      const tradeSize = parseFloat(event.trade.size) * parseFloat(event.trade.price);
      const copyText = `Copy $${tradeSize.toFixed(0)} ${event.trade.side}`;

      const keyboard = createInlineKeyboard([
        [
          {
            text: "View on Polymarket",
            url: `https://polymarket.com/event/${event.trade.slug || ""}`,
          },
        ],
        [
          {
            text: copyText,
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

  // Process paper trades for users simulating this wallet
  try {
    const paperStats = await paperService.processPaperTradesForWallet(event.walletAddress, event.trade);
    if (paperStats.processed > 0 || paperStats.failed > 0) {
      logger.info(`Paper trading: ${paperStats.processed} processed, ${paperStats.failed} failed`);
    }
  } catch (error) {
    logger.error("Failed to process paper trades", error);
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

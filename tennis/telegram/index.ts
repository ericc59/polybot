import { tennisConfig } from "../config";
import { logger } from "../../lib/logger";
import { sendMessage as mainBotSendMessage } from "../../bot/telegram";
import * as userRepo from "../../bot/db/repositories/user.repo";

// Telegram API for tennis bot commands (polling uses tennis bot token)
const TELEGRAM_API = `https://api.telegram.org/bot${tennisConfig.TELEGRAM_BOT_TOKEN}`;

/**
 * Call Telegram API (tennis bot)
 */
async function callTelegram(method: string, params: Record<string, any>): Promise<any> {
  try {
    const response = await fetch(`${TELEGRAM_API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error(`Telegram ${method} error`, error);
    return null;
  }
}

/**
 * Send a message to a chat (uses main bot's Telegram token for notifications,
 * tennis bot token for command responses with buttons)
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: { parse_mode?: "HTML" | "Markdown"; reply_markup?: any }
): Promise<boolean> {
  try {
    // If reply_markup is present (buttons), use tennis bot's direct API
    // Otherwise use main bot for notifications
    if (options?.reply_markup) {
      const result = await callTelegram("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: options?.parse_mode || "HTML",
        reply_markup: options.reply_markup,
      });
      return result?.ok === true;
    }

    await mainBotSendMessage(String(chatId), text, { parseMode: options?.parse_mode || "HTML" });
    return true;
  } catch (error) {
    logger.error("Telegram sendMessage error", error);
    return false;
  }
}

/**
 * Send message to user 1's chat (same destination as sports bot notifications)
 */
export async function broadcastToAdmins(text: string): Promise<void> {
  try {
    // Use user 1's telegram chat ID - same as sports betting notifications
    const user = await userRepo.findById(1);
    if (user?.telegram_chat_id) {
      logger.debug(`Tennis notification -> chat ${user.telegram_chat_id}`);
      await sendMessage(user.telegram_chat_id, text);
    } else {
      logger.warn("User 1 has no telegram_chat_id set, falling back to ADMIN_CHAT_IDS");
      // Fallback to configured admin chat IDs
      for (const chatId of tennisConfig.ADMIN_CHAT_IDS) {
        await sendMessage(chatId, text);
      }
    }
  } catch (error) {
    logger.error("Failed to broadcast to admins", error);
  }
}

/**
 * Check if a chat ID is an admin
 */
export function isAdmin(chatId: string | number): boolean {
  return tennisConfig.ADMIN_CHAT_IDS.includes(String(chatId));
}

/**
 * Get updates (for polling mode)
 */
export async function getUpdates(offset?: number): Promise<any[]> {
  const params: Record<string, any> = { timeout: 30 };
  if (offset) {
    params.offset = offset;
  }

  const result = await callTelegram("getUpdates", params);
  return result?.result || [];
}

/**
 * Answer a callback query (button press acknowledgement)
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
  const result = await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
  return result?.ok === true;
}

/**
 * Format a match for display
 */
export function formatMatch(match: {
  id: number;
  player1: string;
  player2: string;
  commenceTime: number;
  status: string;
  polymarketConditionId?: string | null;
}): string {
  const time = new Date(match.commenceTime * 1000).toLocaleString();
  const marketStatus = match.polymarketConditionId ? "✅ Market linked" : "❌ No market";

  return `
<b>#${match.id}</b>: ${match.player1} vs ${match.player2}
📅 ${time}
📊 Status: <code>${match.status}</code>
🔗 ${marketStatus}`.trim();
}

/**
 * Format balance for display
 */
export function formatBalance(balance: number): string {
  return `💰 Balance: <b>$${balance.toFixed(2)}</b>`;
}

/**
 * Send walkover alert with full detection context
 */
export async function sendWalkoverAlert(
  player1: string,
  player2: string,
  reason: string,
  confidence: string,
  context?: {
    consecutiveMissing?: number;
    requiredMissing?: number;
    minutesUntilStart?: number;
  }
): Promise<void> {
  // Format the reason in a human-readable way
  let reasonText = reason;
  let triggerDetails = "";

  if (reason === "disappeared_before_start") {
    reasonText = "Match disappeared from Odds API";
    if (context?.consecutiveMissing && context?.requiredMissing) {
      triggerDetails = `\n📊 Missing: ${context.consecutiveMissing}/${context.requiredMissing} polls`;
    }
  } else if (reason === "completed_no_scores") {
    reasonText = "Match marked completed with no scores";
  } else if (reason === "manual") {
    reasonText = "Manually triggered";
  }

  // Format time until start
  let timeText = "";
  if (context?.minutesUntilStart !== undefined) {
    const mins = context.minutesUntilStart;
    if (mins < 60) {
      timeText = `\n⏰ Time until start: ${mins} minutes`;
    } else {
      timeText = `\n⏰ Time until start: ${(mins / 60).toFixed(1)} hours`;
    }
  }

  const message = `
🚨 <b>WALKOVER DETECTED</b> 🚨

🎾 ${player1} vs ${player2}
📋 Trigger: ${reasonText}
🎯 Confidence: <b>${confidence.toUpperCase()}</b>${triggerDetails}${timeText}

Orders will be placed automatically if trading is enabled.`.trim();

  await broadcastToAdmins(message);
}

/**
 * Send notification when a match is missing from the API
 * Shows progress towards walkover detection threshold
 */
export async function sendMissingPollAlert(
  player1: string,
  player2: string,
  consecutiveMissing: number,
  requiredForDetection: number,
  minutesUntilStart: number
): Promise<void> {
  // Format time until start
  let timeText: string;
  if (minutesUntilStart < 60) {
    timeText = `${minutesUntilStart} minutes`;
  } else {
    timeText = `${(minutesUntilStart / 60).toFixed(1)} hours`;
  }

  const progressBar = "🟠".repeat(consecutiveMissing) + "⚪".repeat(Math.max(0, requiredForDetection - consecutiveMissing));

  const message = `
⚠️ <b>MATCH MISSING FROM API</b>

🎾 ${player1} vs ${player2}
📊 Progress: ${consecutiveMissing}/${requiredForDetection} polls
${progressBar}
⏰ Start: ${timeText}

${consecutiveMissing >= requiredForDetection - 1 ? "⚡ Next poll may trigger walkover detection!" : "Monitoring..."}`.trim();

  await broadcastToAdmins(message);
}

/**
 * Send order placed notification
 */
export async function sendOrderPlacedNotification(
  player1: string,
  player2: string,
  player1OrderId: string | undefined,
  player2OrderId: string | undefined
): Promise<void> {
  const message = `
✅ <b>ORDERS PLACED</b>

🎾 ${player1} vs ${player2}
📝 ${player1}: ${player1OrderId || "FAILED"}
📝 ${player2}: ${player2OrderId || "FAILED"}

Both orders at $0.49 → settle at $0.50`.trim();

  await broadcastToAdmins(message);
}

/**
 * Post walkover detection to the public channel (like sports bets and copy trades)
 */
export async function postWalkoverToChannel(
  player1: string,
  player2: string,
  reason: string,
  confidence: string,
  ordersPlaced: boolean
): Promise<void> {
  const channelId = process.env.TELEGRAM_CHAT_ID;
  if (!channelId) return;

  try {
    // Format the reason in a human-readable way
    let reasonText = reason;
    if (reason === "disappeared_before_start") {
      reasonText = "Match disappeared from API";
    } else if (reason === "completed_no_scores") {
      reasonText = "Completed with no scores";
    } else if (reason === "manual") {
      reasonText = "Manual trigger";
    }

    const statusEmoji = ordersPlaced ? "✅" : "⚠️";
    const statusText = ordersPlaced ? "Orders placed" : "Pending verification";

    const message = [
      `🎾 *Tennis Walkover Detected* 🚨`,
      ``,
      `*${player1} vs ${player2}*`,
      ``,
      `📋 Trigger: ${reasonText}`,
      `🎯 Confidence: *${confidence.toUpperCase()}*`,
      `${statusEmoji} Status: ${statusText}`,
    ].join("\n");

    await mainBotSendMessage(channelId, message, { parseMode: "Markdown" });
    logger.debug(`Posted walkover to channel: ${player1} vs ${player2}`);
  } catch (error) {
    logger.error("Failed to post walkover to channel", error);
  }
}

import { logger } from "../../lib/logger";
import * as telegram from "./index";
import * as monitor from "../services/monitor.service";
import * as trading from "../services/trading.service";
import * as oddsApi from "../services/odds-api.service";
import * as marketFinder from "../services/market-finder.service";
import * as twitter from "../services/twitter.service";

interface TelegramMessage {
  message_id: number;
  from?: { id: number; username?: string };
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Handle incoming Telegram update
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // Handle callback queries (button presses)
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  // Check admin access
  if (!telegram.isAdmin(chatId)) {
    await telegram.sendMessage(chatId, "⛔ Unauthorized. This bot is admin-only.");
    return;
  }

  // Parse command
  const [command, ...args] = text.split(/\s+/);

  try {
    switch (command) {
      case "/start":
      case "/help":
        await handleHelp(chatId);
        break;

      case "/status":
        await handleStatus(chatId);
        break;

      case "/matches":
        await handleMatches(chatId);
        break;

      case "/scan":
        await handleScan(chatId);
        break;

      case "/add":
        await handleAdd(chatId, args);
        break;

      case "/remove":
        await handleRemove(chatId, args);
        break;

      case "/detect":
        await handleDetect(chatId, args);
        break;

      case "/reset":
        await handleReset(chatId, args);
        break;

      case "/orders":
        await handleOrders(chatId);
        break;

      case "/balance":
        await handleBalance(chatId);
        break;

      case "/connect":
        await handleConnect(chatId, args);
        break;

      case "/disconnect":
        await handleDisconnect(chatId);
        break;

      case "/link":
        await handleLink(chatId, args);
        break;

      case "/linkall":
        await handleLinkAll(chatId);
        break;

      case "/analyze":
        await handleAnalyze(chatId, args);
        break;

      case "/sweep":
        await handleSweep(chatId, args);
        break;

      case "/twitter":
        await handleTwitter(chatId, args);
        break;

      default:
        await telegram.sendMessage(chatId, `Unknown command: ${command}\nUse /help for available commands.`);
    }
  } catch (error) {
    logger.error(`Command error: ${command}`, error);
    await telegram.sendMessage(chatId, `❌ Error executing command: ${(error as Error).message}`);
  }
}

async function handleHelp(chatId: number): Promise<void> {
  const help = `
🎾 <b>Tennis Walkover Bot</b>

<b>Monitoring Commands:</b>
/status - Bot status
/matches - List tracked matches
/scan - Scan for new matches

<b>Match Management:</b>
/add &lt;odds_id&gt; - Track a match
/remove &lt;match_id&gt; - Stop tracking
/link &lt;match_id&gt; &lt;condition_id&gt; - Link Polymarket market
/linkall - Sync all Polymarket events

<b>Trading Commands:</b>
/analyze &lt;match_id&gt; - Analyze order book opportunity
/sweep &lt;match_id&gt; - Execute walkover sweep (LIVE TRADE!)
/detect &lt;match_id&gt; - Manual walkover trigger
/reset &lt;match_id&gt; - Reset match to pending
/orders - List open orders
/balance - Check wallet balance
/connect &lt;private_key&gt; [proxy] - Connect wallet
/disconnect - Remove wallet

<b>Twitter Detection:</b>
/twitter - Twitter polling status
/twitter test &lt;text&gt; - Test parsing a tweet

<b>Strategy:</b>
On walkover → sweep order book up to $0.49
All shares settle at $0.50 = instant profit`.trim();

  await telegram.sendMessage(chatId, help);
}

async function handleStatus(chatId: number): Promise<void> {
  const status = monitor.getStatus();
  const rateLimit = oddsApi.getRateLimitStatus();

  const message = `
📊 <b>Bot Status</b>

🔄 Monitor: ${status.running ? "✅ Running" : "❌ Stopped"}
📈 Poll Count: ${status.pollCount}
⏰ Last Poll: ${status.lastPollTime ? new Date(status.lastPollTime).toLocaleTimeString() : "Never"}
🎾 Tracked Matches: ${status.trackedMatches}
💳 Trading Ready: ${status.tradingReady ? "✅" : "❌"}

<b>API Rate Limits:</b>
Remaining: ${rateLimit.remaining}
Used: ${rateLimit.used}`.trim();

  await telegram.sendMessage(chatId, message);
}

async function handleMatches(chatId: number): Promise<void> {
  const matches = monitor.getTrackedMatches();

  if (matches.length === 0) {
    await telegram.sendMessage(chatId, "No matches currently tracked.\nUse /scan to find matches.");
    return;
  }

  let message = `🎾 <b>Tracked Matches (${matches.length})</b>\n\n`;

  for (const match of matches.slice(0, 10)) {
    message += telegram.formatMatch(match) + "\n\n";
  }

  if (matches.length > 10) {
    message += `<i>...and ${matches.length - 10} more</i>`;
  }

  await telegram.sendMessage(chatId, message);
}

async function handleScan(chatId: number): Promise<void> {
  await telegram.sendMessage(chatId, "🔍 Scanning for tennis matches...");

  const count = await monitor.autoTrackUpcomingMatches();

  await telegram.sendMessage(
    chatId,
    `✅ Scan complete. Added ${count} new matches to tracking.`
  );
}

async function handleAdd(chatId: number, args: string[]): Promise<void> {
  if (args.length < 1) {
    await telegram.sendMessage(chatId, "Usage: /add <odds_api_id>");
    return;
  }

  const oddsApiId = args[0]!;

  // Try to fetch match info from API
  const cachedMatch = oddsApi.getCachedMatch(oddsApiId);

  if (!cachedMatch) {
    await telegram.sendMessage(
      chatId,
      `Match not found in cache. Try /scan first to refresh match data.`
    );
    return;
  }

  const { player1, player2 } = oddsApi.parsePlayerNames(cachedMatch);
  const commenceTime = Math.floor(new Date(cachedMatch.commence_time).getTime() / 1000);

  const matchId = monitor.trackMatch(
    oddsApiId,
    player1,
    player2,
    commenceTime,
    cachedMatch.sport_key
  );

  await telegram.sendMessage(
    chatId,
    `✅ Now tracking match #${matchId}:\n${player1} vs ${player2}`
  );
}

async function handleRemove(chatId: number, args: string[]): Promise<void> {
  if (args.length < 1) {
    await telegram.sendMessage(chatId, "Usage: /remove <match_id>");
    return;
  }

  const matchId = parseInt(args[0]!, 10);
  if (isNaN(matchId)) {
    await telegram.sendMessage(chatId, "Invalid match ID");
    return;
  }

  monitor.untrackMatch(matchId);
  await telegram.sendMessage(chatId, `✅ Stopped tracking match #${matchId}`);
}

async function handleDetect(chatId: number, args: string[]): Promise<void> {
  // If no match ID provided, show today's matches as buttons
  if (args.length < 1) {
    const matches = monitor.getTrackedMatches();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Filter to matches starting within the next 24 hours
    const todayMatches = matches.filter(m => {
      const startTime = m.commenceTime * 1000;
      return startTime > now && startTime < now + oneDayMs;
    });

    if (todayMatches.length === 0) {
      await telegram.sendMessage(chatId, "No matches starting in the next 24 hours.\n\nUsage: /detect <match_id>");
      return;
    }

    // Build inline keyboard with match buttons
    const buttons = todayMatches.slice(0, 10).map(m => {
      const startTime = new Date(m.commenceTime * 1000);
      const timeStr = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Get last names only for shorter button text
      const p1Last = m.player1.split(' ').pop() || m.player1;
      const p2Last = m.player2.split(' ').pop() || m.player2;
      return [{
        text: `${timeStr} ${p1Last} v ${p2Last}`,
        callback_data: `detect:${m.id}`
      }];
    });

    const message = `🎾 <b>Select match to trigger walkover:</b>\n\n⚠️ This will place orders on all markets!`;

    await telegram.sendMessage(chatId, message, {
      reply_markup: { inline_keyboard: buttons }
    });
    return;
  }

  const matchId = parseInt(args[0]!, 10);
  if (isNaN(matchId)) {
    await telegram.sendMessage(chatId, "Invalid match ID");
    return;
  }

  // Execute immediately - notifications will be sent by handleWalkoverDetected
  const result = await monitor.triggerManualWalkover(matchId);

  if (!result.success) {
    await telegram.sendMessage(chatId, `❌ Failed: ${result.error}`);
  }
}

async function handleReset(chatId: number, args: string[]): Promise<void> {
  if (args.length < 1) {
    await telegram.sendMessage(chatId, "Usage: /reset <match_id>");
    return;
  }

  const matchId = parseInt(args[0]!, 10);
  if (isNaN(matchId)) {
    await telegram.sendMessage(chatId, "Invalid match ID");
    return;
  }

  const match = monitor.getMatch(matchId);
  if (!match) {
    await telegram.sendMessage(chatId, "❌ Match not found");
    return;
  }

  // Reset match status to pending
  const { db } = await import("../db");
  db().prepare(`
    UPDATE tracked_matches
    SET status = 'pending', walkover_detected_at = NULL, orders_placed_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(Math.floor(Date.now() / 1000), matchId);

  await telegram.sendMessage(chatId, `✅ Reset match #${matchId} to pending status`);
}

async function handleOrders(chatId: number): Promise<void> {
  const orders = trading.getAllPlacedOrders();

  if (orders.length === 0) {
    await telegram.sendMessage(chatId, "No orders have been placed yet.");
    return;
  }

  let message = `📝 <b>Recent Orders</b>\n\n`;

  for (const order of orders.slice(0, 10)) {
    message += `#${order.id}: ${order.player}\n`;
    message += `Price: $${order.price} | Size: ${order.size}\n`;
    message += `Status: ${order.status}\n\n`;
  }

  await telegram.sendMessage(chatId, message);
}

async function handleBalance(chatId: number): Promise<void> {
  const balance = await trading.getWalletBalance();

  if (!balance) {
    await telegram.sendMessage(chatId, "❌ No trading wallet connected.\nUse /connect <private_key> to connect.");
    return;
  }

  await telegram.sendMessage(chatId, telegram.formatBalance(balance.balance));
}

async function handleConnect(chatId: number, args: string[]): Promise<void> {
  if (args.length < 1) {
    await telegram.sendMessage(chatId, "Usage: /connect <private_key> [proxy_address]");
    return;
  }

  const privateKey = args[0]!;
  const proxyAddress = args[1];

  await telegram.sendMessage(chatId, "🔄 Connecting wallet...");

  const result = await trading.connectWallet(privateKey, proxyAddress);

  if (result.success) {
    await telegram.sendMessage(
      chatId,
      `✅ Wallet connected: <code>${result.address?.slice(0, 10)}...</code>`
    );
  } else {
    await telegram.sendMessage(chatId, `❌ Failed: ${result.error}`);
  }
}

async function handleDisconnect(chatId: number): Promise<void> {
  trading.disconnectWallet();
  await telegram.sendMessage(chatId, "✅ Trading wallet disconnected");
}

async function handleLink(chatId: number, args: string[]): Promise<void> {
  if (args.length < 2) {
    await telegram.sendMessage(chatId, "Usage: /link <match_id> <polymarket_condition_id>");
    return;
  }

  const matchId = parseInt(args[0]!, 10);
  const conditionId = args[1]!;

  if (isNaN(matchId)) {
    await telegram.sendMessage(chatId, "Invalid match ID");
    return;
  }

  await telegram.sendMessage(chatId, "🔄 Fetching market info...");

  const market = await marketFinder.getMarketByConditionId(conditionId);

  if (!market) {
    await telegram.sendMessage(chatId, "❌ Could not fetch market info. Check condition ID.");
    return;
  }

  // Update match in database
  const match = monitor.getMatch(matchId);
  if (!match) {
    await telegram.sendMessage(chatId, "❌ Match not found");
    return;
  }

  // Use direct DB update
  const { db } = await import("../db");
  const stmt = db().prepare(`
    UPDATE tracked_matches
    SET polymarket_condition_id = ?, player1_token_id = ?, player2_token_id = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(market.conditionId, market.player1TokenId, market.player2TokenId, Math.floor(Date.now() / 1000), matchId);

  await telegram.sendMessage(
    chatId,
    `✅ Linked match #${matchId} to market:\n${market.title}\n\nPlayer 1: ${market.player1}\nPlayer 2: ${market.player2}`
  );
}

async function handleAnalyze(chatId: number, args: string[]): Promise<void> {
  if (args.length < 1) {
    await telegram.sendMessage(chatId, "Usage: /analyze <match_id>");
    return;
  }

  const matchId = parseInt(args[0]!, 10);
  if (isNaN(matchId)) {
    await telegram.sendMessage(chatId, "Invalid match ID");
    return;
  }

  const match = monitor.getMatch(matchId);
  if (!match) {
    await telegram.sendMessage(chatId, "❌ Match not found");
    return;
  }

  if (!match.polymarketConditionId) {
    await telegram.sendMessage(chatId, "❌ Match not linked to Polymarket");
    return;
  }

  await telegram.sendMessage(chatId, `📊 Analyzing order book for #${matchId}:\n${match.player1} vs ${match.player2}...`);

  const analysis = await trading.analyzeWalkoverOpportunity(match);

  if (!analysis) {
    await telegram.sendMessage(chatId, "❌ Failed to analyze order book. Is trading client connected?");
    return;
  }

  const message = `
📊 <b>Order Book Analysis</b>
${match.player1} vs ${match.player2}

<b>${match.player1}:</b>
Shares under $0.49: ${analysis.player1.shares.toFixed(0)}
Cost: $${analysis.player1.cost.toFixed(2)}
Avg price: $${analysis.player1.avgPrice.toFixed(3)}
Profit if walkover: $${analysis.player1.profit.toFixed(2)}

<b>${match.player2}:</b>
Shares under $0.49: ${analysis.player2.shares.toFixed(0)}
Cost: $${analysis.player2.cost.toFixed(2)}
Avg price: $${analysis.player2.avgPrice.toFixed(3)}
Profit if walkover: $${analysis.player2.profit.toFixed(2)}

<b>Total:</b>
Cost: $${analysis.totalCost.toFixed(2)}
Expected profit: $${analysis.totalProfit.toFixed(2)}
ROI: ${((analysis.totalProfit / analysis.totalCost) * 100).toFixed(1)}%`.trim();

  await telegram.sendMessage(chatId, message);
}

async function handleSweep(chatId: number, args: string[]): Promise<void> {
  if (args.length < 1) {
    await telegram.sendMessage(chatId, "Usage: /sweep <match_id> [max_spend_per_side]");
    return;
  }

  const matchId = parseInt(args[0]!, 10);
  if (isNaN(matchId)) {
    await telegram.sendMessage(chatId, "Invalid match ID");
    return;
  }

  const maxSpend = args[1] ? parseFloat(args[1]) : undefined;

  const match = monitor.getMatch(matchId);
  if (!match) {
    await telegram.sendMessage(chatId, "❌ Match not found");
    return;
  }

  if (!match.polymarketConditionId) {
    await telegram.sendMessage(chatId, "❌ Match not linked to Polymarket");
    return;
  }

  await telegram.sendMessage(
    chatId,
    `🚨 <b>EXECUTING WALKOVER SWEEP</b>\n${match.player1} vs ${match.player2}\n\nSweeping order book up to $0.49...`
  );

  const result = await trading.sweepWalkoverOrders(match, 0.49, maxSpend);

  if (result.success) {
    const message = `
✅ <b>SWEEP COMPLETE</b>

<b>${match.player1}:</b>
${result.player1.sharesBought.toFixed(0)} shares @ $${result.player1.avgPrice.toFixed(3)}
Cost: $${result.player1.costUsd.toFixed(2)}

<b>${match.player2}:</b>
${result.player2.sharesBought.toFixed(0)} shares @ $${result.player2.avgPrice.toFixed(3)}
Cost: $${result.player2.costUsd.toFixed(2)}

<b>Total:</b>
${result.totalShares.toFixed(0)} shares bought
$${result.totalCost.toFixed(2)} spent
$${result.totalExpectedProfit.toFixed(2)} expected profit`.trim();

    await telegram.sendMessage(chatId, message);
  } else {
    await telegram.sendMessage(
      chatId,
      `❌ Sweep failed:\nP1: ${result.player1.error || "OK"}\nP2: ${result.player2.error || "OK"}`
    );
  }
}

async function handleLinkAll(chatId: number): Promise<void> {
  await telegram.sendMessage(chatId, "🔗 Syncing with Polymarket and Odds API...\nThis may take a minute.");

  // First, get events from Polymarket (primary source)
  const fromPolymarket = await monitor.autoTrackFromPolymarket();

  // Then link to Odds API for monitoring
  const linkedToOdds = await monitor.linkToOddsApi();

  await telegram.sendMessage(
    chatId,
    `✅ Sync complete.\n\n` +
    `New from Polymarket: ${fromPolymarket}\n` +
    `Linked to Odds API: ${linkedToOdds}`
  );
}

async function handleTwitter(chatId: number, args: string[]): Promise<void> {
  // Test parsing mode
  if (args[0] === "test" && args.length > 1) {
    const testText = args.slice(1).join(" ");
    const result = twitter.testParseTweet(testText);

    if (result) {
      let message = `✅ <b>Parse successful</b>\n\n`;
      message += `Tournament: ${result.tournament || "N/A"}\n`;
      message += `Players detected: ${result.players.length}\n\n`;

      for (const player of result.players) {
        const match = twitter.testFindPlayer(player);
        message += `🏃 <b>${player}</b>\n`;
        message += `   Matched: ${match ? `#${match.id}: ${match.player1} vs ${match.player2}` : "No match found"}\n\n`;
      }

      await telegram.sendMessage(chatId, message.trim());
    } else {
      await telegram.sendMessage(chatId, `❌ No withdrawal detected in text`);
    }
    return;
  }

  // Status mode
  const status = twitter.getStatus();

  const message = `
🐦 <b>Twitter Polling Status</b>

Status: ${status.polling ? "✅ Polling" : "❌ Not polling"}
Poll Count: ${status.pollCount.toLocaleString()}
Elapsed: ${status.elapsedMinutes.toFixed(1)} min
Cost so far: $${status.costSoFar.toFixed(4)}
Projected: <b>$${status.projectedMonthlyCost.toFixed(2)}/mo</b>
Last Tweet ID: <code>${status.lastTweetId || "None"}</code>

<b>Usage:</b>
<code>/twitter test OUT: Djokovic, Sinner</code>
Test parsing a withdrawal tweet`.trim();

  await telegram.sendMessage(chatId, message);
}

/**
 * Handle callback query (button press)
 */
async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  const chatId = query.message?.chat.id;
  if (!chatId) return;

  // Check admin access
  if (!telegram.isAdmin(chatId)) {
    await telegram.answerCallbackQuery(query.id, "⛔ Unauthorized");
    return;
  }

  const data = query.data || "";

  // Handle detect button
  if (data.startsWith("detect:")) {
    const matchId = parseInt(data.split(":")[1]!, 10);

    if (isNaN(matchId)) {
      await telegram.answerCallbackQuery(query.id, "Invalid match ID");
      return;
    }

    // Acknowledge the button press
    await telegram.answerCallbackQuery(query.id, "🚨 Triggering walkover...");

    // Get match info for message
    const match = monitor.getMatch(matchId);
    if (match) {
      await telegram.sendMessage(chatId, `🚨 <b>Triggering walkover for:</b>\n${match.player1} vs ${match.player2}`);
    }

    // Execute walkover trigger
    const result = await monitor.triggerManualWalkover(matchId);

    if (!result.success) {
      await telegram.sendMessage(chatId, `❌ Failed: ${result.error}`);
    }
    return;
  }

  // Unknown callback
  await telegram.answerCallbackQuery(query.id, "Unknown action");
}

/**
 * Start polling for updates
 */
export async function startPolling(): Promise<void> {
  let offset: number | undefined;

  logger.info("Starting Telegram polling...");

  while (true) {
    try {
      const updates = await telegram.getUpdates(offset);

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      logger.error("Telegram polling error", error);
      await Bun.sleep(5000);
    }
  }
}

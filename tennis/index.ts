#!/usr/bin/env bun
import { tennisConfig, validateConfig, setDryRun, DRY_RUN } from "./config";
import { getDb, closeDb } from "./db";
import { logger } from "../lib/logger";
import * as monitor from "./services/monitor.service";
import * as trading from "./services/trading.service";
import * as oddsApi from "./services/odds-api.service";
import * as twitter from "./services/twitter.service";
import { startPolling } from "./telegram/commands";

const args = process.argv.slice(2);

// Parse flags
const dryRun = args.includes("--dry-run");
if (dryRun) {
  setDryRun(true);
}

// Get command (first non-flag argument)
const command = args.find(arg => !arg.startsWith("--")) || "help";

async function main() {
  switch (command) {
    case "start":
      await runStart();
      break;

    case "scan":
      await runScan();
      break;

    case "detect":
      await runDetect(args[1]);
      break;

    case "status":
      await runStatus();
      break;

    case "setup":
      runSetup();
      break;

    case "help":
    default:
      printHelp();
  }
}

/**
 * Start the tennis bot
 */
async function runStart() {
  const modeText = dryRun ? "DRY RUN MODE" : "LIVE MODE";
  console.log(`
╔══════════════════════════════════════╗
║   🎾 Tennis Walkover Bot             ║
║   Polymarket Arbitrage Service       ║
║   ${dryRun ? "⚠️  DRY RUN - NO REAL TRADES  ⚠️" : "💰 LIVE TRADING ENABLED 💰"}      ║
╚══════════════════════════════════════╝
`);

  if (dryRun) {
    logger.warn("DRY RUN MODE ACTIVE - No real orders will be placed");
  }

  // Validate config
  const { valid, missing } = validateConfig();
  if (!valid) {
    logger.error(`Missing configuration: ${missing.join(", ")}`);
    logger.info("Run 'bun tennis/index.ts setup' for setup instructions");
    process.exit(1);
  }

  // Initialize database
  logger.info("Initializing database...");
  getDb();

  // Initialize trading (if wallet configured)
  logger.info("Initializing trading client...");
  const tradingReady = await trading.init();
  if (tradingReady) {
    const balance = await trading.getWalletBalance();
    logger.success(`Trading ready. Balance: $${balance?.balance.toFixed(2) || "0.00"}`);
  } else {
    logger.warn("Trading not configured. Use Telegram /connect command to add wallet.");
  }

  // Setup graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    monitor.stop();
    twitter.stopPolling();
    closeDb();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    monitor.stop();
    twitter.stopPolling();
    closeDb();
    process.exit(0);
  });

  // Start services in parallel
  logger.info("Starting services...");

  // Start HTTP API server for dashboard
  const API_PORT = Number(process.env.TENNIS_API_PORT) || 3456;
  Bun.serve({
    port: API_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers });
      }

      // POST /trigger-walkover
      if (url.pathname === "/trigger-walkover" && req.method === "POST") {
        try {
          const body = await req.json();
          const matchId = body.matchId;

          if (!matchId) {
            return new Response(JSON.stringify({ error: "Missing matchId" }), {
              status: 400,
              headers,
            });
          }

          logger.info(`API: Triggering walkover for match #${matchId}`);
          const result = await monitor.triggerManualWalkover(matchId);

          if (result.success) {
            return new Response(JSON.stringify({ success: true, message: `Walkover triggered for match #${matchId}` }), {
              headers,
            });
          } else {
            return new Response(JSON.stringify({ success: false, error: result.error }), {
              status: 400,
              headers,
            });
          }
        } catch (error) {
          logger.error("API trigger-walkover error", error);
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers,
          });
        }
      }

      // GET /status
      if (url.pathname === "/status" && req.method === "GET") {
        const status = {
          ...monitor.getStatus(),
          twitter: twitter.getStatus(),
        };
        return new Response(JSON.stringify(status), { headers });
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers,
      });
    },
  });
  logger.success(`HTTP API listening on port ${API_PORT}`);

  // Start Telegram polling in background
  startPolling().catch((err) => {
    logger.error("Telegram polling crashed", err);
  });

  // Start Twitter @EntryLists polling in background
  twitter.startPolling().catch((err) => {
    logger.error("Twitter polling crashed", err);
  });

  // Start monitor
  await monitor.start();
}

/**
 * Scan for matches without starting full bot
 */
async function runScan() {
  logger.info("Scanning for tennis matches...");

  const matches = await oddsApi.fetchAllUpcomingMatches();

  console.log(`\nFound ${matches.length} upcoming tennis matches:\n`);

  for (const match of matches) {
    const { player1, player2 } = oddsApi.parsePlayerNames(match);
    const time = new Date(match.commence_time).toLocaleString();

    console.log(`ID: ${match.id}`);
    console.log(`${player1} vs ${player2}`);
    console.log(`Time: ${time}`);
    console.log(`Sport: ${match.sport_key}`);
    console.log("---");
  }

  const rateLimit = oddsApi.getRateLimitStatus();
  console.log(`\nAPI Rate Limit: ${rateLimit.remaining} requests remaining`);
}

/**
 * Manually trigger walkover detection
 */
async function runDetect(matchId?: string) {
  if (!matchId) {
    logger.error("Usage: bun tennis/index.ts detect <match_id>");
    process.exit(1);
  }

  const id = parseInt(matchId, 10);
  if (isNaN(id)) {
    logger.error("Invalid match ID");
    process.exit(1);
  }

  // Initialize services
  getDb();
  await trading.init();

  const result = await monitor.triggerManualWalkover(id);

  if (result.success) {
    logger.success(`Walkover triggered for match #${id}`);
  } else {
    logger.error(`Failed: ${result.error}`);
  }

  closeDb();
}

/**
 * Show status
 */
async function runStatus() {
  getDb();

  const matches = monitor.getTrackedMatches();
  const wallet = trading.getTradingWallet();

  console.log("\n📊 Tennis Bot Status\n");
  console.log(`Tracked Matches: ${matches.length}`);
  console.log(`Trading Wallet: ${wallet ? wallet.walletAddress.slice(0, 10) + "..." : "Not configured"}`);
  console.log(`Database: ${tennisConfig.DB_PATH}`);

  if (matches.length > 0) {
    console.log("\nUpcoming Matches:");
    for (const match of matches.slice(0, 5)) {
      const time = new Date(match.commenceTime * 1000).toLocaleString();
      console.log(`  #${match.id}: ${match.player1} vs ${match.player2} (${time})`);
    }
  }

  closeDb();
}

/**
 * Print setup instructions
 */
function runSetup() {
  console.log(`
🎾 Tennis Walkover Bot Setup
═══════════════════════════════

1. Add these to your .env file:

   # The Odds API (required)
   ODDS_API_KEY=your_api_key_here

   # Telegram Bot (required)
   TENNIS_TELEGRAM_BOT_TOKEN=your_bot_token
   TENNIS_ADMIN_CHAT_IDS=your_chat_id

   # Optional settings
   TENNIS_MAX_ORDER_SIZE=100
   TENNIS_POLL_INTERVAL_MS=60000
   TENNIS_DB_PATH=./data/tennis.db

2. Create a Telegram bot:
   - Message @BotFather on Telegram
   - Send /newbot and follow instructions
   - Copy the token to TENNIS_TELEGRAM_BOT_TOKEN

3. Get your chat ID:
   - Message your new bot
   - Visit: https://api.telegram.org/bot<TOKEN>/getUpdates
   - Find your chat.id in the response

4. Start the bot:
   bun tennis/index.ts start

5. Connect your trading wallet via Telegram:
   /connect <private_key> [proxy_address]

Commands:
  start   - Run the bot
  scan    - Scan for tennis matches
  detect  - Manually trigger walkover
  status  - Show current status
  setup   - Show this message
`);
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
🎾 Tennis Walkover Bot

Usage: bun tennis/index.ts <command>

Commands:
  start           Start the bot with monitoring and Telegram
  scan            Scan The Odds API for upcoming tennis matches
  detect <id>     Manually trigger walkover detection for a match
  status          Show current bot status
  setup           Show setup instructions
  help            Show this message

Examples:
  bun tennis/index.ts start
  bun tennis/index.ts scan
  bun tennis/index.ts detect 123
`);
}

// Run
main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});

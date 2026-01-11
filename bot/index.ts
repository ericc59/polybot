import { config, validateConfig } from "./config";
import { getDb } from "./db/index";
import {
  testConnection,
  startPolling,
  setupWebhook,
  createWebhookHandler,
  handleUpdate,
} from "./telegram/index";
import { startMonitor, stopMonitor, getMonitorStatus } from "./services/monitor.service";
import {
  analyzeWallet,
  discoverProfitableWallets,
  formatWalletScore,
} from "./tracker/analyzer";
import { logger } from "./utils/logger";

const args = process.argv.slice(2);
const command = args[0] || "help";

async function main() {
  console.log(`
======================================
  POLYMARKET WHALE TRACKER (Multi-User)
======================================
`);

  switch (command) {
    case "start":
      await runStart();
      break;
    case "discover":
      await runDiscover();
      break;
    case "analyze":
      await runAnalyze(args[1]);
      break;
    case "setup":
      runSetup();
      break;
    default:
      printHelp();
  }
}

async function runStart() {
  const { valid, missing } = validateConfig();

  if (!valid) {
    logger.error(`Missing config: ${missing.join(", ")}`);
    logger.info("Run 'bun bot/index.ts setup' for instructions");
    process.exit(1);
  }

  // Test Telegram connection
  const telegramOk = await testConnection();
  if (!telegramOk) {
    logger.error("Telegram connection failed - check TELEGRAM_BOT_TOKEN");
    process.exit(1);
  }

  logger.success("Telegram connection OK");

  // Initialize database
  await getDb();
  logger.success("Database initialized");

  // Start monitor service
  startMonitor();

  // Start Telegram bot
  if (config.USE_WEBHOOK) {
    // Webhook mode - start HTTP server
    await setupWebhook(`${config.WEBHOOK_URL}/telegram`);

    Bun.serve({
      port: config.PORT,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/telegram" && req.method === "POST") {
          return createWebhookHandler()(req);
        }

        if (url.pathname === "/health") {
          const status = getMonitorStatus();
          return new Response(
            JSON.stringify({
              status: "ok",
              monitor: status,
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not found", { status: 404 });
      },
    });

    logger.success(`Webhook server running on port ${config.PORT}`);
  } else {
    // Polling mode - long polling for updates
    logger.info("Starting in polling mode...");
    startPolling();
  }

  logger.success("Bot is running! Send /start in Telegram to register.");

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    stopMonitor();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    stopMonitor();
    process.exit(0);
  });
}

async function runDiscover() {
  logger.info("Discovering profitable wallets...");
  logger.info(
    `Min PnL: $${config.MIN_WALLET_PNL}, Min Win Rate: ${config.MIN_WIN_RATE * 100}%`
  );

  const wallets = await discoverProfitableWallets(20);

  if (wallets.length === 0) {
    logger.warn("No wallets found matching criteria. Try lowering thresholds.");
    return;
  }

  console.log(`\nFound ${wallets.length} profitable wallets:\n`);

  for (const wallet of wallets) {
    console.log("-".repeat(50));
    console.log(formatWalletScore(wallet));
  }

  console.log("\n" + "-".repeat(50));
  console.log("\nUsers can add wallets via /add command in Telegram");
}

async function runAnalyze(address?: string) {
  if (!address) {
    logger.error("Usage: bun bot/index.ts analyze <wallet-address>");
    return;
  }

  logger.info(`Analyzing wallet ${address}...`);

  const score = await analyzeWallet(address);

  if (!score) {
    logger.error("Could not analyze wallet");
    return;
  }

  console.log("\n" + formatWalletScore(score));
}

function runSetup() {
  console.log(`
POLYMARKET WHALE TRACKER SETUP (Multi-User)
============================================

1. CREATE A TELEGRAM BOT
------------------------
- Message @BotFather on Telegram
- Send /newbot and follow prompts
- Copy the bot token

2. CREATE .env FILE
-------------------
Create a .env file in the project root:

TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather

# Optional: Webhook mode (for production)
# USE_WEBHOOK=true
# WEBHOOK_URL=https://your-domain.com
# PORT=3000

# Optional: Adjust defaults
POLL_INTERVAL_MS=60000
MIN_WALLET_PNL=10000
MIN_WIN_RATE=0.55
MIN_TRADES=10

3. START THE BOT
----------------
bun bot/index.ts start

4. REGISTER AS A USER
---------------------
- Send /start to your bot in Telegram
- Use /discover to find wallets
- Use /add <wallet> to subscribe
- Use /settings to customize

TELEGRAM COMMANDS FOR USERS
---------------------------
/start     - Register as a new user
/help      - Show available commands
/add       - Subscribe to a wallet
/remove    - Unsubscribe from a wallet
/list      - Show your tracked wallets
/settings  - View/edit your settings
/discover  - Find profitable traders
/stats     - View your usage stats
`);
}

function printHelp() {
  console.log(`
USAGE: bun bot/index.ts <command>

COMMANDS:
  start      Start the multi-user bot
  discover   Find profitable wallets (CLI utility)
  analyze    Analyze a specific wallet (CLI utility)
  setup      Show setup instructions
  help       Show this help message

EXAMPLES:
  bun bot/index.ts start           # Start the bot
  bun bot/index.ts discover        # Find profitable traders
  bun bot/index.ts analyze 0x...   # Analyze a wallet

TELEGRAM COMMANDS (once bot is running):
  /start     - Register as user
  /add       - Subscribe to wallet
  /list      - Show tracked wallets
  /settings  - Edit preferences
  /discover  - Find wallets
`);
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});

import { config, validateConfig } from "./config";
import { getDb } from "./db/index";
import {
	getMonitorStatus,
	startMonitor,
	stopMonitor,
} from "./services/monitor.service";
import {
	getRealtimeStatus,
	startRealtimeMonitor,
	stopRealtimeMonitor,
} from "./services/realtime.service";
import * as stripeService from "./services/stripe.service";
import * as copyService from "./services/copy.service";
import * as sportsService from "./services/sports.service";
import {
	createWebhookHandler,
	handleUpdate,
	setupWebhook,
	startPolling,
	testConnection,
} from "./telegram/index";
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
  POLYSPY (Multi-User)
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

	// Initialize sports betting schema
	sportsService.initSportsSchema();

	// Initialize real copy trading and check for redemptions
	await copyService.initAndCheckRedemptions();

	// Start periodic redemption check for real trading (every 5 minutes)
	copyService.startRealRedemptionMonitor();

	// Start real-time WebSocket monitor (with polling fallback)
	if (config.USE_POLLING) {
		logger.info("Starting polling monitor (USE_POLLING=true)...");
		startMonitor();
	} else {
		logger.info("Starting real-time WebSocket monitor...");
		await startRealtimeMonitor();
	}

	// Start sports value betting monitor (polls every 5 seconds)
	logger.info("Starting sports value betting monitor...");
	sportsService.startMonitoring(1); // Default user ID

	// Start HTTP server (always runs for health checks and Stripe webhooks)
	Bun.serve({
		port: config.PORT,
		async fetch(req) {
			const url = new URL(req.url);

			// Telegram webhook (only in webhook mode)
			if (url.pathname === "/telegram" && req.method === "POST") {
				if (!config.USE_WEBHOOK) {
					return new Response("Webhook mode not enabled", { status: 404 });
				}
				return createWebhookHandler()(req);
			}

			// Health check
			if (url.pathname === "/health") {
				const monitorStatus = config.USE_POLLING
					? getMonitorStatus()
					: getRealtimeStatus();
				return new Response(
					JSON.stringify({
						status: "ok",
						monitor: monitorStatus,
						monitorMode: config.USE_POLLING ? "polling" : "realtime",
						telegramMode: config.USE_WEBHOOK ? "webhook" : "polling",
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}

			// Stripe webhook endpoint
			if (url.pathname === "/stripe/webhook" && req.method === "POST") {
				const payload = await req.text();
				const signature = req.headers.get("stripe-signature");

				if (!signature) {
					return new Response("Missing stripe-signature header", {
						status: 400,
					});
				}

				const result = await stripeService.handleWebhookEvent(
					payload,
					signature,
				);

				if (!result.success) {
					return new Response("Webhook verification failed", { status: 400 });
				}

				return new Response(
					JSON.stringify({ received: true, event: result.event }),
					{
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			return new Response("Not found", { status: 404 });
		},
	});

	logger.success(`HTTP server running on port ${config.PORT}`);

	// Start Telegram bot
	if (config.USE_WEBHOOK) {
		await setupWebhook(`${config.WEBHOOK_URL}/telegram`);
		logger.success("Telegram webhook configured");
	} else {
		logger.info("Starting Telegram in polling mode...");
		startPolling();
	}

	logger.success("Bot is running! Send /start in Telegram to register.");

	// Handle graceful shutdown
	process.on("SIGINT", () => {
		logger.info("Shutting down...");
		copyService.stopRealRedemptionMonitor();
		sportsService.stopMonitoring();
		if (config.USE_POLLING) {
			stopMonitor();
		} else {
			stopRealtimeMonitor();
		}
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		logger.info("Shutting down...");
		copyService.stopRealRedemptionMonitor();
		sportsService.stopMonitoring();
		if (config.USE_POLLING) {
			stopMonitor();
		} else {
			stopRealtimeMonitor();
		}
		process.exit(0);
	});
}

async function runDiscover() {
	logger.info("Discovering profitable wallets...");
	logger.info(
		`Min PnL: $${config.MIN_WALLET_PNL}, Min Win Rate: ${config.MIN_WIN_RATE * 100}%`,
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
POLYSPY SETUP (Multi-User)
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

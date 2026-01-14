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
import * as paperService from "./services/paper.service";
import * as copyService from "./services/copy.service";
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
		case "paper":
			await runPaperCommand(args[1], args[2]);
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

	// Initialize paper trading and backfill missing data
	await paperService.initAndBackfill();

	// Start periodic redemption check for paper trading (every 5 minutes)
	paperService.startRedemptionMonitor();

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
		paperService.stopRedemptionMonitor();
		copyService.stopRealRedemptionMonitor();
		if (config.USE_POLLING) {
			stopMonitor();
		} else {
			stopRealtimeMonitor();
		}
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		logger.info("Shutting down...");
		paperService.stopRedemptionMonitor();
		copyService.stopRealRedemptionMonitor();
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

async function runPaperCommand(subcommand?: string, arg?: string) {
	// Initialize database
	await getDb();

	const userId = 1; // Default user for CLI

	switch (subcommand) {
		case "topup": {
			const amount = parseFloat(arg || "1000");
			if (isNaN(amount) || amount <= 0) {
				logger.error("Invalid amount. Usage: bun bot/index.ts paper topup <amount>");
				return;
			}
			const result = paperService.topUpPaperPortfolio(userId, amount);
			if (result.success) {
				logger.success(`Added $${amount} to paper portfolio. New balance: $${result.newBalance?.toFixed(2)}`);
			} else {
				logger.error(result.error || "Failed to top up portfolio");
			}
			break;
		}

		case "refresh": {
			logger.info("Refreshing prices for all positions...");
			const result = await paperService.refreshStalePositionPrices();
			logger.info(`Refreshed ${result.updated} prices, ${result.failed} failed`);
			break;
		}

		case "status": {
			const portfolio = paperService.getPaperPortfolio(userId);
			if (!portfolio) {
				logger.warn("No active paper portfolio");
				return;
			}
			console.log("\nPaper Portfolio Status:");
			console.log("-".repeat(40));
			console.log(`Cash: $${portfolio.currentCash.toFixed(2)}`);
			console.log(`Positions: ${portfolio.positions.length}`);
			console.log(`Total Value: $${portfolio.totalValue.toFixed(2)}`);
			console.log(`P&L: $${portfolio.pnl.toFixed(2)} (${portfolio.pnlPercent.toFixed(1)}%)`);
			console.log(`Tracked Wallets: ${portfolio.trackedWallets.length}`);
			break;
		}

		case "reset": {
			const startAmount = parseFloat(arg || "1000");
			// Try to reset existing portfolio first
			const resetResult = paperService.resetPaperPortfolio(userId, startAmount);
			if (resetResult.success) {
				logger.success(`Reset paper portfolio to $${startAmount} (positions cleared, wallets kept)`);
			} else {
				// No portfolio exists, create new one
				const result = paperService.startPaperTrading(userId, startAmount);
				if (result.success) {
					logger.success(`Created new paper portfolio with $${startAmount}`);
				} else {
					logger.error(result.error || "Failed to create portfolio");
				}
			}
			break;
		}

		default:
			console.log(`
Paper Trading Commands:
-----------------------
  bun bot/index.ts paper topup <amount>   Add funds to paper portfolio
  bun bot/index.ts paper refresh          Refresh prices for all positions
  bun bot/index.ts paper status           Show portfolio status
  bun bot/index.ts paper reset [amount]   Reset portfolio (default $1000)
`);
	}
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
  paper      Manage paper trading portfolio
  setup      Show setup instructions
  help       Show this help message

EXAMPLES:
  bun bot/index.ts start           # Start the bot
  bun bot/index.ts discover        # Find profitable traders
  bun bot/index.ts analyze 0x...   # Analyze a wallet
  bun bot/index.ts paper topup 500 # Add $500 to paper portfolio
  bun bot/index.ts paper refresh   # Refresh position prices
  bun bot/index.ts paper status    # Show portfolio status

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

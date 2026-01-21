import { config } from "../config";
import * as userRepo from "../db/repositories/user.repo";
import * as walletRepo from "../db/repositories/wallet.repo";
import * as adminService from "../services/admin.service";
import * as copyService from "../services/copy.service";
import * as paperService from "../services/paper.service";
import * as stripeService from "../services/stripe.service";
import * as tradingService from "../services/trading.service";
import * as sportsService from "../services/sports.service";
import {
	analyzeWallet,
	discoverProfitableWallets,
	formatWalletScore,
} from "../tracker/analyzer";
import { encryptCredentials, decryptCredentials } from "../utils/crypto";
import { logger } from "../utils/logger";
import {
	answerCallbackQuery,
	createInlineKeyboard,
	editMessage,
	sendMessage,
	type TelegramCallbackQuery,
	type TelegramMessage,
} from "./index";

// Parse command from message
function parseCommand(text: string): { command: string; args: string[] } {
	const parts = text.trim().split(/\s+/);
	const command = (parts[0] || "")
		.toLowerCase()
		.replace("/", "")
		.replace(/@.*$/, "");
	const args = parts.slice(1);
	return { command, args };
}

// Validate Ethereum address
function isValidAddress(address: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Handle incoming message with command
export async function handleCommand(message: TelegramMessage): Promise<void> {
	const text = message.text;
	if (!text || !text.startsWith("/")) return;

	const telegramId = message.from?.id?.toString();
	if (!telegramId) return;

	const chatId = message.chat.id.toString();
	const { command, args } = parseCommand(text);

	logger.info(`Command: /${command} from ${telegramId}`);

	// Commands that don't require registration
	if (command === "start") {
		await handleStart(telegramId, chatId, message.from?.username);
		return;
	}

	if (command === "help") {
		await handleHelp(chatId);
		return;
	}

	// All other commands require registration
	const user = await userRepo.getUserContext(telegramId);
	if (!user) {
		await sendMessage(chatId, "Please use /start to register first.");
		return;
	}

	// Update last active
	await userRepo.updateLastActive(user.id);

	// Route to command handler
	switch (command) {
		case "add":
			await handleAdd(user, chatId, args);
			break;
		case "remove":
			await handleRemove(user, chatId, args);
			break;
		case "list":
			await handleList(user, chatId);
			break;
		case "settings":
			await handleSettings(user, chatId);
			break;
		case "set":
			await handleSet(user, chatId, args);
			break;
		case "toggle":
			await handleToggle(user, chatId, args);
			break;
		case "discover":
			await handleDiscover(user, chatId);
			break;
		case "stats":
			await handleStats(user, chatId);
			break;
		case "connect":
			await handleConnect(user, chatId, args);
			break;
		case "disconnect":
			await handleDisconnect(user, chatId);
			break;
		case "copy":
			await handleCopy(user, chatId, args);
			break;
		case "limits":
			await handleLimits(user, chatId, args);
			break;
		case "copyhistory":
			await handleCopyHistory(user, chatId);
			break;
		case "volumedebug":
			await handleVolumeDebug(user, chatId);
			break;
		case "testmode":
			await handleTestMode(user, chatId);
			break;
		case "balance":
			await handleBalance(user, chatId);
			break;
		case "setproxy":
			await handleSetProxy(user, chatId, args);
			break;
		case "subscribe":
		case "upgrade":
			await handleSubscribe(user, chatId, args);
			break;
		case "billing":
			await handleBilling(user, chatId);
			break;
		case "plan":
			await handlePlan(user, chatId);
			break;
		case "admin":
			await handleAdmin(user, chatId, args);
			break;
		case "paper":
			await handlePaper(user, chatId, args);
			break;
		case "positions":
			await handlePositions(user, chatId);
			break;
		case "redeem":
			await handleRedeem(user, chatId);
			break;
		case "ignore":
			await handleIgnore(user, chatId, args);
			break;
		case "unignore":
			await handleUnignore(user, chatId, args);
			break;
		case "ignored":
			await handleIgnored(user, chatId);
			break;
		case "resetvolume":
			await handleResetVolume(user, chatId);
			break;
		case "sports":
			await handleSports(user, chatId, args);
			break;
		default:
			await sendMessage(
				chatId,
				"Unknown command. Use /help for available commands.",
			);
	}
}

// Handle callback queries from inline keyboards
export async function handleCallbackQuery(
	query: TelegramCallbackQuery,
): Promise<void> {
	const data = query.data;
	if (!data) return;

	const telegramId = query.from.id.toString();
	const chatId = query.message?.chat.id.toString();
	const messageId = query.message?.message_id;

	if (!chatId || !messageId) {
		await answerCallbackQuery(query.id, "Error: Invalid callback");
		return;
	}

	const user = await userRepo.getUserContext(telegramId);
	if (!user) {
		await answerCallbackQuery(query.id, "Please /start first");
		return;
	}

	// Parse callback data: action:param1:param2
	const [action, ...params] = data.split(":");

	try {
		switch (action) {
			case "settings":
				await handleSettingsCallback(user, chatId, messageId, params);
				break;
			case "toggle":
				await handleToggleCallback(user, chatId, messageId, params);
				break;
			case "wallet":
				await handleWalletCallback(user, chatId, messageId, params, query.id);
				break;
			default:
				await answerCallbackQuery(query.id, "Unknown action");
		}
	} catch (error) {
		logger.error("Callback error", error);
		await answerCallbackQuery(query.id, "Error processing request");
	}
}

// =============================================
// COMMAND HANDLERS
// =============================================

async function handleStart(
	telegramId: string,
	chatId: string,
	username?: string,
): Promise<void> {
	// Check if user exists
	let user = await userRepo.findByTelegramId(telegramId);

	if (user) {
		await userRepo.updateLastActive(user.id);
		await sendMessage(
			chatId,
			`*Welcome back!*\n\nYou're already registered. Use /help to see commands.`,
			{ parseMode: "Markdown" },
		);
		return;
	}

	// Create new user
	user = await userRepo.createUser({
		telegramId,
		telegramChatId: chatId,
		telegramUsername: username,
	});

	const welcome = `*Welcome to PolySpy!*

I'll alert you when profitable traders make moves on Polymarket.

*Quick Start:*
1. /discover - Find top traders
2. /add <wallet> - Subscribe to a wallet
3. /settings - Customize your alerts

*Your Plan:* Free (up to 5 wallets)

Use /help for all commands.`;

	await sendMessage(chatId, welcome, { parseMode: "Markdown" });
}

async function handleHelp(chatId: string): Promise<void> {
	const help = `*PolySpy*

*Wallet Commands:*
/add <wallet> - Subscribe to a wallet
/remove <wallet> - Unsubscribe
/list - Show your tracked wallets
/discover - Find profitable traders

*Settings:*
/settings - View & edit settings
/set min\\_trade <amount> - Min trade size
/set min\\_pnl <amount> - Min wallet PnL
/toggle sports - Toggle sports filtering
/toggle dormant - Toggle dormant whale alerts

*Copy Trading:*
/connect <private\\_key> - Connect wallet
/disconnect - Remove trading wallet
/balance - Check wallet USDC balance
/positions - View your open positions
/redeem - Redeem winning positions (at 100%)
/testmode - Apply ultra-safe test limits
/copy <wallet> <auto|recommend> - Copy a trader
/copy off <wallet> - Stop copying
/limits - View/set trading limits
/copyhistory - Recent copy trades
/ignore <pattern> - Ignore markets matching pattern
/unignore <pattern> - Remove from ignore list
/ignored - View ignored patterns

*Paper Trading:*
/paper start [amount] - Start with virtual $amount
/paper add <wallet> - Add wallet to track
/paper remove <wallet> - Remove wallet
/paper wallets - List tracked wallets
/paper status - View portfolio
/paper history - Trade history
/paper reset [amount] - Clear positions, reset balance
/paper stop - Stop and see results
/paper golive - Switch all to real trading

*Sports Betting:*
/sports - Status & rules
/sports start - Start auto-betting
/sports stop - Stop monitoring
/sports help - All commands

*Subscription:*
/plan - View current plan & pricing
/subscribe <pro|enterprise> - Upgrade plan
/billing - Manage subscription

*Other:*
/stats - Your usage statistics
/help - This message`;

	await sendMessage(chatId, help, { parseMode: "Markdown" });
}

async function handleAdd(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const addressArg = args[0];
	if (!addressArg) {
		await sendMessage(chatId, "Usage: /add <wallet-address>");
		return;
	}

	const address = addressArg.toLowerCase();

	if (!isValidAddress(address)) {
		await sendMessage(
			chatId,
			"Invalid wallet address. Must be 0x followed by 40 hex characters.",
		);
		return;
	}

	// Check tier limits
	const walletCount = await walletRepo.countUserWallets(user.id);
	// if (walletCount >= user.tier.max_wallets) {
	// 	await sendMessage(
	// 		chatId,
	// 		`You've reached the limit of ${user.tier.max_wallets} wallets on the ${user.tier.name} plan.`,
	// 	);
	// 	return;
	// }

	// Check if already subscribed
	if (await walletRepo.isSubscribed(user.id, address)) {
		await sendMessage(chatId, "You're already tracking this wallet.");
		return;
	}

	await sendMessage(chatId, "Analyzing wallet...");

	// Run analysis in background
	runAddWalletInBackground(user.id, chatId, address).catch((err) => {
		logger.error("Background add wallet failed", err);
		sendMessage(chatId, "Failed to add wallet. Please try again.").catch(
			() => {},
		);
	});
}

// Background task for adding wallet
async function runAddWalletInBackground(
	userId: number,
	chatId: string,
	address: string,
): Promise<void> {
	const stats = await analyzeWallet(address);
	if (!stats) {
		await sendMessage(
			chatId,
			"Could not analyze wallet. It may not have any Polymarket activity.",
		);
		return;
	}

	// Add subscription
	await walletRepo.addWallet(userId, address, stats);

	const typeLabel = {
		active: "",
		dormant: " [DORMANT WHALE]",
		sniper: " [SNIPER]",
	};

	await sendMessage(
		chatId,
		`*Wallet Added!*${typeLabel[stats.whaleType]}

*PnL:* $${stats.totalPnl.toFixed(0)}
*Win Rate:* ${(stats.winRate * 100).toFixed(1)}%
*Trades:* ${stats.totalTrades}

You'll receive alerts when this wallet trades.`,
		{ parseMode: "Markdown" },
	);
}

async function handleRemove(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const addressArg = args[0];
	if (!addressArg) {
		await sendMessage(chatId, "Usage: /remove <wallet-address>");
		return;
	}

	const address = addressArg.toLowerCase();

	const removed = await walletRepo.removeWallet(user.id, address);

	if (removed) {
		await sendMessage(chatId, "Wallet removed from your tracking list.");
	} else {
		await sendMessage(chatId, "You weren't tracking that wallet.");
	}
}

async function handleList(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const wallets = await walletRepo.getUserWallets(user.id);

	if (wallets.length === 0) {
		await sendMessage(
			chatId,
			"You're not tracking any wallets.\n\nUse /discover to find traders or /add <wallet> to add one.",
		);
		return;
	}

	let message = `*Tracking ${wallets.length}/${user.tier.max_wallets} wallets:*\n\n`;

	for (const w of wallets) {
		const typeEmoji =
			w.whale_type === "dormant"
				? " [D]"
				: w.whale_type === "sniper"
					? " [S]"
					: "";
		const pnl = w.total_pnl ? `$${w.total_pnl.toFixed(0)}` : "N/A";
		const winRate = w.win_rate ? `${(w.win_rate * 100).toFixed(0)}%` : "N/A";
		const name = w.custom_name || w.wallet_address.slice(0, 10) + "...";
		const status = w.notify_enabled ? "" : " (paused)";

		message += `${name}${typeEmoji}${status}\n`;
		message += `  PnL: ${pnl} | Win: ${winRate}\n\n`;
	}

	// Create inline keyboard for wallet actions
	const buttons = wallets.slice(0, 5).map((w) => [
		{
			text: w.wallet_address.slice(0, 8) + "...",
			callback_data: `wallet:view:${w.wallet_address.slice(0, 20)}`,
		},
	]);

	await sendMessage(chatId, message, {
		parseMode: "Markdown",
		replyMarkup: buttons.length > 0 ? createInlineKeyboard(buttons) : undefined,
	});
}

async function handleSettings(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const s = user.settings;
	const excludedCats = JSON.parse(s.categories_exclude || "[]") as string[];

	const message = `*Your Settings*

*Alert Thresholds:*
Min Trade Size: $${s.min_trade_size}
Min Wallet PnL: $${s.min_wallet_pnl}

*Filters:*
Sports Markets: ${excludedCats.includes("sports") ? "Hidden" : "Shown"}
Buy Alerts: ${s.alert_on_buy ? "On" : "Off"}
Sell Alerts: ${s.alert_on_sell ? "On" : "Off"}

*Whale Types:*
Active Whales: ${s.alert_whale_type_active ? "On" : "Off"}
Dormant Whales: ${s.alert_whale_type_dormant ? "On" : "Off"}
Snipers: ${s.alert_whale_type_sniper ? "On" : "Off"}

*Rate Limit:* ${s.max_alerts_per_hour}/hour`;

	const keyboard = createInlineKeyboard([
		[
			{ text: "Min Trade", callback_data: "settings:min_trade" },
			{ text: "Min PnL", callback_data: "settings:min_pnl" },
		],
		[
			{
				text: excludedCats.includes("sports") ? "Show Sports" : "Hide Sports",
				callback_data: "toggle:sports",
			},
		],
		[
			{
				text: `Dormant: ${s.alert_whale_type_dormant ? "ON" : "OFF"}`,
				callback_data: "toggle:dormant",
			},
			{
				text: `Sniper: ${s.alert_whale_type_sniper ? "ON" : "OFF"}`,
				callback_data: "toggle:sniper",
			},
		],
	]);

	await sendMessage(chatId, message, {
		parseMode: "Markdown",
		replyMarkup: keyboard,
	});
}

async function handleSet(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const settingArg = args[0];
	const valueArg = args[1];
	if (!settingArg || !valueArg) {
		await sendMessage(
			chatId,
			"Usage:\n/set min\\_trade <amount>\n/set min\\_pnl <amount>",
			{ parseMode: "Markdown" },
		);
		return;
	}

	const setting = settingArg.toLowerCase().replace("_", "");
	const value = parseFloat(valueArg);

	if (isNaN(value) || value < 0) {
		await sendMessage(chatId, "Invalid value. Must be a positive number.");
		return;
	}

	switch (setting) {
		case "mintrade":
			await userRepo.updateSettings(user.id, { min_trade_size: value });
			await sendMessage(chatId, `Min trade size set to $${value}`);
			break;
		case "minpnl":
			await userRepo.updateSettings(user.id, { min_wallet_pnl: value });
			await sendMessage(chatId, `Min wallet PnL set to $${value}`);
			break;
		default:
			await sendMessage(chatId, `Unknown setting: ${setting}`);
	}
}

async function handleToggle(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const settingArg = args[0];
	if (!settingArg) {
		await sendMessage(
			chatId,
			"Usage:\n/toggle sports\n/toggle dormant\n/toggle sniper\n/toggle buy\n/toggle sell",
			{ parseMode: "Markdown" },
		);
		return;
	}

	const setting = settingArg.toLowerCase();

	switch (setting) {
		case "sports": {
			const current = JSON.parse(
				user.settings.categories_exclude || "[]",
			) as string[];
			const newExclude = current.includes("sports")
				? current.filter((c) => c !== "sports")
				: [...current, "sports"];
			await userRepo.updateSettings(user.id, {
				categories_exclude: JSON.stringify(newExclude),
			});
			await sendMessage(
				chatId,
				`Sports markets: ${newExclude.includes("sports") ? "Hidden" : "Shown"}`,
			);
			break;
		}
		case "dormant": {
			const newVal = user.settings.alert_whale_type_dormant ? 0 : 1;
			await userRepo.updateSettings(user.id, {
				alert_whale_type_dormant: newVal,
			});
			await sendMessage(
				chatId,
				`Dormant whale alerts: ${newVal ? "On" : "Off"}`,
			);
			break;
		}
		case "sniper": {
			const newVal = user.settings.alert_whale_type_sniper ? 0 : 1;
			await userRepo.updateSettings(user.id, {
				alert_whale_type_sniper: newVal,
			});
			await sendMessage(chatId, `Sniper alerts: ${newVal ? "On" : "Off"}`);
			break;
		}
		case "buy": {
			const newVal = user.settings.alert_on_buy ? 0 : 1;
			await userRepo.updateSettings(user.id, { alert_on_buy: newVal });
			await sendMessage(chatId, `Buy alerts: ${newVal ? "On" : "Off"}`);
			break;
		}
		case "sell": {
			const newVal = user.settings.alert_on_sell ? 0 : 1;
			await userRepo.updateSettings(user.id, { alert_on_sell: newVal });
			await sendMessage(chatId, `Sell alerts: ${newVal ? "On" : "Off"}`);
			break;
		}
		default:
			await sendMessage(chatId, `Unknown toggle: ${setting}`);
	}
}

async function handleDiscover(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	await sendMessage(
		chatId,
		"Discovering profitable traders... This may take a minute. I'll send results when ready.",
	);

	// Run discovery in background so it doesn't block other users
	runDiscoveryInBackground(chatId).catch((err) => {
		logger.error("Background discovery failed", err);
		sendMessage(chatId, "Discovery failed. Please try again later.").catch(
			() => {},
		);
	});
}

// Background task for discovery
async function runDiscoveryInBackground(chatId: string): Promise<void> {
	const wallets = await discoverProfitableWallets(10);

	if (wallets.length === 0) {
		await sendMessage(chatId, "No wallets found matching criteria.");
		return;
	}

	let message = `*Found ${wallets.length} profitable traders:*\n\n`;

	const buttons: { text: string; callback_data: string }[][] = [];

	for (const w of wallets.slice(0, 5)) {
		const typeLabel =
			w.whaleType === "dormant"
				? " [D]"
				: w.whaleType === "sniper"
					? " [S]"
					: "";
		message += `\`${w.address.slice(0, 12)}...\`${typeLabel}\n`;
		message += `$${w.totalPnl.toFixed(0)} PnL | ${(w.winRate * 100).toFixed(0)}% win\n\n`;

		buttons.push([
			{
				text: `Add ${w.address.slice(0, 8)}...`,
				callback_data: `wallet:add:${w.address}`,
			},
		]);
	}

	await sendMessage(chatId, message, {
		parseMode: "Markdown",
		replyMarkup: createInlineKeyboard(buttons),
	});
}

async function handleStats(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const walletCount = await walletRepo.countUserWallets(user.id);
	const createdAt = new Date(user.created_at * 1000).toLocaleDateString();

	const message = `*Your Stats*

*Account:*
Plan: ${user.tier.name}
Member since: ${createdAt}

*Usage:*
Wallets: ${walletCount}/${user.tier.max_wallets}
Alerts limit: ${user.tier.max_alerts_per_day}/day`;

	await sendMessage(chatId, message, { parseMode: "Markdown" });
}

// =============================================
// CALLBACK HANDLERS
// =============================================

async function handleSettingsCallback(
	user: userRepo.UserWithSettings,
	chatId: string,
	messageId: number,
	params: string[],
): Promise<void> {
	const setting = params[0];

	if (setting === "min_trade") {
		await sendMessage(
			chatId,
			"Send the new minimum trade size:\n\nExample: /set min\\_trade 1000",
			{ parseMode: "Markdown" },
		);
	} else if (setting === "min_pnl") {
		await sendMessage(
			chatId,
			"Send the new minimum wallet PnL:\n\nExample: /set min\\_pnl 50000",
			{ parseMode: "Markdown" },
		);
	}
}

async function handleToggleCallback(
	user: userRepo.UserWithSettings,
	chatId: string,
	messageId: number,
	params: string[],
): Promise<void> {
	const setting = params[0];
	if (!setting) return;

	// Perform toggle
	await handleToggle(user, chatId, [setting]);

	// Refresh settings display
	const updatedUser = await userRepo.getUserContext(user.telegram_id);
	if (updatedUser) {
		// Re-render settings message
		const s = updatedUser.settings;
		const excludedCats = JSON.parse(s.categories_exclude || "[]") as string[];

		const message = `*Your Settings*

*Alert Thresholds:*
Min Trade Size: $${s.min_trade_size}
Min Wallet PnL: $${s.min_wallet_pnl}

*Filters:*
Sports Markets: ${excludedCats.includes("sports") ? "Hidden" : "Shown"}
Buy Alerts: ${s.alert_on_buy ? "On" : "Off"}
Sell Alerts: ${s.alert_on_sell ? "On" : "Off"}

*Whale Types:*
Active Whales: ${s.alert_whale_type_active ? "On" : "Off"}
Dormant Whales: ${s.alert_whale_type_dormant ? "On" : "Off"}
Snipers: ${s.alert_whale_type_sniper ? "On" : "Off"}

*Rate Limit:* ${s.max_alerts_per_hour}/hour`;

		const keyboard = createInlineKeyboard([
			[
				{ text: "Min Trade", callback_data: "settings:min_trade" },
				{ text: "Min PnL", callback_data: "settings:min_pnl" },
			],
			[
				{
					text: excludedCats.includes("sports") ? "Show Sports" : "Hide Sports",
					callback_data: "toggle:sports",
				},
			],
			[
				{
					text: `Dormant: ${s.alert_whale_type_dormant ? "ON" : "OFF"}`,
					callback_data: "toggle:dormant",
				},
				{
					text: `Sniper: ${s.alert_whale_type_sniper ? "ON" : "OFF"}`,
					callback_data: "toggle:sniper",
				},
			],
		]);

		try {
			await editMessage(chatId, messageId, message, {
				parseMode: "Markdown",
				replyMarkup: keyboard,
			});
		} catch {
			// Message might not be editable
		}
	}
}

async function handleWalletCallback(
	user: userRepo.UserWithSettings,
	chatId: string,
	messageId: number,
	params: string[],
	callbackId: string,
): Promise<void> {
	const [action, address] = params;

	if (action === "add" && address) {
		// Check limits
		const walletCount = await walletRepo.countUserWallets(user.id);
		if (walletCount >= user.tier.max_wallets) {
			await answerCallbackQuery(callbackId, "Wallet limit reached!", true);
			return;
		}

		// Check if already subscribed
		if (await walletRepo.isSubscribed(user.id, address)) {
			await answerCallbackQuery(callbackId, "Already tracking");
			return;
		}

		// Analyze and add
		const stats = await analyzeWallet(address);
		if (stats) {
			await walletRepo.addWallet(user.id, address, stats);
			await answerCallbackQuery(callbackId, "Wallet added!");
			await sendMessage(
				chatId,
				`Added wallet ${address.slice(0, 10)}... to your tracking list.`,
			);
		} else {
			await answerCallbackQuery(callbackId, "Could not analyze wallet", true);
		}
	}
}

// =============================================
// COPY TRADING COMMANDS
// =============================================

async function handleConnect(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	// Check subscription tier
	if (!user.tier.can_use_copy_trading) {
		await sendMessage(
			chatId,
			"Copy trading requires Pro or Enterprise subscription. Upgrade to unlock this feature.",
		);
		return;
	}

	const privateKey = args[0];

	if (!privateKey) {
		// Show current status and instructions
		const wallet = copyService.getTradingWallet(user.id);
		if (wallet) {
			await sendMessage(
				chatId,
				`*Connected Wallet:* \`${wallet.walletAddress}\`\n\nUse /disconnect to remove, or /limits to adjust settings.`,
				{ parseMode: "Markdown" },
			);
		} else {
			await sendMessage(
				chatId,
				`*Connect Trading Wallet*\n\n⚠️ *Security Warning*: Only use a dedicated trading wallet, not your main wallet.\n\nUsage: \`/connect <private_key>\`\n\nYour private key will be encrypted and stored securely.`,
				{ parseMode: "Markdown" },
			);
		}
		return;
	}

	// Validate private key
	if (!tradingService.isValidPrivateKey(privateKey)) {
		await sendMessage(chatId, "Invalid private key format.");
		return;
	}

	await sendMessage(chatId, "Connecting wallet and deriving API keys...");

	try {
		// Derive API key from Polymarket
		const credentials = await tradingService.deriveApiKey(privateKey);

		if (!credentials) {
			await sendMessage(
				chatId,
				"Failed to derive API keys. Make sure the wallet has been used on Polymarket.",
			);
			return;
		}

		// Get wallet address
		const address = tradingService.getAddressFromPrivateKey(privateKey);

		// Encrypt credentials (including private key for auto-trading)
		const encrypted = encryptCredentials({
			apiKey: credentials.apiKey,
			apiSecret: credentials.apiSecret,
			passphrase: credentials.passphrase,
			privateKey: privateKey, // Stored encrypted for auto-trading
		} as any);

		// Save to database
		const saved = copyService.saveTradingWallet(user.id, address, encrypted);

		if (saved) {
			await sendMessage(
				chatId,
				`✅ *Wallet Connected*\n\n` +
				`Address: \`${address}\`\n\n` +
				`*Safe Defaults Applied:*\n` +
				`• Max ${copyService.SAFE_DEFAULTS.copyPercentage}% of source trade\n` +
				`• Max $${copyService.SAFE_DEFAULTS.maxTradeSize} per trade\n` +
				`• $${copyService.SAFE_DEFAULTS.dailyLimit}/day limit\n` +
				`• Auto-trading: OFF\n\n` +
				`*Commands:*\n` +
				`/testmode - Apply ultra-safe test limits\n` +
				`/limits - View/adjust limits\n` +
				`/copy <wallet> recommend - Get trade alerts\n` +
				`/copy <wallet> auto - Enable auto-copy`,
				{ parseMode: "Markdown" },
			);
		} else {
			await sendMessage(chatId, "Failed to save wallet. Please try again.");
		}
	} catch (error: any) {
		logger.error("Failed to connect wallet", error);
		await sendMessage(chatId, `Connection failed: ${error.message}`);
	}
}

async function handleDisconnect(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet) {
		await sendMessage(chatId, "No trading wallet connected.");
		return;
	}

	const deleted = copyService.deleteTradingWallet(user.id);

	if (deleted) {
		await sendMessage(
			chatId,
			"Trading wallet disconnected and credentials deleted.",
		);
	} else {
		await sendMessage(chatId, "Failed to disconnect wallet.");
	}
}

async function handleCopy(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	if (!user.tier.can_use_copy_trading) {
		await sendMessage(
			chatId,
			"Copy trading requires Pro or Enterprise subscription.",
		);
		return;
	}

	// No args - show current copy subscriptions
	if (args.length === 0) {
		const subs = copyService.getCopySubscriptions(user.id);
		if (subs.length === 0) {
			await sendMessage(
				chatId,
				"*Copy Trading*\n\nNo wallets configured for copying.\n\nUsage:\n`/copy <wallet> auto` - Auto-execute trades\n`/copy <wallet> recommend` - Get recommendations\n`/copy off <wallet>` - Stop copying",
				{ parseMode: "Markdown" },
			);
		} else {
			const lines = subs.map(
				(s) =>
					`• \`${s.sourceWallet.slice(0, 10)}...\` - ${s.mode.toUpperCase()}`,
			);
			await sendMessage(chatId, `*Copy Subscriptions*\n\n${lines.join("\n")}`, {
				parseMode: "Markdown",
			});
		}
		return;
	}

	// /copy off <wallet>
	if (args[0]?.toLowerCase() === "off") {
		const address = args[1]?.toLowerCase();
		if (!address || !isValidAddress(address)) {
			await sendMessage(chatId, "Usage: /copy off <wallet-address>");
			return;
		}

		const removed = copyService.unsubscribeFromCopy(user.id, address);
		if (removed) {
			await sendMessage(
				chatId,
				`Stopped copying \`${address.slice(0, 10)}...\``,
				{ parseMode: "Markdown" },
			);
		}
		return;
	}

	// /copy <wallet> <mode>
	const address = args[0]?.toLowerCase();
	const mode = (args[1]?.toLowerCase() || "recommend") as copyService.CopyMode;

	if (!address || !isValidAddress(address)) {
		await sendMessage(chatId, "Invalid wallet address.");
		return;
	}

	if (mode !== "auto" && mode !== "recommend") {
		await sendMessage(chatId, "Mode must be 'auto' or 'recommend'.");
		return;
	}

	// For auto mode, require connected wallet
	if (mode === "auto") {
		const wallet = copyService.getTradingWallet(user.id);
		if (!wallet || !wallet.encryptedCredentials) {
			await sendMessage(
				chatId,
				"Auto copy-trading requires a connected wallet. Use /connect first.",
			);
			return;
		}
	}

	const subscribed = copyService.subscribeToCopy(user.id, address, mode);

	if (subscribed) {
		const modeDesc =
			mode === "auto"
				? "Trades will be auto-executed"
				: "You'll receive trade recommendations";
		await sendMessage(
			chatId,
			`✅ Now copying \`${address.slice(0, 10)}...\` in *${mode.toUpperCase()}* mode.\n\n${modeDesc}`,
			{ parseMode: "Markdown" },
		);
	} else {
		await sendMessage(chatId, "Failed to set up copy trading.");
	}
}

async function handleLimits(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet) {
		await sendMessage(
			chatId,
			"No trading wallet connected. Use /connect first.",
		);
		return;
	}

	// No args - show current limits
	if (args.length === 0) {
		const copyPct = wallet.copyPercentage;
		const maxTrade = wallet.maxTradeSize
			? `$${wallet.maxTradeSize}`
			: "No limit";
		const dailyLimit = wallet.dailyLimit ? `$${wallet.dailyLimit}` : "No limit";
		const maxPerMarket = wallet.maxPerMarket ? `$${wallet.maxPerMarket}` : "No limit";
		const todaysTotal = copyService.getTodaysCopyTotal(user.id);
		const copyEnabled = wallet.copyEnabled ? "ENABLED" : "DISABLED";

		await sendMessage(
			chatId,
			`*Copy Trading Limits*\n\n` +
				`Status: *${copyEnabled}*\n` +
				`Copy Size: ${copyPct}% of source trade\n` +
				`Max Trade: ${maxTrade}\n` +
				`Max Per Market: ${maxPerMarket}\n` +
				`Daily Limit: ${dailyLimit}\n` +
				`Today's Volume: $${todaysTotal.toFixed(0)}\n\n` +
				`*Commands:*\n` +
				`/limits enable|disable\n` +
				`/limits copy <percent>\n` +
				`/limits max <amount>\n` +
				`/limits market <amount>\n` +
				`/limits daily <amount>`,
			{ parseMode: "Markdown" },
		);
		return;
	}

	const setting = args[0]!.toLowerCase();
	const value = args[1];

	switch (setting) {
		case "enable": {
			// Show confirmation with current limits
			const copyPct = wallet.copyPercentage;
			const maxTrade = wallet.maxTradeSize ? `$${wallet.maxTradeSize}` : "No limit ⚠️";
			const maxMarket = wallet.maxPerMarket ? `$${wallet.maxPerMarket}` : "No limit ⚠️";
			const daily = wallet.dailyLimit ? `$${wallet.dailyLimit}` : "No limit ⚠️";

			// Check if limits are dangerously high
			const warnings: string[] = [];
			if (!wallet.maxTradeSize || wallet.maxTradeSize > 100) {
				warnings.push("• Consider setting a max trade size (/limits max 50)");
			}
			if (!wallet.maxPerMarket || wallet.maxPerMarket > 100) {
				warnings.push("• Consider setting a max per market (/limits market 25)");
			}
			if (!wallet.dailyLimit || wallet.dailyLimit > 500) {
				warnings.push("• Consider setting a daily limit (/limits daily 100)");
			}
			if (copyPct > 50) {
				warnings.push("• Copy % is high - consider lowering (/limits copy 10)");
			}

			copyService.updateTradingSettings(user.id, { copyEnabled: true });

			const warningText = warnings.length > 0
				? `\n\n⚠️ *Recommendations:*\n${warnings.join("\n")}`
				: "";

			await sendMessage(
				chatId,
				`✅ *Auto Copy-Trading ENABLED*\n\n` +
				`Current limits:\n` +
				`• Copy size: ${copyPct}% of source\n` +
				`• Max per trade: ${maxTrade}\n` +
				`• Max per market: ${maxMarket}\n` +
				`• Daily limit: ${daily}\n` +
				warningText +
				`\n\n💡 Use /testmode for ultra-safe limits\n` +
				`Use /limits disable to turn off`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "disable":
			copyService.updateTradingSettings(user.id, { copyEnabled: false });
			await sendMessage(chatId, "🛑 Auto copy-trading disabled.");
			break;

		case "copy": {
			const pct = parseInt(value || "100");
			if (isNaN(pct) || pct < 1 || pct > 200) {
				await sendMessage(chatId, "Copy percentage must be between 1-200%.");
				return;
			}
			copyService.updateTradingSettings(user.id, { copyPercentage: pct });
			await sendMessage(chatId, `Copy size set to ${pct}% of source trades.`);
			break;
		}

		case "max": {
			const max = parseFloat(value || "0");
			if (isNaN(max) || max < 0) {
				await sendMessage(chatId, "Invalid amount.");
				return;
			}
			copyService.updateTradingSettings(user.id, {
				maxTradeSize: max > 0 ? max : null,
			});
			await sendMessage(
				chatId,
				max > 0 ? `Max trade size set to $${max}.` : "Max trade limit removed.",
			);
			break;
		}

		case "daily": {
			const daily = parseFloat(value || "0");
			if (isNaN(daily) || daily < 0) {
				await sendMessage(chatId, "Invalid amount.");
				return;
			}
			copyService.updateTradingSettings(user.id, {
				dailyLimit: daily > 0 ? daily : null,
			});
			await sendMessage(
				chatId,
				daily > 0 ? `Daily limit set to $${daily}.` : "Daily limit removed.",
			);
			break;
		}

		case "market": {
			const market = parseFloat(value || "0");
			if (isNaN(market) || market < 0) {
				await sendMessage(chatId, "Invalid amount.");
				return;
			}
			copyService.updateTradingSettings(user.id, {
				maxPerMarket: market > 0 ? market : null,
			});
			await sendMessage(
				chatId,
				market > 0
					? `Max per market set to $${market}. You won't exceed this on any single event.`
					: "Max per market limit removed.",
			);
			break;
		}

		default:
			await sendMessage(
				chatId,
				"Unknown setting. Use enable, disable, copy, max, market, or daily.",
			);
	}
}

async function handleCopyHistory(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const history = copyService.getCopyTradeHistory(user.id, 10);

	if (history.length === 0) {
		await sendMessage(chatId, "No copy trade history yet.");
		return;
	}

	const lines = history.map((h) => {
		const status = {
			pending: "⏳",
			executed: "✅",
			failed: "❌",
			skipped: "⏭️",
		}[h.status];
		const date = new Date(h.createdAt * 1000).toLocaleDateString();
		return `${status} ${h.side} $${h.size.toFixed(0)} - ${h.marketTitle?.slice(0, 30) || "Unknown"}... (${date})`;
	});

	await sendMessage(chatId, `*Recent Copy Trades*\n\n${lines.join("\n")}`, {
		parseMode: "Markdown",
	});
}

async function handleVolumeDebug(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const breakdown = copyService.getTodaysCopyBreakdown(user.id);

	if (breakdown.trades.length === 0) {
		await sendMessage(chatId, "No trades today.");
		return;
	}

	const executedTrades = breakdown.trades.filter(
		(t) => t.status === "executed",
	);
	const confirmedTrades = executedTrades.filter((t) => t.hasTxHash);
	const unconfirmedTrades = executedTrades.filter((t) => !t.hasTxHash);

	// Group confirmed by size
	const sizeGroups: Record<string, number> = {};
	for (const t of confirmedTrades) {
		const key = `$${t.size.toFixed(0)}`;
		sizeGroups[key] = (sizeGroups[key] || 0) + 1;
	}
	const groupLines = Object.entries(sizeGroups)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([size, count]) => `${size} × ${count}`);

	const msg =
		`*Volume Debug*\n\n` +
		`Executed: ${executedTrades.length}\n` +
		`Confirmed (w/ txHash): ${confirmedTrades.length}\n` +
		`Unconfirmed: ${unconfirmedTrades.length}\n\n` +
		`*Old total: $${breakdown.total.toFixed(2)}*\n` +
		`*New total (confirmed): $${breakdown.totalWithTxHash.toFixed(2)}*\n\n` +
		`Confirmed by amount:\n${groupLines.join("\n")}`;

	await sendMessage(chatId, msg, { parseMode: "Markdown" });
}

async function handleTestMode(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet) {
		await sendMessage(
			chatId,
			"No trading wallet connected. Use /connect first.",
		);
		return;
	}

	// Apply ultra-safe test limits
	const applied = copyService.applyTestModeLimits(user.id);

	if (applied) {
		await sendMessage(
			chatId,
			`🧪 *Test Mode Activated*\n\n` +
			`Ultra-safe limits applied:\n` +
			`• Copy size: ${copyService.TEST_MODE_LIMITS.copyPercentage}% of source trade\n` +
			`• Max per trade: $${copyService.TEST_MODE_LIMITS.maxTradeSize}\n` +
			`• Max per market: $${copyService.TEST_MODE_LIMITS.maxPerMarket}\n` +
			`• Daily limit: $${copyService.TEST_MODE_LIMITS.dailyLimit}\n` +
			`• Auto-trading: DISABLED\n\n` +
			`These limits protect you while testing with real money.\n\n` +
			`To enable auto-trading:\n` +
			`1. Use /copy <wallet> recommend first (just alerts)\n` +
			`2. When ready: /limits enable\n\n` +
			`Use /limits to view or adjust settings.`,
			{ parseMode: "Markdown" },
		);
	} else {
		await sendMessage(chatId, "Failed to apply test mode. Please try again.");
	}
}

async function handleBalance(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet || !wallet.encryptedCredentials) {
		await sendMessage(
			chatId,
			"No trading wallet connected. Use /connect first.",
		);
		return;
	}

	await sendMessage(chatId, "Checking balance...");

	try {
		const credentials = decryptCredentials(wallet.encryptedCredentials);
		const client = await tradingService.createClobClient(
			(credentials as any).privateKey,
			{
				apiKey: credentials.apiKey,
				apiSecret: credentials.apiSecret,
				passphrase: credentials.passphrase,
			},
			wallet.proxyAddress || undefined  // Pass proxy address if set
		);

		const { balance, allowance } = await tradingService.getBalance(client, wallet.proxyAddress || undefined);

		const proxyInfo = wallet.proxyAddress
			? `Proxy: \`${wallet.proxyAddress}\`\n`
			: "";

		await sendMessage(
			chatId,
			`💰 *Wallet Balance*\n\n` +
			`Signer: \`${wallet.walletAddress}\`\n` +
			proxyInfo +
			`\nUSDC Balance: *$${balance.toFixed(2)}*\n` +
			`Allowance: $${allowance.toFixed(2)}` +
			(!wallet.proxyAddress ? `\n\n⚠️ No proxy set. If using Polymarket's web interface, use /setproxy <address>` : ""),
			{ parseMode: "Markdown" },
		);
	} catch (error: any) {
		logger.error("Failed to get balance", error);
		await sendMessage(chatId, `Failed to check balance: ${error.message}`);
	}
}

async function handlePositions(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet || !wallet.encryptedCredentials) {
		await sendMessage(
			chatId,
			"No trading wallet connected. Use /connect first.",
		);
		return;
	}

	await sendMessage(chatId, "Fetching positions...");

	try {
		const credentials = decryptCredentials(wallet.encryptedCredentials);
		const client = await tradingService.createClobClient(
			(credentials as any).privateKey,
			{
				apiKey: credentials.apiKey,
				apiSecret: credentials.apiSecret,
				passphrase: credentials.passphrase,
			},
			wallet.proxyAddress || undefined
		);

		const positions = await tradingService.getAllPositions(client, wallet.proxyAddress || undefined);

		if (positions.length === 0) {
			await sendMessage(
				chatId,
				"📊 *Your Positions*\n\nNo open positions.",
				{ parseMode: "Markdown" },
			);
			return;
		}

		// Calculate totals
		let totalValue = 0;
		let totalCost = 0;
		const lines: string[] = [];

		// Helper to format price in cents
		const formatPrice = (price: number) => {
			const cents = price * 100;
			if (cents < 1) return `${cents.toFixed(1)}¢`;
			return `${cents.toFixed(0)}¢`;
		};

		// Helper to format time remaining
		const formatTimeLeft = (endDate?: string) => {
			if (!endDate) return "";
			const end = new Date(endDate + "T23:59:59");
			const now = new Date();
			const diff = end.getTime() - now.getTime();

			if (diff <= 0) return "⏰ Ended";

			const days = Math.floor(diff / (1000 * 60 * 60 * 24));
			const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

			if (days > 30) {
				const months = Math.floor(days / 30);
				return `⏳ ${months}mo left`;
			}
			if (days > 0) return `⏳ ${days}d ${hours}h left`;
			if (hours > 0) return `⏳ ${hours}h left`;
			return "⏳ <1h left";
		};

		for (const pos of positions) {
			const value = pos.size * pos.curPrice;
			const cost = pos.size * pos.avgPrice;
			totalValue += value;
			totalCost += cost;

			// Potential payout if position wins (each share = $1)
			const payout = pos.size;
			const potentialProfit = payout - cost;

			const outcomeEmoji = pos.outcome?.toLowerCase() === "yes" ? "✅" : "❌";
			const title = pos.marketTitle
				? pos.marketTitle.length > 30
					? pos.marketTitle.slice(0, 30) + "..."
					: pos.marketTitle
				: "Unknown Market";

			// Format shares/payout - use K for large numbers
			const formatAmount = (amt: number) => {
				if (amt >= 1000) return `$${(amt / 1000).toFixed(1)}K`;
				return `$${amt.toFixed(2)}`;
			};

			const sharesStr = pos.size >= 1000
				? `${(pos.size / 1000).toFixed(1)}K`
				: pos.size.toFixed(1);

			const timeLeft = formatTimeLeft(pos.endDate);

			lines.push(
				`${outcomeEmoji} *${pos.outcome || "?"}* - ${sharesStr} @ ${formatPrice(pos.curPrice)}\n` +
				`   ${title}\n` +
				`   Value: ${formatAmount(value)} → Win: ${formatAmount(payout)} (+${formatAmount(potentialProfit)}) ${timeLeft}`
			);
		}

		// Calculate total potential payout
		const totalPayout = positions.reduce((sum, pos) => sum + pos.size, 0);
		const totalPotentialProfit = totalPayout - totalCost;

		// Format totals
		const formatTotal = (amt: number) => {
			if (amt >= 1000) return `$${(amt / 1000).toFixed(1)}K`;
			return `$${amt.toFixed(2)}`;
		};

		await sendMessage(
			chatId,
			`📊 *Your Positions* (${positions.length})\n\n` +
			lines.join("\n\n") +
			`\n\n💰 Value: *${formatTotal(totalValue)}*\n` +
			`🎯 If all win: *${formatTotal(totalPayout)}* (+${formatTotal(totalPotentialProfit)})`,
			{ parseMode: "Markdown" },
		);
	} catch (error: any) {
		logger.error("Failed to get positions", error);
		await sendMessage(chatId, `Failed to fetch positions: ${error.message}`);
	}
}

async function handleRedeem(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet || !wallet.encryptedCredentials) {
		await sendMessage(
			chatId,
			"No trading wallet connected. Use /connect first.",
		);
		return;
	}

	await sendMessage(chatId, "🔍 Checking for redeemable positions...");

	try {
		const credentials = decryptCredentials(wallet.encryptedCredentials);
		const client = await tradingService.createClobClient(
			(credentials as any).privateKey,
			{
				apiKey: credentials.apiKey,
				apiSecret: credentials.apiSecret,
				passphrase: credentials.passphrase,
			},
			wallet.proxyAddress || undefined
		);

		const positions = await tradingService.getAllPositions(client, wallet.proxyAddress || undefined);

		// Find positions at 100% (winners ready to redeem)
		const redeemable = positions.filter(pos => pos.curPrice >= 0.99);

		if (redeemable.length === 0) {
			await sendMessage(
				chatId,
				"📊 *No Redeemable Positions*\n\nNo positions at 100% to redeem. Positions need to be fully resolved (price = $1.00) before redemption.",
				{ parseMode: "Markdown" },
			);
			return;
		}

		await sendMessage(
			chatId,
			`Found ${redeemable.length} redeemable position(s). Redeeming...`,
		);

		let redeemed = 0;
		let totalValue = 0;
		const results: string[] = [];

		for (const pos of redeemable) {
			const result = await tradingService.redeemPosition(
				client,
				pos.tokenId,
				pos.size,
				true // isWinner
			);

			if (result.success) {
				redeemed++;
				totalValue += pos.size;
				results.push(`✅ ${pos.outcome} - ${pos.size.toFixed(2)} shares → $${pos.size.toFixed(2)}`);
			} else {
				results.push(`❌ ${pos.outcome} - Failed: ${result.error}`);
			}
		}

		await sendMessage(
			chatId,
			`💰 *Redemption Complete*\n\n` +
			`Redeemed: ${redeemed}/${redeemable.length}\n` +
			`Value: $${totalValue.toFixed(2)}\n\n` +
			results.join("\n"),
			{ parseMode: "Markdown" },
		);
	} catch (error: any) {
		logger.error("Failed to redeem positions", error);
		await sendMessage(chatId, `Failed to redeem: ${error.message}`);
	}
}

async function handleSetProxy(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const wallet = copyService.getTradingWallet(user.id);

	if (!wallet) {
		await sendMessage(
			chatId,
			"No trading wallet connected. Use /connect first.",
		);
		return;
	}

	const proxyAddress = args[0];

	if (!proxyAddress) {
		// Show current proxy and instructions
		if (wallet.proxyAddress) {
			await sendMessage(
				chatId,
				`*Current Proxy Wallet:* \`${wallet.proxyAddress}\`\n\n` +
				`To change: \`/setproxy <new_address>\`\n` +
				`To remove: \`/setproxy clear\``,
				{ parseMode: "Markdown" },
			);
		} else {
			await sendMessage(
				chatId,
				`*Set Proxy Wallet*\n\n` +
				`If you use Polymarket's web interface, your funds are in a proxy wallet.\n\n` +
				`Find your proxy address:\n` +
				`1. Go to polymarket.com\n` +
				`2. Click your profile\n` +
				`3. Copy the address shown (0x...)\n\n` +
				`Then: \`/setproxy <address>\``,
				{ parseMode: "Markdown" },
			);
		}
		return;
	}

	// Handle clear
	if (proxyAddress.toLowerCase() === "clear") {
		copyService.setProxyAddress(user.id, "");
		await sendMessage(chatId, "Proxy address cleared.");
		return;
	}

	// Validate address format
	if (!/^0x[a-fA-F0-9]{40}$/.test(proxyAddress)) {
		await sendMessage(chatId, "Invalid address format. Must be 0x followed by 40 hex characters.");
		return;
	}

	// Save proxy address
	const saved = copyService.setProxyAddress(user.id, proxyAddress);

	if (saved) {
		await sendMessage(
			chatId,
			`✅ *Proxy Wallet Set*\n\n` +
			`Proxy: \`${proxyAddress}\`\n\n` +
			`The bot will now check balance and trade using this address.\n` +
			`Run /balance to verify.`,
			{ parseMode: "Markdown" },
		);
	} else {
		await sendMessage(chatId, "Failed to save proxy address.");
	}
}

// =============================================
// IGNORED MARKETS COMMANDS
// =============================================

async function handleIgnore(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const pattern = args.join(" ").trim();

	if (!pattern) {
		await sendMessage(
			chatId,
			"*Ignore Markets*\n\n" +
			"Prevent copy trading on specific markets by pattern.\n\n" +
			"Usage: `/ignore <pattern>`\n\n" +
			"Examples:\n" +
			"• `/ignore NBA Finals`\n" +
			"• `/ignore Super Bowl`\n" +
			"• `/ignore Bitcoin`\n\n" +
			"The pattern matches any part of the market title (case-insensitive).",
			{ parseMode: "Markdown" },
		);
		return;
	}

	const added = copyService.addIgnoredMarket(user.id, pattern);

	if (added) {
		await sendMessage(
			chatId,
			`✅ Added "\`${pattern}\`" to your ignore list.\n\nCopy trades matching this pattern will be skipped.`,
			{ parseMode: "Markdown" },
		);
	} else {
		await sendMessage(chatId, "Failed to add pattern. Please try again.");
	}
}

async function handleUnignore(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const pattern = args.join(" ").trim();

	if (!pattern) {
		await sendMessage(
			chatId,
			"Usage: `/unignore <pattern>`\n\nRemoves a pattern from your ignore list.",
			{ parseMode: "Markdown" },
		);
		return;
	}

	const removed = copyService.removeIgnoredMarket(user.id, pattern);

	if (removed) {
		await sendMessage(
			chatId,
			`✅ Removed "\`${pattern}\`" from your ignore list.`,
			{ parseMode: "Markdown" },
		);
	} else {
		await sendMessage(chatId, "Failed to remove pattern. It may not exist in your list.");
	}
}

async function handleIgnored(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const patterns = copyService.getIgnoredMarkets(user.id);

	if (patterns.length === 0) {
		await sendMessage(
			chatId,
			"*Ignored Markets*\n\n" +
			"No patterns in your ignore list.\n\n" +
			"Use `/ignore <pattern>` to add one.",
			{ parseMode: "Markdown" },
		);
		return;
	}

	const lines = patterns.map((p, i) => `${i + 1}. \`${p}\``);

	await sendMessage(
		chatId,
		`*Ignored Markets (${patterns.length})*\n\n` +
		`${lines.join("\n")}\n\n` +
		`Use \`/unignore <pattern>\` to remove.`,
		{ parseMode: "Markdown" },
	);
}

async function handleResetVolume(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const beforeVolume = copyService.getTodaysCopyTotal(user.id);
	copyService.resetTodaysVolume(user.id);

	await sendMessage(
		chatId,
		`✅ *Volume Reset*\n\n` +
		`Previous: $${beforeVolume.toFixed(0)}\n` +
		`Current: $0\n\n` +
		`Your daily limit counter has been reset.`,
		{ parseMode: "Markdown" },
	);
}

// =============================================
// SPORTS BETTING COMMANDS
// =============================================

async function handleSports(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const subcommand = args[0]?.toLowerCase();

	switch (subcommand) {
		case "status": {
			const status = sportsService.getStatus(user.id);
			const config = status.config;

			// Get current exposure
			const currentExposure = sportsService.getTotalOpenExposure(user.id);

			// Get balance for exposure limit calculation
			let balance = 0;
			try {
				const wallet = copyService.getTradingWallet(user.id);
				if (wallet?.encryptedCredentials) {
					const credentials = decryptCredentials(wallet.encryptedCredentials);
					const client = await tradingService.createClobClient(
						(credentials as any).privateKey,
						{
							apiKey: credentials.apiKey,
							apiSecret: credentials.apiSecret,
							passphrase: credentials.passphrase,
						},
						wallet.proxyAddress || undefined
					);
					const balanceResult = await tradingService.getBalance(client, wallet.proxyAddress || undefined);
					balance = balanceResult.balance;
				}
			} catch {
				// Ignore balance errors
			}

			const maxExposure = balance * config.maxExposurePct;
			const exposureAvailable = Math.max(0, maxExposure - currentExposure);

			// Clean up sport names
			const enabledSports = config.sports
				.map(s => s
					.replace("basketball_", "")
					.replace("americanfootball_", "")
					.replace("icehockey_", "")
					.replace("baseball_", "")
					.replace("soccer_", "")
					.replace("tennis_", "")
					.replace(/_/g, " ")
					.toUpperCase()
				)
				.join(", ") || "None";

			const dynamicEdgeInfo = config.dynamicEdgeEnabled
				? `${(config.minEdge4Books * 100).toFixed(1)}%-${(config.minEdge2Books * 100).toFixed(1)}% (dynamic)`
				: `${(config.minEdge * 100).toFixed(1)}%`;

			const sizingInfo = config.sharesPerBet > 0
				? `${config.sharesPerBet} shares (scales to ${config.sharesPerBet * config.maxEdgeMultiplier} w/ edge)`
				: `$${config.minBetUsd} - $${config.maxBetUsd}`;

			await sendMessage(
				chatId,
				`🏀 *Sports Betting Status*\n\n` +
				`*Monitoring:* ${status.monitoring ? "✅ Running" : "⏸ Stopped"}\n` +
				`*Auto-trade:* ${config.autoTrade ? "ON" : "OFF"}\n\n` +
				`*Exposure:*\n` +
				`• Current: $${currentExposure.toFixed(0)} / $${maxExposure.toFixed(0)} (${(config.maxExposurePct * 100).toFixed(0)}% of bankroll)\n` +
				`• Available: $${exposureAvailable.toFixed(0)}\n\n` +
				`*Entry Rules:*\n` +
				`• Min edge: ${dynamicEdgeInfo}\n` +
				`• Min price: ${(config.minPrice * 100).toFixed(0)}¢\n` +
				`• Max per market: $${config.maxPerMarket} / ${config.maxSharesPerMarket} shares\n` +
				`• Books required: ${config.booksRequired}+\n` +
				`• Timing: ${config.preGameBufferMinutes > 0 ? `Skip 0-${config.preGameBufferMinutes}min before start, live OK` : "No timing restrictions"}\n` +
				`• Sizing: ${sizingInfo}\n\n` +
				`*Exit Rules:*\n` +
				`• All exits DISABLED - hold to resolution\n` +
				`• Positions close when market settles\n\n` +
				`*Sports:* ${enabledSports}\n\n` +
				`*Activity:*\n` +
				`• Today's volume: $${status.todaysVolume.toFixed(0)}\n` +
				`• Today's P&L: ${status.todaysPnl >= 0 ? `+$${status.todaysPnl.toFixed(2)}` : `-$${Math.abs(status.todaysPnl).toFixed(2)}`}\n` +
				`• Current scan: ${status.valueBetsFound} value bets\n` +
				`• Last poll: ${status.lastPoll ? new Date(status.lastPoll).toLocaleTimeString() : "Never"}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "enable": {
			const sport = args[1]?.toLowerCase();
			if (!sport) {
				await sendMessage(
					chatId,
					"Usage: /sports enable <sport>\n\nSports: nba, ncaab, nfl, mlb, nhl, soccer, tennis",
				);
				return;
			}

			const sportMap: Record<string, string> = {
				nba: "basketball_nba",
				ncaab: "basketball_ncaab",
				ncaa: "basketball_ncaab",
				cbb: "basketball_ncaab",
				nfl: "americanfootball_nfl",
				mlb: "baseball_mlb",
				nhl: "icehockey_nhl",
				soccer: "soccer_epl",
				tennis: "tennis_atp_aus_open",
			};

			const sportKey = sportMap[sport];
			if (!sportKey) {
				await sendMessage(chatId, `Unknown sport: ${sport}`);
				return;
			}

			const config = sportsService.getSportsConfig(user.id);
			if (!config.sports.includes(sportKey)) {
				config.sports.push(sportKey);
				sportsService.updateSportsConfig(user.id, { sports: config.sports });
			}

			await sendMessage(chatId, `✅ Enabled ${sport.toUpperCase()} for value betting`);
			break;
		}

		case "disable": {
			const sport = args[1]?.toLowerCase();
			if (!sport) {
				await sendMessage(chatId, "Usage: /sports disable <sport>");
				return;
			}

			const sportMap: Record<string, string> = {
				nba: "basketball_nba",
				ncaab: "basketball_ncaab",
				ncaa: "basketball_ncaab",
				cbb: "basketball_ncaab",
				nfl: "americanfootball_nfl",
				mlb: "baseball_mlb",
				nhl: "icehockey_nhl",
				soccer: "soccer_epl",
				tennis: "tennis_atp_aus_open",
			};

			const sportKey = sportMap[sport];
			if (!sportKey) {
				await sendMessage(chatId, `Unknown sport: ${sport}`);
				return;
			}

			const config = sportsService.getSportsConfig(user.id);
			config.sports = config.sports.filter((s) => s !== sportKey);
			sportsService.updateSportsConfig(user.id, { sports: config.sports });

			await sendMessage(chatId, `🛑 Disabled ${sport.toUpperCase()}`);
			break;
		}

		case "start": {
			const config = sportsService.getSportsConfig(user.id);
			if (!config.autoTrade) {
				await sendMessage(chatId, "⚠️ Auto-trade is OFF. Use `/sports auto on` first, or monitoring will only find bets without placing them.");
			}
			sportsService.startMonitoring(user.id);
			await sendMessage(
				chatId,
				`🚀 *Sports betting monitor started!*\n\n` +
				`Polling every 15 seconds for value bets.\n` +
				`Sports: ${config.sports.map(s => s.replace("basketball_", "").replace("americanfootball_", "").toUpperCase()).join(", ")}\n` +
				`Min edge: ${(config.minEdge * 100).toFixed(0)}%\n` +
				`Max bet: $${config.maxBetUsd}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "stop": {
			sportsService.stopMonitoring();
			await sendMessage(chatId, "🛑 Sports betting monitor stopped");
			break;
		}

		case "markets": {
			// Show what Polymarket sports markets actually exist for configured sports
			const config = sportsService.getSportsConfig(user.id);
			const polyEvents = await sportsService.fetchPolymarketSportsEvents(config.sports);

			if (polyEvents.length === 0) {
				await sendMessage(chatId, "No Polymarket sports events found for your configured sports.");
				return;
			}

			const lines = polyEvents.slice(0, 15).map((e: any) => `• ${e.title}`);
			await sendMessage(
				chatId,
				`📊 *Polymarket Sports Events (${polyEvents.length} total)*\n\n${lines.join("\n")}\n\n${polyEvents.length > 15 ? `...and ${polyEvents.length - 15} more` : ""}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "scan": {
			await sendMessage(chatId, "🔍 Scanning for value bets (check server logs for debug info)...");
			const config = sportsService.getSportsConfig(user.id);

			// Fetch Polymarket events FIRST (source of truth)
			const polyEvents = await sportsService.fetchPolymarketSportsEvents(config.sports);

			// Fetch odds from Odds API
			const odds = await sportsService.fetchAllConfiguredOdds(config);

			// Pass debug=true to log all comparisons to server console
			const valueBets = await sportsService.findValueBets(odds, polyEvents, config, true);

			if (valueBets.length === 0) {
				await sendMessage(
					chatId,
					`No value bets found.\n\n` +
					`Scanned ${odds.length} matches, ${polyEvents.length} Polymarket events.\n` +
					`Min edge: ${(config.minEdge * 100).toFixed(0)}%\n\n` +
					`Check server logs for detailed comparison data.`,
				);
			} else {
				const lines = valueBets.slice(0, 5).map((bet) => {
					return `*${bet.homeTeam} vs ${bet.awayTeam}*\n` +
						`${bet.outcome} @ ${(bet.polymarketPrice * 100).toFixed(1)}¢ (fair: ${(bet.sharpProb * 100).toFixed(2)}¢)\n` +
						`Edge: +${(bet.edge * 100).toFixed(1)}%`;
				});
				await sendMessage(
					chatId,
					`🎯 *Found ${valueBets.length} Value Bets*\n\n${lines.join("\n\n")}\n\n` +
					`Use \`/sports start\` to begin auto-betting.`,
					{ parseMode: "Markdown" },
				);
			}
			break;
		}

		case "auto": {
			const toggle = args[1]?.toLowerCase();
			if (toggle === "on") {
				sportsService.updateSportsConfig(user.id, { autoTrade: true });
				await sendMessage(chatId, "✅ Auto-trading enabled for sports bets");
			} else if (toggle === "off") {
				sportsService.updateSportsConfig(user.id, { autoTrade: false });
				await sendMessage(chatId, "🛑 Auto-trading disabled");
			} else {
				await sendMessage(chatId, "Usage: /sports auto <on|off>");
			}
			break;
		}

		case "edge": {
			const edge = parseFloat(args[1] || "");
			if (isNaN(edge) || edge < 1 || edge > 50) {
				await sendMessage(chatId, "Usage: /sports edge <percent>\n\nExample: /sports edge 5 (for 5% min edge)");
				return;
			}
			sportsService.updateSportsConfig(user.id, { minEdge: edge / 100 });
			await sendMessage(chatId, `✅ Minimum edge set to ${edge}%`);
			break;
		}

		case "maxbet": {
			const max = parseFloat(args[1] || "");
			if (isNaN(max) || max < 1) {
				await sendMessage(chatId, "Usage: /sports maxbet <amount>\n\nExample: /sports maxbet 100");
				return;
			}
			sportsService.updateSportsConfig(user.id, { maxBetUsd: max });
			await sendMessage(chatId, `✅ Max bet set to $${max}`);
			break;
		}

		case "maxmarket": {
			const max = parseFloat(args[1] || "");
			if (isNaN(max) || max < 1) {
				await sendMessage(chatId, "Usage: /sports maxmarket <amount>\n\nExample: /sports maxmarket 50\n\nThis limits total exposure per outcome (e.g., max $50 on any single team)");
				return;
			}
			sportsService.updateSportsConfig(user.id, { maxPerMarket: max });
			await sendMessage(chatId, `✅ Max per market set to $${max}`);
			break;
		}

		case "minprice": {
			const price = parseFloat(args[1] || "");
			if (isNaN(price) || price < 0 || price > 99) {
				await sendMessage(chatId, "Usage: /sports minprice <cents>\n\nExample: /sports minprice 20\n\nThis prevents betting on outcomes priced below this threshold (e.g., 20 = 20¢ = no extreme underdogs).\n\nSet to 0 to disable.");
				return;
			}
			// Convert cents to decimal (e.g., 25 -> 0.25)
			const minPrice = price >= 1 ? price / 100 : price;
			sportsService.updateSportsConfig(user.id, { minPrice });
			if (minPrice === 0) {
				await sendMessage(chatId, `✅ Min price disabled - will bet on any odds`);
			} else {
				await sendMessage(chatId, `✅ Min price set to ${(minPrice * 100).toFixed(0)}¢ - won't bet on outcomes below this`);
			}
			break;
		}

		case "shares": {
			const shares = parseInt(args[1] || "", 10);
			if (isNaN(shares) || shares < 0) {
				await sendMessage(chatId, "Usage: /sports shares <amount>\n\nExample: /sports shares 25\n\nBuy fixed number of shares per bet (e.g., 25 shares).\n\nSet to 0 to use dollar-based sizing instead.");
				return;
			}
			sportsService.updateSportsConfig(user.id, { sharesPerBet: shares });
			if (shares === 0) {
				await sendMessage(chatId, `✅ Share-based sizing disabled - using dollar amounts`);
			} else {
				await sendMessage(chatId, `✅ Shares per bet set to ${shares}`);
			}
			break;
		}

		case "maxshares": {
			const max = parseInt(args[1] || "", 10);
			if (isNaN(max) || max < 1) {
				await sendMessage(chatId, "Usage: /sports maxshares <amount>\n\nExample: /sports maxshares 100\n\nMax shares per outcome (e.g., max 100 shares on any single team)");
				return;
			}
			sportsService.updateSportsConfig(user.id, { maxSharesPerMarket: max });
			await sendMessage(chatId, `✅ Max shares per market set to ${max}`);
			break;
		}

		case "maxperevent": {
			const max = parseInt(args[1] || "", 10);
			if (isNaN(max) || max < 1 || max > 50) {
				await sendMessage(chatId, "Usage: /sports maxperevent <count>\n\nExample: /sports maxperevent 15\n\nRange: 1-50");
				return;
			}
			sportsService.updateSportsConfig(user.id, { maxBetsPerEvent: max });
			await sendMessage(chatId, `✅ Max bets per event set to ${max}`);
			break;
		}

		case "exposure": {
			const pct = parseInt(args[1] || "", 10);
			if (isNaN(pct) || pct < 1 || pct > 100) {
				await sendMessage(chatId, "Usage: /sports exposure <percent>\n\nExample: /sports exposure 25 (for 25% of bankroll)\n\nRange: 1-100");
				return;
			}
			sportsService.updateSportsConfig(user.id, { maxExposurePct: pct / 100 });
			await sendMessage(chatId, `✅ Max exposure set to ${pct}% of bankroll`);
			break;
		}

		case "minsellprofit": {
			const pct = parseInt(args[1] || "", 10);
			if (isNaN(pct) || pct < 0 || pct > 100) {
				await sendMessage(chatId, "Usage: /sports minsellprofit <percent>\n\nExample: /sports minsellprofit 10\n\nOnly sell positions when profit is at least this % (default: 5%)");
				return;
			}
			sportsService.updateSportsConfig(user.id, { minSellProfit: pct / 100 });
			await sendMessage(chatId, `✅ Min sell profit set to ${pct}%`);
			break;
		}

		case "dynamic": {
			const toggle = args[1]?.toLowerCase();
			if (toggle === "on") {
				sportsService.updateSportsConfig(user.id, { dynamicEdgeEnabled: true });
				await sendMessage(chatId, "✅ Dynamic edge enabled - uses 2.5%-5% based on book consensus");
			} else if (toggle === "off") {
				sportsService.updateSportsConfig(user.id, { dynamicEdgeEnabled: false });
				const config = sportsService.getSportsConfig(user.id);
				await sendMessage(chatId, `✅ Dynamic edge disabled - using fixed ${(config.minEdge * 100).toFixed(1)}% threshold`);
			} else {
				const config = sportsService.getSportsConfig(user.id);
				const status = config.dynamicEdgeEnabled ? "ON (2.5%-5%)" : `OFF (${(config.minEdge * 100).toFixed(1)}%)`;
				await sendMessage(chatId, `Dynamic edge: *${status}*\n\nUsage: /sports dynamic <on|off>`, { parseMode: "Markdown" });
			}
			break;
		}

		case "value": {
			const valueBets = sportsService.getCurrentValueBets();
			if (valueBets.length === 0) {
				await sendMessage(chatId, "No value bets found right now.\n\nUse /sports status to check settings.");
				return;
			}

			const lines = valueBets.slice(0, 5).map((bet) => {
				return `*${bet.homeTeam} vs ${bet.awayTeam}*\n` +
					`${bet.outcome} @ ${(bet.polymarketPrice * 100).toFixed(1)}¢ (fair: ${(bet.sharpProb * 100).toFixed(2)}¢)\n` +
					`Edge: +${(bet.edge * 100).toFixed(1)}%`;
			});

			await sendMessage(
				chatId,
				`🎯 *Value Bets Found: ${valueBets.length}*\n\n${lines.join("\n\n")}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "history": {
			const history = sportsService.getSportsBetHistory(user.id, 10);
			if (history.length === 0) {
				await sendMessage(chatId, "No sports betting history yet.");
				return;
			}

			const lines = history.map((bet) => {
				const date = new Date(bet.createdAt * 1000).toLocaleDateString();
				return `${date} | ${bet.sport} | ${bet.outcome}\n` +
					`$${bet.size.toFixed(0)} @ ${(bet.edge * 100).toFixed(1)}% edge`;
			});

			await sendMessage(
				chatId,
				`📊 *Recent Sports Bets*\n\n${lines.join("\n\n")}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "sync": {
			await sendMessage(chatId, "🔄 Syncing positions with Polymarket...");
			try {
				const syncResult = await sportsService.reconcilePositions(user.id);
				await sendMessage(
					chatId,
					`✅ *Sync Complete*\n\n` +
					`• Positions in DB: ${syncResult.synced}\n` +
					`• Removed (sold/resolved): ${syncResult.removed}\n` +
					`• Added from Polymarket: ${syncResult.added}`,
					{ parseMode: "Markdown" },
				);
			} catch (error) {
				await sendMessage(chatId, `❌ Sync failed: ${error}`);
			}
			break;
		}

		case "reset": {
			const result = sportsService.resetSportsBets(user.id);
			await sendMessage(
				chatId,
				`✅ *Sports Bets Reset*\n\n` +
				`Deleted ${result.deleted} bets from database.\n\n` +
				`⚠️ Note: This only clears the database tracking. Any open positions on Polymarket remain - you'll need to sell them manually if desired.`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "help": {
			await sendMessage(
				chatId,
				`🏀 *Sports Value Betting*\n\n` +
				`Find and bet on Polymarket sports markets where the price is below sharp bookmaker lines.\n\n` +
				`*Commands:*\n` +
				`/sports - Show status & rules\n\n` +
				`*Monitor:*\n` +
				`/sports start - Start auto-betting\n` +
				`/sports stop - Stop monitoring\n` +
				`/sports auto <on|off> - Toggle auto-trade\n` +
				`/sports scan - One-time scan\n\n` +
				`*Entry Settings:*\n` +
				`/sports edge <pct> - Min edge (e.g., 4.2)\n` +
				`/sports minprice <cents> - Min price (e.g., 20)\n` +
				`/sports maxmarket <$> - Max $ per outcome\n` +
				`/sports maxshares <n> - Max shares per outcome\n` +
				`/sports shares <n> - Shares per bet\n` +
				`/sports exposure <pct> - Max bankroll %\n\n` +
				`*Sports:*\n` +
				`/sports enable <sport> - Enable (nba, ncaab, nfl, nhl)\n` +
				`/sports disable <sport> - Disable\n\n` +
				`*View:*\n` +
				`/sports value - Current value bets\n` +
				`/sports history - Betting history\n` +
				`/sports sync - Sync with Polymarket`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		default:
			// If no subcommand, show status by default
			if (!subcommand) {
				const status = sportsService.getStatus(user.id);
				const cfg = status.config;

				// Get current exposure
				const currentExposure = sportsService.getTotalOpenExposure(user.id);

				// Get balance for exposure limit calculation
				let balance = 0;
				try {
					const wallet = copyService.getTradingWallet(user.id);
					if (wallet?.encryptedCredentials) {
						const credentials = decryptCredentials(wallet.encryptedCredentials);
						const client = await tradingService.createClobClient(
							(credentials as any).privateKey,
							{
								apiKey: credentials.apiKey,
								apiSecret: credentials.apiSecret,
								passphrase: credentials.passphrase,
							},
							wallet.proxyAddress || undefined
						);
						const balanceResult = await tradingService.getBalance(client, wallet.proxyAddress || undefined);
						balance = balanceResult.balance;
					}
				} catch {
					// Ignore balance errors
				}

				const maxExposure = balance * cfg.maxExposurePct;
				const exposureAvailable = Math.max(0, maxExposure - currentExposure);

				// Clean up sport names
				const enabledSports = cfg.sports
					.map(s => s
						.replace("basketball_", "")
						.replace("americanfootball_", "")
						.replace("icehockey_", "")
						.replace("baseball_", "")
						.replace("soccer_", "")
						.replace("tennis_", "")
						.replace(/_/g, " ")
						.toUpperCase()
					)
					.join(", ") || "None";

				const dynamicEdgeInfo = cfg.dynamicEdgeEnabled
					? `${(cfg.minEdge4Books * 100).toFixed(1)}%-${(cfg.minEdge2Books * 100).toFixed(1)}% (dynamic)`
					: `${(cfg.minEdge * 100).toFixed(1)}%`;

				const sizingInfo = cfg.sharesPerBet > 0
					? `${cfg.sharesPerBet} shares (scales to ${cfg.sharesPerBet * cfg.maxEdgeMultiplier} w/ edge)`
					: `$${cfg.minBetUsd} - $${cfg.maxBetUsd}`;

				await sendMessage(
					chatId,
					`🏀 *Sports Betting Status*\n\n` +
					`*Monitoring:* ${status.monitoring ? "✅ Running" : "⏸ Stopped"}\n` +
					`*Auto-trade:* ${cfg.autoTrade ? "ON" : "OFF"}\n\n` +
					`*Exposure:*\n` +
					`• Current: $${currentExposure.toFixed(0)} / $${maxExposure.toFixed(0)} (${(cfg.maxExposurePct * 100).toFixed(0)}% of bankroll)\n` +
					`• Available: $${exposureAvailable.toFixed(0)}\n\n` +
					`*Entry Rules:*\n` +
					`• Min edge: ${dynamicEdgeInfo}\n` +
					`• Min price: ${(cfg.minPrice * 100).toFixed(0)}¢\n` +
					`• Max per market: $${cfg.maxPerMarket} / ${cfg.maxSharesPerMarket} shares\n` +
					`• Books required: ${cfg.booksRequired}+\n` +
					`• Timing: ${cfg.preGameBufferMinutes > 0 ? `Skip 0-${cfg.preGameBufferMinutes}min before start, live OK` : "No timing restrictions"}\n` +
					`• Sizing: ${sizingInfo}\n\n` +
					`*Exit Rules:*\n` +
					`• All exits DISABLED - hold to resolution\n` +
					`• Positions close when market settles\n\n` +
					`*Sports:* ${enabledSports}\n\n` +
					`*Activity:*\n` +
					`• Today's volume: $${status.todaysVolume.toFixed(0)}\n` +
					`• Today's P&L: ${status.todaysPnl >= 0 ? `+$${status.todaysPnl.toFixed(2)}` : `-$${Math.abs(status.todaysPnl).toFixed(2)}`}\n` +
					`• Current scan: ${status.valueBetsFound} value bets\n` +
					`• Last poll: ${status.lastPoll ? new Date(status.lastPoll).toLocaleTimeString() : "Never"}\n\n` +
					`_Use /sports help for commands_`,
					{ parseMode: "Markdown" },
				);
			} else {
				// Unknown subcommand - show help
				await sendMessage(
					chatId,
					`🏀 *Sports Value Betting*\n\n` +
					`Bets on Polymarket sports when price < sharp bookmaker EV.\n\n` +
					`*Commands:*\n` +
					`/sports - Show status & rules\n\n` +
					`*Monitor:*\n` +
					`/sports start - Start auto-betting\n` +
					`/sports stop - Stop monitoring\n` +
					`/sports auto <on|off> - Toggle auto-trade\n\n` +
					`*Entry Settings:*\n` +
					`/sports edge <pct> - Min edge threshold\n` +
					`/sports dynamic <on|off> - Dynamic edge (2.5-5%)\n` +
					`/sports minprice <cents> - Min price\n` +
					`/sports maxmarket <$> - Max $ per outcome\n` +
					`/sports shares <n> - Shares per bet\n` +
					`/sports maxshares <n> - Max shares per outcome\n` +
					`/sports maxperevent <n> - Max bets per event\n` +
					`/sports exposure <pct> - Max % bankroll exposed\n\n` +
					`*Sports:*\n` +
					`/sports enable/disable <sport>\n\n` +
					`*View:*\n` +
					`/sports value - Current opportunities\n` +
					`/sports history - Bet history`,
					{ parseMode: "Markdown" },
				);
			}
	}
}

// =============================================
// SUBSCRIPTION COMMANDS
// =============================================

async function handlePlan(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const info = await stripeService.getSubscriptionInfo(user.id);
	const pricing = stripeService.getPricingInfo();

	const tierEmoji = {
		free: "🆓",
		pro: "⭐",
		enterprise: "💎",
	};

	const tierLimits = {
		free: { wallets: 5, alerts: 100, copyTrading: false },
		pro: { wallets: 50, alerts: 1000, copyTrading: true },
		enterprise: { wallets: 500, alerts: 10000, copyTrading: true },
	};

	const current = tierLimits[info.tier];
	const expiryText = info.expiresAt
		? `\nRenews: ${new Date(info.expiresAt * 1000).toLocaleDateString()}`
		: "";
	const cancelText = info.cancelAtPeriodEnd ? " (cancels at period end)" : "";

	const message = `${tierEmoji[info.tier]} *Your Plan: ${info.tier.toUpperCase()}*${cancelText}${expiryText}

*Current Limits:*
• Tracked wallets: ${current.wallets}
• Alerts/day: ${current.alerts}
• Copy trading: ${current.copyTrading ? "Yes" : "No"}

*Available Plans:*

⭐ *Pro* - $${pricing.pro}/month
• 50 tracked wallets
• 1,000 alerts/day
• Copy trading enabled

💎 *Enterprise* - $${pricing.enterprise}/month
• 500 tracked wallets
• 10,000 alerts/day
• Copy trading enabled
• Priority support

Use /subscribe pro or /subscribe enterprise to upgrade.`;

	await sendMessage(chatId, message, { parseMode: "Markdown" });
}

async function handleSubscribe(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const tier = args[0]?.toLowerCase() as "pro" | "enterprise" | undefined;

	if (!tier || (tier !== "pro" && tier !== "enterprise")) {
		await sendMessage(
			chatId,
			"Usage: /subscribe <pro|enterprise>\n\nUse /plan to see pricing details.",
		);
		return;
	}

	// Check if Stripe is configured
	if (!config.STRIPE_SECRET_KEY) {
		await sendMessage(
			chatId,
			"Payments are not configured. Please contact support.",
		);
		return;
	}

	const priceId =
		tier === "pro"
			? config.STRIPE_PRO_PRICE_ID
			: config.STRIPE_ENTERPRISE_PRICE_ID;

	if (!priceId) {
		await sendMessage(
			chatId,
			`${tier} plan is not available yet. Please contact support.`,
		);
		return;
	}

	try {
		await sendMessage(chatId, "Creating checkout session...");

		// Create checkout URL
		const baseUrl =
			config.WEBHOOK_URL || "https://t.me/polymarket_trade_watch_bot";
		const checkoutUrl = await stripeService.createCheckoutSession(
			user.id,
			user.telegram_username,
			tier,
			`${baseUrl}?success=true`,
			`${baseUrl}?canceled=true`,
		);

		if (checkoutUrl) {
			const keyboard = createInlineKeyboard([
				[{ text: `Subscribe to ${tier.toUpperCase()}`, url: checkoutUrl }],
			]);

			await sendMessage(
				chatId,
				`Click below to complete your ${tier.toUpperCase()} subscription:`,
				{ replyMarkup: keyboard },
			);
		} else {
			await sendMessage(
				chatId,
				"Failed to create checkout session. Please try again.",
			);
		}
	} catch (error: any) {
		logger.error("Failed to create checkout", error);
		await sendMessage(chatId, `Error: ${error.message}`);
	}
}

async function handleBilling(
	user: userRepo.UserWithSettings,
	chatId: string,
): Promise<void> {
	const info = await stripeService.getSubscriptionInfo(user.id);

	if (!info.customerId) {
		await sendMessage(
			chatId,
			"You don't have a subscription yet. Use /subscribe to get started.",
		);
		return;
	}

	try {
		const baseUrl =
			config.WEBHOOK_URL || "https://t.me/polymarket_trade_watch_bot";
		const portalUrl = await stripeService.createBillingPortalSession(
			user.id,
			baseUrl,
		);

		const keyboard = createInlineKeyboard([
			[{ text: "Manage Subscription", url: portalUrl }],
		]);

		await sendMessage(
			chatId,
			"*Billing Portal*\n\nClick below to manage your subscription, update payment method, or view invoices.",
			{ parseMode: "Markdown", replyMarkup: keyboard },
		);
	} catch (error: any) {
		logger.error("Failed to create billing portal", error);
		await sendMessage(chatId, `Error: ${error.message}`);
	}
}

// =============================================
// PAPER TRADING COMMANDS
// =============================================

async function handlePaper(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	const subcommand = args[0]?.toLowerCase();

	switch (subcommand) {
		case "start": {
			const amount = parseFloat(args[1] || "10000");

			if (isNaN(amount) || amount < 100) {
				await sendMessage(
					chatId,
					"Amount must be at least $100\n\nUsage: /paper start [amount]",
				);
				return;
			}

			const result = paperService.startPaperTrading(user.id, amount);
			if (result.success) {
				await sendMessage(
					chatId,
					`*Paper Trading Started!*\n\nStarting balance: $${amount.toFixed(2)}\n\nNow add wallets to track:\n/paper add <wallet>\n\nExample: /paper add 0x123...`,
					{ parseMode: "Markdown" },
				);
			} else {
				await sendMessage(chatId, `Failed: ${result.error}`);
			}
			break;
		}

		case "add": {
			const wallet = args[1]?.toLowerCase();
			if (!wallet || !isValidAddress(wallet)) {
				await sendMessage(
					chatId,
					"Usage: /paper add <wallet>\n\nExample: /paper add 0x123...",
				);
				return;
			}

			const result = paperService.addWalletToPortfolio(user.id, wallet);
			if (result.success) {
				const trackedWallets = paperService.getTrackedWallets(user.id);
				await sendMessage(
					chatId,
					`*Wallet Added!*\n\nNow tracking: \`${wallet.slice(0, 10)}...${wallet.slice(-6)}\`\n\nTotal wallets: ${trackedWallets.length}\n\nTrades from this wallet will be simulated in your paper portfolio.`,
					{ parseMode: "Markdown" },
				);
			} else {
				await sendMessage(chatId, `Failed: ${result.error}`);
			}
			break;
		}

		case "remove": {
			const wallet = args[1]?.toLowerCase();
			if (!wallet || !isValidAddress(wallet)) {
				await sendMessage(chatId, "Usage: /paper remove <wallet>");
				return;
			}

			const result = paperService.removeWalletFromPortfolio(user.id, wallet);
			if (result.success) {
				await sendMessage(
					chatId,
					`Removed \`${wallet.slice(0, 10)}...\` from paper portfolio.`,
					{ parseMode: "Markdown" },
				);
			} else {
				await sendMessage(chatId, `Failed: ${result.error}`);
			}
			break;
		}

		case "stop": {
			const result = paperService.stopPaperTrading(user.id);
			if (result.success && result.portfolio) {
				const pnlSign = result.portfolio.pnl >= 0 ? "+" : "";
				await sendMessage(
					chatId,
					`*Paper Trading Stopped*\n\nFinal Results:\nStarting: $${result.portfolio.startingBalance.toFixed(2)}\nEnding: $${result.portfolio.totalValue.toFixed(2)}\nP&L: ${pnlSign}$${result.portfolio.pnl.toFixed(2)} (${pnlSign}${result.portfolio.pnlPercent.toFixed(1)}%)\nTotal Trades: ${result.portfolio.trades}`,
					{ parseMode: "Markdown" },
				);
			} else {
				await sendMessage(chatId, "No active paper portfolio to stop.");
			}
			break;
		}

		case "reset": {
			const amount = parseFloat(args[1] || "10000");
			const result = paperService.resetPaperPortfolio(user.id, amount);
			if (result.success) {
				await sendMessage(
					chatId,
					`*Paper Portfolio Reset*\n\n` +
					`All positions cleared.\n` +
					`New balance: $${amount.toFixed(2)}\n\n` +
					`Your tracked wallets are still active.`,
					{ parseMode: "Markdown" },
				);
			} else {
				await sendMessage(chatId, `Failed: ${result.error}`);
			}
			break;
		}

		case "status": {
			const portfolio = paperService.getPaperPortfolio(user.id);
			if (!portfolio) {
				await sendMessage(
					chatId,
					"No active paper trading.\n\nStart with: /paper start [amount]",
				);
				return;
			}

			const summary = paperService.formatPortfolioSummary(portfolio);
			await sendMessage(chatId, summary, { parseMode: "Markdown" });
			break;
		}

		case "history": {
			const trades = paperService.getPaperTradeHistory(user.id, 15);
			if (trades.length === 0) {
				await sendMessage(
					chatId,
					"No paper trades yet.\n\nAdd wallets to track with /paper add <wallet>",
				);
				return;
			}

			const lines = trades.map((t) => {
				const title =
					t.marketTitle.length > 20
						? t.marketTitle.slice(0, 20) + "..."
						: t.marketTitle;
				const emoji = t.side === "BUY" ? "🟢" : "🔴";
				const walletShort = t.sourceWallet.slice(0, 6) + "...";
				return `${emoji} $${t.value.toFixed(0)} ${title}\n   _from ${walletShort}_`;
			});

			await sendMessage(
				chatId,
				`*Paper Trade History*\n\n${lines.join("\n\n")}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "golive": {
			const portfolio = paperService.getPaperPortfolio(user.id);
			if (!portfolio || portfolio.wallets.length === 0) {
				await sendMessage(
					chatId,
					"No active paper portfolio with tracked wallets.",
				);
				return;
			}

			// Check tier
			if (!user.tier.can_use_copy_trading) {
				await sendMessage(
					chatId,
					"Copy trading requires Pro or Enterprise subscription.\n\nUse /plan to upgrade.",
				);
				return;
			}

			// Check if trading wallet is connected
			const tradingWallet = copyService.getTradingWallet(user.id);
			if (!tradingWallet) {
				await sendMessage(
					chatId,
					"Connect your trading wallet first with /connect",
				);
				return;
			}

			// Stop paper trading and start real copy trading for all tracked wallets
			const wallets = portfolio.wallets;
			paperService.stopPaperTrading(user.id);

			for (const wallet of wallets) {
				copyService.subscribeToCopy(user.id, wallet, "auto");
			}

			await sendMessage(
				chatId,
				`*Gone Live!*\n\nSwitched ${wallets.length} wallet(s) from paper to real copy trading.\n\nTrades will now be executed with real funds.`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		case "wallets": {
			const wallets = paperService.getTrackedWallets(user.id);
			if (wallets.length === 0) {
				await sendMessage(
					chatId,
					"No wallets tracked in paper portfolio.\n\nAdd with: /paper add <wallet>",
				);
				return;
			}

			const lines = wallets.map((w, i) => `${i + 1}. \`${w}\``);
			await sendMessage(
				chatId,
				`*Tracked Wallets (${wallets.length})*\n\n${lines.join("\n")}`,
				{ parseMode: "Markdown" },
			);
			break;
		}

		default:
			await sendMessage(
				chatId,
				`*Paper Trading*\n\nSimulate copy trading with virtual money.\n\n*Commands:*\n/paper start [amount] - Start with $amount (default: $10k)\n/paper add <wallet> - Add wallet to track\n/paper remove <wallet> - Remove wallet\n/paper wallets - List tracked wallets\n/paper status - View portfolio\n/paper history - View trade history\n/paper stop - Stop and see results\n/paper golive - Switch all wallets to real trading`,
				{ parseMode: "Markdown" },
			);
	}
}

// =============================================
// ADMIN COMMANDS
// =============================================

async function handleAdmin(
	user: userRepo.UserWithSettings,
	chatId: string,
	args: string[],
): Promise<void> {
	// Check if user is admin
	if (!adminService.isAdmin(user.telegram_id)) {
		await sendMessage(chatId, "You are not authorized to use admin commands.");
		return;
	}

	const subcommand = args[0]?.toLowerCase();

	switch (subcommand) {
		case "stats":
			await handleAdminStats(chatId);
			break;
		case "users":
			await handleAdminUsers(chatId, args.slice(1));
			break;
		case "user":
			await handleAdminUser(chatId, args[1]);
			break;
		case "ban":
			await handleAdminBan(chatId, args[1]);
			break;
		case "unban":
			await handleAdminUnban(chatId, args[1]);
			break;
		case "settier":
			await handleAdminSetTier(chatId, args[1], args[2]);
			break;
		case "search":
			await handleAdminSearch(chatId, args.slice(1).join(" "));
			break;
		default:
			await sendMessage(
				chatId,
				`*Admin Commands*

/admin stats - System statistics
/admin users [page] - List users
/admin user <id> - User details
/admin search <query> - Search users
/admin ban <id> - Ban user
/admin unban <id> - Unban user
/admin settier <id> <tier> - Set user tier`,
				{ parseMode: "Markdown" },
			);
	}
}

async function handleAdminStats(chatId: string): Promise<void> {
	const stats = adminService.getSystemStats();

	const message = `*System Statistics*

*Users*
• Total: ${stats.users.total}
• Active: ${stats.users.active}
• Banned: ${stats.users.banned}

*Tiers*
• Free: ${stats.tiers.free}
• Pro: ${stats.tiers.pro}
• Enterprise: ${stats.tiers.enterprise}

*Wallets*
• Subscriptions: ${stats.wallets.total}
• Unique: ${stats.wallets.unique}

*Alerts*
• Today: ${stats.alerts.today}
• Total: ${stats.alerts.total}

*Copy Trades*
• Total: ${stats.copyTrades.total}
• Executed: ${stats.copyTrades.executed}
• Failed: ${stats.copyTrades.failed}`;

	await sendMessage(chatId, message, { parseMode: "Markdown" });
}

async function handleAdminUsers(chatId: string, args: string[]): Promise<void> {
	const page = parseInt(args[0] || "1", 10);
	const limit = 10;
	const offset = (page - 1) * limit;

	const { users, total } = adminService.listUsers(limit, offset);
	const totalPages = Math.ceil(total / limit);

	if (users.length === 0) {
		await sendMessage(chatId, "No users found.");
		return;
	}

	const lines = users.map((u) => {
		const status = u.isBanned ? "BANNED" : u.isActive ? "" : "inactive";
		const username = u.telegramUsername
			? `@${u.telegramUsername}`
			: u.telegramId;
		return `${u.id}. ${username} [${u.tier}] ${u.walletCount}w ${status}`;
	});

	const message = `*Users (Page ${page}/${totalPages})*

${lines.join("\n")}

Total: ${total} users`;

	await sendMessage(chatId, message, { parseMode: "Markdown" });
}

async function handleAdminUser(
	chatId: string,
	userIdStr: string | undefined,
): Promise<void> {
	if (!userIdStr) {
		await sendMessage(chatId, "Usage: /admin user <user_id>");
		return;
	}

	const userId = parseInt(userIdStr, 10);
	if (isNaN(userId)) {
		await sendMessage(chatId, "Invalid user ID.");
		return;
	}

	const user = adminService.getUserById(userId);
	if (!user) {
		await sendMessage(chatId, "User not found.");
		return;
	}

	const createdDate = new Date(user.createdAt * 1000)
		.toISOString()
		.split("T")[0];
	const lastActive = user.lastActiveAt
		? new Date(user.lastActiveAt * 1000).toISOString().split("T")[0]
		: "Never";

	const message = `*User #${user.id}*

*Telegram:* ${user.telegramUsername ? `@${user.telegramUsername}` : user.telegramId}
*Tier:* ${user.tier}
*Status:* ${user.isBanned ? "BANNED" : user.isActive ? "Active" : "Inactive"}

*Stats:*
• Wallets: ${user.walletCount}
• Alerts today: ${user.alertsToday}
• Total alerts: ${user.totalAlerts}

*Dates:*
• Created: ${createdDate}
• Last active: ${lastActive}

${user.stripeCustomerId ? `*Stripe:* \`${user.stripeCustomerId}\`` : ""}`;

	await sendMessage(chatId, message, { parseMode: "Markdown" });
}

async function handleAdminBan(
	chatId: string,
	userIdStr: string | undefined,
): Promise<void> {
	if (!userIdStr) {
		await sendMessage(chatId, "Usage: /admin ban <user_id>");
		return;
	}

	const userId = parseInt(userIdStr, 10);
	if (isNaN(userId)) {
		await sendMessage(chatId, "Invalid user ID.");
		return;
	}

	const success = adminService.banUser(userId);
	if (success) {
		await sendMessage(chatId, `User #${userId} has been banned.`);
	} else {
		await sendMessage(chatId, "Failed to ban user. User may not exist.");
	}
}

async function handleAdminUnban(
	chatId: string,
	userIdStr: string | undefined,
): Promise<void> {
	if (!userIdStr) {
		await sendMessage(chatId, "Usage: /admin unban <user_id>");
		return;
	}

	const userId = parseInt(userIdStr, 10);
	if (isNaN(userId)) {
		await sendMessage(chatId, "Invalid user ID.");
		return;
	}

	const success = adminService.unbanUser(userId);
	if (success) {
		await sendMessage(chatId, `User #${userId} has been unbanned.`);
	} else {
		await sendMessage(chatId, "Failed to unban user. User may not exist.");
	}
}

async function handleAdminSetTier(
	chatId: string,
	userIdStr: string | undefined,
	tier: string | undefined,
): Promise<void> {
	if (!userIdStr || !tier) {
		await sendMessage(
			chatId,
			"Usage: /admin settier <user_id> <free|pro|enterprise>",
		);
		return;
	}

	const userId = parseInt(userIdStr, 10);
	if (isNaN(userId)) {
		await sendMessage(chatId, "Invalid user ID.");
		return;
	}

	if (!["free", "pro", "enterprise"].includes(tier)) {
		await sendMessage(chatId, "Invalid tier. Use: free, pro, or enterprise");
		return;
	}

	const success = adminService.setUserTier(
		userId,
		tier as "free" | "pro" | "enterprise",
	);
	if (success) {
		await sendMessage(chatId, `User #${userId} tier set to ${tier}.`);
	} else {
		await sendMessage(chatId, "Failed to set tier. User may not exist.");
	}
}

async function handleAdminSearch(chatId: string, query: string): Promise<void> {
	if (!query) {
		await sendMessage(chatId, "Usage: /admin search <username or telegram_id>");
		return;
	}

	const users = adminService.searchUsers(query);
	if (users.length === 0) {
		await sendMessage(chatId, "No users found.");
		return;
	}

	const lines = users.map((u) => {
		const username = u.telegramUsername
			? `@${u.telegramUsername}`
			: u.telegramId;
		return `${u.id}. ${username} [${u.tier}]`;
	});

	await sendMessage(chatId, `*Search Results*\n\n${lines.join("\n")}`, {
		parseMode: "Markdown",
	});
}

import {
  sendMessage,
  editMessage,
  answerCallbackQuery,
  createInlineKeyboard,
  type TelegramMessage,
  type TelegramCallbackQuery,
} from "./index";
import * as userRepo from "../db/repositories/user.repo";
import * as walletRepo from "../db/repositories/wallet.repo";
import { analyzeWallet, formatWalletScore, discoverProfitableWallets } from "../tracker/analyzer";
import { logger } from "../utils/logger";

// Parse command from message
function parseCommand(text: string): { command: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const command = (parts[0] || "").toLowerCase().replace("/", "").replace(/@.*$/, "");
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
    default:
      await sendMessage(chatId, "Unknown command. Use /help for available commands.");
  }
}

// Handle callback queries from inline keyboards
export async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
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
  username?: string
): Promise<void> {
  // Check if user exists
  let user = await userRepo.findByTelegramId(telegramId);

  if (user) {
    await userRepo.updateLastActive(user.id);
    await sendMessage(
      chatId,
      `*Welcome back!*\n\nYou're already registered. Use /help to see commands.`,
      { parseMode: "Markdown" }
    );
    return;
  }

  // Create new user
  user = await userRepo.createUser({
    telegramId,
    telegramChatId: chatId,
    telegramUsername: username,
  });

  const welcome = `*Welcome to Polymarket Whale Tracker!*

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
  const help = `*Polymarket Whale Tracker*

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

*Other:*
/stats - Your usage statistics
/help - This message`;

  await sendMessage(chatId, help, { parseMode: "Markdown" });
}

async function handleAdd(
  user: userRepo.UserWithSettings,
  chatId: string,
  args: string[]
): Promise<void> {
  const addressArg = args[0];
  if (!addressArg) {
    await sendMessage(chatId, "Usage: /add <wallet-address>");
    return;
  }

  const address = addressArg.toLowerCase();

  if (!isValidAddress(address)) {
    await sendMessage(chatId, "Invalid wallet address. Must be 0x followed by 40 hex characters.");
    return;
  }

  // Check tier limits
  const walletCount = await walletRepo.countUserWallets(user.id);
  if (walletCount >= user.tier.max_wallets) {
    await sendMessage(
      chatId,
      `You've reached the limit of ${user.tier.max_wallets} wallets on the ${user.tier.name} plan.`
    );
    return;
  }

  // Check if already subscribed
  if (await walletRepo.isSubscribed(user.id, address)) {
    await sendMessage(chatId, "You're already tracking this wallet.");
    return;
  }

  await sendMessage(chatId, "Analyzing wallet...");

  // Run analysis in background
  runAddWalletInBackground(user.id, chatId, address).catch((err) => {
    logger.error("Background add wallet failed", err);
    sendMessage(chatId, "Failed to add wallet. Please try again.").catch(() => {});
  });
}

// Background task for adding wallet
async function runAddWalletInBackground(userId: number, chatId: string, address: string): Promise<void> {
  const stats = await analyzeWallet(address);
  if (!stats) {
    await sendMessage(chatId, "Could not analyze wallet. It may not have any Polymarket activity.");
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
    { parseMode: "Markdown" }
  );
}

async function handleRemove(
  user: userRepo.UserWithSettings,
  chatId: string,
  args: string[]
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

async function handleList(user: userRepo.UserWithSettings, chatId: string): Promise<void> {
  const wallets = await walletRepo.getUserWallets(user.id);

  if (wallets.length === 0) {
    await sendMessage(chatId, "You're not tracking any wallets.\n\nUse /discover to find traders or /add <wallet> to add one.");
    return;
  }

  let message = `*Tracking ${wallets.length}/${user.tier.max_wallets} wallets:*\n\n`;

  for (const w of wallets) {
    const typeEmoji = w.whale_type === "dormant" ? " [D]" : w.whale_type === "sniper" ? " [S]" : "";
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

async function handleSettings(user: userRepo.UserWithSettings, chatId: string): Promise<void> {
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
  args: string[]
): Promise<void> {
  const settingArg = args[0];
  const valueArg = args[1];
  if (!settingArg || !valueArg) {
    await sendMessage(
      chatId,
      "Usage:\n/set min\\_trade <amount>\n/set min\\_pnl <amount>",
      { parseMode: "Markdown" }
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
  args: string[]
): Promise<void> {
  const settingArg = args[0];
  if (!settingArg) {
    await sendMessage(
      chatId,
      "Usage:\n/toggle sports\n/toggle dormant\n/toggle sniper\n/toggle buy\n/toggle sell",
      { parseMode: "Markdown" }
    );
    return;
  }

  const setting = settingArg.toLowerCase();

  switch (setting) {
    case "sports": {
      const current = JSON.parse(user.settings.categories_exclude || "[]") as string[];
      const newExclude = current.includes("sports")
        ? current.filter((c) => c !== "sports")
        : [...current, "sports"];
      await userRepo.updateSettings(user.id, {
        categories_exclude: JSON.stringify(newExclude),
      });
      await sendMessage(
        chatId,
        `Sports markets: ${newExclude.includes("sports") ? "Hidden" : "Shown"}`
      );
      break;
    }
    case "dormant": {
      const newVal = user.settings.alert_whale_type_dormant ? 0 : 1;
      await userRepo.updateSettings(user.id, { alert_whale_type_dormant: newVal });
      await sendMessage(chatId, `Dormant whale alerts: ${newVal ? "On" : "Off"}`);
      break;
    }
    case "sniper": {
      const newVal = user.settings.alert_whale_type_sniper ? 0 : 1;
      await userRepo.updateSettings(user.id, { alert_whale_type_sniper: newVal });
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

async function handleDiscover(user: userRepo.UserWithSettings, chatId: string): Promise<void> {
  await sendMessage(chatId, "Discovering profitable traders... This may take a minute. I'll send results when ready.");

  // Run discovery in background so it doesn't block other users
  runDiscoveryInBackground(chatId).catch((err) => {
    logger.error("Background discovery failed", err);
    sendMessage(chatId, "Discovery failed. Please try again later.").catch(() => {});
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
      w.whaleType === "dormant" ? " [D]" : w.whaleType === "sniper" ? " [S]" : "";
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

async function handleStats(user: userRepo.UserWithSettings, chatId: string): Promise<void> {
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
  params: string[]
): Promise<void> {
  const setting = params[0];

  if (setting === "min_trade") {
    await sendMessage(
      chatId,
      "Send the new minimum trade size:\n\nExample: /set min\\_trade 1000",
      { parseMode: "Markdown" }
    );
  } else if (setting === "min_pnl") {
    await sendMessage(
      chatId,
      "Send the new minimum wallet PnL:\n\nExample: /set min\\_pnl 50000",
      { parseMode: "Markdown" }
    );
  }
}

async function handleToggleCallback(
  user: userRepo.UserWithSettings,
  chatId: string,
  messageId: number,
  params: string[]
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
  callbackId: string
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
      await sendMessage(chatId, `Added wallet ${address.slice(0, 10)}... to your tracking list.`);
    } else {
      await answerCallbackQuery(callbackId, "Could not analyze wallet", true);
    }
  }
}

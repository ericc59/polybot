import { config } from "../config";
import { logger } from "../utils/logger";
import { handleCommand, handleCallbackQuery } from "./commands";

const TELEGRAM_API = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

// Telegram update types
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// Generic Telegram API call
export async function callTelegram(
  method: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = (await response.json()) as { ok: boolean; result?: unknown; description?: string };

  if (!data.ok) {
    logger.error(`Telegram API error: ${method}`, data);
    throw new Error(data.description || "Telegram API error");
  }

  return data.result;
}

// Send a message
export async function sendMessage(
  chatId: string | number,
  text: string,
  options: {
    parseMode?: "Markdown" | "HTML";
    replyMarkup?: unknown;
    disablePreview?: boolean;
  } = {}
): Promise<TelegramMessage> {
  return (await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || "Markdown",
    reply_markup: options.replyMarkup,
    disable_web_page_preview: options.disablePreview ?? true,
  })) as TelegramMessage;
}

// Edit a message
export async function editMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  options: {
    parseMode?: "Markdown" | "HTML";
    replyMarkup?: unknown;
  } = {}
): Promise<TelegramMessage> {
  return (await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.parseMode || "Markdown",
    reply_markup: options.replyMarkup,
  })) as TelegramMessage;
}

// Answer callback query
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<boolean> {
  return (await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  })) as boolean;
}

// Delete a message
export async function deleteMessage(
  chatId: string | number,
  messageId: number
): Promise<boolean> {
  return (await callTelegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  })) as boolean;
}

// Test connection
export async function testConnection(): Promise<boolean> {
  try {
    await callTelegram("getMe");
    return true;
  } catch {
    return false;
  }
}

// Handle incoming update
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  try {
    if (update.message?.text) {
      await handleCommand(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (error) {
    logger.error("Error handling update", error);
  }
}

// Polling mode (for development)
let pollingOffset = 0;
let pollingActive = false;

export async function startPolling(): Promise<void> {
  if (pollingActive) return;
  pollingActive = true;

  logger.info("Starting Telegram polling...");

  while (pollingActive) {
    try {
      const updates = (await callTelegram("getUpdates", {
        offset: pollingOffset,
        timeout: 30,
      })) as TelegramUpdate[];

      for (const update of updates) {
        pollingOffset = Math.max(pollingOffset, update.update_id + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      logger.error("Polling error", error);
      await Bun.sleep(5000);
    }
  }
}

export function stopPolling(): void {
  pollingActive = false;
}

// Webhook mode (for production)
export async function setupWebhook(webhookUrl: string): Promise<void> {
  await callTelegram("setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"],
  });
  logger.info(`Webhook set to ${webhookUrl}`);
}

export async function removeWebhook(): Promise<void> {
  await callTelegram("deleteWebhook");
  logger.info("Webhook removed");
}

// Create webhook handler for Bun.serve
export function createWebhookHandler() {
  return async (req: Request): Promise<Response> => {
    try {
      const update = (await req.json()) as TelegramUpdate;
      // Handle asynchronously, return immediately
      handleUpdate(update).catch((e) => logger.error("Webhook handler error", e));
      return new Response("OK");
    } catch {
      return new Response("Error", { status: 400 });
    }
  };
}

// Inline keyboard helpers
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export function createInlineKeyboard(buttons: InlineButton[][]): unknown {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        callback_data: btn.callback_data,
        url: btn.url,
      }))
    ),
  };
}

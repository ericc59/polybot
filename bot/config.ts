export const config = {
  // API endpoints
  DATA_API: "https://data-api.polymarket.com",
  GAMMA_API: "https://gamma-api.polymarket.com",
  CLOB_API: "https://clob.polymarket.com",

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  // TELEGRAM_CHAT_ID is now per-user in the database

  // Server config (for webhook mode)
  PORT: Number(process.env.PORT) || 3000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || "", // e.g., https://polybot.example.com
  USE_WEBHOOK: process.env.USE_WEBHOOK === "true",

  // Monitor mode: real-time WebSocket (default) or polling
  USE_POLLING: process.env.USE_POLLING === "true", // Set to true to use slow polling instead of WebSocket

  // Wallet tracking settings (defaults, users can override)
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS) || 60000, // 1 minute
  MIN_WALLET_PNL: Number(process.env.MIN_WALLET_PNL) || 10000, // Min $10k profit to track
  MIN_WIN_RATE: Number(process.env.MIN_WIN_RATE) || 0.55, // 55% win rate minimum
  MIN_TRADES: Number(process.env.MIN_TRADES) || 10, // At least 10 trades
  MIN_TRADE_SIZE: Number(process.env.MIN_TRADE_SIZE) || 500, // Min $500 trade to alert

  // Database
  DB_PATH: process.env.DB_PATH || "./data/polybot.db",

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID || "",
  STRIPE_ENTERPRISE_PRICE_ID: process.env.STRIPE_ENTERPRISE_PRICE_ID || "",

  // Admin
  ADMIN_TELEGRAM_IDS: (process.env.ADMIN_TELEGRAM_IDS || "").split(",").filter(Boolean),
};

export function validateConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!config.TELEGRAM_BOT_TOKEN) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }
  if (config.USE_WEBHOOK && !config.WEBHOOK_URL) {
    missing.push("WEBHOOK_URL (required when USE_WEBHOOK=true)");
  }

  return { valid: missing.length === 0, missing };
}

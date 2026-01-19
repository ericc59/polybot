// Runtime flags
export let DRY_RUN = false;

export function setDryRun(value: boolean) {
  DRY_RUN = value;
}

export const tennisConfig = {
  // The Odds API
  ODDS_API_KEY: process.env.ODDS_API_KEY || "",
  ODDS_API_BASE: "https://api.the-odds-api.com/v4",
  POLL_INTERVAL_MS: Number(process.env.TENNIS_POLL_INTERVAL_MS) || 15000,

  // Trading
  BID_PRICE: 0.49, // Place bids at $0.49
  MAX_ORDER_SIZE: Number(process.env.TENNIS_MAX_ORDER_SIZE) || 2, // $2 per side (Polymarket min is $1)

  // Database
  DB_PATH: process.env.TENNIS_DB_PATH || "./data/tennis.db",

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TENNIS_TELEGRAM_BOT_TOKEN || "",
  ADMIN_CHAT_IDS: (process.env.TENNIS_ADMIN_CHAT_IDS || "")
    .split(",")
    .filter(Boolean)
    .map((id) => id.trim()),

  // Polymarket
  CLOB_HOST: "https://clob.polymarket.com",
  CHAIN_ID: 137,
  DATA_API: "https://data-api.polymarket.com",
  GAMMA_API: "https://gamma-api.polymarket.com",
};

export function validateConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!tennisConfig.ODDS_API_KEY) {
    missing.push("ODDS_API_KEY");
  }
  if (!tennisConfig.TELEGRAM_BOT_TOKEN) {
    missing.push("TENNIS_TELEGRAM_BOT_TOKEN");
  }
  if (tennisConfig.ADMIN_CHAT_IDS.length === 0) {
    missing.push("TENNIS_ADMIN_CHAT_IDS");
  }

  return { valid: missing.length === 0, missing };
}

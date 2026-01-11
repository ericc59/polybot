# Polymarket Wallet Tracker

A Telegram bot that alerts you when profitable Polymarket traders make trades.

## Features

- **Auto-discover** profitable wallets based on PnL and win rate
- **Track wallets** and get notified when they trade
- **Telegram alerts** with trade details and trader stats

## Quick Start

```bash
# Install dependencies
bun install

# See setup instructions
bun run setup

# Discover profitable wallets
bun run discover

# Add a wallet to track
bun run add 0x...

# Start the bot
bun run start
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run discover` | Find profitable wallets on Polymarket |
| `bun run add <addr>` | Add a wallet to track |
| `bun run list` | Show all tracked wallets |
| `bun run analyze <addr>` | Analyze a wallet's performance |
| `bun run start` | Start the bot |
| `bun run setup` | Show setup instructions |

## Environment Variables

```env
TELEGRAM_BOT_TOKEN=xxx    # From @BotFather
TELEGRAM_CHAT_ID=xxx      # Your chat ID
POLL_INTERVAL_MS=60000    # Check every 60s
MIN_WALLET_PNL=1000       # Min $1000 profit
MIN_WIN_RATE=0.55         # Min 55% win rate
MIN_TRADES=10             # Min 10 trades
```

## How It Works

1. The bot polls the Polymarket Data API for trades from tracked wallets
2. When a new trade is detected, it formats an alert with:
   - Market and outcome
   - Trade side (BUY/SELL), size, and price
   - Trader's historical PnL and win rate
3. Sends the alert to your Telegram

## Data Sources

Uses the [Polymarket Data API](https://docs.polymarket.com/) to fetch:
- `/trades` - Recent trades by wallet
- `/positions` - Wallet positions and PnL

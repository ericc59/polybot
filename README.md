# PolySpy

A multi-user Telegram bot that tracks profitable Polymarket traders and sends real-time alerts when they make trades.

## Features

- **Real-Time Alerts**: WebSocket-based monitoring for sub-second trade detection (no polling delay)
- **Wallet Tracking**: Subscribe to whale wallets and get notified when they trade
- **Smart Discovery**: Find profitable traders based on PnL, win rate, and trading patterns
- **Paper Trading**: Simulate copy trading with virtual money before going live
- **Category Analytics**: See trader expertise by market category (Politics, Crypto, Sports, etc.)
- **Copy Trading**: Get recommendations or auto-execute trades to mirror whale moves
- **Subscription Tiers**: Free, Pro, and Enterprise plans with Stripe integration
- **Admin Dashboard**: Manage users, view stats, and moderate via Telegram commands

## Quick Start

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Configure Environment

Create a `.env` file:

```env
# Required
TELEGRAM_BOT_TOKEN=your-bot-token

# Optional: Webhook mode (for production)
USE_WEBHOOK=true
WEBHOOK_URL=https://your-domain.com
PORT=3000

# Optional: Monitor mode (real-time WebSocket is default)
# USE_POLLING=true  # Uncomment to use slow polling instead of WebSocket

# Optional: Tracking thresholds
MIN_WALLET_PNL=10000
MIN_WIN_RATE=0.55
MIN_TRADES=10
MIN_TRADE_SIZE=500

# Optional: Stripe payments
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...

# Optional: Admin access
ADMIN_TELEGRAM_IDS=123456789,987654321

# Optional: Encryption key for copy trading credentials
ENCRYPTION_KEY=your-secure-key
```

### 3. Install & Run

```bash
# Install dependencies
bun install

# Start the bot
bun bot/index.ts start
```

## Telegram Commands

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Register and see welcome message |
| `/help` | Show all available commands |
| `/add <wallet>` | Subscribe to a wallet |
| `/remove <wallet>` | Unsubscribe from a wallet |
| `/list` | Show your tracked wallets |
| `/settings` | View/edit notification settings |
| `/discover` | Find profitable traders |
| `/stats` | View your usage statistics |

### Subscription Commands

| Command | Description |
|---------|-------------|
| `/plan` | View available plans and pricing |
| `/subscribe <pro\|enterprise>` | Upgrade your subscription |
| `/billing` | Manage subscription and billing |

### Copy Trading Commands (Pro+)

| Command | Description |
|---------|-------------|
| `/connect` | Connect trading wallet |
| `/disconnect` | Remove trading wallet |
| `/copy <wallet> <auto\|recommend>` | Enable copy trading |
| `/copy off <wallet>` | Disable copy trading |
| `/limits` | View/set trading limits |
| `/copyhistory` | View copy trade history |

### Paper Trading Commands

Simulate copy trading multiple wallets with a single virtual portfolio:

| Command | Description |
|---------|-------------|
| `/paper start [amount]` | Start paper trading (default $10k) |
| `/paper add <wallet>` | Add a wallet to track |
| `/paper remove <wallet>` | Remove a wallet |
| `/paper wallets` | List tracked wallets |
| `/paper status` | View portfolio performance |
| `/paper history` | View trade history |
| `/paper stop` | Stop and see final results |
| `/paper golive` | Switch all wallets to real trading |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/admin stats` | System statistics |
| `/admin users [page]` | List all users |
| `/admin user <id>` | View user details |
| `/admin search <query>` | Search users |
| `/admin ban <id>` | Ban a user |
| `/admin unban <id>` | Unban a user |
| `/admin settier <id> <tier>` | Set user's tier |

## Subscription Tiers

| Feature | Free | Pro ($9.99/mo) | Enterprise ($49.99/mo) |
|---------|------|----------------|------------------------|
| Tracked Wallets | 5 | 50 | 500 |
| Alerts/Day | 100 | 1,000 | 10,000 |
| Paper Trading | Yes | Yes | Yes |
| Copy Trading | - | Recommend | Auto-Execute |
| Category Analytics | Basic | Full | Full |

## Setting Up Stripe

```bash
# Generate Stripe products and prices
bun scripts/setup-stripe.ts
```

Then configure the webhook in Stripe Dashboard:
- Endpoint: `https://your-domain.com/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

## CLI Commands

```bash
# Start the bot
bun bot/index.ts start

# Discover profitable wallets
bun bot/index.ts discover

# Analyze a specific wallet
bun bot/index.ts analyze 0x...

# Show setup instructions
bun bot/index.ts setup
```

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Format code
bun run format
```

## Architecture

```
bot/
├── api/              # Polymarket API client
├── db/               # SQLite database + repositories
├── services/         # Business logic
│   ├── admin.service.ts
│   ├── alert.service.ts
│   ├── copy.service.ts
│   ├── monitor.service.ts
│   ├── paper.service.ts
│   ├── stripe.service.ts
│   ├── tier.service.ts
│   └── trading.service.ts
├── telegram/         # Telegram bot handlers
├── tracker/          # Wallet analysis
├── utils/            # Helpers (crypto, logger)
├── config.ts         # Environment config
└── index.ts          # Entry point
```

## API Endpoints

The bot runs an HTTP server on the configured port:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with monitor status |
| `/telegram` | POST | Telegram webhook (if enabled) |
| `/stripe/webhook` | POST | Stripe webhook for payments |

## License

MIT

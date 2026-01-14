/**
 * Console-based real-time trade visualization
 * Uses ANSI color codes for colorful terminal output
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",

  // Foreground
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Background
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

// Stats tracking
let stats = {
  tradesReceived: 0,
  tradesMatched: 0,
  totalVolume: 0,
  buyCount: 0,
  sellCount: 0,
  startTime: Date.now(),
};

export function resetStats(): void {
  stats = {
    tradesReceived: 0,
    tradesMatched: 0,
    totalVolume: 0,
    buyCount: 0,
    sellCount: 0,
    startTime: Date.now(),
  };
}

export function getStats() {
  return { ...stats };
}

/**
 * Display a trade in the console with colors
 */
export function displayTrade(trade: {
  side: "BUY" | "SELL";
  wallet: string;
  market: string;
  outcome?: string;
  size: number;
  price: number;
  isMatched: boolean;
}): void {
  stats.tradesReceived++;

  if (!trade.isMatched) {
    return; // Don't display unmatched trades
  }

  stats.tradesMatched++;
  stats.totalVolume += trade.size;

  if (trade.side === "BUY") {
    stats.buyCount++;
  } else {
    stats.sellCount++;
  }

  const timestamp = new Date().toLocaleTimeString();
  const sideColor = trade.side === "BUY" ? colors.green : colors.red;
  const sideBg = trade.side === "BUY" ? colors.bgGreen : colors.bgRed;

  // Truncate market name
  const marketName = trade.market.length > 40
    ? trade.market.slice(0, 37) + "..."
    : trade.market;

  // Format wallet address
  const wallet = `${trade.wallet.slice(0, 6)}...${trade.wallet.slice(-4)}`;

  // Format size
  const sizeStr = trade.size >= 1000
    ? `$${(trade.size / 1000).toFixed(1)}K`
    : `$${trade.size.toFixed(0)}`;

  // Format price as cents
  const priceStr = `${(trade.price * 100).toFixed(0)}¢`;

  console.log(
    `${colors.dim}${timestamp}${colors.reset} ` +
    `${sideBg}${colors.bright}${colors.black} ${trade.side} ${colors.reset} ` +
    `${colors.cyan}${wallet}${colors.reset} ` +
    `${sideColor}${sizeStr}${colors.reset} @ ${priceStr} ` +
    `${colors.white}${marketName}${colors.reset}` +
    (trade.outcome ? ` ${colors.yellow}[${trade.outcome}]${colors.reset}` : "")
  );
}

/**
 * Display stats summary
 */
export function displayStats(): void {
  const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const volumeStr = stats.totalVolume >= 1000000
    ? `$${(stats.totalVolume / 1000000).toFixed(2)}M`
    : stats.totalVolume >= 1000
    ? `$${(stats.totalVolume / 1000).toFixed(1)}K`
    : `$${stats.totalVolume.toFixed(0)}`;

  console.log(`\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}  REAL-TIME STATS${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  Runtime:          ${colors.white}${minutes}m ${seconds}s${colors.reset}`);
  console.log(`  Trades Received:  ${colors.blue}${stats.tradesReceived.toLocaleString()}${colors.reset}`);
  console.log(`  Trades Matched:   ${colors.green}${stats.tradesMatched.toLocaleString()}${colors.reset}`);
  console.log(`  Buy Orders:       ${colors.green}${stats.buyCount}${colors.reset}`);
  console.log(`  Sell Orders:      ${colors.red}${stats.sellCount}${colors.reset}`);
  console.log(`  Volume Tracked:   ${colors.yellow}${volumeStr}${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}\n`);
}

/**
 * Display a connection status message
 */
export function displayConnectionStatus(status: "connected" | "disconnected" | "reconnecting"): void {
  const statusColors = {
    connected: colors.green,
    disconnected: colors.red,
    reconnecting: colors.yellow,
  };

  const statusEmoji = {
    connected: "●",
    disconnected: "○",
    reconnecting: "◐",
  };

  console.log(
    `${statusColors[status]}${statusEmoji[status]} WebSocket ${status.toUpperCase()}${colors.reset}`
  );
}

/**
 * Display the header when starting
 */
export function displayHeader(watchedWallets: number): void {
  console.log(`\n${colors.bright}${colors.green}`);
  console.log(`  ██████╗  ██████╗ ██╗  ██╗   ██╗███████╗██████╗ ██╗   ██╗`);
  console.log(`  ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝██╔════╝██╔══██╗╚██╗ ██╔╝`);
  console.log(`  ██████╔╝██║   ██║██║   ╚████╔╝ ███████╗██████╔╝ ╚████╔╝ `);
  console.log(`  ██╔═══╝ ██║   ██║██║    ╚██╔╝  ╚════██║██╔═══╝   ╚██╔╝  `);
  console.log(`  ██║     ╚██████╔╝███████╗██║   ███████║██║        ██║   `);
  console.log(`  ╚═╝      ╚═════╝ ╚══════╝╚═╝   ╚══════╝╚═╝        ╚═╝   `);
  console.log(`${colors.reset}`);
  console.log(`${colors.dim}  Real-Time Whale Tracker${colors.reset}`);
  console.log(`${colors.cyan}  Watching ${watchedWallets} wallets...${colors.reset}`);
  console.log(`${colors.dim}  Press Ctrl+C to exit${colors.reset}\n`);
}

/**
 * Display a redemption notification when a market resolves
 */
export function displayRedemption(redemption: {
  title: string;
  outcome: string;
  won: boolean;
  value: number;
}): void {
  const timestamp = new Date().toLocaleTimeString();
  const resultColor = redemption.won ? colors.green : colors.red;
  const resultText = redemption.won ? "WON" : "LOST";
  const resultBg = redemption.won ? colors.bgGreen : colors.bgRed;
  const valueStr = redemption.value > 0 ? `+$${redemption.value.toFixed(2)}` : "$0.00";

  // Truncate title
  const title = redemption.title.length > 35
    ? redemption.title.slice(0, 32) + "..."
    : redemption.title;

  console.log(
    `${colors.dim}${timestamp}${colors.reset} ` +
    `${colors.bright}${colors.yellow}🎯 REDEEMED${colors.reset} ` +
    `${resultBg}${colors.bright}${colors.black} ${resultText} ${colors.reset} ` +
    `${colors.white}${title}${colors.reset} ` +
    `${colors.yellow}[${redemption.outcome}]${colors.reset} ` +
    `${resultColor}${valueStr}${colors.reset}`
  );
}

/**
 * Display a paper trade notification with portfolio stats
 */
export function displayPaperTrade(trade: {
  side: "BUY" | "SELL";
  market: string;
  size: number;
  price: number;
  sourceWallet: string;
  portfolioValue?: number;
  totalPnl?: number;
  pnl24h?: number | null;
}): void {
  const sideColor = trade.side === "BUY" ? colors.green : colors.red;
  const sizeStr = `$${trade.size.toFixed(2)}`;

  // Trade line
  console.log(
    `${colors.magenta}📝 PAPER${colors.reset} ` +
    `${sideColor}${trade.side}${colors.reset} ` +
    `${sizeStr} ` +
    `${colors.dim}(from ${trade.sourceWallet.slice(0, 8)}...)${colors.reset}`
  );

  // Portfolio stats line
  if (trade.portfolioValue !== undefined) {
    const valueStr = formatCurrency(trade.portfolioValue);
    const pnlColor = (trade.totalPnl ?? 0) >= 0 ? colors.green : colors.red;
    const pnlSign = (trade.totalPnl ?? 0) >= 0 ? "+" : "";
    const pnlStr = `${pnlSign}${formatCurrency(trade.totalPnl ?? 0)}`;

    let pnl24hStr = "";
    if (trade.pnl24h !== null && trade.pnl24h !== undefined) {
      const pnl24hColor = trade.pnl24h >= 0 ? colors.green : colors.red;
      const pnl24hSign = trade.pnl24h >= 0 ? "+" : "";
      pnl24hStr = ` ${colors.dim}|${colors.reset} ${pnl24hColor}${pnl24hSign}${formatCurrency(trade.pnl24h)} 24h${colors.reset}`;
    }

    console.log(
      `   ${colors.cyan}Portfolio:${colors.reset} ${colors.white}${valueStr}${colors.reset} ` +
      `${colors.dim}|${colors.reset} ${pnlColor}${pnlStr} all-time${colors.reset}` +
      pnl24hStr
    );
  }
}

/**
 * Format currency for display
 */
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Display an ASCII graph of portfolio value over time
 */
export function displayPortfolioGraph(
  history: Array<{ timestamp: number; value: number; pnl: number }>,
  width: number = 50,
  height: number = 10
): void {
  if (history.length === 0) {
    console.log(`${colors.dim}  No history data available yet${colors.reset}`);
    return;
  }

  const values = history.map(h => h.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // ASCII graph characters
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

  // Create the graph line
  let graphLine = "";
  const step = Math.max(1, Math.floor(history.length / width));

  for (let i = 0; i < width && i * step < history.length; i++) {
    const idx = Math.min(i * step, history.length - 1);
    const entry = history[idx];
    if (!entry) continue;
    const val = entry.value;
    const normalized = (val - minVal) / range;
    const charIdx = Math.floor(normalized * (chars.length - 1));
    const pnl = entry.pnl;
    const charColor = pnl >= 0 ? colors.green : colors.red;
    graphLine += `${charColor}${chars[charIdx]}${colors.reset}`;
  }

  // Display
  console.log(`\n${colors.cyan}  30-Day Portfolio Value${colors.reset}`);
  console.log(`${colors.dim}  $${maxVal.toFixed(0).padStart(8)}${colors.reset} ┤`);
  console.log(`             ${graphLine}`);
  console.log(`${colors.dim}  $${minVal.toFixed(0).padStart(8)}${colors.reset} ┤`);

  // Date range
  const firstEntry = history[0];
  const lastEntry = history[history.length - 1];
  if (firstEntry && lastEntry) {
    const startDate = new Date(firstEntry.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endDate = new Date(lastEntry.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    console.log(`${colors.dim}             ${startDate.padEnd(width / 2)}${endDate.padStart(width / 2)}${colors.reset}`);
  }
}

/**
 * Display portfolio summary panel
 */
export function displayPortfolioPanel(portfolio: {
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  pnl24h: number | null;
  pnl24hPercent: number | null;
  walletCount: number;
  tradeCount: number;
  history?: Array<{ timestamp: number; value: number; pnl: number }>;
}): void {
  const pnlColor = portfolio.pnl >= 0 ? colors.green : colors.red;
  const pnlSign = portfolio.pnl >= 0 ? "+" : "";

  console.log(`\n${colors.bright}${colors.magenta}╔═══════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.magenta}║${colors.reset}  ${colors.bright}PAPER PORTFOLIO${colors.reset}                                         ${colors.magenta}║${colors.reset}`);
  console.log(`${colors.magenta}╠═══════════════════════════════════════════════════════════╣${colors.reset}`);

  // Current Value
  console.log(`${colors.magenta}║${colors.reset}  ${colors.dim}Current Value:${colors.reset}  ${colors.bright}${colors.white}${formatCurrency(portfolio.totalValue).padEnd(12)}${colors.reset}                       ${colors.magenta}║${colors.reset}`);

  // All-time P&L
  const pnlStr = `${pnlSign}${formatCurrency(portfolio.pnl)} (${pnlSign}${portfolio.pnlPercent.toFixed(1)}%)`;
  console.log(`${colors.magenta}║${colors.reset}  ${colors.dim}All-time P&L:${colors.reset}   ${pnlColor}${pnlStr.padEnd(20)}${colors.reset}               ${colors.magenta}║${colors.reset}`);

  // 24h P&L
  if (portfolio.pnl24h !== null && portfolio.pnl24hPercent !== null) {
    const pnl24hColor = portfolio.pnl24h >= 0 ? colors.green : colors.red;
    const pnl24hSign = portfolio.pnl24h >= 0 ? "+" : "";
    const pnl24hStr = `${pnl24hSign}${formatCurrency(portfolio.pnl24h)} (${pnl24hSign}${portfolio.pnl24hPercent.toFixed(1)}%)`;
    console.log(`${colors.magenta}║${colors.reset}  ${colors.dim}24h P&L:${colors.reset}        ${pnl24hColor}${pnl24hStr.padEnd(20)}${colors.reset}               ${colors.magenta}║${colors.reset}`);
  } else {
    console.log(`${colors.magenta}║${colors.reset}  ${colors.dim}24h P&L:${colors.reset}        ${colors.dim}--${colors.reset}                                     ${colors.magenta}║${colors.reset}`);
  }

  // Stats
  console.log(`${colors.magenta}║${colors.reset}  ${colors.dim}Wallets:${colors.reset}        ${colors.cyan}${portfolio.walletCount}${colors.reset}    ${colors.dim}Trades:${colors.reset} ${colors.cyan}${portfolio.tradeCount}${colors.reset}                      ${colors.magenta}║${colors.reset}`);

  console.log(`${colors.magenta}╚═══════════════════════════════════════════════════════════╝${colors.reset}`);

  // Display graph if history available
  if (portfolio.history && portfolio.history.length > 1) {
    displayPortfolioGraph(portfolio.history);
  }
}

/**
 * Display periodic stats update (every N seconds)
 */
let lastStatsDisplay = 0;
export function maybeDisplayStats(intervalSeconds: number = 60): void {
  const now = Date.now();
  if (now - lastStatsDisplay >= intervalSeconds * 1000) {
    displayStats();
    lastStatsDisplay = now;
  }
}

/**
 * Format countdown to market resolution
 */
function formatCountdown(endDate: number | null): string | null {
  if (!endDate) return null;

  const now = Math.floor(Date.now() / 1000);
  const remaining = endDate - now;

  if (remaining <= 0) {
    return `${colors.yellow}ENDED${colors.reset}`;
  }

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60);

  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${colors.dim}${months}mo${colors.reset}`;
  } else if (days > 0) {
    return `${colors.cyan}${days}d ${hours}h${colors.reset}`;
  } else if (hours > 0) {
    return `${colors.yellow}${hours}h ${mins}m${colors.reset}`;
  } else {
    return `${colors.red}${mins}m${colors.reset}`;
  }
}

/**
 * Display a single position
 */
export function displayPosition(pos: {
  marketTitle: string;
  outcome: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  cost: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  isWinning: boolean;
  hasPriceData: boolean;
  endDate?: number | null;
}): void {
  // Show unknown status when no price data
  let statusIcon: string;
  let statusColor: string;
  if (!pos.hasPriceData) {
    statusIcon = "?";
    statusColor = colors.dim;
  } else {
    statusIcon = pos.isWinning ? "✓" : "✗";
    statusColor = pos.isWinning ? colors.green : colors.red;
  }
  const pnlSign = pos.pnl >= 0 ? "+" : "";

  // Truncate market title
  const title = pos.marketTitle.length > 35
    ? pos.marketTitle.slice(0, 32) + "..."
    : pos.marketTitle;

  const countdown = formatCountdown(pos.endDate ?? null);

  console.log(
    `  ${statusColor}${statusIcon}${colors.reset} ` +
    `${colors.white}${title}${colors.reset} ` +
    `${colors.yellow}[${pos.outcome}]${colors.reset}` +
    (countdown ? ` ${colors.dim}(${colors.reset}${countdown}${colors.dim})${colors.reset}` : "")
  );

  // Show different format when no price data
  if (!pos.hasPriceData) {
    console.log(
      `    ${colors.dim}Entry:${colors.reset} ${(pos.avgPrice * 100).toFixed(0)}¢  ` +
      `${colors.dim}Shares:${colors.reset} ${pos.shares.toFixed(1)}  ` +
      `${colors.dim}Value:${colors.reset} $${pos.value.toFixed(2)}  ` +
      `${colors.dim}(no price data)${colors.reset}`
    );
  } else {
    console.log(
      `    ${colors.dim}Entry:${colors.reset} ${(pos.avgPrice * 100).toFixed(0)}¢ → ` +
      `${colors.dim}Now:${colors.reset} ${(pos.currentPrice * 100).toFixed(0)}¢  ` +
      `${colors.dim}Shares:${colors.reset} ${pos.shares.toFixed(1)}  ` +
      `${statusColor}${pnlSign}$${pos.pnl.toFixed(2)} (${pnlSign}${pos.pnlPercent.toFixed(1)}%)${colors.reset}`
    );
  }
}

/**
 * Display all positions for a portfolio
 */
export function displayPositions(
  positions: Array<{
    marketTitle: string;
    outcome: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    cost: number;
    value: number;
    pnl: number;
    pnlPercent: number;
    isWinning: boolean;
    hasPriceData: boolean;
    endDate?: number | null;
  }>
): void {
  if (positions.length === 0) {
    console.log(`${colors.dim}  No open positions${colors.reset}`);
    return;
  }

  // Separate positions by price data availability
  const withPriceData = positions.filter(p => p.hasPriceData);
  const withoutPriceData = positions.filter(p => !p.hasPriceData);

  // Sort positions with price data by P&L
  const sorted = [...withPriceData].sort((a, b) => b.pnl - a.pnl);
  const winning = sorted.filter(p => p.isWinning);
  const losing = sorted.filter(p => !p.isWinning);

  // Sort positions without price data by value
  const unknownSorted = [...withoutPriceData].sort((a, b) => b.value - a.value);

  console.log(`\n${colors.cyan}  Open Positions (${positions.length})${colors.reset}`);
  console.log(`${colors.dim}  ───────────────────────────────────────────────────────${colors.reset}`);

  // Show winning positions (with price data)
  if (winning.length > 0) {
    console.log(`${colors.green}  Winning (${winning.length}):${colors.reset}`);
    for (const pos of winning.slice(0, 5)) {
      displayPosition(pos);
    }
    if (winning.length > 5) {
      console.log(`${colors.dim}    ...and ${winning.length - 5} more winning${colors.reset}`);
    }
  }

  // Show losing positions (with price data)
  if (losing.length > 0) {
    console.log(`${colors.red}  Losing (${losing.length}):${colors.reset}`);
    for (const pos of losing.slice(0, 5)) {
      displayPosition(pos);
    }
    if (losing.length > 5) {
      console.log(`${colors.dim}    ...and ${losing.length - 5} more losing${colors.reset}`);
    }
  }

  // Show positions without price data
  if (unknownSorted.length > 0) {
    console.log(`${colors.dim}  Awaiting Price Data (${unknownSorted.length}):${colors.reset}`);
    for (const pos of unknownSorted.slice(0, 5)) {
      displayPosition(pos);
    }
    if (unknownSorted.length > 5) {
      console.log(`${colors.dim}    ...and ${unknownSorted.length - 5} more awaiting data${colors.reset}`);
    }
  }

  // Summary - only count P&L for positions with price data
  const knownPnl = withPriceData.reduce((sum, p) => sum + p.pnl, 0);
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  const unknownValue = withoutPriceData.reduce((sum, p) => sum + p.value, 0);
  const pnlColor = knownPnl >= 0 ? colors.green : colors.red;
  const pnlSign = knownPnl >= 0 ? "+" : "";

  console.log(`${colors.dim}  ───────────────────────────────────────────────────────${colors.reset}`);
  console.log(
    `  ${colors.dim}Total Value:${colors.reset} ${colors.white}$${totalValue.toFixed(2)}${colors.reset}  ` +
    `${colors.dim}Unrealized P&L:${colors.reset} ${pnlColor}${pnlSign}$${knownPnl.toFixed(2)}${colors.reset}` +
    (withoutPriceData.length > 0 ? `  ${colors.dim}($${unknownValue.toFixed(0)} awaiting prices)${colors.reset}` : "")
  );
}

/**
 * Display all active portfolios summary
 */
export function displayAllPortfolios(
  portfolios: Array<{
    portfolioId: number;
    userId: number;
    totalValue: number;
    pnl: number;
    pnlPercent: number;
    pnl24h: number | null;
    pnl24hPercent: number | null;
    walletCount: number;
    tradeCount: number;
  }>,
  history?: Map<number, Array<{ timestamp: number; value: number; pnl: number }>>,
  positions?: Map<number, Array<{
    marketTitle: string;
    outcome: string;
    shares: number;
    avgPrice: number;
    currentPrice: number;
    cost: number;
    value: number;
    pnl: number;
    pnlPercent: number;
    isWinning: boolean;
    hasPriceData: boolean;
    endDate?: number | null;
  }>>
): void {
  if (portfolios.length === 0) {
    console.log(`${colors.dim}  No active paper portfolios${colors.reset}`);
    return;
  }

  for (const p of portfolios) {
    displayPortfolioPanel({
      ...p,
      history: history?.get(p.portfolioId),
    });

    // Display positions for this portfolio
    const portfolioPositions = positions?.get(p.portfolioId);
    if (portfolioPositions && portfolioPositions.length > 0) {
      displayPositions(portfolioPositions);
    }
  }
}

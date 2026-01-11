import { getPositions, getTrades, discoverActiveTraders, getTopTraders, type Position, type Trade } from "../api/polymarket";
import { config } from "../config";
import { logger } from "../utils/logger";

export type MarketCategory = "POLITICS" | "CRYPTO" | "SPORTS" | "CULTURE" | "OTHER";

export interface CategoryMetrics {
  category: MarketCategory;
  pnl: number;
  trades: number;
  volume: number;
  winRate: number;
}

export interface WalletScore {
  address: string;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgTradeSize: number;
  lastTradeAt: number;
  // Dormant whale metrics
  daysSinceLastTrade: number;
  pnlPerTrade: number;
  tradeFrequency: number; // trades per month
  whaleType: "active" | "dormant" | "sniper";
  // Taker/Maker metrics
  takerRatio: number; // % of trades where wallet was taker (aggressor)
  takerVolume: number;
  makerVolume: number;
  // Category breakdown
  categoryBreakdown: CategoryMetrics[];
}

/**
 * Detect the category of a market based on slug and title patterns
 */
export function detectCategory(slug: string, title: string): MarketCategory {
  const slugLower = slug.toLowerCase();
  const titleLower = title.toLowerCase();

  // Sports: NBA, NFL, NHL, MLB, EPL, UCL, MLS, UFC, etc.
  if (slugLower.match(/^(nba|nfl|nhl|mlb|epl|ucl|mls|ufc|ncaa|f1|tennis|golf|boxing|cricket|rugby)-/)) {
    return "SPORTS";
  }
  if (titleLower.match(/\b(nba|nfl|nhl|mlb|super bowl|world series|champions league|premier league|ufc|mma|playoffs|championship game)\b/)) {
    return "SPORTS";
  }

  // Politics: elections, candidates, government
  if (slugLower.includes("election") || slugLower.includes("president") || slugLower.includes("congress")) {
    return "POLITICS";
  }
  if (titleLower.match(/\b(election|president|trump|biden|senate|congress|democrat|republican|vote|governor|mayor|poll)\b/)) {
    return "POLITICS";
  }

  // Crypto: bitcoin, ethereum, tokens
  if (slugLower.match(/\b(bitcoin|btc|ethereum|eth|crypto|solana|sol|xrp|cardano|ada|doge|bnb)\b/)) {
    return "CRYPTO";
  }
  if (titleLower.match(/\b(bitcoin|btc|ethereum|eth|crypto|cryptocurrency|token|blockchain|defi|nft)\b/)) {
    return "CRYPTO";
  }

  // Culture: entertainment, celebrities, tech, science
  if (titleLower.match(/\b(oscar|grammy|emmy|movie|film|album|celebrity|elon musk|twitter|meta|apple|google|ai|openai|spacex)\b/)) {
    return "CULTURE";
  }

  return "OTHER";
}

export async function analyzeWallet(address: string, minTrades = config.MIN_TRADES): Promise<WalletScore | null> {
  try {
    // Fetch positions to get PnL data
    const positions = await getPositions({ user: address, limit: 500 });

    // Fetch recent trades
    const trades = await getTrades({ user: address, limit: 500 });

    if (trades.length < minTrades) {
      return null; // Not enough history
    }

    // Calculate PnL from positions with category breakdown
    let realizedPnl = 0;
    let unrealizedPnl = 0;
    let winningPositions = 0;
    let losingPositions = 0;

    // Track per-category metrics
    const categoryStats: Map<MarketCategory, { pnl: number; trades: number; volume: number; wins: number; total: number }> = new Map();

    for (const pos of positions) {
      // cashPnl = unrealized, realizedPnl = realized
      const realized = pos.realizedPnl || 0;
      const unrealized = pos.cashPnl || 0;

      realizedPnl += realized;
      unrealizedPnl += unrealized;

      // Count winning/losing based on total position PnL
      const positionPnl = realized + unrealized;
      if (positionPnl > 0) {
        winningPositions++;
      } else if (positionPnl < 0) {
        losingPositions++;
      }

      // Track category PnL
      const category = detectCategory("", pos.title || "");
      const stats = categoryStats.get(category) || { pnl: 0, trades: 0, volume: 0, wins: 0, total: 0 };
      stats.pnl += positionPnl;
      stats.trades++;
      stats.volume += pos.currentValue || 0;
      stats.total++;
      if (positionPnl > 0) stats.wins++;
      categoryStats.set(category, stats);
    }

    const totalPnl = realizedPnl + unrealizedPnl;
    const totalDecided = winningPositions + losingPositions;
    const winRate = totalDecided > 0 ? winningPositions / totalDecided : 0;

    // Calculate average trade size and taker/maker breakdown
    let totalVolume = 0;
    let takerVolume = 0;
    let makerVolume = 0;
    let takerCount = 0;
    const addrLower = address.toLowerCase();

    for (const trade of trades) {
      const size = parseFloat(trade.size || "0");
      const price = parseFloat(trade.price || "0");
      const tradeVolume = size * price;
      totalVolume += tradeVolume;

      // Determine if this wallet was taker or maker
      if (trade.taker?.toLowerCase() === addrLower) {
        takerVolume += tradeVolume;
        takerCount++;
      } else if (trade.maker?.toLowerCase() === addrLower) {
        makerVolume += tradeVolume;
      }
    }
    const avgTradeSize = trades.length > 0 ? totalVolume / trades.length : 0;
    const takerRatio = trades.length > 0 ? takerCount / trades.length : 0;

    // Get last trade timestamp
    const firstTrade = trades[0];
    const lastTradeAt = firstTrade ? firstTrade.timestamp : 0;

    // Calculate dormant whale metrics
    const now = Date.now() / 1000;
    const daysSinceLastTrade = lastTradeAt > 0 ? (now - lastTradeAt) / 86400 : 999;

    // PnL per trade
    const pnlPerTrade = trades.length > 0 ? totalPnl / trades.length : 0;

    // Trade frequency (trades per 30 days)
    const lastTrade = trades[trades.length - 1];
    const oldestTrade = lastTrade ? lastTrade.timestamp : now;
    const tradingPeriodDays = Math.max(1, (now - oldestTrade) / 86400);
    const tradeFrequency = (trades.length / tradingPeriodDays) * 30;

    // Classify whale type
    let whaleType: "active" | "dormant" | "sniper" = "active";
    if (tradeFrequency < 10 && pnlPerTrade > 100) {
      // Low frequency + high PnL per trade = dormant whale
      whaleType = "dormant";
    } else if (tradeFrequency < 5 && winRate > 0.7) {
      // Very low frequency + high win rate = sniper
      whaleType = "sniper";
    }

    // Build category breakdown array sorted by PnL
    const categoryBreakdown: CategoryMetrics[] = Array.from(categoryStats.entries())
      .map(([category, stats]) => ({
        category,
        pnl: stats.pnl,
        trades: stats.trades,
        volume: stats.volume,
        winRate: stats.total > 0 ? stats.wins / stats.total : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl);

    return {
      address,
      totalPnl,
      realizedPnl,
      unrealizedPnl,
      winRate,
      totalTrades: trades.length,
      winningTrades: winningPositions,
      losingTrades: losingPositions,
      avgTradeSize,
      lastTradeAt,
      daysSinceLastTrade,
      pnlPerTrade,
      tradeFrequency,
      whaleType,
      takerRatio,
      takerVolume,
      makerVolume,
      categoryBreakdown,
    };
  } catch (error) {
    logger.error(`Failed to analyze wallet ${address}`, error);
    return null;
  }
}

export async function discoverProfitableWallets(count = 100): Promise<WalletScore[]> {
  logger.info("Discovering traders...");

  // Get top traders from leaderboard first (includes dormant whales with high all-time PnL)
  logger.info("Fetching leaderboard top traders...");
  let leaderboardAddresses: string[] = [];
  try {
    leaderboardAddresses = await getTopTraders();
    logger.info(`Found ${leaderboardAddresses.length} traders from leaderboard`);
  } catch (e) {
    logger.warn("Leaderboard fetch failed, using recent trades only");
  }

  // Also get recent traders
  const recentAddresses = await discoverActiveTraders(500);
  logger.info(`Found ${recentAddresses.length} recent traders`);

  // Combine, prioritizing leaderboard traders
  const addressSet = new Set<string>(leaderboardAddresses);
  for (const addr of recentAddresses) {
    addressSet.add(addr);
  }
  const addresses = Array.from(addressSet);
  logger.info(`Total unique addresses: ${addresses.length}`);

  const scores: WalletScore[] = [];
  const seen = new Set<string>();

  // Pass 1: Find active whales (high trade count, standard criteria)
  logger.info("Pass 1: Finding active whales...");
  for (const address of addresses) {
    if (scores.length >= count) break;

    try {
      const score = await analyzeWallet(address, 10);
      if (!score) continue;

      if (meetsThreshold(score) && !seen.has(address)) {
        scores.push(score);
        seen.add(address);
        const typeTag = score.whaleType !== "active" ? ` [${score.whaleType.toUpperCase()}]` : "";
        logger.walletFound(score.address, score.totalPnl, score.winRate);
        if (typeTag) logger.info(`  ^ ${typeTag}`);
      }

      await new Promise((r) => setTimeout(r, 150));
    } catch {
      // Skip failed wallets
    }
  }

  // Pass 2: Find dormant whales (fewer than 500 trades returned = genuinely lower volume)
  logger.info("Pass 2: Finding dormant whales (low-volume high-conviction traders)...");
  for (const address of addresses) {
    if (scores.length >= count) break;
    if (seen.has(address)) continue;

    try {
      // Lower minimum trades for dormant whales
      const score = await analyzeWallet(address, 3);
      if (!score) continue;

      // Dormant whale criteria:
      // - Less than 500 trades (means we got ALL their trades)
      // - Very high profit per trade
      // - Decent win rate
      // - Still minimum $10k total
      const isDormantWhale =
        score.totalTrades < 500 &&
        score.totalTrades >= 3 &&
        score.pnlPerTrade >= 1000 && // $1k+ per trade
        score.winRate >= 0.5 &&
        score.totalPnl >= 10000; // $10k minimum

      if (isDormantWhale && !seen.has(address)) {
        score.whaleType = "dormant";
        scores.push(score);
        seen.add(address);
        logger.walletFound(score.address, score.totalPnl, score.winRate);
        logger.info(`  ^ [DORMANT] ${score.totalTrades} trades, $${score.pnlPerTrade.toFixed(0)}/trade`);
      }

      await new Promise((r) => setTimeout(r, 150));
    } catch {
      // Skip
    }
  }

  // Sort by PnL per trade for better ranking (catches both active and dormant)
  scores.sort((a, b) => {
    // Dormant whales and snipers get priority
    if (a.whaleType !== "active" && b.whaleType === "active") return -1;
    if (b.whaleType !== "active" && a.whaleType === "active") return 1;
    return b.totalPnl - a.totalPnl;
  });

  return scores;
}

function meetsThreshold(score: WalletScore): boolean {
  // Hard minimum: $10k PnL, no exceptions
  if (score.totalPnl < 10000) {
    return false;
  }

  // Must have decent win rate
  if (score.winRate < 0.55) {
    return false;
  }

  return true;
}

export function formatWalletScore(score: WalletScore): string {
  const typeEmoji = {
    active: "",
    dormant: " [DORMANT WHALE]",
    sniper: " [SNIPER]",
  };

  // Format category breakdown
  const categoryLines = score.categoryBreakdown
    .filter((cat) => cat.trades > 0)
    .slice(0, 4) // Top 4 categories
    .map((cat) => {
      const pnlSign = cat.pnl >= 0 ? "+" : "";
      return `  ${cat.category}: ${pnlSign}$${cat.pnl.toFixed(0)} (${cat.trades} trades, ${(cat.winRate * 100).toFixed(0)}% win)`;
    });

  const lines = [
    `Address: ${score.address}${typeEmoji[score.whaleType]}`,
    `Total PnL: $${score.totalPnl.toFixed(2)}`,
    `Win Rate: ${(score.winRate * 100).toFixed(1)}%`,
    `Trades: ${score.totalTrades} (${score.winningTrades}W / ${score.losingTrades}L)`,
    `Avg Trade: $${score.avgTradeSize.toFixed(2)}`,
    `PnL/Trade: $${score.pnlPerTrade.toFixed(2)}`,
    `Taker Ratio: ${(score.takerRatio * 100).toFixed(1)}% ($${score.takerVolume.toFixed(0)} taker / $${score.makerVolume.toFixed(0)} maker)`,
    `Frequency: ${score.tradeFrequency.toFixed(1)} trades/month`,
    `Last Active: ${score.daysSinceLastTrade.toFixed(0)} days ago`,
  ];

  if (categoryLines.length > 0) {
    lines.push(`Category Breakdown:`);
    lines.push(...categoryLines);
  }

  return lines.join("\n");
}

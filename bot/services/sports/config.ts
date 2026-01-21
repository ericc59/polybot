// =============================================
// SPORTS BETTING CONFIG
// =============================================

import type { SportsConfig } from "./types";

export const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
export const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

export const DEFAULT_SPORTS_CONFIG: SportsConfig = {
  enabled: true,
  minEdge: 0.035, // 3.5% minimum edge to buy (fallback when dynamic disabled)
  minSellEdge: 0.05, // 5% edge to sell (lock in profits)
  minSellProfit: 0.05, // 5% minimum profit to sell
  kellyFraction: 0.25, // Quarter Kelly
  maxBetPct: 0.03, // 3% max per bet
  maxExposurePct: 0.5, // 25% max exposure (total open position value)
  minBetUsd: 0.5, // $0.5 minimum
  maxBetUsd: 5, // $1 maximum per bet
  maxPerMarket: 25, // $25 max total exposure per outcome
  sharesPerBet: 25, // Fixed 25 shares per bet (set to 0 to use dollar-based sizing)
  maxSharesPerMarket: 100, // Max 100 shares per outcome
  booksRequired: 2, // Consensus from 2+ books
  maxBetsPerEvent: 15, // Max bets per event (prevents correlated bets)
  sports: [
    "basketball_nba",
    "basketball_ncaab",
    "americanfootball_nfl",
    "icehockey_nhl",
  ],
  autoTrade: true, // Entries enabled, all exits disabled
  maxHoldPrice: 1.0, // DISABLED - was causing unwanted sells at 85¢
  minPrice: 0.25, // Don't bet on outcomes below 25¢ (avoid extreme underdogs)
  // Improvement 1: Dynamic edge thresholds based on confidence
  dynamicEdgeEnabled: false, // DISABLED - use single minEdge threshold
  minEdge4Books: 0.025, // 2.5% edge when 4+ books agree (high confidence)
  minEdge3Books: 0.035, // 3.5% edge when 3 books agree (medium confidence)
  minEdge2Books: 0.05, // 5% edge when only 2 books agree (low confidence)
  maxVarianceForLowEdge: 0.02, // Max 2% variance to qualify for lower edge threshold
  // Improvement 2: Edge-proportional position sizing
  edgeProportionalSizing: true,
  maxEdgeMultiplier: 3, // Up to 3x size for high-edge bets
  // Improvement 3: Edge reversal exit
  edgeReversalEnabled: false, // Disabled - exit methodology TBD
  edgeReversalThreshold: -0.02, // Sell if edge drops below -2%
  // Improvement 5: Correlated position limits
  correlationEnabled: true,
  sameEventCorrelation: 0.8, // High correlation for same event
  sameDayCorrelation: 0.3, // Medium correlation for same day bets
  // Pre-game buffer: avoid danger zone right before tipoff
  preGameBufferMinutes: 30, // Skip bets within 30 min of start (but allow live betting)
};

// Sharp books only - in order of preference (pinnacle is sharpest when available)
export const SHARP_BOOKS = ["pinnacle", "lowvig", "betonlineag", "fanduel", "draftkings"];

// Max age for bookmaker odds (2 minutes - lines can move fast)
export const MAX_ODDS_AGE_MS = 2 * 60 * 1000;

// Game duration in minutes by sport
export const GAME_DURATIONS: Record<string, number> = {
  basketball_nba: 48,
  basketball_ncaab: 40,
  americanfootball_nfl: 60,
  americanfootball_ncaaf: 60,
  icehockey_nhl: 60,
  baseball_mlb: 180, // ~3 hours average
};

// Polymarket series IDs for sports leagues
export const POLYMARKET_SERIES_IDS: Record<string, number> = {
  basketball_nba: 10345,
  basketball_ncaab: 10470,
  americanfootball_nfl: 10187,
  americanfootball_ncaaf: 10210,
  baseball_mlb: 3,
  icehockey_nhl: 10346,
};

// Slug prefixes for sports (fallback when series_id doesn't work)
export const POLYMARKET_SLUG_PREFIXES: Record<string, string> = {
  basketball_nba: "nba-",
  basketball_ncaab: "cbb-",
  americanfootball_nfl: "nfl-",
  americanfootball_ncaaf: "cfb-",
  baseball_mlb: "mlb-",
  icehockey_nhl: "nhl-",
};

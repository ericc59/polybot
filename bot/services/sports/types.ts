// =============================================
// SPORTS BETTING TYPES
// =============================================

export interface OddsApiMatch {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    last_update: string;
    markets: Array<{
      key: string;
      last_update: string;
      outcomes: Array<{
        name: string;
        price: number;
      }>;
    }>;
  }>;
}

export interface ValueBet {
  id: string;
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcome: string;
  sharpOdds: number;
  sharpProb: number;
  polymarketPrice: number;
  edge: number;
  expectedValue: number;
  recommendedSize: number;
  bookmakerConsensus: number;
  polymarketTokenId: string;
  polymarketConditionId: string;
  polymarketSlug?: string;
  detectedAt: number;
  consensusVariance?: number;
  dynamicMinEdge?: number;
  bookData?: BookData[];
}

export interface BookData {
  key: string;
  odds: number;
  rawProb: number;
  fairProb: number;
  vig: number;
}

export interface SportsConfig {
  enabled: boolean;
  minEdge: number;
  minSellEdge: number;
  minSellProfit: number;
  kellyFraction: number;
  maxBetPct: number;
  maxExposurePct: number;
  minBetUsd: number;
  maxBetUsd: number;
  maxPerMarket: number;
  sharesPerBet: number;
  maxSharesPerMarket: number;
  booksRequired: number;
  maxBetsPerEvent: number;
  sports: string[];
  autoTrade: boolean;
  maxHoldPrice: number;
  minPrice: number;
  dynamicEdgeEnabled: boolean;
  minEdge4Books: number;
  minEdge3Books: number;
  minEdge2Books: number;
  maxVarianceForLowEdge: number;
  edgeProportionalSizing: boolean;
  maxEdgeMultiplier: number;
  edgeReversalEnabled: boolean;
  edgeReversalThreshold: number;
  correlationEnabled: boolean;
  sameEventCorrelation: number;
  sameDayCorrelation: number;
  preGameBufferMinutes: number;
}

export interface PolymarketSportsEvent {
  id: string;
  slug: string;
  title: string;
  startDate: string;
  endDate: string;
  markets?: Array<{
    id: string;
    question: string;
    conditionId: string;
    outcomes: string;
    outcomePrices: string;
    clobTokenIds: string;
    groupItemTitle?: string;
  }>;
}

export interface TrackedEvent {
  id: string;
  slug: string;
  sport: string;
  title: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcomes: Array<{
    name: string;
    price: number;
    tokenId: string;
  }>;
  hasValueBet: boolean;
  valueBetEdge?: number;
}

export interface OpenBet {
  id: number;
  userId?: number;
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  tokenId: string;
  shares: number;
  buyPrice: number;
  size: number;
  commenceTime?: number | null;
}

export interface LiveScore {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{
    name: string;
    score: string;
  }> | null;
  last_update: string | null;
}

export interface SportsStatus {
  isMonitoring: boolean;
  valueBetsFound: number;
  lastPoll: number;
  openBets: number;
  todaysVolume: number;
  todaysPnl: number;
  config: SportsConfig;
}

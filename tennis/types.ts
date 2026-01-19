// Types from The Odds API
export interface OddsApiMatch {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string; // ISO date string
  home_team: string;
  away_team: string;
  completed?: boolean;
  scores?: Array<{ name: string; score: string }> | null;
  last_update?: string;
}

// Internal tracked match representation
export interface TrackedMatch {
  id: number;
  oddsApiId: string;
  player1: string;
  player2: string;
  commenceTime: number; // Unix timestamp
  sportKey: string;
  polymarketConditionId: string | null;
  player1TokenId: string | null;
  player2TokenId: string | null;
  polymarketSlug: string | null; // Event slug for fetching ALL markets
  status: MatchStatus;
  walkoverDetectedAt: number | null;
  ordersPlacedAt: number | null;
  notes: string | null;
  lastSeenInApi: number | null; // When we last saw this in Odds API
  consecutiveMissing: number; // How many consecutive polls it's been missing
  createdAt: number;
  updatedAt: number;
}

export type MatchStatus =
  | "pending" // Tracking but not started
  | "live" // Match in progress
  | "walkover_detected" // Walkover detected, awaiting order placement
  | "orders_placed" // Orders have been placed
  | "completed" // Fully resolved
  | "ignored"; // Manually ignored

// Walkover detection result
export interface WalkoverDetection {
  detected: boolean;
  reason?: WalkoverReason;
  confidence?: WalkoverConfidence;
}

export type WalkoverReason =
  | "completed_no_scores" // Match marked completed but no scores
  | "disappeared_before_start" // Match removed from API before start time
  | "manual"; // Manually triggered

export type WalkoverConfidence = "high" | "medium" | "low";

// Polymarket market match
export interface PolymarketMatch {
  conditionId: string;
  questionId: string;
  title: string;
  player1: string;
  player1TokenId: string;
  player2: string;
  player2TokenId: string;
  endDate?: string;
}

// Order tracking
export interface PlacedOrder {
  id: number;
  matchId: number;
  player: string;
  tokenId: string;
  orderId: string;
  side: "BUY";
  price: number;
  size: number;
  status: OrderStatus;
  createdAt: number;
}

export type OrderStatus = "pending" | "filled" | "partially_filled" | "cancelled" | "expired";

// Trading wallet
export interface TennisWallet {
  id: number;
  walletAddress: string;
  encryptedCredentials: string;
  proxyAddress: string | null;
  createdAt: number;
}

// Walkover event log
export interface WalkoverEvent {
  id: number;
  matchId: number;
  detectionReason: WalkoverReason;
  confidence: WalkoverConfidence;
  detectedAt: number;
  notified: boolean;
}

import { config } from "../config";

export interface Trade {
  id: string;
  taker: string;
  maker: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: string;
  price: string;
  timestamp: number;
  transactionHash: string;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  proxyWallet?: string;
  name?: string;
  pseudonym?: string;
}

export interface Position {
  asset: string;
  conditionId: string;
  size: string;
  avgPrice: string;
  curPrice: string;
  title: string;
  outcome: string;
  outcomeIndex: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  realizedPnl: number;
  percentPnl: number;
  redeemable: boolean;
  mergeable: boolean;
}

export interface Activity {
  id: string;
  user: string;
  type: "TRADE" | "SPLIT" | "MERGE" | "REDEEM" | "REWARD" | "CONVERSION";
  timestamp: number;
  transactionHash: string;
  conditionId?: string;
  title?: string;
  side?: "BUY" | "SELL";
  size?: string;
  price?: string;
  usdcSize?: string;
}

export interface WalletProfile {
  address: string;
  name?: string;
  pseudonym?: string;
  bio?: string;
  profileImage?: string;
  volume?: string;
  pnl?: string;
  positions?: number;
}

async function fetchApi<T>(endpoint: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const url = new URL(endpoint, config.DATA_API);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function getTrades(params: {
  user?: string;
  market?: string;
  limit?: number;
  offset?: number;
  side?: "BUY" | "SELL";
}): Promise<Trade[]> {
  return fetchApi<Trade[]>("/trades", params);
}

export async function getActivity(params: {
  user: string;
  type?: string;
  limit?: number;
  offset?: number;
  start?: number;
  end?: number;
}): Promise<Activity[]> {
  return fetchApi<Activity[]>("/activity", params);
}

export async function getPositions(params: {
  user: string;
  limit?: number;
  offset?: number;
}): Promise<Position[]> {
  return fetchApi<Position[]>("/positions", params);
}

export async function getRecentMarketTrades(conditionId: string, limit = 100): Promise<Trade[]> {
  return fetchApi<Trade[]>("/trades", { market: conditionId, limit });
}

// Discover wallets by looking at recent trades on active markets
export async function discoverActiveTraders(limit = 500): Promise<string[]> {
  const trades = await fetchApi<Trade[]>("/trades", { limit });

  // Get unique wallet addresses
  const wallets = new Set<string>();
  for (const trade of trades) {
    const address = trade.proxyWallet || trade.taker;
    if (address) {
      wallets.add(address.toLowerCase());
    }
  }

  return Array.from(wallets);
}

export interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
  profileImage: string;
  xUsername?: string;
  verifiedBadge: boolean;
}

// Get top traders from the leaderboard
export async function getLeaderboard(params: {
  category?: "OVERALL" | "POLITICS" | "SPORTS" | "CRYPTO" | "CULTURE";
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  orderBy?: "PNL" | "VOL";
  limit?: number;
  offset?: number;
}): Promise<LeaderboardEntry[]> {
  return fetchApi<LeaderboardEntry[]>("/v1/leaderboard", {
    category: params.category || "OVERALL",
    timePeriod: params.timePeriod || "ALL",
    orderBy: params.orderBy || "PNL",
    limit: params.limit || 50,
    offset: params.offset || 0,
  });
}

// Get top traders from multiple time periods for a comprehensive list
export async function getTopTraders(): Promise<string[]> {
  const wallets = new Set<string>();

  // Get all-time top PnL traders
  const allTime = await getLeaderboard({ timePeriod: "ALL", orderBy: "PNL", limit: 50 });
  for (const entry of allTime) {
    if (entry.proxyWallet) wallets.add(entry.proxyWallet.toLowerCase());
  }

  // Get monthly top performers (might catch dormant whales who woke up)
  const monthly = await getLeaderboard({ timePeriod: "MONTH", orderBy: "PNL", limit: 50 });
  for (const entry of monthly) {
    if (entry.proxyWallet) wallets.add(entry.proxyWallet.toLowerCase());
  }

  return Array.from(wallets);
}

// Market details
export interface Market {
  id: string;
  conditionId: string;
  slug: string;
  title: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  endDate: string;
  createdAt: string;
  closed: boolean;
  resolved: boolean;
  resolutionSource?: string;
  category?: string;
}

// Fetch market details from Gamma API
export async function getMarket(conditionId: string): Promise<Market | null> {
  try {
    const url = new URL(`/markets/${conditionId}`, config.GAMMA_API);
    const response = await fetch(url.toString());

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as Market;
  } catch (error) {
    return null;
  }
}

// Search markets by slug or title
export async function searchMarkets(query: string, limit = 10): Promise<Market[]> {
  try {
    const url = new URL("/markets", config.GAMMA_API);
    url.searchParams.set("_limit", String(limit));
    url.searchParams.set("closed", "false");

    const response = await fetch(url.toString());

    if (!response.ok) {
      return [];
    }

    const markets = (await response.json()) as Market[];

    // Filter by query
    const q = query.toLowerCase();
    return markets.filter(
      (m) =>
        m.slug?.toLowerCase().includes(q) ||
        m.title?.toLowerCase().includes(q)
    );
  } catch (error) {
    return [];
  }
}

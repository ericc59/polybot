import { tennisConfig } from "../config";
import { logger } from "../../lib/logger";
import type { PolymarketMatch } from "../types";

// Sports series IDs for tennis
const ATP_SERIES_ID = "10365";
const WTA_SERIES_ID = "10366";

// Cache for tennis events
interface CachedEvent {
  id: string;
  title: string;
  slug: string;
  startDate?: string; // Market creation time (NOT match time!)
  startTime?: string; // Actual event start time (ISO string)
  description?: string; // Contains actual match time as fallback
  markets: Array<{
    conditionId: string;
    question: string;
    outcomes: string;
    clobTokenIds: string;
    endDate: string;
  }>;
}

let cachedEvents: CachedEvent[] = [];
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all active tennis events from Polymarket Sports API
 * Uses pagination to get ALL events (API returns max 20 per page)
 */
export async function fetchAllTennisEvents(): Promise<CachedEvent[]> {
  const now = Date.now();
  if (cachedEvents.length > 0 && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedEvents;
  }

  const events: CachedEvent[] = [];

  // Fetch ATP and WTA events with pagination
  for (const seriesId of [ATP_SERIES_ID, WTA_SERIES_ID]) {
    let offset = 0;
    const pageSize = 20;
    let hasMore = true;

    while (hasMore) {
      try {
        // Use active=true, order by startTime ascending to get today's events first
        const url = `${tennisConfig.GAMMA_API}/events?series_id=${seriesId}&active=true&closed=false&order=startTime&ascending=true&limit=${pageSize}&offset=${offset}`;
        const response = await fetch(url);

        if (response.ok) {
          const data = (await response.json()) as CachedEvent[];
          events.push(...data);

          // If we got fewer than pageSize, we've reached the end
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            offset += pageSize;
            // Safety limit to avoid infinite loops
            if (offset > 500) hasMore = false;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        logger.error(`Failed to fetch tennis events for series ${seriesId}`, error);
        hasMore = false;
      }
    }
  }

  if (events.length > 0) {
    cachedEvents = events;
    lastCacheTime = now;
    logger.info(`Cached ${events.length} tennis events from Polymarket`);
  }

  return events;
}

/**
 * Fetch a single event by slug
 */
async function fetchEventBySlug(slug: string): Promise<CachedEvent | null> {
  try {
    const url = `${tennisConfig.GAMMA_API}/events?slug=${slug}`;
    const response = await fetch(url);

    if (response.ok) {
      const data = (await response.json()) as CachedEvent[];
      if (data.length > 0) {
        return data[0] ?? null;
      }
    }
  } catch (error) {
    // Silent fail - slug might not exist
  }
  return null;
}

/**
 * Generate possible Polymarket slugs for a tennis match
 * Slug format: {sport}-{player1lastname truncated}-{player2lastname truncated}-{date}
 */
function generatePossibleSlugs(
  player1: string,
  player2: string,
  sportKey: string,
  commenceTime: number
): string[] {
  const slugs: string[] = [];

  // Determine sport prefix (atp or wta)
  const isWTA = sportKey.toLowerCase().includes("wta");
  const prefix = isWTA ? "wta" : "atp";

  // Get various name variations for each player
  const nameVariants1 = getNameVariants(player1);
  const nameVariants2 = getNameVariants(player2);

  // Generate date strings for a few days around the commence time
  // Polymarket dates can be off by a day due to timezone differences
  const baseDate = new Date(commenceTime * 1000);
  const dates: string[] = [];

  for (let offset = -1; offset <= 2; offset++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + offset);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
  }

  // Generate slug combinations with all variants
  const seen = new Set<string>();
  for (const date of dates) {
    for (const v1 of nameVariants1) {
      for (const v2 of nameVariants2) {
        // Try both player orderings
        const slug1 = `${prefix}-${v1}-${v2}-${date}`;
        const slug2 = `${prefix}-${v2}-${v1}-${date}`;
        if (!seen.has(slug1)) {
          slugs.push(slug1);
          seen.add(slug1);
        }
        if (!seen.has(slug2)) {
          slugs.push(slug2);
          seen.add(slug2);
        }
      }
    }
  }

  return slugs;
}

/**
 * Get name variants for slug generation
 * Handles: short names (Ann Li → annli), Chinese names (surname first),
 * Hispanic multi-part names, varying truncation lengths, etc.
 */
function getNameVariants(fullName: string): string[] {
  const variants: string[] = [];
  const parts = fullName.trim().split(/\s+/);
  const normalized = parts.map(p => p.toLowerCase().replace(/[^a-z]/g, ""));

  // Skip suffixes like Jr., Sr., etc.
  const suffixes = ["jr", "sr", "ii", "iii", "iv"];
  const filteredParts = normalized.filter(p => !suffixes.includes(p));

  if (filteredParts.length === 0) return ["unknown"];

  // Standard: last name - try 6, 7, and 2 char truncations (Polymarket varies)
  const lastName = filteredParts[filteredParts.length - 1]!;
  variants.push(lastName.slice(0, 6));
  if (lastName.length >= 7) {
    variants.push(lastName.slice(0, 7));
  }
  // Try 2-char truncation (seen with "Wang" -> "wa")
  if (lastName.length >= 2) {
    variants.push(lastName.slice(0, 2));
  }
  // Also add full short names (like "bu", "li", "wu")
  if (lastName.length <= 3) {
    variants.push(lastName);
  }

  // For 2-part names
  if (filteredParts.length === 2) {
    const first = filteredParts[0]!;
    const last = filteredParts[1]!;

    // Try concatenated version for short names (e.g., "Ann Li" → "annli")
    if (first.length <= 4 && last.length <= 4) {
      variants.push((first + last).slice(0, 6));
    }

    // Try first name as potential surname (Chinese naming convention)
    variants.push(first.slice(0, 6));
    if (first.length >= 7) {
      variants.push(first.slice(0, 7));
    }
    if (first.length <= 3) {
      variants.push(first);
    }
  }

  // For names with 3+ parts (like "Maria Camila Osorio Serrano")
  // Try the second-to-last part as well (common Hispanic pattern)
  if (filteredParts.length >= 3) {
    const secondLast = filteredParts[filteredParts.length - 2]!;
    variants.push(secondLast.slice(0, 6));
    if (secondLast.length >= 7) {
      variants.push(secondLast.slice(0, 7));
    }
  }

  return [...new Set(variants)]; // Remove duplicates
}

/**
 * Search Polymarket for a tennis match market by player names
 */
export async function findMarketByPlayers(
  player1: string,
  player2: string,
  sportKey?: string,
  commenceTime?: number
): Promise<PolymarketMatch | null> {
  // First try the cached events from series_id query
  const events = await fetchAllTennisEvents();

  // Search for a match with these players
  const normalizedP1 = normalizeName(player1);
  const normalizedP2 = normalizeName(player2);
  const lastNameP1 = getLastName(normalizedP1);
  const lastNameP2 = getLastName(normalizedP2);

  for (const event of events) {
    const normalizedTitle = normalizeName(event.title);

    // Check if both players are mentioned in the title
    const hasP1 = normalizedTitle.includes(lastNameP1) || normalizedTitle.includes(normalizedP1);
    const hasP2 = normalizedTitle.includes(lastNameP2) || normalizedTitle.includes(normalizedP2);

    if (hasP1 && hasP2) {
      // Found a match - get the moneyline (head-to-head winner) market
      // The moneyline market question typically matches the event title
      // and has outcomes that are player names (not Over/Under, etc.)
      const market = event.markets?.find((m) => {
        try {
          const outcomes = JSON.parse(m.outcomes || "[]") as string[];
          if (outcomes.length !== 2) return false;

          // Skip Over/Under and handicap markets
          const hasOverUnder = outcomes.some(
            (o) => o.toLowerCase().includes("over") || o.toLowerCase().includes("under")
          );
          if (hasOverUnder) return false;

          // Skip set-specific markets
          const question = m.question.toLowerCase();
          if (question.includes("set 1") || question.includes("set handicap")) return false;

          // Prefer the market that matches the event title (head-to-head)
          if (m.question === event.title) return true;

          // Or any market with player name outcomes
          return outcomes.some((o) => normalizedTitle.includes(normalizeName(o)));
        } catch {
          return false;
        }
      });

      if (market) {
        try {
          const outcomes = JSON.parse(market.outcomes || "[]");
          const tokenIds = JSON.parse(market.clobTokenIds || "[]");

          if (outcomes.length >= 2 && tokenIds.length >= 2) {
            logger.info(`Found Polymarket market for ${player1} vs ${player2}: ${event.title}`);
            return {
              conditionId: market.conditionId,
              questionId: "",
              title: market.question || event.title,
              player1: outcomes[0],
              player1TokenId: tokenIds[0],
              player2: outcomes[1],
              player2TokenId: tokenIds[1],
              endDate: market.endDate,
            };
          }
        } catch (error) {
          logger.debug(`Failed to parse market data for ${event.title}`, error);
        }
      }
    }
  }

  // Fallback: Try slug-based lookup if we have sportKey and commenceTime
  if (sportKey && commenceTime) {
    const slugs = generatePossibleSlugs(player1, player2, sportKey, commenceTime);
    logger.debug(`Trying ${slugs.length} slug variants for ${player1} vs ${player2}`);

    for (const slug of slugs) {
      const event = await fetchEventBySlug(slug);
      if (event) {
        const result = extractMarketFromEvent(event, player1, player2);
        if (result) {
          logger.info(`Found Polymarket market via slug lookup for ${player1} vs ${player2}: ${event.title}`);
          return result;
        }
      }
    }
  }

  logger.warn(`Could not find Polymarket market for ${player1} vs ${player2}`);
  return null;
}

/**
 * Extract moneyline market from an event
 */
function extractMarketFromEvent(
  event: CachedEvent,
  player1: string,
  player2: string
): PolymarketMatch | null {
  const normalizedTitle = normalizeName(event.title);

  // Find the moneyline (head-to-head winner) market
  const market = event.markets?.find((m) => {
    try {
      const outcomes = JSON.parse(m.outcomes || "[]") as string[];
      if (outcomes.length !== 2) return false;

      // Skip Over/Under and handicap markets
      const hasOverUnder = outcomes.some(
        (o) => o.toLowerCase().includes("over") || o.toLowerCase().includes("under")
      );
      if (hasOverUnder) return false;

      // Skip set-specific markets
      const question = m.question.toLowerCase();
      if (question.includes("set 1") || question.includes("set handicap")) return false;

      // Prefer the market that matches the event title (head-to-head)
      if (m.question === event.title) return true;

      // Or any market with player name outcomes
      return outcomes.some((o) => normalizedTitle.includes(normalizeName(o)));
    } catch {
      return false;
    }
  });

  if (market) {
    try {
      const outcomes = JSON.parse(market.outcomes || "[]");
      const tokenIds = JSON.parse(market.clobTokenIds || "[]");

      if (outcomes.length >= 2 && tokenIds.length >= 2) {
        return {
          conditionId: market.conditionId,
          questionId: "",
          title: market.question || event.title,
          player1: outcomes[0],
          player1TokenId: tokenIds[0],
          player2: outcomes[1],
          player2TokenId: tokenIds[1],
          endDate: market.endDate,
        };
      }
    } catch {
      // Failed to parse
    }
  }

  return null;
}

/**
 * Clear the events cache (useful for testing)
 */
export function clearEventsCache(): void {
  cachedEvents = [];
  lastCacheTime = 0;
}

/**
 * Market info for placing orders
 */
export interface MarketForOrders {
  conditionId: string;
  question: string;
  outcomes: Array<{ outcome: string; tokenId: string }>;
}

/**
 * Get ALL markets for an event (by slug)
 * Returns all markets with their outcomes and token IDs for placing walkover orders
 */
export async function getAllMarketsForEvent(slug: string): Promise<MarketForOrders[]> {
  const markets: MarketForOrders[] = [];

  try {
    // Fetch the event directly by slug
    const event = await fetchEventBySlug(slug);

    if (!event || !event.markets) {
      logger.warn(`No event found for slug: ${slug}`);
      return markets;
    }

    logger.info(`Found ${event.markets.length} markets for event: ${event.title}`);

    for (const market of event.markets) {
      try {
        const outcomes = JSON.parse(market.outcomes || "[]") as string[];
        const tokenIds = JSON.parse(market.clobTokenIds || "[]") as string[];

        if (outcomes.length >= 2 && tokenIds.length >= 2) {
          const marketForOrders: MarketForOrders = {
            conditionId: market.conditionId,
            question: market.question,
            outcomes: outcomes.map((outcome, i) => ({
              outcome,
              tokenId: tokenIds[i] || "",
            })).filter(o => o.tokenId), // Only include outcomes with token IDs
          };

          markets.push(marketForOrders);
          logger.debug(`  Market: ${market.question} (${marketForOrders.outcomes.length} outcomes)`);
        }
      } catch (error) {
        logger.debug(`Failed to parse market: ${market.question}`, error);
      }
    }

    logger.info(`Parsed ${markets.length} tradeable markets for ${event.title}`);
    return markets;
  } catch (error) {
    logger.error(`Failed to get markets for slug ${slug}`, error);
    return markets;
  }
}

/**
 * Get ALL markets for an event by finding it via player names
 */
export async function getAllMarketsForMatch(
  player1: string,
  player2: string
): Promise<{ slug: string; markets: MarketForOrders[] } | null> {
  // Find the event
  const events = await fetchAllTennisEvents();

  const normalizedP1 = normalizeName(player1);
  const normalizedP2 = normalizeName(player2);
  const lastNameP1 = getLastName(normalizedP1);
  const lastNameP2 = getLastName(normalizedP2);

  for (const event of events) {
    const normalizedTitle = normalizeName(event.title);

    const hasP1 = normalizedTitle.includes(lastNameP1) || normalizedTitle.includes(normalizedP1);
    const hasP2 = normalizedTitle.includes(lastNameP2) || normalizedTitle.includes(normalizedP2);

    if (hasP1 && hasP2) {
      // Found the event - get all its markets
      const markets = await getAllMarketsForEvent(event.slug);
      return { slug: event.slug, markets };
    }
  }

  logger.warn(`Could not find event for ${player1} vs ${player2}`);
  return null;
}

/**
 * Get market directly by condition ID
 */
export async function getMarketByConditionId(
  conditionId: string
): Promise<PolymarketMatch | null> {
  try {
    // Try CLOB API first
    const clobUrl = `${tennisConfig.CLOB_HOST}/markets/${conditionId}`;
    const clobResponse = await fetch(clobUrl);

    if (clobResponse.ok) {
      const clobData = (await clobResponse.json()) as {
        condition_id: string;
        question_id?: string;
        tokens: Array<{ token_id: string; outcome: string }>;
      };

      // Get additional market info from Gamma API
      const gammaUrl = `${tennisConfig.GAMMA_API}/markets/${conditionId}`;
      const gammaResponse = await fetch(gammaUrl);
      let title = `Market ${conditionId.slice(0, 8)}...`;
      let endDate: string | undefined;

      if (gammaResponse.ok) {
        const gammaData = (await gammaResponse.json()) as {
          question?: string;
          endDate?: string;
        };
        title = gammaData.question || title;
        endDate = gammaData.endDate;
      }

      // Parse tokens (tennis markets have 2 outcomes - one per player)
      if (clobData.tokens.length >= 2) {
        const [token1, token2] = clobData.tokens;
        return {
          conditionId: clobData.condition_id,
          questionId: clobData.question_id || "",
          title,
          player1: token1!.outcome,
          player1TokenId: token1!.token_id,
          player2: token2!.outcome,
          player2TokenId: token2!.token_id,
          endDate,
        };
      }
    }

    return null;
  } catch (error) {
    logger.error(`Failed to get market ${conditionId}`, error);
    return null;
  }
}

/**
 * Normalize a player name for comparison
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .trim();
}

/**
 * Get last name from a full name
 */
function getLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  // Skip common suffixes like Jr., Sr., III, etc.
  const suffixes = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"];
  let lastName = parts[parts.length - 1] || fullName;

  if (parts.length > 1 && suffixes.includes(lastName.toLowerCase())) {
    lastName = parts[parts.length - 2] || lastName;
  }

  return lastName;
}

/**
 * Get current prices for a market's tokens
 */
export async function getMarketPrices(
  conditionId: string
): Promise<{ player1Price: number; player2Price: number } | null> {
  try {
    const url = `${tennisConfig.CLOB_HOST}/prices?market=${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, string>;

    // Get prices from response
    const prices = Object.values(data).map((p) => parseFloat(p));

    if (prices.length >= 2) {
      return {
        player1Price: prices[0] || 0,
        player2Price: prices[1] || 0,
      };
    }

    return null;
  } catch (error) {
    logger.error(`Failed to get prices for ${conditionId}`, error);
    return null;
  }
}

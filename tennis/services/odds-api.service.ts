import { tennisConfig } from "../config";
import { logger } from "../../lib/logger";
import type { OddsApiMatch } from "../types";

// Module state
let lastPollTime: number = 0;
let requestsRemaining: number = -1;
let requestsUsed: number = 0;
let lastFetchHadErrors: boolean = false;  // Track if last fetch had any API errors
const matchCache = new Map<string, OddsApiMatch>();
const sportFetchErrors = new Set<string>();  // Track which sports had errors in last fetch

// Tennis sport keys to monitor
const TENNIS_SPORTS = [
  "tennis_atp_aus_open",
  "tennis_atp_french_open",
  "tennis_atp_wimbledon",
  "tennis_atp_us_open",
  "tennis_wta_aus_open",
  "tennis_wta_french_open",
  "tennis_wta_wimbledon",
  "tennis_wta_us_open",
];

interface OddsApiResponse<T> {
  data: T;
  requestsRemaining: number;
  requestsUsed: number;
}

/**
 * Check if the last fetch had any API errors
 * Used by monitor to avoid false "missing" detections when API is having issues
 */
export function lastFetchHadApiErrors(): boolean {
  return lastFetchHadErrors;
}

/**
 * Check if a specific sport had errors in the last fetch
 */
export function sportHadFetchError(sportKey: string): boolean {
  // Check if this sport or a parent sport had errors
  return sportFetchErrors.has(sportKey) ||
         Array.from(sportFetchErrors).some(errSport => sportKey.startsWith(errSport.replace(/_[^_]+$/, '')));
}

/**
 * Fetch available tennis sports from The Odds API
 */
export async function fetchTennisSports(): Promise<string[]> {
  const url = `${tennisConfig.ODDS_API_BASE}/sports?apiKey=${tennisConfig.ODDS_API_KEY}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        logger.warn("Odds API rate limited");
        return [];
      }
      if (response.status >= 500) {
        logger.warn(`Odds API unavailable (${response.status})`);
        return [];
      }
      throw new Error(`API error: ${response.status}`);
    }

    updateRateLimits(response);

    const sports = (await response.json()) as Array<{ key: string; title: string; active: boolean }>;
    return sports
      .filter((s) => s.key.startsWith("tennis_") && s.active)
      .map((s) => s.key);
  } catch (error) {
    logger.error("Failed to fetch tennis sports", error);
    return [];
  }
}

/**
 * Fetch upcoming matches for a specific tennis sport
 * Returns { matches, hadError } to distinguish between "no matches" and "API error"
 */
export async function fetchMatchesForSport(sportKey: string): Promise<{ matches: OddsApiMatch[], hadError: boolean }> {
  const url = `${tennisConfig.ODDS_API_BASE}/sports/${sportKey}/events?apiKey=${tennisConfig.ODDS_API_KEY}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        logger.warn("Odds API rate limited");
        return { matches: [], hadError: true };
      }
      if (response.status === 404) {
        // Sport not available - this is not an error, just no data
        return { matches: [], hadError: false };
      }
      if (response.status >= 500) {
        logger.warn(`Odds API unavailable (${response.status}) for ${sportKey}`);
        return { matches: [], hadError: true };
      }
      return { matches: [], hadError: true };
    }

    updateRateLimits(response);

    const matches = (await response.json()) as OddsApiMatch[];
    return { matches, hadError: false };
  } catch (error) {
    logger.error(`Failed to fetch matches for ${sportKey}`, error);
    return { matches: [], hadError: true };
  }
}

/**
 * Fetch scores/results for a specific tennis sport
 */
export async function fetchScoresForSport(sportKey: string): Promise<OddsApiMatch[]> {
  const url = `${tennisConfig.ODDS_API_BASE}/sports/${sportKey}/scores?apiKey=${tennisConfig.ODDS_API_KEY}&daysFrom=1`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        logger.warn("Odds API rate limited");
        return [];
      }
      if (response.status === 404) {
        return [];
      }
      if (response.status >= 500) {
        logger.warn(`Odds API unavailable (${response.status}) for ${sportKey} scores`);
        return [];
      }
      throw new Error(`API error: ${response.status}`);
    }

    updateRateLimits(response);

    const matches = (await response.json()) as OddsApiMatch[];
    return matches;
  } catch (error) {
    logger.error(`Failed to fetch scores for ${sportKey}`, error);
    return [];
  }
}

/**
 * Fetch all upcoming tennis matches across all sports
 */
export async function fetchAllUpcomingMatches(): Promise<OddsApiMatch[]> {
  const allMatches: OddsApiMatch[] = [];

  // Reset error tracking for this fetch cycle
  sportFetchErrors.clear();
  lastFetchHadErrors = false;

  // First get active tennis sports
  const activeSports = await fetchTennisSports();

  if (activeSports.length === 0) {
    logger.warn("No active tennis sports found");
    lastFetchHadErrors = true;  // Treat no sports as an error condition
    return [];
  }

  logger.debug(`Found ${activeSports.length} active tennis sports`);

  // Fetch matches for each sport (sequentially to respect rate limits)
  let sportsWithErrors = 0;
  for (const sportKey of activeSports) {
    const { matches, hadError } = await fetchMatchesForSport(sportKey);

    if (hadError) {
      sportFetchErrors.add(sportKey);
      sportsWithErrors++;
      lastFetchHadErrors = true;
    }

    allMatches.push(...matches);

    // Small delay between requests
    await Bun.sleep(100);
  }

  // Update cache
  for (const match of allMatches) {
    matchCache.set(match.id, match);
  }

  lastPollTime = Date.now();

  if (sportsWithErrors > 0) {
    logger.warn(`Fetched ${allMatches.length} matches but ${sportsWithErrors}/${activeSports.length} sports had API errors`);
  } else {
    logger.info(`Fetched ${allMatches.length} tennis matches from ${activeSports.length} sports`);
  }

  return allMatches;
}

/**
 * Fetch scores for all active tennis sports
 */
export async function fetchAllScores(): Promise<OddsApiMatch[]> {
  const allScores: OddsApiMatch[] = [];
  const activeSports = await fetchTennisSports();

  for (const sportKey of activeSports) {
    const scores = await fetchScoresForSport(sportKey);
    allScores.push(...scores);
    await Bun.sleep(100);
  }

  // Update cache with score data
  for (const match of allScores) {
    matchCache.set(match.id, match);
  }

  return allScores;
}

/**
 * Get a cached match by ID
 */
export function getCachedMatch(matchId: string): OddsApiMatch | undefined {
  return matchCache.get(matchId);
}

/**
 * Get all cached matches
 */
export function getAllCachedMatches(): OddsApiMatch[] {
  return Array.from(matchCache.values());
}

/**
 * Clear the match cache
 */
export function clearCache(): void {
  matchCache.clear();
}

/**
 * Get last poll time
 */
export function getLastPollTime(): number {
  return lastPollTime;
}

/**
 * Get API rate limit status
 */
export function getRateLimitStatus(): { remaining: number; used: number } {
  return {
    remaining: requestsRemaining,
    used: requestsUsed,
  };
}

/**
 * Update rate limit tracking from response headers
 */
function updateRateLimits(response: Response): void {
  const remaining = response.headers.get("x-requests-remaining");
  const used = response.headers.get("x-requests-used");

  if (remaining) {
    requestsRemaining = parseInt(remaining, 10);
  }
  if (used) {
    requestsUsed = parseInt(used, 10);
  }
}

/**
 * Parse player names from match (tennis uses home/away but really player1/player2)
 */
export function parsePlayerNames(match: OddsApiMatch): { player1: string; player2: string } {
  return {
    player1: match.home_team,
    player2: match.away_team,
  };
}

/**
 * Check if a match has scores
 */
export function hasScores(match: OddsApiMatch): boolean {
  if (!match.scores || match.scores.length === 0) {
    return false;
  }
  // Check if any score is non-zero
  return match.scores.some((s) => parseInt(s.score || "0", 10) > 0);
}

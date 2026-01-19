import { logger } from "../utils/logger";
import { db } from "../db";
import * as tradingService from "./trading.service";
import * as copyService from "./copy.service";
import { decryptCredentials } from "../utils/crypto";
import { sendMessage } from "../telegram";
import * as userRepo from "../db/repositories/user.repo";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

// =============================================
// TYPES
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
  detectedAt: number;
}

export interface SportsConfig {
  enabled: boolean;
  minEdge: number;
  minSellEdge: number;
  kellyFraction: number;
  maxBetPct: number;
  maxExposurePct: number;  // Max % of bankroll in open positions
  minBetUsd: number;
  maxBetUsd: number;
  maxPerMarket: number;
  booksRequired: number;
  maxBetsPerEvent: number;
  sports: string[];
  autoTrade: boolean;
  maxHoldPrice: number;  // Auto-sell when bid price exceeds this (e.g., 0.85 = 85¢)
}

interface PolymarketSportsEvent {
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
    groupItemTitle?: string; // "Winner", "Over/Under 220.5", "Spread", etc.
  }>;
}

// =============================================
// CONFIG
// =============================================

const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

export const DEFAULT_SPORTS_CONFIG: SportsConfig = {
	enabled: true,
	minEdge: 0.035, // 3.5% minimum edge to buy
	minSellEdge: 0.05, // 5% edge to sell (lock in profits)
	kellyFraction: 0.25, // Quarter Kelly
	maxBetPct: 0.03, // 3% max per bet
	maxExposurePct: 0.5, // 25% max exposure (total open position value)
	minBetUsd: 0.5, // $0.5 minimum
	maxBetUsd: 5, // $1 maximum per bet
	maxPerMarket: 25, // $25 max total exposure per outcome
	booksRequired: 2, // Consensus from 2+ books
	maxBetsPerEvent: 15, // Max bets per event (prevents correlated bets)
	sports: [
		"basketball_nba",
		"basketball_ncaab",
		"americanfootball_nfl",
		"icehockey_nhl",
	],
	autoTrade: true,
	maxHoldPrice: 0.85, // Auto-sell when bid price exceeds 85¢ (if in profit)
};

// =============================================
// STATE
// =============================================

let isMonitoring = false;
let currentValueBets: ValueBet[] = [];
let currentTrackedEvents: TrackedEvent[] = [];
let lastPollTime = 0;

// Tracked event for dashboard display
interface TrackedEvent {
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

// Status file for dashboard to read
const STATUS_FILE_PATH = join(process.cwd(), "data", "sports-status.json");
const VALUE_BETS_FILE_PATH = join(process.cwd(), "data", "sports-value-bets.json");
const TRACKED_EVENTS_FILE_PATH = join(process.cwd(), "data", "sports-tracked-events.json");

function writeStatusFile() {
  try {
    const statusDir = dirname(STATUS_FILE_PATH);
    if (!existsSync(statusDir)) {
      mkdirSync(statusDir, { recursive: true });
    }
    const status = {
      monitoring: isMonitoring,
      lastPollTime,
      valueBetsCount: currentValueBets.length,
      trackedEventsCount: currentTrackedEvents.length,
      updatedAt: Date.now(),
    };
    writeFileSync(STATUS_FILE_PATH, JSON.stringify(status, null, 2));

    // Also write value bets to separate file
    writeFileSync(VALUE_BETS_FILE_PATH, JSON.stringify({
      valueBets: currentValueBets,
      updatedAt: Date.now(),
    }, null, 2));

    // Write all tracked events
    writeFileSync(TRACKED_EVENTS_FILE_PATH, JSON.stringify({
      events: currentTrackedEvents,
      updatedAt: Date.now(),
    }, null, 2));
  } catch (error) {
    logger.error("Failed to write sports status file", error);
  }
}

// =============================================
// ODDS API
// =============================================

export async function fetchOddsForSport(sportKey: string): Promise<OddsApiMatch[]> {
  if (!ODDS_API_KEY) {
    logger.warn("ODDS_API_KEY not configured");
    return [];
  }

  try {
    const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
    const response = await fetch(url);

    if (!response.ok) {
      logger.error(`Odds API error: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    logger.error("Failed to fetch odds", error);
    return [];
  }
}

// =============================================
// LIVE SCORES (Odds API)
// =============================================

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

// Game duration in minutes by sport
const GAME_DURATION_MINUTES: Record<string, number> = {
  "basketball_nba": 48,
  "basketball_ncaab": 40,
  "americanfootball_nfl": 60,
  "americanfootball_ncaaf": 60,
  "icehockey_nhl": 60,
  "baseball_mlb": 180, // ~3 hours average, but innings-based
};

// Cache for live scores (refreshed on each poll)
let liveScoresCache: Map<string, LiveScore> = new Map();
let lastScoresFetch = 0;
let lastReconcileTime = 0;

export async function fetchLiveScores(sports: string[]): Promise<LiveScore[]> {
  if (!ODDS_API_KEY) return [];

  const allScores: LiveScore[] = [];

  for (const sport of sports) {
    try {
      // Only fetch if game could be in progress (last 4 hours)
      const url = `${ODDS_API_BASE}/sports/${sport}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`;
      const response = await fetch(url);

      if (!response.ok) continue;

      const scores = await response.json() as LiveScore[];
      allScores.push(...scores);
    } catch {
      // Ignore errors, scores are optional
    }
  }

  // Update cache
  liveScoresCache = new Map();
  for (const score of allScores) {
    liveScoresCache.set(score.id, score);
  }
  lastScoresFetch = Date.now();

  return allScores;
}

/**
 * Estimate minutes remaining in a game based on start time and sport
 */
function estimateMinutesRemaining(commenceTime: string, sportKey: string): number | null {
  const startTime = new Date(commenceTime).getTime();
  const now = Date.now();
  const elapsedMs = now - startTime;

  if (elapsedMs < 0) return null; // Game hasn't started

  const totalDuration = GAME_DURATION_MINUTES[sportKey] || 60;
  const elapsedMinutes = elapsedMs / (1000 * 60);

  // Account for halftime/breaks (~20 min for basketball, ~30 for football)
  const breaksMinutes = sportKey.includes("basketball") ? 20 :
                        sportKey.includes("football") ? 30 :
                        sportKey.includes("hockey") ? 20 : 15;

  const gameMinutes = elapsedMinutes - breaksMinutes;
  const remaining = totalDuration - Math.max(0, gameMinutes);

  return Math.max(0, remaining);
}

/**
 * Get live game state for a match
 */
export function getLiveGameState(matchId: string, sportKey: string, commenceTime: string): {
  hasScores: boolean;
  homeScore: number | null;
  awayScore: number | null;
  scoreDiff: number | null;
  minutesRemaining: number | null;
  isLive: boolean;
  isCompleted: boolean;
} {
  const score = liveScoresCache.get(matchId);

  if (!score || !score.scores || score.scores.length < 2) {
    // No live scores, estimate from time
    const minutesRemaining = estimateMinutesRemaining(commenceTime, sportKey);
    const started = minutesRemaining !== null;

    return {
      hasScores: false,
      homeScore: null,
      awayScore: null,
      scoreDiff: null,
      minutesRemaining,
      isLive: started && minutesRemaining !== null && minutesRemaining > 0,
      isCompleted: false,
    };
  }

  const homeScoreData = score.scores.find(s => s.name === score.home_team);
  const awayScoreData = score.scores.find(s => s.name === score.away_team);

  const homeScore = homeScoreData ? parseInt(homeScoreData.score) : null;
  const awayScore = awayScoreData ? parseInt(awayScoreData.score) : null;
  const scoreDiff = homeScore !== null && awayScore !== null ? Math.abs(homeScore - awayScore) : null;

  const minutesRemaining = estimateMinutesRemaining(commenceTime, sportKey);

  return {
    hasScores: true,
    homeScore,
    awayScore,
    scoreDiff,
    minutesRemaining,
    isLive: !score.completed && minutesRemaining !== null && minutesRemaining >= 0,
    isCompleted: score.completed,
  };
}

/**
 * Dynamic take-profit logic based on game state
 *
 * SELL scenarios (lock in profit):
 * - 200%+ profit: Always sell. You've tripled your money.
 * - 100%+ profit + crunch time + close game: High variance, take the money
 * - 50%+ profit + crunch time + close game: Buzzer-beater risk is real
 * - Game completed: Take profit (shouldn't hit this, handled by auto-redeem)
 *
 * HOLD scenarios (let it ride):
 * - Blowout game: Even in crunch time, we're likely winning
 * - Early/mid game: Still time for our team to build/maintain lead
 * - Low profit (<50%): Upside to $1 is still significant
 * - Close game but lots of time: Time for things to develop
 *
 * The key insight: we only want to lock in gains when the RISK of reversal
 * is high (close game) AND there's LIMITED TIME to recover.
 */
export function shouldTakeProfitOnGameState(
  profitPct: number,
  gameState: ReturnType<typeof getLiveGameState>,
  sportKey: string
): { shouldSell: boolean; reason: string } {

  // =============================================
  // ALWAYS SELL: 200%+ profit
  // =============================================
  // You've tripled your money. The max payout is $1/share.
  // If you bought at 20¢ and it's now 60¢+, you've captured most of the value.
  // Risk of holding: game could flip and you lose everything.
  if (profitPct >= 2.0) {
    return { shouldSell: true, reason: "200%+ profit - take the triple" };
  }

  // =============================================
  // GAME COMPLETED: Should have been auto-redeemed
  // =============================================
  if (gameState.isCompleted) {
    return { shouldSell: true, reason: "Game completed" };
  }

  // =============================================
  // NO GAME STATE: Conservative fallback
  // =============================================
  // If we can't determine game state (no live scores, can't estimate time),
  // use a conservative approach based on profit alone.
  if (!gameState.isLive || gameState.minutesRemaining === null) {
    // 100%+ profit without game info = take it, we're flying blind
    if (profitPct >= 1.0) {
      return { shouldSell: true, reason: "100%+ profit (no game state)" };
    }
    return { shouldSell: false, reason: "" };
  }

  // =============================================
  // SPORT-SPECIFIC THRESHOLDS
  // =============================================
  const isBasketball = sportKey.includes("basketball");
  const isFootball = sportKey.includes("football");
  const isHockey = sportKey.includes("hockey");

  // "Crunch time" = when a game can flip quickly
  // "Close game" = point differential where outcome is uncertain
  // "Blowout" = we're likely safe even in crunch time
  let crunchTimeMinutes: number;
  let closeGamePoints: number;
  let blowoutPoints: number;

  if (isBasketball) {
    crunchTimeMinutes = 5;   // Last 5 minutes - 3-pointers can swing games fast
    closeGamePoints = 10;    // 10 pts = ~3-4 possessions
    blowoutPoints = 20;      // 20+ pts = very safe
  } else if (isFootball) {
    crunchTimeMinutes = 8;   // Last 8 mins - enough for 2 scoring drives
    closeGamePoints = 8;     // Within one score (TD + 2pt)
    blowoutPoints = 17;      // 3 scores = very safe
  } else if (isHockey) {
    crunchTimeMinutes = 5;   // Last 5 minutes - empty net goals happen
    closeGamePoints = 2;     // 2 goals = very close
    blowoutPoints = 4;       // 4+ goals = very safe
  } else {
    crunchTimeMinutes = 10;
    closeGamePoints = 5;
    blowoutPoints = 15;
  }

  const minRemaining = gameState.minutesRemaining;
  const scoreDiff = gameState.scoreDiff;
  const inCrunchTime = minRemaining <= crunchTimeMinutes;
  const inLateGame = minRemaining <= crunchTimeMinutes * 2;  // 10 min for basketball
  const isCloseGame = scoreDiff !== null && scoreDiff <= closeGamePoints;
  const isBlowout = scoreDiff !== null && scoreDiff >= blowoutPoints;

  // =============================================
  // DECISION MATRIX
  // =============================================

  // BLOWOUT: Almost never sell (unless extreme profit)
  // If we're up 20+ in basketball, 17+ in football, 4+ in hockey,
  // the game is essentially won. Let it ride to $1.
  if (isBlowout) {
    // Only sell on 150%+ profit in blowout (very conservative)
    if (profitPct >= 1.5 && inCrunchTime) {
      return { shouldSell: true, reason: `150%+ profit, blowout (+${scoreDiff}pts), locking in` };
    }
    return { shouldSell: false, reason: "" };  // Hold the blowout
  }

  // CLOSE GAME + CRUNCH TIME: Highest risk zone
  // This is where buzzer-beaters happen. Lock in profits.
  if (isCloseGame && inCrunchTime) {
    if (profitPct >= 0.5) {
      return {
        shouldSell: true,
        reason: `${(profitPct * 100).toFixed(0)}% profit, crunch time (${minRemaining.toFixed(0)}min), close game (${scoreDiff}pts)`
      };
    }
    // Even with <50% profit, if it's VERY close (within 1 score) and VERY late (last 2 min)
    if (minRemaining <= 2 && profitPct >= 0.3) {
      return {
        shouldSell: true,
        reason: `${(profitPct * 100).toFixed(0)}% profit, last ${minRemaining.toFixed(0)}min, nail-biter (${scoreDiff}pts)`
      };
    }
  }

  // CLOSE GAME + LATE GAME (not quite crunch time)
  // Still risky, sell if we have good profit
  if (isCloseGame && inLateGame) {
    if (profitPct >= 1.0) {
      return {
        shouldSell: true,
        reason: `100%+ profit, late game (${minRemaining.toFixed(0)}min), close (${scoreDiff}pts)`
      };
    }
  }

  // HIGH PROFIT (100%+) in any moderately close game
  // Even early in the game, 100%+ profit on a close game is worth considering
  if (profitPct >= 1.0 && isCloseGame) {
    // Only sell if we're past halftime
    if (minRemaining <= (GAME_DURATION_MINUTES[sportKey] || 60) / 2) {
      return {
        shouldSell: true,
        reason: `100%+ profit, 2nd half, close game (${scoreDiff}pts)`
      };
    }
  }

  // Default: HOLD
  // - Early game: let it develop
  // - Low profit: upside is worth the risk
  // - Not close game but not blowout: moderate confidence, hold
  return { shouldSell: false, reason: "" };
}

export async function fetchAllConfiguredOdds(config: SportsConfig): Promise<OddsApiMatch[]> {
  const allMatches: OddsApiMatch[] = [];

  for (const sport of config.sports) {
    const matches = await fetchOddsForSport(sport);
    allMatches.push(...matches);
  }

  return allMatches;
}

// =============================================
// POLYMARKET SPORTS EVENTS
// =============================================

// Polymarket series IDs for sports leagues
const POLYMARKET_SERIES_IDS: Record<string, number> = {
  "basketball_nba": 10345,
  "basketball_ncaab": 10470, // CBB (College Basketball - Men's)
  "americanfootball_nfl": 10187,
  "americanfootball_ncaaf": 10210,
  "baseball_mlb": 3,
  "icehockey_nhl": 10346,
};

// Slug prefixes for sports (fallback when series_id doesn't work)
const POLYMARKET_SLUG_PREFIXES: Record<string, string> = {
  "basketball_nba": "nba-",
  "basketball_ncaab": "cbb-",
  "americanfootball_nfl": "nfl-",
  "americanfootball_ncaaf": "cfb-",
  "baseball_mlb": "mlb-",
  "icehockey_nhl": "nhl-",
};

// Detect sport from Polymarket slug
function detectSportFromSlug(slug: string): string {
  if (slug.startsWith("nba-")) return "basketball_nba";
  if (slug.startsWith("cbb-")) return "basketball_ncaab";
  if (slug.startsWith("nfl-")) return "americanfootball_nfl";
  if (slug.startsWith("cfb-")) return "americanfootball_ncaaf";
  if (slug.startsWith("mlb-")) return "baseball_mlb";
  if (slug.startsWith("nhl-")) return "icehockey_nhl";
  return "unknown";
}

// Get today's date in YYYY-MM-DD format (local time)
function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Fetch real-time price from CLOB API (the actual tradeable price)
// side=sell gives the ask price (what you'd pay to buy)
async function fetchClobAskPrice(tokenId: string): Promise<number | null> {
  try {
    const url = `https://clob.polymarket.com/price?token_id=${tokenId}&side=sell`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

// Fetch bid price (what you'd get if you sell)
async function fetchClobBidPrice(tokenId: string): Promise<number | null> {
  try {
    const url = `https://clob.polymarket.com/price?token_id=${tokenId}&side=buy`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

export async function fetchPolymarketSportsEvents(sports: string[]): Promise<PolymarketSportsEvent[]> {
  const allEvents: PolymarketSportsEvent[] = [];

  // Only fetch events ending today or tomorrow (for timezone handling)
  // Event endDate is typically the next day at midnight UTC after the game
  const today = getTodayDate();
  const todayDate = new Date(today + "T00:00:00Z");
  const tomorrow = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const dayAfter = new Date(todayDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  for (const sport of sports) {
    const seriesId = POLYMARKET_SERIES_IDS[sport];
    if (!seriesId) {
      logger.debug(`No Polymarket series ID for sport: ${sport}`);
      continue;
    }

    try {
      // Filter at API level: end_date between today and day after tomorrow
      const url = `https://gamma-api.polymarket.com/events?series_id=${seriesId}&active=true&closed=false&end_date_min=${today}&end_date_max=${dayAfter}&limit=50`;
      logger.debug(`Fetching Polymarket events: ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        logger.warn(`Polymarket API error for ${sport}: ${response.status}`);
        continue;
      }

      const events = await response.json();
      logger.info(`Polymarket: Found ${events.length} events for ${sport} (today: ${today})`);
      allEvents.push(...events);
    } catch (error) {
      logger.error(`Failed to fetch Polymarket events for ${sport}`, error);
    }
  }

  return allEvents;
}

// Standard team abbreviations (used in Polymarket slugs)
const TEAM_ABBREVS: Record<string, string> = {
  // NBA
  "atlanta hawks": "atl",
  "boston celtics": "bos",
  "brooklyn nets": "bkn",
  "charlotte hornets": "cha",
  "chicago bulls": "chi",
  "cleveland cavaliers": "cle",
  "dallas mavericks": "dal",
  "denver nuggets": "den",
  "detroit pistons": "det",
  "golden state warriors": "gsw",
  "houston rockets": "hou",
  "indiana pacers": "ind",
  "los angeles clippers": "lac",
  "la clippers": "lac",
  "los angeles lakers": "lal",
  "la lakers": "lal",
  "memphis grizzlies": "mem",
  "miami heat": "mia",
  "milwaukee bucks": "mil",
  "minnesota timberwolves": "min",
  "new orleans pelicans": "nop",
  "new york knicks": "nyk",
  "oklahoma city thunder": "okc",
  "orlando magic": "orl",
  "philadelphia 76ers": "phi",
  "phoenix suns": "phx",
  "portland trail blazers": "por",
  "sacramento kings": "sac",
  "san antonio spurs": "sas",
  "toronto raptors": "tor",
  "utah jazz": "uta",
  "washington wizards": "was",

  // NFL
  "arizona cardinals": "ari",
  "atlanta falcons": "atl",
  "baltimore ravens": "bal",
  "buffalo bills": "buf",
  "carolina panthers": "car",
  "chicago bears": "chi",
  "cincinnati bengals": "cin",
  "cleveland browns": "cle",
  "dallas cowboys": "dal",
  "denver broncos": "den",
  "detroit lions": "det",
  "green bay packers": "gb",
  "houston texans": "hou",
  "indianapolis colts": "ind",
  "jacksonville jaguars": "jax",
  "kansas city chiefs": "kc",
  "las vegas raiders": "lv",
  "los angeles chargers": "lac",
  "la chargers": "lac",
  "los angeles rams": "la",
  "la rams": "la",
  "miami dolphins": "mia",
  "minnesota vikings": "min",
  "new england patriots": "ne",
  "new orleans saints": "no",
  "new york giants": "nyg",
  "new york jets": "nyj",
  "philadelphia eagles": "phi",
  "pittsburgh steelers": "pit",
  "san francisco 49ers": "sf",
  "seattle seahawks": "sea",
  "tampa bay buccaneers": "tb",
  "tennessee titans": "ten",
  "washington commanders": "was",

  // NHL
  "anaheim ducks": "ana",
  "arizona coyotes": "ari",
  "boston bruins": "bos",
  "buffalo sabres": "buf",
  "calgary flames": "cgy",
  "carolina hurricanes": "car",
  "chicago blackhawks": "chi",
  "colorado avalanche": "col",
  "columbus blue jackets": "cbj",
  "dallas stars": "dal",
  "detroit red wings": "det",
  "edmonton oilers": "edm",
  "florida panthers": "fla",
  "los angeles kings": "lak",
  "la kings": "lak",
  "minnesota wild": "min",
  "montreal canadiens": "mtl",
  "nashville predators": "nsh",
  "new jersey devils": "njd",
  "new york islanders": "nyi",
  "new york rangers": "nyr",
  "ottawa senators": "ott",
  "philadelphia flyers": "phi",
  "pittsburgh penguins": "pit",
  "san jose sharks": "sj",
  "seattle kraken": "sea",
  "st louis blues": "stl",
  "st. louis blues": "stl",
  "tampa bay lightning": "tb",
  "toronto maple leafs": "tor",
  "utah hockey club": "uta",
  "vancouver canucks": "van",
  "vegas golden knights": "vgk",
  "washington capitals": "was",
  "winnipeg jets": "wpg",
};

function getTeamAbbrev(teamName: string): string | null {
  const normalized = teamName.toLowerCase().trim();
  return TEAM_ABBREVS[normalized] || null;
}

// Generate possible abbreviations for college teams dynamically
function generateCollegeAbbrevs(teamName: string): string[] {
  const name = teamName.toLowerCase();
  const abbrevs: string[] = [];

  // Remove common suffixes (mascots)
  const cleanName = name
    .replace(/\s+(bulldogs|tigers|wildcats|bears|eagles|hawks|knights|lions|panthers|wolves|cardinals|warriors|cougars|huskies|spartans|trojans|bruins|ducks|beavers|buffaloes|aggies|longhorns|sooners|jayhawks|cyclones|mountaineers|volunteers|gators|seminoles|hurricanes|cavaliers|hokies|wolfpack|tar heels|blue devils|demon deacons|orange|crimson tide|razorbacks|rebels|commodores|gamecocks|fighting irish|golden eagles|red raiders|horned frogs|mustangs|owls|pirates|phoenix|shockers|mastodons|lumberjacks|golden hurricane|green wave|49ers|blazers|peacocks|bobcats|red flash|big green|purple eagles|broncs|dolphins|rams|patriots|golden grizzlies|zips|rockets|yellow jackets|blue hens|flames|bearcats|mean green|musketeers|hoyas|friars|bluejays|red storm|pirates|highlanders|hatters|terriers|dons|saints|skyhawks|dragons|sun devils|roadrunners)$/i, "")
    .trim();

  // Split into words
  const words = cleanName.split(/\s+/);

  // First letters of each word (for "Green Bay" -> "gb", "San Francisco" -> "sf")
  const firstLetters = words.map(w => w[0]).join("");
  if (firstLetters.length >= 2) abbrevs.push(firstLetters);

  // First word shortened (common for single-name schools)
  if (words[0] && words[0].length >= 3) {
    abbrevs.push(words[0].slice(0, 3));
    abbrevs.push(words[0].slice(0, 4));
    abbrevs.push(words[0].slice(0, 5));
    abbrevs.push(words[0].slice(0, 6));
  }

  // Handle "St" / "State" variations - "Wichita St" -> "wichst"
  if (/\bst\b/i.test(cleanName)) {
    const withSt = cleanName.replace(/\s+st\b/i, "st").replace(/\s+/g, "");
    abbrevs.push(withSt);
    abbrevs.push(withSt.slice(0, 6));
    abbrevs.push(withSt.slice(0, 7));
    // Also try first-4-letters + "st" pattern (e.g., "wichst" for Wichita St)
    if (words[0] && words[0].length >= 4) {
      abbrevs.push(words[0].slice(0, 4) + "st");
      abbrevs.push(words[0].slice(0, 5) + "st");
    }
  }

  // Handle "State" -> "st"
  const withState = cleanName.replace(/\s+state$/i, "st").replace(/\s+/g, "");
  if (withState.length <= 8) abbrevs.push(withState);
  abbrevs.push(withState.slice(0, 6));
  abbrevs.push(withState.slice(0, 7));

  // Full name without spaces (truncated)
  const noSpaces = cleanName.replace(/\s+/g, "");
  abbrevs.push(noSpaces.slice(0, 4));
  abbrevs.push(noSpaces.slice(0, 5));
  abbrevs.push(noSpaces.slice(0, 6));

  // Handle directions (South, North, East, West)
  if (/^(south|north|east|west)\s/.test(cleanName)) {
    const dirAbbrev = cleanName[0]; // s, n, e, w
    const rest = cleanName.replace(/^(south|north|east|west)\s+/, "");
    const restWords = rest.split(/\s+/);
    if (restWords[0]) {
      abbrevs.push(dirAbbrev + restWords[0].slice(0, 2)); // sfl for south florida
      abbrevs.push(dirAbbrev + restWords[0].slice(0, 3)); // ecar for east carolina
      abbrevs.push(dirAbbrev + restWords[0].slice(0, 4));

      // State abbreviations for direction schools (North Texas -> ntx)
      const stateAbbrevMap: Record<string, string> = {
        "texas": "tx", "carolina": "car", "florida": "fl", "dakota": "dak",
        "alabama": "al", "illinois": "il", "iowa": "ia", "colorado": "co",
      };
      const stateAbbrev = stateAbbrevMap[restWords[0]];
      if (stateAbbrev) {
        abbrevs.push(dirAbbrev + stateAbbrev); // ntx for north texas
      }
    }
  }

  // Handle "Fort Wayne" -> "ipfw" (Indiana Purdue Fort Wayne) or "fw"
  if (/fort\s+wayne/i.test(name)) {
    abbrevs.push("ipfw");
    abbrevs.push("fw");
    abbrevs.push("ftw");
  }

  // Handle short "St" schools - first 3-4 chars + st (e.g., "arzst" for Arizona St)
  if (/\bst\b/i.test(name)) {
    if (words[0] && words[0].length >= 3) {
      abbrevs.push(words[0].slice(0, 3) + "st"); // arist
      // Also try consonant patterns
      const consonants = words[0].replace(/[aeiou]/g, "");
      if (consonants.length >= 2) {
        abbrevs.push(consonants.slice(0, 3) + "st"); // arzst for arizona st
      }
    }
  }

  // Add single word with 't' suffix for some schools (charlt for Charlotte)
  if (words.length === 1 && words[0].length >= 5) {
    abbrevs.push(words[0].slice(0, 5) + "t");
    abbrevs.push(words[0].slice(0, 6) + "t");
  }

  // Consonant-heavy abbreviations for single word schools (Memphis -> mphs)
  if (words.length === 1 && words[0].length >= 4) {
    const consonants = words[0].replace(/[aeiou]/g, "");
    if (consonants.length >= 3) {
      abbrevs.push(consonants.slice(0, 4)); // mphs for memphis
      abbrevs.push(consonants.slice(0, 3));
    }
  }

  // Known special abbreviations that can't be generated algorithmically
  const specialAbbrevs: Record<string, string[]> = {
    "milwaukee": ["wbd", "uwm", "milw", "mil"],
    "wisconsin-milwaukee": ["wbd", "uwm"],
    "uw-milwaukee": ["wbd", "uwm"],
    "green bay": ["gb", "grby", "grnby"],
    "fort wayne": ["ipfw", "fw", "ftw", "fwm"],
    "san francisco": ["sf", "usf", "sanf"],
    "memphis": ["mphs", "mem", "memp"],
    "oakland": ["oak", "oakl"],
    "utsa": ["utsa"],
    "arizona": ["arz", "ariz", "arzst"],
    "houston": ["hou"],
    "tulane": ["tulane", "tul"],
    "tulsa": ["tulsa", "tuls"],
    "temple": ["templ", "temp"],
    "florida atlantic": ["flatl", "fau"],
    "penn state": ["pennst", "pst"],
    "utah state": ["utahst", "usu"],
    "san diego state": ["sdst", "sdsu"],
    "washington state": ["washst", "wsu"],
    "michigan state": ["michst", "msu"],
    "ohio state": ["ohst", "osu"],
    "kansas": ["kan", "ku"],
    "colorado": ["col", "colo"],
    "american": ["amercn", "amer", "au"],
  };
  const lowerName = name.toLowerCase();
  for (const [key, vals] of Object.entries(specialAbbrevs)) {
    if (lowerName.includes(key)) {
      abbrevs.push(...vals);
    }
  }

  return [...new Set(abbrevs)].filter(a => a.length >= 2);
}

// Simple normalization for outcome matching
function normalizeForMatching(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Check if a Polymarket outcome matches an Odds API team
function outcomeMatchesTeam(outcome: string, teamName: string): boolean {
  const outcomeNorm = normalizeForMatching(outcome);
  const teamNorm = normalizeForMatching(teamName);

  // Direct containment (e.g., "nets" in "brooklynnets" or "brooklynnets" contains "nets")
  if (teamNorm.includes(outcomeNorm) || outcomeNorm.includes(teamNorm)) {
    return true;
  }

  // Check first 4+ chars match (handles abbreviations like "76ers" matching "philadelphia76ers")
  if (outcomeNorm.length >= 4 && teamNorm.includes(outcomeNorm.slice(0, 4))) {
    return true;
  }

  return false;
}

// Find Odds API match for a Polymarket event using EXACT slug matching
// Polymarket slug format: nba-chi-bkn-2026-01-16 (sport-team1-team2-date)
// ONLY matches today's games
function findMatchingOddsMatch(
  polyEvent: PolymarketSportsEvent,
  oddsMatches: OddsApiMatch[],
  debug: boolean = false
): OddsApiMatch | null {
  // Parse Polymarket slug: nba-chi-bkn-2026-01-16
  const slugParts = polyEvent.slug.match(/^([a-z]+)-([a-z]+)-([a-z]+)-(\d{4}-\d{2}-\d{2})$/);
  if (!slugParts) {
    // Can't parse slug, skip this event
    return null;
  }

  const [, , team1Abbrev, team2Abbrev, polyDate] = slugParts;
  const today = getTodayDate();

  // ONLY match today's games - skip future/past games
  if (polyDate !== today) {
    if (debug) {
    //   logger.debug(`  Skipping: game date ${polyDate} != today ${today}`);
    }
    return null;
  }

  for (const match of oddsMatches) {
    // Get abbreviations for Odds API teams (try pro teams first, then generate for college)
    let homeAbbrevs: string[] = [];
    let awayAbbrevs: string[] = [];

    const homeProAbbrev = getTeamAbbrev(match.home_team);
    const awayProAbbrev = getTeamAbbrev(match.away_team);

    if (homeProAbbrev) {
      homeAbbrevs = [homeProAbbrev];
    } else {
      // Generate possible abbreviations for college team
      homeAbbrevs = generateCollegeAbbrevs(match.home_team);
    }

    if (awayProAbbrev) {
      awayAbbrevs = [awayProAbbrev];
    } else {
      // Generate possible abbreviations for college team
      awayAbbrevs = generateCollegeAbbrevs(match.away_team);
    }

    if (homeAbbrevs.length === 0 || awayAbbrevs.length === 0) {
      continue;
    }

    // Check if any combination of abbreviations matches (order doesn't matter)
    let abbrevMatch = false;
    for (const homeAbbrev of homeAbbrevs) {
      for (const awayAbbrev of awayAbbrevs) {
        if (
          (homeAbbrev === team1Abbrev && awayAbbrev === team2Abbrev) ||
          (homeAbbrev === team2Abbrev && awayAbbrev === team1Abbrev)
        ) {
          abbrevMatch = true;
          break;
        }
      }
      if (abbrevMatch) break;
    }

    if (!abbrevMatch) {
      continue;
    }

    // Verify date matches (allow for timezone - game at 8pm EST = next day UTC)
    const oddsDate = new Date(match.commence_time);
    const oddsDay = oddsDate.toISOString().split("T")[0];

    // Allow same day or next day (for late night games crossing UTC midnight)
    const polyDateObj = new Date(polyDate + "T00:00:00Z");
    const nextDay = new Date(polyDateObj.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    if (oddsDay !== polyDate && oddsDay !== nextDay) {
      continue;
    }

    // Exact match found!
    return match;
  }

  return null;
}

// =============================================
// ODDS CONVERSION
// =============================================

function americanToProb(americanOdds: number): number {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}

// Sharp books only - in order of preference
const SHARP_BOOKS = ["lowvig", "betonlineag", "fanduel", "draftkings"];

// Max age for bookmaker odds (5 minutes)
const MAX_ODDS_AGE_MS = 5 * 60 * 1000;

function calculateConsensusOdds(
  match: OddsApiMatch,
  outcome: string,
  minBooks: number,
  debug: boolean = false
): { avgProb: number; bookCount: number; details: string[] } | null {
  const bookData: Array<{ key: string; odds: number; rawProb: number; fairProb: number; vig: number }> = [];
  const details: string[] = [];
  const now = Date.now();

  // Only use sharp books
  for (const sharpKey of SHARP_BOOKS) {
    const bookmaker = match.bookmakers.find(b => b.key.toLowerCase() === sharpKey);
    if (!bookmaker) {
      if (debug) details.push(`    [MISSING] ${sharpKey}`);
      continue;
    }

    // Check if odds are fresh (updated within last 5 minutes)
    const lastUpdate = new Date(bookmaker.last_update).getTime();
    const ageMs = now - lastUpdate;
    if (ageMs > MAX_ODDS_AGE_MS) {
      if (debug) {
        const ageMins = Math.round(ageMs / 60000);
        details.push(`    [STALE] ${sharpKey} (${ageMins}m old)`);
      }
      continue;
    }

    const h2hMarket = bookmaker.markets.find((m) => m.key === "h2h");
    if (!h2hMarket) continue;
    if (h2hMarket.outcomes.length !== 2) continue;

    // Get both outcomes to calculate vig-free probability
    const outcome1 = h2hMarket.outcomes[0]!;
    const outcome2 = h2hMarket.outcomes[1]!;

    const prob1 = americanToProb(outcome1.price);
    const prob2 = americanToProb(outcome2.price);
    const totalProb = prob1 + prob2; // This is > 100% due to vig

    // De-vig: divide by total to get fair probability
    const fairProb1 = prob1 / totalProb;
    const fairProb2 = prob2 / totalProb;

    // Find which outcome we want
    const isOutcome1 = outcome1.name === outcome;
    const rawProb = isOutcome1 ? prob1 : prob2;
    const fairProb = isOutcome1 ? fairProb1 : fairProb2;
    const odds = isOutcome1 ? outcome1.price : outcome2.price;
    const vig = (totalProb - 1) * 100;

    bookData.push({ key: bookmaker.key, odds, rawProb, fairProb, vig });
    if (debug) {
      details.push(`    ${bookmaker.key}: ${odds > 0 ? '+' : ''}${odds} → ${(rawProb * 100).toFixed(1)}% raw, ${(fairProb * 100).toFixed(1)}% fair (${vig.toFixed(1)}% vig)`);
    }
  }

  if (bookData.length < minBooks) {
    return null;
  }

  const avgProb = bookData.reduce((sum, b) => sum + b.fairProb, 0) / bookData.length;
  return { avgProb, bookCount: bookData.length, details };
}

// =============================================
// VALUE DETECTION
// =============================================

/**
 * Find value bets for a single Polymarket event
 * Used for per-market processing flow
 */
async function findValueBetsForEvent(
	polyEvent: PolymarketSportsEvent,
	oddsMatches: OddsApiMatch[],
	config: SportsConfig,
	debug: boolean = false,
): Promise<ValueBet[]> {
	const valueBets: ValueBet[] = [];

	// Check if this event has markets we can trade
	if (!polyEvent.markets || polyEvent.markets.length === 0) {
		return [];
	}

	// Find the moneyline market
	const moneylineMarket = polyEvent.markets.find((m) => {
		if (m.groupItemTitle) {
			const title = m.groupItemTitle.toLowerCase();
			return title === "winner" || title === "moneyline";
		}
		const q = m.question.toLowerCase();
		if (
			q.includes("over") ||
			q.includes("under") ||
			q.includes("o/u") ||
			q.includes("total")
		) {
			return false;
		}
		if (q.includes("spread") || q.includes("handicap") || /[+-]\d/.test(q)) {
			return false;
		}
		return (
			q.includes(" vs ") ||
			q.includes(" vs. ") ||
			q.includes("win") ||
			q.includes("winner") ||
			q === polyEvent.title.toLowerCase()
		);
	});

	if (!moneylineMarket) {
		return [];
	}

	// Try to find odds for this Polymarket event
	const oddsMatch = findMatchingOddsMatch(polyEvent, oddsMatches, false);
	if (!oddsMatch) {
		return [];
	}

	try {
		const outcomes = JSON.parse(moneylineMarket.outcomes || "[]") as string[];
		const tokenIds = JSON.parse(
			moneylineMarket.clobTokenIds || "[]",
		) as string[];

		if (outcomes.length !== 2 || tokenIds.length !== 2) {
			return [];
		}

		// Skip totals markets
		const hasOverUnder = outcomes.some((o) => {
			const lower = o.toLowerCase();
			return (
				lower === "over" ||
				lower === "under" ||
				lower.startsWith("over ") ||
				lower.startsWith("under ")
			);
		});
		if (hasOverUnder) {
			return [];
		}

		// Fetch real-time prices
		const polyPrice0 = await fetchClobAskPrice(tokenIds[0]!);
		const polyPrice1 = await fetchClobAskPrice(tokenIds[1]!);

		if (polyPrice0 === null || polyPrice1 === null) {
			return [];
		}

		// Check both outcomes for value
		for (let i = 0; i < outcomes.length; i++) {
			const outcomeName = outcomes[i]!;
			const polyPrice = i === 0 ? polyPrice0 : polyPrice1;
			const tokenId = tokenIds[i]!;

			const isHomeTeam = outcomeMatchesTeam(outcomeName, oddsMatch.home_team);
			const isAwayTeam = outcomeMatchesTeam(outcomeName, oddsMatch.away_team);

			let oddsTeamName: string;
			if (isHomeTeam && !isAwayTeam) {
				oddsTeamName = oddsMatch.home_team;
			} else if (isAwayTeam && !isHomeTeam) {
				oddsTeamName = oddsMatch.away_team;
			} else {
				continue;
			}

			const consensus = calculateConsensusOdds(
				oddsMatch,
				oddsTeamName,
				config.booksRequired,
				false,
			);
			if (!consensus) {
				continue;
			}

			const sharpProb = consensus.avgProb;
			const edge = (sharpProb - polyPrice) / polyPrice;

			// Log edge with color coding
			if (debug) {
				logger.edge(outcomeName, edge, config.minEdge);
			}

			if (edge >= config.minEdge) {
				const kellyPct = edge / (1 - sharpProb);
				const recommendedPct = kellyPct * config.kellyFraction;
				const cappedPct = Math.min(recommendedPct, config.maxBetPct);

				valueBets.push({
					id: `${oddsMatch.id}-${i}`,
					matchId: oddsMatch.id,
					sport: oddsMatch.sport_title,
					homeTeam: oddsMatch.home_team,
					awayTeam: oddsMatch.away_team,
					commenceTime: oddsMatch.commence_time,
					outcome: outcomeName,
					sharpOdds: 0,
					sharpProb,
					polymarketPrice: polyPrice,
					edge,
					expectedValue: edge * polyPrice,
					recommendedSize: cappedPct,
					bookmakerConsensus: consensus.bookCount,
					polymarketTokenId: tokenId,
					polymarketConditionId: moneylineMarket.conditionId,
					detectedAt: Math.floor(Date.now() / 1000),
				});
			}
		}
	} catch {
		// Invalid JSON, skip
	}

	return valueBets.sort((a, b) => b.edge - a.edge);
}

export async function findValueBets(
  oddsMatches: OddsApiMatch[],
  polyEvents: PolymarketSportsEvent[],
  config: SportsConfig,
  debug: boolean = false
): Promise<ValueBet[]> {
  const valueBets: ValueBet[] = [];
  let matchedCount = 0;
  let noOddsCount = 0;
  let noMarketCount = 0;

  // START FROM POLYMARKET (source of truth)
  for (const polyEvent of polyEvents) {
    // Check if this event has markets we can trade
    if (!polyEvent.markets || polyEvent.markets.length === 0) {
      noMarketCount++;
      if (debug) {
        logger.debug(`  No markets on this event`);
      }
      continue;
    }

    // Find the moneyline market using groupItemTitle field (most reliable)
    // groupItemTitle = "Winner" for moneyline, "Over/Under X" for totals, "Spread" for spreads
    const moneylineMarket = polyEvent.markets.find((m) => {
      // Primary: Use groupItemTitle if available
      if (m.groupItemTitle) {
        const title = m.groupItemTitle.toLowerCase();
        // Only accept "Winner" markets (moneyline)
        return title === "winner" || title === "moneyline";
      }

      // Fallback: Parse from question if groupItemTitle not available
      const q = m.question.toLowerCase();

      // Exclude totals/over-under markets
      if (q.includes("over") || q.includes("under") || q.includes("o/u") || q.includes("total")) {
        return false;
      }

      // Exclude spread/handicap markets
      if (q.includes("spread") || q.includes("handicap") || /[+-]\d/.test(q)) {
        return false;
      }

      // Market question is usually the game title like "Grizzlies vs. Lakers"
      return (
        q.includes(" vs ") ||
        q.includes(" vs. ") ||
        q.includes("win") ||
        q.includes("winner") ||
        q === polyEvent.title.toLowerCase()
      );
    });

    if (!moneylineMarket) {
      noMarketCount++;
      if (debug) {
        const marketQuestions = polyEvent.markets.map(m => m.question).slice(0, 3);
        logger.debug(`  No moneyline market found. Available: ${JSON.stringify(marketQuestions)}`);
      }
      continue;
    }

    // Try to find odds for this Polymarket event (only today's games)
    const oddsMatch = findMatchingOddsMatch(polyEvent, oddsMatches, debug);
    if (!oddsMatch) {
      noOddsCount++;
      if (debug) {
        // logger.debug(`  No Odds API match found`);
      }
      continue;
    }

    matchedCount++;

    try {
      const outcomes = JSON.parse(moneylineMarket.outcomes || "[]") as string[];
      const tokenIds = JSON.parse(moneylineMarket.clobTokenIds || "[]") as string[];

      if (outcomes.length !== 2 || tokenIds.length !== 2) {
        continue;
      }

      // Double-check outcomes are team names, not "Over"/"Under"
      const hasOverUnder = outcomes.some(o => {
        const lower = o.toLowerCase();
        return lower === "over" || lower === "under" || lower.startsWith("over ") || lower.startsWith("under ");
      });
      if (hasOverUnder) {
        if (debug) {
          logger.debug(`  Skipping totals market: ${outcomes.join(" / ")}`);
        }
        continue;
      }

      // Fetch real-time prices from CLOB API (ask price = what you'd pay to buy)
      const polyPrice0 = await fetchClobAskPrice(tokenIds[0]!);
      const polyPrice1 = await fetchClobAskPrice(tokenIds[1]!);

      if (polyPrice0 === null || polyPrice1 === null) {
        if (debug) {
          logger.warn(`  Failed to fetch CLOB prices`);
        }
        continue;
      }

      const polyTotal = polyPrice0 + polyPrice1;

      // Check both outcomes for value
      for (let i = 0; i < outcomes.length; i++) {
        const outcomeName = outcomes[i]!;
        const polyPrice = i === 0 ? polyPrice0 : polyPrice1;
        const tokenId = tokenIds[i]!;

        // Find matching team in odds data using exact matching
        const isHomeTeam = outcomeMatchesTeam(outcomeName, oddsMatch.home_team);
        const isAwayTeam = outcomeMatchesTeam(outcomeName, oddsMatch.away_team);

        // Determine which team this outcome refers to
        let oddsTeamName: string;
        if (isHomeTeam && !isAwayTeam) {
          oddsTeamName = oddsMatch.home_team;
        } else if (isAwayTeam && !isHomeTeam) {
          oddsTeamName = oddsMatch.away_team;
        } else {
          // Ambiguous match - skip this outcome
          continue;
        }

        const consensus = calculateConsensusOdds(oddsMatch, oddsTeamName, config.booksRequired, false);
        if (!consensus) {
          continue;
        }

        const sharpProb = consensus.avgProb;
        const edge = (sharpProb - polyPrice) / polyPrice;

        // Simplified logging: just show outcome and edge with color coding
        if (debug) {
          logger.edge(outcomeName, edge, config.minEdge);
        }

        if (edge >= config.minEdge) {
          // Calculate Kelly sizing
          const kellyPct = edge / (1 - sharpProb);
          const recommendedPct = kellyPct * config.kellyFraction;
          const cappedPct = Math.min(recommendedPct, config.maxBetPct);

          valueBets.push({
            id: `${oddsMatch.id}-${i}`,
            matchId: oddsMatch.id,
            sport: oddsMatch.sport_title,
            homeTeam: oddsMatch.home_team,
            awayTeam: oddsMatch.away_team,
            commenceTime: oddsMatch.commence_time,
            outcome: outcomeName,
            sharpOdds: 0, // Could convert back to American
            sharpProb,
            polymarketPrice: polyPrice,
            edge,
            expectedValue: edge * polyPrice,
            recommendedSize: cappedPct,
            bookmakerConsensus: consensus.bookCount,
            polymarketTokenId: tokenId,
            polymarketConditionId: moneylineMarket.conditionId,
            detectedAt: Math.floor(Date.now() / 1000),
          });
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // Log summary
  if (debug) {
    logger.info(`--- Summary: ${polyEvents.length} Polymarket events, ${matchedCount} matched to Odds API, ${noOddsCount} no odds, ${noMarketCount} no tradeable market, ${valueBets.length} value bets ---`);
  }

  // Sort by edge descending
  return valueBets.sort((a, b) => b.edge - a.edge);
}

// =============================================
// MONITORING
// =============================================

export async function startMonitoring(userId: number): Promise<void> {
  if (isMonitoring) {
    logger.warn("Sports monitoring already running");
    return;
  }

  const config = getSportsConfig(userId);
  if (!config.enabled) {
    logger.warn("Sports betting not enabled for user");
    return;
  }

  isMonitoring = true;
  writeStatusFile();
  logger.success("Sports value betting monitor started");

  // Sync with Polymarket positions on startup
  logger.info("Syncing with Polymarket positions...");
  const syncResult = await reconcilePositions(userId);
  if (syncResult.added > 0) {
    logger.success(`Synced ${syncResult.added} positions from Polymarket to database`);
  }

  let pollCount = 0;

  while (isMonitoring) {
    // Reload config on each poll so changes take effect immediately
    const currentConfig = getSportsConfig(userId);
    await pollForValueBets(userId, currentConfig);

    // Check market resolutions every 60 seconds (12 polls)
    pollCount++;
    if (pollCount % 12 === 0) {
      await checkMarketResolutions();
    }

    await Bun.sleep(5000); // Poll every 5 seconds
  }
}

export function stopMonitoring(): void {
  isMonitoring = false;
  writeStatusFile();
  logger.info("Sports monitoring stopped");
}

async function pollForValueBets(userId: number, config: SportsConfig, debug: boolean = true): Promise<void> {
  lastPollTime = Date.now();

  try {
    // Note: Auto-reconciliation disabled - it was syncing ALL Polymarket positions
				// (including non-sports) which inflated exposure calculation.
				// Use /sports sync manually if needed, but exposure tracking should
				// only include bets the bot actually placed.

				// Fetch all data upfront for efficiency
				const polyEvents = await fetchPolymarketSportsEvents(config.sports);
    const oddsMatches = await fetchAllConfiguredOdds(config);
				await fetchLiveScores(config.sports);

    // Get open positions for sell opportunity checks
				const openBets = getOpenSportsBets(userId);
				const openBetsByMatchId = new Map<string, typeof openBets>();
				for (const bet of openBets) {
					const existing = openBetsByMatchId.get(bet.matchId) || [];
					existing.push(bet);
					openBetsByMatchId.set(bet.matchId, existing);
				}

				// Track stats
				let matchedCount = 0;
				let valueBetsFound = 0;
				let betsPlaced = 0;
				let sellsExecuted = 0;
				currentValueBets = [];

				// Process each market individually: check value → bet → check sells
				for (const polyEvent of polyEvents) {
					// Find value bet for this specific event
					const eventValueBets = await findValueBetsForEvent(
						polyEvent,
						oddsMatches,
						config,
						debug,
					);

					if (eventValueBets.length > 0) {
						matchedCount++;
						currentValueBets.push(...eventValueBets);
						valueBetsFound += eventValueBets.length;

						// Execute bets immediately for this event
						if (config.autoTrade) {
							for (const bet of eventValueBets) {
								const result = await executeValueBet(userId, bet, config);
								if (result.success) {
									betsPlaced++;
								} else if (result.error) {
									logger.warn(`Skipped ${bet.outcome}: ${result.error}`);
								}
							}
						}
					}

					// Check sell opportunities for any open positions on this event
					const eventOpenBets = openBetsByMatchId.get(polyEvent.id) || [];
					for (const openBet of eventOpenBets) {
						const sold = await checkSellOpportunityForBet(
							userId,
							openBet,
							config,
							oddsMatches,
							debug,
						);
						if (sold) sellsExecuted++;
					}
				}

    // Also check sells for positions not matched to current poly events
				// (in case the event ended or was delisted)
				for (const bet of openBets) {
					if (!polyEvents.find((e) => e.id === bet.matchId)) {
						await checkSellOpportunityForBet(
							userId,
							bet,
							config,
							oddsMatches,
							debug,
						);
					}
				}

    // Convert poly events to tracked events for dashboard
				currentTrackedEvents = polyEvents.map((event) => {
					const sport = detectSportFromSlug(event.slug);
					const titleParts = event.title.split(/ vs\.? /i);
					const homeTeam = titleParts[1]?.trim() || event.title;
					const awayTeam = titleParts[0]?.trim() || "";

					const moneylineMarket = event.markets?.find(
						(m) => m.groupItemTitle === "Winner" || !m.groupItemTitle,
					);
					let outcomes: TrackedEvent["outcomes"] = [];

					if (moneylineMarket) {
						try {
							const outcomeNames = JSON.parse(moneylineMarket.outcomes || "[]");
							const outcomePrices = JSON.parse(
								moneylineMarket.outcomePrices || "[]",
							);
							const tokenIds = JSON.parse(moneylineMarket.clobTokenIds || "[]");

							outcomes = outcomeNames.map((name: string, i: number) => ({
								name,
								price: parseFloat(outcomePrices[i] || "0"),
								tokenId: tokenIds[i] || "",
							}));
						} catch {
							// Parsing failed, leave empty
						}
					}

					const valueBet = currentValueBets.find(
						(vb) => vb.matchId === event.id,
					);

					return {
						id: event.id,
						slug: event.slug,
						sport,
						title: event.title,
						homeTeam,
						awayTeam,
						commenceTime: event.startDate,
						outcomes,
						hasValueBet: !!valueBet,
						valueBetEdge: valueBet?.edge,
					};
				});

    logger.info(
					`Sports poll: ${oddsMatches.length} odds, ${polyEvents.length} events, ${valueBetsFound} value bets, ${betsPlaced} placed, ${sellsExecuted} sold`,
				);
    writeStatusFile();
  } catch (error) {
    logger.error("Sports poll error", error);
  }
}

// =============================================
// TRADING
// =============================================

async function executeValueBet(
  userId: number,
  bet: ValueBet,
  config: SportsConfig
): Promise<{ success: boolean; error?: string }> {
  const wallet = copyService.getTradingWallet(userId);
  if (!wallet || !wallet.encryptedCredentials) {
    return { success: false, error: "No trading wallet connected" };
  }

  try {
    const credentials = decryptCredentials(wallet.encryptedCredentials);
    const client = await tradingService.createClobClient(
      (credentials as any).privateKey,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
      },
      wallet.proxyAddress || undefined
    );

    // Check max bets per event (controls how many times we can bet on same event/outcome)
    const betsOnEvent = getBetsOnEvent(userId, bet.matchId);
    if (betsOnEvent >= config.maxBetsPerEvent) {
      return { success: false, error: `Max bets per event reached (${config.maxBetsPerEvent})` };
    }

    // Get balance
    const { balance } = await tradingService.getBalance(client, wallet.proxyAddress || undefined);

    // Calculate bet size
    let betSize = balance * bet.recommendedSize;
    betSize = Math.max(betSize, config.minBetUsd);
    betSize = Math.min(betSize, config.maxBetUsd);

    // Check exposure limit (total open position value)
    const currentTotalExposure = getTotalOpenExposure(userId);
    const maxExposure = balance * config.maxExposurePct;
    if (currentTotalExposure + betSize > maxExposure) {
      const available = Math.max(0, maxExposure - currentTotalExposure);
      return { success: false, error: `Exposure limit reached ($${currentTotalExposure.toFixed(0)}/$${maxExposure.toFixed(0)}, $${available.toFixed(0)} available)` };
    }

    // Check max per market (total exposure on this outcome)
    const currentExposure = getExposureOnToken(userId, bet.polymarketTokenId);
    const remainingAllowance = config.maxPerMarket - currentExposure;
    if (remainingAllowance <= 0) {
      return { success: false, error: `Max per market reached ($${config.maxPerMarket})` };
    }
    // Reduce bet size if it would exceed max per market
    if (betSize > remainingAllowance) {
      betSize = remainingAllowance;
    }
    // Skip if adjusted size is below minimum
    if (betSize < config.minBetUsd) {
      return { success: false, error: `Bet size below minimum after max per market adjustment` };
    }

    // Place market order - amount is in USD for BUY orders
    const result = await tradingService.placeMarketOrder(client, {
      tokenId: bet.polymarketTokenId,
      side: "BUY",
      amount: betSize,  // USD amount, not shares
    });

    // Calculate shares bought (for logging/recording)
    const shares = betSize / bet.polymarketPrice;

    if (result.success) {
      // Record the trade
      recordSportsBet(userId, bet, betSize, shares, result.orderId || "");
      logger.success(`Sports bet placed: ${bet.outcome} @ ${(bet.polymarketPrice * 100).toFixed(0)}¢, $${betSize.toFixed(2)} (${shares.toFixed(1)} shares)`);

      // Send Telegram notification
      await notifyBetPlaced(userId, bet, betSize);
    }

    return result;
  } catch (error: any) {
    logger.error("Failed to execute sports bet", error);
    return { success: false, error: error.message };
  }
}

async function notifyBetPlaced(userId: number, bet: ValueBet, betSize: number): Promise<void> {
  try {
    const user = await userRepo.findById(userId);
    if (!user?.telegram_chat_id) return;

    const sportIcon = bet.sport.toLowerCase().includes("basketball") ? "🏀" :
                      bet.sport.toLowerCase().includes("football") ? "🏈" :
                      bet.sport.toLowerCase().includes("baseball") ? "⚾" :
                      bet.sport.toLowerCase().includes("hockey") ? "🏒" : "🎯";

    const message = [
      `${sportIcon} *Sports Value Bet Placed*`,
      ``,
      `*Match:* ${bet.homeTeam} vs ${bet.awayTeam}`,
      `*Bet:* ${bet.outcome}`,
      `*Size:* $${betSize.toFixed(2)} @ ${(bet.polymarketPrice * 100).toFixed(0)}¢`,
      `*Edge:* +${(bet.edge * 100).toFixed(1)}% (sharp: ${(bet.sharpProb * 100).toFixed(0)}¢)`,
      `*Books:* ${bet.bookmakerConsensus} bookmakers`,
    ].join("\n");

    await sendMessage(user.telegram_chat_id, message, { parseMode: "Markdown" });
  } catch (error) {
    logger.error("Failed to send sports bet notification", error);
  }
}

// =============================================
// DATABASE
// =============================================

export function getSportsConfig(userId: number): SportsConfig {
  try {
    const row = db()
      .prepare("SELECT config FROM sports_config WHERE user_id = ?")
      .get(userId) as { config: string } | undefined;

    if (row) {
      return { ...DEFAULT_SPORTS_CONFIG, ...JSON.parse(row.config) };
    }
  } catch {
    // Table might not exist yet
  }

  return DEFAULT_SPORTS_CONFIG;
}

export function updateSportsConfig(userId: number, updates: Partial<SportsConfig>): boolean {
  try {
    const current = getSportsConfig(userId);
    const newConfig = { ...current, ...updates };

    db().prepare(`
      INSERT INTO sports_config (user_id, config, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
    `).run(userId, JSON.stringify(newConfig), Math.floor(Date.now() / 1000));

    return true;
  } catch (error) {
    logger.error("Failed to update sports config", error);
    return false;
  }
}

export function recordSportsBet(
  userId: number,
  bet: ValueBet,
  size: number,
  shares: number,
  orderId: string
): void {
  try {
    db().prepare(`
      INSERT INTO sports_bets (
        user_id, match_id, sport, home_team, away_team, outcome,
        token_id, shares, sharp_prob, poly_price, edge, size, order_id, condition_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      bet.matchId,
      bet.sport,
      bet.homeTeam,
      bet.awayTeam,
      bet.outcome,
      bet.polymarketTokenId,
      shares,
      bet.sharpProb,
      bet.polymarketPrice,
      bet.edge,
      size,
      orderId,
      bet.polymarketConditionId,
      Math.floor(Date.now() / 1000)
    );
  } catch (error) {
    logger.error("Failed to record sports bet", error);
  }
}

export function getTodaysSportsVolume(userId: number): number {
  try {
    // Use calendar day start (midnight local time), not rolling 24 hours
    const now = new Date();
    const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
    const row = db()
      .prepare("SELECT COALESCE(SUM(size), 0) as total FROM sports_bets WHERE user_id = ? AND created_at > ?")
      .get(userId, todayStart) as { total: number };

    return row.total;
  } catch {
    return 0;
  }
}

export function getBetsOnEvent(userId: number, matchId: string): number {
  try {
    const todayStart = Math.floor(Date.now() / 1000) - 86400;
    const row = db()
      .prepare("SELECT COUNT(*) as count FROM sports_bets WHERE user_id = ? AND match_id = ? AND created_at > ?")
      .get(userId, matchId, todayStart) as { count: number };

    return row.count;
  } catch {
    return 0;
  }
}

/**
 * Get total USD exposure on a specific token (for max per market limit)
 */
export function getExposureOnToken(userId: number, tokenId: string): number {
  try {
    const row = db()
      .prepare("SELECT COALESCE(SUM(size), 0) as total FROM sports_bets WHERE user_id = ? AND token_id = ? AND status IN ('placed', 'open')")
      .get(userId, tokenId) as { total: number };

    return row.total;
  } catch {
    return 0;
  }
}

/**
 * Get total current exposure across all open positions
 */
export function getTotalOpenExposure(userId: number): number {
  try {
    const row = db()
      .prepare("SELECT COALESCE(SUM(size), 0) as total FROM sports_bets WHERE user_id = ? AND status IN ('placed', 'open')")
      .get(userId) as { total: number };

    return row.total;
  } catch {
    return 0;
  }
}

/**
 * Check if we already have a bet on a specific token today
 */
export function hasBetOnToken(userId: number, tokenId: string): boolean {
  try {
    const todayStart = Math.floor(Date.now() / 1000) - 86400;
    const row = db()
      .prepare("SELECT COUNT(*) as count FROM sports_bets WHERE user_id = ? AND token_id = ? AND created_at > ?")
      .get(userId, tokenId, todayStart) as { count: number };

    return row.count > 0;
  } catch {
    return false;
  }
}

export function getSportsBetHistory(userId: number, limit: number = 20): Array<{
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  edge: number;
  size: number;
  createdAt: number;
}> {
  try {
    return db()
      .prepare(`
        SELECT match_id as matchId, sport, home_team as homeTeam, away_team as awayTeam,
               outcome, edge, size, created_at as createdAt
        FROM sports_bets
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(userId, limit) as any[];
  } catch {
    return [];
  }
}

// =============================================
// SELL OPPORTUNITIES
// =============================================

interface OpenBet {
  id: number;
  userId: number;
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  tokenId: string;
  shares: number;
  buyPrice: number;
  size: number;
}

export function getOpenSportsBets(userId: number): OpenBet[] {
  try {
    return db()
      .prepare(`
        SELECT id, user_id as userId, match_id as matchId, sport,
               home_team as homeTeam, away_team as awayTeam, outcome,
               token_id as tokenId, shares, poly_price as buyPrice, size
        FROM sports_bets
        WHERE user_id = ? AND status IN ('open', 'placed') AND token_id IS NOT NULL AND shares > 0
      `)
      .all(userId) as OpenBet[];
  } catch {
    return [];
  }
}

export function markBetSold(betId: number, sellPrice: number, profit: number): void {
  try {
    db().prepare(`
      UPDATE sports_bets
      SET status = 'sold', sell_price = ?, profit = ?
      WHERE id = ?
    `).run(sellPrice, profit, betId);
  } catch (error) {
    logger.error("Failed to mark bet as sold", error);
  }
}

/**
 * Check sell opportunity for a single bet
 * Returns true if the bet was sold
 */
async function checkSellOpportunityForBet(
	userId: number,
	bet: OpenBet,
	config: SportsConfig,
	oddsMatches: OddsApiMatch[],
	debug: boolean = false,
): Promise<boolean> {
	// Get current bid price (what we'd get if we sell)
	const bidPrice = await fetchClobBidPrice(bet.tokenId);
	if (bidPrice === null) return false;

	// CHECK 0a: Auto-redeem - sell if price >= 99¢ (market resolved, we won)
	if (bidPrice >= 0.99) {
		const profit = bet.shares * bidPrice - bet.size;
		logger.info(
			`✅ AUTO-REDEEM: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ | Winner! Profit: $${profit.toFixed(2)}`,
		);

		if (config.autoTrade) {
			await executeRedeemSell(userId, bet, bidPrice);
			return true;
		}
		return false;
	}

	// CHECK 0b: Auto-mark loser - if price <= 1¢ (market resolved, we lost)
	if (bidPrice <= 0.01) {
		logger.info(
			`❌ LOSER: ${bet.outcome} @ ${(bidPrice * 100).toFixed(1)}¢ | Loss: -$${bet.size.toFixed(2)}`,
		);
		markBetLost(bet.id);
		return false;
	}

	// CHECK 1: Game-state-based take-profit
	const profitPct = (bidPrice - bet.buyPrice) / bet.buyPrice;

	// Find the match in oddsMatches to get commence time and sport key
	const oddsMatch = oddsMatches.find((m) => m.id === bet.matchId);

	// Map bet's sport name to sport key (Odds API format)
	const sportKeyFromBet = bet.sport.toLowerCase().includes("nba")
		? "basketball_nba"
		: bet.sport.toLowerCase().includes("ncaa")
			? "basketball_ncaab"
			: bet.sport.toLowerCase().includes("cbb")
				? "basketball_ncaab"
				: bet.sport.toLowerCase().includes("nfl")
					? "americanfootball_nfl"
					: bet.sport.toLowerCase().includes("cfb")
						? "americanfootball_ncaaf"
						: bet.sport.toLowerCase().includes("nhl")
							? "icehockey_nhl"
							: bet.sport.toLowerCase().includes("mlb")
								? "baseball_mlb"
								: "unknown";

	// Get game state (from live scores cache + time estimation)
	const commenceTime = oddsMatch?.commence_time || "";
	const sportKey = oddsMatch?.sport_key || sportKeyFromBet;
	const gameState = getLiveGameState(bet.matchId, sportKey, commenceTime);

	// Log game state for debugging
	if (debug && gameState.isLive) {
		const scoreStr = gameState.hasScores
			? `${gameState.homeScore}-${gameState.awayScore} (diff: ${gameState.scoreDiff})`
			: "no live score";
		const timeStr =
			gameState.minutesRemaining !== null
				? `~${gameState.minutesRemaining.toFixed(0)}min left`
				: "time unknown";
		logger.info(
			`  ${bet.outcome}: +${(profitPct * 100).toFixed(0)}% | ${scoreStr} | ${timeStr}`,
		);
	}

	// Check if we should take profit based on game state
	const takeProfitDecision = shouldTakeProfitOnGameState(
		profitPct,
		gameState,
		sportKey,
	);

	if (takeProfitDecision.shouldSell) {
		const profitPctStr = (profitPct * 100).toFixed(0);
		logger.info(
			`🎯 TAKE PROFIT: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ (entry: ${(bet.buyPrice * 100).toFixed(0)}¢) | +${profitPctStr}% | ${takeProfitDecision.reason}`,
		);

		if (config.autoTrade) {
			await executeTakeProfitSell(userId, bet, bidPrice);
			return true;
		}
		return false;
	}

	// maxHoldPrice threshold - but ONLY in risky game situations
	if (bidPrice >= config.maxHoldPrice && profitPct > 0) {
		const isBasketball = sportKey.includes("basketball");
		const isFootball = sportKey.includes("football");
		const isHockey = sportKey.includes("hockey");

		const crunchTimeMinutes = isBasketball
			? 5
			: isFootball
				? 8
				: isHockey
					? 5
					: 10;
		const closeGamePoints = isBasketball
			? 10
			: isFootball
				? 8
				: isHockey
					? 2
					: 5;

		const minRemaining = gameState.minutesRemaining;
		const scoreDiff = gameState.scoreDiff;
		const inLateGame =
			minRemaining !== null && minRemaining <= crunchTimeMinutes * 2;
		const isCloseGame = scoreDiff !== null && scoreDiff <= closeGamePoints;
		const gameStateUnknown = !gameState.isLive || minRemaining === null;

		const shouldSellAtThreshold =
			gameStateUnknown || (isCloseGame && inLateGame);

		if (shouldSellAtThreshold) {
			const profitPctStr = (profitPct * 100).toFixed(0);
			const reason = gameStateUnknown
				? "no game state"
				: `close game (${scoreDiff} pts) in late stages`;
			logger.info(
				`🎯 TAKE PROFIT (price threshold): ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ | +${profitPctStr}% | ${reason}`,
			);

			if (config.autoTrade) {
				await executeTakeProfitSell(userId, bet, bidPrice);
				return true;
			}
			return false;
		}
	}

	// CHECK 2: Edge-based sell
	if (!oddsMatch) return false;

	const consensus = calculateConsensusOdds(
		oddsMatch,
		bet.outcome,
		config.booksRequired,
		false,
	);
	if (!consensus) return false;

	const fairValue = consensus.avgProb;
	const sellEdge = (bidPrice - fairValue) / fairValue;

	if (debug) {
		logger.info(
			`  ${bet.outcome}: bid=${(bidPrice * 100).toFixed(1)}¢, fair=${(fairValue * 100).toFixed(1)}¢, sell edge=${(sellEdge * 100).toFixed(1)}%`,
		);
	}

	// Must be in profit AND have positive sell edge
	if (sellEdge >= config.minSellEdge && profitPct > 0) {
		logger.info(
			`💰 SELL OPPORTUNITY: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ (fair: ${(fairValue * 100).toFixed(0)}¢) | Edge: +${(sellEdge * 100).toFixed(1)}% | Profit: +${(profitPct * 100).toFixed(0)}%`,
		);

		if (config.autoTrade) {
			await executeSellBet(userId, bet, bidPrice);
			return true;
		}
	}

	return false;
}

async function checkSellOpportunities(
  userId: number,
  config: SportsConfig,
  oddsMatches: OddsApiMatch[],
  debug: boolean = false
): Promise<void> {
  const openBets = getOpenSportsBets(userId);
  if (openBets.length === 0) return;

  if (debug) {
    logger.info(`Checking ${openBets.length} open positions for sell opportunities...`);
  }

  for (const bet of openBets) {
    // Get current bid price (what we'd get if we sell)
    const bidPrice = await fetchClobBidPrice(bet.tokenId);
    if (bidPrice === null) continue;

    // CHECK 0a: Auto-redeem - sell if price >= 99¢ (market resolved, we won)
    if (bidPrice >= 0.99) {
      const profit = (bet.shares * bidPrice) - bet.size;
      logger.info(`✅ AUTO-REDEEM: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ | Winner! Profit: $${profit.toFixed(2)}`);

      if (config.autoTrade) {
        await executeRedeemSell(userId, bet, bidPrice);
      }
      continue;
    }

    // CHECK 0b: Auto-mark loser - if price <= 1¢ (market resolved, we lost)
    if (bidPrice <= 0.01) {
      logger.info(`❌ LOSER: ${bet.outcome} @ ${(bidPrice * 100).toFixed(1)}¢ | Loss: -$${bet.size.toFixed(2)}`);
      markBetLost(bet.id);
      continue;
    }

    // CHECK 1: Game-state-based take-profit
    // Uses time remaining, score differential, and profit % to decide when to lock in gains
    const profitPct = (bidPrice - bet.buyPrice) / bet.buyPrice;

    // Find the match in oddsMatches to get commence time and sport key
    const oddsMatch = oddsMatches.find(m => m.id === bet.matchId);

    // Map bet's sport name to sport key (Odds API format)
    const sportKeyFromBet = bet.sport.toLowerCase().includes("nba") ? "basketball_nba" :
                            bet.sport.toLowerCase().includes("ncaa") ? "basketball_ncaab" :
                            bet.sport.toLowerCase().includes("cbb") ? "basketball_ncaab" :
                            bet.sport.toLowerCase().includes("nfl") ? "americanfootball_nfl" :
                            bet.sport.toLowerCase().includes("cfb") ? "americanfootball_ncaaf" :
                            bet.sport.toLowerCase().includes("nhl") ? "icehockey_nhl" :
                            bet.sport.toLowerCase().includes("mlb") ? "baseball_mlb" :
                            "unknown";

    // Get game state (from live scores cache + time estimation)
    const commenceTime = oddsMatch?.commence_time || "";
    const sportKey = oddsMatch?.sport_key || sportKeyFromBet;
    const gameState = getLiveGameState(bet.matchId, sportKey, commenceTime);

    // Log game state for debugging
    if (debug && gameState.isLive) {
      const scoreStr = gameState.hasScores
        ? `${gameState.homeScore}-${gameState.awayScore} (diff: ${gameState.scoreDiff})`
        : "no live score";
      const timeStr = gameState.minutesRemaining !== null
        ? `~${gameState.minutesRemaining.toFixed(0)}min left`
        : "time unknown";
      logger.info(`  ${bet.outcome}: +${(profitPct * 100).toFixed(0)}% | ${scoreStr} | ${timeStr}`);
    }

    // Check if we should take profit based on game state
    const takeProfitDecision = shouldTakeProfitOnGameState(profitPct, gameState, sportKey);

    if (takeProfitDecision.shouldSell) {
      const profitPctStr = (profitPct * 100).toFixed(0);
      logger.info(`🎯 TAKE PROFIT: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ (entry: ${(bet.buyPrice * 100).toFixed(0)}¢) | +${profitPctStr}% | ${takeProfitDecision.reason}`);

      if (config.autoTrade) {
        await executeTakeProfitSell(userId, bet, bidPrice);
      }
      continue;
    }

    // maxHoldPrice threshold - but ONLY in risky game situations
    // Don't sell at 85¢ in a blowout with time left - let it ride to 95¢+
    if (bidPrice >= config.maxHoldPrice && profitPct > 0) {
      // Determine if game state is risky (close game + late, or unknown)
      const isBasketball = sportKey.includes("basketball");
      const isFootball = sportKey.includes("football");
      const isHockey = sportKey.includes("hockey");

      // Sport-specific thresholds
      const crunchTimeMinutes = isBasketball ? 5 : isFootball ? 8 : isHockey ? 5 : 10;
      const closeGamePoints = isBasketball ? 10 : isFootball ? 8 : isHockey ? 2 : 5;

      const minRemaining = gameState.minutesRemaining;
      const scoreDiff = gameState.scoreDiff;
      const inLateGame = minRemaining !== null && minRemaining <= crunchTimeMinutes * 2;
      const isCloseGame = scoreDiff !== null && scoreDiff <= closeGamePoints;
      const gameStateUnknown = !gameState.isLive || minRemaining === null;

      // Only sell at maxHoldPrice if:
      // 1. Game state is unknown (defensive), OR
      // 2. It's a close game in late stages (risky to hold)
      const shouldSellAtThreshold = gameStateUnknown || (isCloseGame && inLateGame);

      if (shouldSellAtThreshold) {
        const profitPctStr = (profitPct * 100).toFixed(0);
        const reason = gameStateUnknown ? "no game state" : `close game (${scoreDiff} pts) in late stages`;
        logger.info(`🎯 TAKE PROFIT (price threshold): ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ | +${profitPctStr}% | ${reason}`);

        if (config.autoTrade) {
          await executeTakeProfitSell(userId, bet, bidPrice);
        }
        continue;
      } else {
        // Log why we're NOT selling despite high price
        if (debug) {
          const reason = scoreDiff !== null
            ? `blowout (${scoreDiff} pts) or early game (${minRemaining?.toFixed(0) || '?'}min left)`
            : "game in progress";
          logger.debug(`  ${bet.outcome}: at ${(bidPrice * 100).toFixed(0)}¢ but holding - ${reason}`);
        }
      }
    }

    // CHECK 2: Edge-based sell - sell if price exceeds fair value by minSellEdge
    // IMPORTANT: Only sell if we're ALSO in profit! Don't sell at a loss just because edge is positive.
    if (!oddsMatch) continue;

    const consensus = calculateConsensusOdds(oddsMatch, bet.outcome, config.booksRequired, false);
    if (!consensus) continue;

    const fairValue = consensus.avgProb;
    const sellEdge = (bidPrice - fairValue) / fairValue;

    if (debug) {
      logger.info(`  ${bet.outcome}: bid=${(bidPrice * 100).toFixed(1)}¢, fair=${(fairValue * 100).toFixed(1)}¢, sell edge=${(sellEdge * 100).toFixed(1)}%`);
    }

    // Must be in profit AND have positive sell edge
    if (sellEdge >= config.minSellEdge && profitPct > 0) {
      logger.info(`💰 SELL OPPORTUNITY: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ (fair: ${(fairValue * 100).toFixed(0)}¢) | Edge: +${(sellEdge * 100).toFixed(1)}% | Profit: +${(profitPct * 100).toFixed(0)}%`);

      if (config.autoTrade) {
        await executeSellBet(userId, bet, bidPrice);
      }
    }
  }
}

async function executeSellBet(
  userId: number,
  bet: OpenBet,
  bidPrice: number
): Promise<{ success: boolean; error?: string }> {
  const wallet = copyService.getTradingWallet(userId);
  if (!wallet || !wallet.encryptedCredentials) {
    return { success: false, error: "No trading wallet connected" };
  }

  try {
    const credentials = decryptCredentials(wallet.encryptedCredentials);
    const client = await tradingService.createClobClient(
      (credentials as any).privateKey,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
      },
      wallet.proxyAddress || undefined
    );

    // Place market order to sell shares
    const result = await tradingService.placeMarketOrder(client, {
      tokenId: bet.tokenId,
      side: "SELL",
      amount: bet.shares,
    });

    if (result.success) {
      const proceeds = bet.shares * bidPrice;
      const profit = proceeds - bet.size;
      markBetSold(bet.id, bidPrice, profit);
      logger.success(`Sports bet SOLD: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢, profit: $${profit.toFixed(2)}`);

      // Send notification
      await notifySellExecuted(userId, bet, bidPrice, profit);
    } else if (result.error?.includes("not enough balance") || result.error?.includes("allowance")) {
      // Position was already sold manually - mark as sold
      const proceeds = bet.shares * bidPrice;
      const profit = proceeds - bet.size;
      markBetSold(bet.id, bidPrice, profit);
      logger.info(`Position already closed: ${bet.outcome} (marked as sold)`);
    }

    return result;
  } catch (error: any) {
    logger.error("Failed to execute sports sell", error);
    return { success: false, error: error.message };
  }
}

async function notifySellExecuted(userId: number, bet: OpenBet, sellPrice: number, profit: number): Promise<void> {
  try {
    const user = await userRepo.findById(userId);
    if (!user?.telegram_chat_id) return;

    const profitEmoji = profit >= 0 ? "💰" : "📉";
    const profitSign = profit >= 0 ? "+" : "";

    const message = [
      `${profitEmoji} *Sports Bet Sold*`,
      ``,
      `*Match:* ${bet.homeTeam} vs ${bet.awayTeam}`,
      `*Position:* ${bet.outcome}`,
      `*Bought:* ${(bet.buyPrice * 100).toFixed(0)}¢ ($${bet.size.toFixed(2)})`,
      `*Sold:* ${(sellPrice * 100).toFixed(0)}¢`,
      `*P&L:* ${profitSign}$${profit.toFixed(2)}`,
    ].join("\n");

    await sendMessage(user.telegram_chat_id, message, { parseMode: "Markdown" });
  } catch (error) {
    logger.error("Failed to send sell notification", error);
  }
}

/**
 * Execute a take-profit sell when price exceeds maxHoldPrice
 */
async function executeTakeProfitSell(
  userId: number,
  bet: OpenBet,
  bidPrice: number
): Promise<{ success: boolean; error?: string }> {
  const wallet = copyService.getTradingWallet(userId);
  if (!wallet || !wallet.encryptedCredentials) {
    return { success: false, error: "No trading wallet connected" };
  }

  try {
    const credentials = decryptCredentials(wallet.encryptedCredentials);
    const client = await tradingService.createClobClient(
      (credentials as any).privateKey,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
      },
      wallet.proxyAddress || undefined
    );

    // Place market order to sell shares
    const result = await tradingService.placeMarketOrder(client, {
      tokenId: bet.tokenId,
      side: "SELL",
      amount: bet.shares,
    });

    if (result.success) {
      const proceeds = bet.shares * bidPrice;
      const profit = proceeds - bet.size;
      const profitPct = ((bidPrice - bet.buyPrice) / bet.buyPrice * 100).toFixed(0);
      markBetSold(bet.id, bidPrice, profit);
      logger.success(`🎯 TAKE PROFIT executed: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ | +${profitPct}% | profit: $${profit.toFixed(2)}`);

      // Send notification
      await notifyTakeProfitExecuted(userId, bet, bidPrice, profit);
    } else if (result.error?.includes("not enough balance") || result.error?.includes("allowance")) {
      // Position was already sold manually - mark as sold
      const proceeds = bet.shares * bidPrice;
      const profit = proceeds - bet.size;
      markBetSold(bet.id, bidPrice, profit);
      logger.info(`Position already closed: ${bet.outcome} (marked as sold)`);
    }

    return result;
  } catch (error: any) {
    logger.error("Failed to execute take-profit sell", error);
    return { success: false, error: error.message };
  }
}

async function notifyTakeProfitExecuted(userId: number, bet: OpenBet, sellPrice: number, profit: number): Promise<void> {
  try {
    const user = await userRepo.findById(userId);
    if (!user?.telegram_chat_id) return;

    const profitPct = ((sellPrice - bet.buyPrice) / bet.buyPrice * 100).toFixed(0);

    const message = [
      `🎯 *Take Profit Executed*`,
      ``,
      `*Match:* ${bet.homeTeam} vs ${bet.awayTeam}`,
      `*Position:* ${bet.outcome}`,
      `*Entry:* ${(bet.buyPrice * 100).toFixed(0)}¢ ($${bet.size.toFixed(2)})`,
      `*Exit:* ${(sellPrice * 100).toFixed(0)}¢`,
      `*Gain:* +${profitPct}%`,
      `*Profit:* +$${profit.toFixed(2)}`,
      ``,
      `_Locked in gains at ${(sellPrice * 100).toFixed(0)}¢ threshold_`,
    ].join("\n");

    await sendMessage(user.telegram_chat_id, message, { parseMode: "Markdown" });
  } catch (error) {
    logger.error("Failed to send take-profit notification", error);
  }
}

/**
 * Execute an auto-redeem sell when price >= 99¢ (market resolved, we won)
 */
async function executeRedeemSell(
  userId: number,
  bet: OpenBet,
  bidPrice: number
): Promise<{ success: boolean; error?: string }> {
  const wallet = copyService.getTradingWallet(userId);
  if (!wallet || !wallet.encryptedCredentials) {
    return { success: false, error: "No trading wallet connected" };
  }

  try {
    const credentials = decryptCredentials(wallet.encryptedCredentials);
    const client = await tradingService.createClobClient(
      (credentials as any).privateKey,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
      },
      wallet.proxyAddress || undefined
    );

    // Place market order to sell shares
    const result = await tradingService.placeMarketOrder(client, {
      tokenId: bet.tokenId,
      side: "SELL",
      amount: bet.shares,
    });

    if (result.success) {
      const proceeds = bet.shares * bidPrice;
      const profit = proceeds - bet.size;
      markBetSold(bet.id, bidPrice, profit);
      logger.success(`✅ AUTO-REDEEM executed: ${bet.outcome} @ ${(bidPrice * 100).toFixed(0)}¢ | Profit: $${profit.toFixed(2)}`);

      // Send notification
      await notifyRedeemExecuted(userId, bet, bidPrice, profit);
    } else if (result.error?.includes("not enough balance") || result.error?.includes("allowance")) {
      // Position was already sold manually - mark as sold
      const proceeds = bet.shares * bidPrice;
      const profit = proceeds - bet.size;
      markBetSold(bet.id, bidPrice, profit);
      logger.info(`Position already closed: ${bet.outcome} (marked as sold)`);
    }

    return result;
  } catch (error: any) {
    logger.error("Failed to execute redeem sell", error);
    return { success: false, error: error.message };
  }
}

async function notifyRedeemExecuted(userId: number, bet: OpenBet, sellPrice: number, profit: number): Promise<void> {
  try {
    const user = await userRepo.findById(userId);
    if (!user?.telegram_chat_id) return;

    const profitPct = ((sellPrice - bet.buyPrice) / bet.buyPrice * 100).toFixed(0);

    const message = [
      `✅ *Winner Redeemed!*`,
      ``,
      `*Match:* ${bet.homeTeam} vs ${bet.awayTeam}`,
      `*Position:* ${bet.outcome}`,
      `*Entry:* ${(bet.buyPrice * 100).toFixed(0)}¢ ($${bet.size.toFixed(2)})`,
      `*Redeemed:* ${(sellPrice * 100).toFixed(0)}¢`,
      `*Return:* +${profitPct}%`,
      `*Profit:* +$${profit.toFixed(2)}`,
    ].join("\n");

    await sendMessage(user.telegram_chat_id, message, { parseMode: "Markdown" });
  } catch (error) {
    logger.error("Failed to send redeem notification", error);
  }
}

// =============================================
// STATUS
// =============================================

export function getStatus(userId: number): {
  monitoring: boolean;
  lastPoll: number;
  valueBetsFound: number;
  todaysVolume: number;
  config: SportsConfig;
} {
  return {
    monitoring: isMonitoring,
    lastPoll: lastPollTime,
    valueBetsFound: currentValueBets.length,
    todaysVolume: getTodaysSportsVolume(userId),
    config: getSportsConfig(userId),
  };
}

export function getCurrentValueBets(): ValueBet[] {
  return currentValueBets;
}

// =============================================
// INIT SCHEMA
// =============================================

export function initSportsSchema(): void {
  try {
    db().exec(`
      CREATE TABLE IF NOT EXISTS sports_config (
        user_id INTEGER PRIMARY KEY,
        config TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS sports_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        match_id TEXT NOT NULL,
        sport TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        outcome TEXT NOT NULL,
        token_id TEXT,
        shares REAL,
        sharp_prob REAL NOT NULL,
        poly_price REAL NOT NULL,
        edge REAL NOT NULL,
        size REAL NOT NULL,
        order_id TEXT,
        status TEXT DEFAULT 'open',
        sell_price REAL,
        profit REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sports_bets_user ON sports_bets(user_id);
      CREATE INDEX IF NOT EXISTS idx_sports_bets_created ON sports_bets(created_at);
    `);

    // Migration: add new columns if they don't exist
    const migrations = [
      "ALTER TABLE sports_bets ADD COLUMN token_id TEXT",
      "ALTER TABLE sports_bets ADD COLUMN shares REAL",
      "ALTER TABLE sports_bets ADD COLUMN sell_price REAL",
      "ALTER TABLE sports_bets ADD COLUMN condition_id TEXT",
    ];
    for (const sql of migrations) {
      try {
        db().exec(sql);
      } catch {
        // Column already exists, ignore
      }
    }

    logger.debug("Sports schema initialized");
  } catch (error) {
    logger.error("Failed to init sports schema", error);
  }
}

// =============================================
// MARKET RESOLUTION CHECKING
// =============================================

interface OpenBetWithCondition {
  id: number;
  userId: number;
  outcome: string;
  tokenId: string;
  shares: number;
  buyPrice: number;
  size: number;
  conditionId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Get all open bets that have a condition ID for resolution checking
 */
function getAllOpenBetsForResolution(): OpenBetWithCondition[] {
  try {
    return db()
      .prepare(`
        SELECT id, user_id as userId, outcome, token_id as tokenId,
               shares, poly_price as buyPrice, size, condition_id as conditionId,
               home_team as homeTeam, away_team as awayTeam
        FROM sports_bets
        WHERE status = 'open' AND condition_id IS NOT NULL
      `)
      .all() as OpenBetWithCondition[];
  } catch {
    return [];
  }
}

/**
 * Mark a bet as won
 */
function markBetWon(betId: number, profit: number): void {
  try {
    db().prepare(`
      UPDATE sports_bets
      SET status = 'won', profit = ?, sell_price = 1.0
      WHERE id = ?
    `).run(profit, betId);
  } catch (error) {
    logger.error("Failed to mark bet as won", error);
  }
}

/**
 * Mark a bet as lost
 */
function markBetLost(betId: number): void {
  try {
    // Get the bet size first
    const bet = db().prepare("SELECT size FROM sports_bets WHERE id = ?").get(betId) as { size: number } | undefined;
    const loss = bet ? -bet.size : 0;

    db().prepare(`
      UPDATE sports_bets
      SET status = 'lost', profit = ?, sell_price = 0
      WHERE id = ?
    `).run(loss, betId);
  } catch (error) {
    logger.error("Failed to mark bet as lost", error);
  }
}

/**
 * Check all open bets for market resolution and update statuses
 */
export async function checkMarketResolutions(): Promise<{ checked: number; resolved: number; won: number; lost: number }> {
  const openBets = getAllOpenBetsForResolution();

  if (openBets.length === 0) {
    return { checked: 0, resolved: 0, won: 0, lost: 0 };
  }

  // Group bets by condition ID to avoid duplicate API calls
  const betsByCondition = new Map<string, OpenBetWithCondition[]>();
  for (const bet of openBets) {
    const existing = betsByCondition.get(bet.conditionId) || [];
    existing.push(bet);
    betsByCondition.set(bet.conditionId, existing);
  }

  let resolved = 0;
  let won = 0;
  let lost = 0;

  for (const [conditionId, bets] of betsByCondition) {
    try {
      const resolution = await tradingService.getMarketResolution(conditionId);

      if (!resolution || !resolution.resolved) {
        continue; // Market not resolved yet
      }

      resolved += bets.length;

      for (const bet of bets) {
        // Check if our outcome won
        // The winning outcome from Polymarket should match our bet outcome
        const betWon = resolution.winningOutcome?.toLowerCase() === bet.outcome.toLowerCase();

        if (betWon) {
          // Won: shares pay out at $1 each
          const payout = bet.shares * 1.0;
          const profit = payout - bet.size;
          markBetWon(bet.id, profit);
          won++;
          logger.success(`Sports bet WON: ${bet.outcome} (${bet.homeTeam} vs ${bet.awayTeam}) - profit: $${profit.toFixed(2)}`);

          // Notify user
          notifyBetResolved(bet.userId, bet, true, profit);
        } else {
          // Lost: shares worth $0
          const loss = -bet.size;
          markBetLost(bet.id);
          lost++;
          logger.info(`Sports bet LOST: ${bet.outcome} (${bet.homeTeam} vs ${bet.awayTeam}) - loss: $${bet.size.toFixed(2)}`);

          // Notify user
          notifyBetResolved(bet.userId, bet, false, loss);
        }
      }
    } catch (error) {
      logger.error(`Failed to check resolution for condition ${conditionId}`, error);
    }

    // Small delay between API calls
    await Bun.sleep(100);
  }

  if (resolved > 0) {
    logger.info(`Resolution check: ${openBets.length} open bets, ${resolved} resolved (${won} won, ${lost} lost)`);
  }

  return { checked: openBets.length, resolved, won, lost };
}

/**
 * Reconcile database with actual Polymarket positions
 * Two-way sync:
 * 1. Marks bets as sold/resolved if they no longer exist in the portfolio
 * 2. Adds positions that exist in Polymarket but aren't tracked in DB
 */
export async function reconcilePositions(userId: number): Promise<{ synced: number; removed: number; added: number }> {
  const wallet = copyService.getTradingWallet(userId);
  if (!wallet || !wallet.encryptedCredentials) {
    return { synced: 0, removed: 0, added: 0 };
  }

  try {
    const credentials = decryptCredentials(wallet.encryptedCredentials);
    const client = await tradingService.createClobClient(
      (credentials as any).privateKey,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
      },
      wallet.proxyAddress || undefined
    );

    // Get actual positions from Polymarket
    const actualPositions = await tradingService.getAllPositions(client, wallet.proxyAddress || undefined);
    const actualTokenIds = new Set(actualPositions.map(p => p.tokenId));

    // Get all bets marked as open in our database
    const openBets = db()
      .prepare(`
        SELECT id, token_id as tokenId, outcome, size, shares, poly_price as buyPrice
        FROM sports_bets
        WHERE user_id = ? AND status IN ('open', 'placed') AND token_id IS NOT NULL
      `)
      .all(userId) as Array<{
        id: number;
        tokenId: string;
        outcome: string;
        size: number;
        shares: number;
        buyPrice: number;
      }>;

    const dbTokenIds = new Set(openBets.map(b => b.tokenId));

    let removed = 0;
    let added = 0;

    // 1. Remove DB entries that no longer exist in Polymarket
    for (const bet of openBets) {
      const actualPos = actualPositions.find(p => p.tokenId === bet.tokenId);

      if (!actualPos || actualPos.size <= 0) {
        const curPrice = actualPos?.curPrice || 0;
        const estimatedProceeds = bet.shares * (curPrice > 0 ? curPrice : 0.5);
        const profit = estimatedProceeds - bet.size;

        db().prepare(`
          UPDATE sports_bets
          SET status = 'sold', profit = ?, sell_price = ?
          WHERE id = ?
        `).run(profit, curPrice || 0.5, bet.id);

        logger.info(`Reconciled: ${bet.outcome} marked as sold (no longer in portfolio)`);
        removed++;
      }
    }

    // 2. Add Polymarket positions that aren't in DB (untracked positions)
    for (const pos of actualPositions) {
      if (pos.size <= 0) continue; // Skip empty positions
      if (dbTokenIds.has(pos.tokenId)) continue; // Already tracked

      const marketTitle = pos.title || '';

      // Only sync sports positions (contain "vs" and not weather/temperature related)
      const lowerTitle = marketTitle.toLowerCase();
      const isSportsMatch = (lowerTitle.includes(' vs ') || lowerTitle.includes(' vs.')) &&
        !lowerTitle.includes('temperature') &&
        !lowerTitle.includes('weather') &&
        !lowerTitle.includes('price') &&
        !lowerTitle.includes('bitcoin') &&
        !lowerTitle.includes('ethereum');

      if (!isSportsMatch) {
        continue; // Skip non-sports positions
      }

      // This is an untracked sports position - add it to DB for exposure calculation
      const costBasis = pos.size * pos.avgPrice;
      const outcomeName = pos.outcome || 'Unknown';

      db().prepare(`
        INSERT INTO sports_bets (
          user_id, match_id, sport, home_team, away_team, outcome, token_id,
          condition_id, status, size, shares, sharp_prob, poly_price, edge, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        pos.conditionId || 'synced-' + pos.tokenId.slice(0, 8),
        'synced',           // sport - placeholder
        marketTitle,        // home_team - use market title
        'vs',               // away_team - placeholder
        outcomeName,        // outcome
        pos.tokenId,
        pos.conditionId || null,
        costBasis,          // size (cost basis in USD)
        pos.size,           // shares
        pos.curPrice,       // sharp_prob - use current price as estimate
        pos.avgPrice,       // poly_price - entry price
        0,                  // edge - unknown for synced positions
        Math.floor(Date.now() / 1000)
      );

      logger.info(`Synced untracked position: ${outcomeName} (${pos.size.toFixed(1)} shares @ ${(pos.avgPrice * 100).toFixed(0)}¢, $${costBasis.toFixed(2)})`);
      added++;
    }

    if (removed > 0 || added > 0) {
      logger.success(`Reconciliation: ${removed} removed, ${added} added from Polymarket`);
    }

    return { synced: openBets.length, removed, added };
  } catch (error) {
    logger.error("Failed to reconcile positions", error);
    return { synced: 0, removed: 0, added: 0 };
  }
}

async function notifyBetResolved(userId: number, bet: OpenBetWithCondition, won: boolean, profit: number): Promise<void> {
  try {
    const user = await userRepo.findById(userId);
    if (!user?.telegram_chat_id) return;

    const icon = won ? "✅" : "❌";
    const status = won ? "WON" : "LOST";
    const profitStr = profit >= 0 ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`;

    const message = [
      `${icon} *Sports Bet ${status}*`,
      ``,
      `*Match:* ${bet.homeTeam} vs ${bet.awayTeam}`,
      `*Bet:* ${bet.outcome}`,
      `*Result:* ${profitStr}`,
    ].join("\n");

    await sendMessage(user.telegram_chat_id, message, { parseMode: "Markdown" });
  } catch (error) {
    logger.error("Failed to send bet resolution notification", error);
  }
}

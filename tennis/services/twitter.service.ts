import { logger } from "../../lib/logger";
import { db } from "../db";
import type { TrackedMatch } from "../types";
import * as monitor from "./monitor.service";
import * as telegram from "../telegram";

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || "";
const TWITTER_USERNAME = process.env.TWITTER_WATCH_USERNAME || "EntryLists";
const POLL_INTERVAL_MS = Number(process.env.TWITTER_POLL_INTERVAL_MS) || 1000; // 1 second default (~$259/mo at $0.0001/req)

let isPolling = false;
let lastTweetId: string | null = null;
let pollCount = 0;
let userId: string | null = null;
let startTime: number | null = null;
const COST_PER_REQUEST = 0.0001; // $0.0001 per request

interface Tweet {
  id: string;
  text: string;
  created_at: string;
}

/**
 * Lookup Twitter user ID by username
 */
async function lookupUserId(username: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Twitter: Failed to lookup user @${username}: ${response.status} - ${error}`);
      return null;
    }

    const data = await response.json();
    return data.data?.id || null;
  } catch (error) {
    logger.error(`Twitter: Error looking up user @${username}`, error);
    return null;
  }
}

/**
 * Start polling @EntryLists for withdrawal announcements
 */
export async function startPolling(): Promise<void> {
  if (!TWITTER_BEARER_TOKEN) {
    logger.warn("Twitter: No bearer token configured, skipping Twitter polling");
    return;
  }

  if (isPolling) {
    logger.warn("Twitter: Already polling");
    return;
  }

  // Lookup user ID
  logger.info(`Twitter: Looking up @${TWITTER_USERNAME}...`);
  userId = await lookupUserId(TWITTER_USERNAME);

  if (!userId) {
    logger.error(`Twitter: Could not find user @${TWITTER_USERNAME}, skipping Twitter polling`);
    return;
  }

  logger.info(`Twitter: Found @${TWITTER_USERNAME} (ID: ${userId})`);

  isPolling = true;
  startTime = Date.now();
  logger.success(`Twitter: Starting @${TWITTER_USERNAME} polling (every ${POLL_INTERVAL_MS / 1000}s)`);

  // Initial fetch to set the baseline
  await fetchAndProcessTweets(true);

  // Start polling loop
  while (isPolling) {
    await Bun.sleep(POLL_INTERVAL_MS);
    if (!isPolling) break;
    await fetchAndProcessTweets(false);

    // Log stats every 60 polls
    if (pollCount % 60 === 0) {
      logStats();
    }
  }
}

/**
 * Log polling stats to console
 */
function logStats(): void {
  if (!startTime) return;

  const elapsed = (Date.now() - startTime) / 1000; // seconds
  const elapsedMin = elapsed / 60;
  const costSoFar = pollCount * COST_PER_REQUEST;
  const reqPerMin = pollCount / elapsedMin;
  const projectedHourlyCost = reqPerMin * 60 * COST_PER_REQUEST;
  const projectedMonthlyCost = projectedHourlyCost * 24 * 30;

  logger.info(
    `📊 Twitter Stats | ` +
    `Polls: ${pollCount} | ` +
    `Cost: $${costSoFar.toFixed(4)} | ` +
    `Rate: ${reqPerMin.toFixed(1)}/min | ` +
    `Est: $${projectedMonthlyCost.toFixed(2)}/mo`
  );
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  isPolling = false;
  logger.info("Twitter: Stopping polling");
}

/**
 * Get polling status
 */
export function getStatus(): {
  polling: boolean;
  pollCount: number;
  lastTweetId: string | null;
  costSoFar: number;
  elapsedMinutes: number;
  projectedMonthlyCost: number;
} {
  const elapsed = startTime ? (Date.now() - startTime) / 1000 / 60 : 0; // minutes
  const costSoFar = pollCount * COST_PER_REQUEST;
  const reqPerMin = elapsed > 0 ? pollCount / elapsed : 0;
  const projectedMonthlyCost = reqPerMin * 60 * 24 * 30 * COST_PER_REQUEST;

  return {
    polling: isPolling,
    pollCount,
    lastTweetId,
    costSoFar,
    elapsedMinutes: elapsed,
    projectedMonthlyCost,
  };
}

/**
 * Fetch recent tweets and process for withdrawals
 */
async function fetchAndProcessTweets(isInitial: boolean): Promise<void> {
  pollCount++;

  try {
    const tweets = await fetchRecentTweets();

    if (!tweets || tweets.length === 0) {
      return;
    }

    // On initial fetch, just set the baseline (don't trigger on old tweets)
    if (isInitial) {
      lastTweetId = tweets[0]?.id || null;
      logger.info(`Twitter: Baseline set, last tweet ID: ${lastTweetId}`);
      return;
    }

    // Process new tweets (newest first, so reverse to process oldest first)
    const newTweets = getNewTweets(tweets);

    if (newTweets.length > 0) {
      logger.info(`Twitter: Found ${newTweets.length} new tweet(s)`);

      for (const tweet of newTweets) {
        await processTweet(tweet);
      }

      // Update last seen tweet ID
      lastTweetId = tweets[0]?.id || lastTweetId;
    }
  } catch (error) {
    logger.error("Twitter: Error fetching tweets", error);
  }
}

/**
 * Fetch recent tweets from watched account
 */
async function fetchRecentTweets(): Promise<Tweet[]> {
  if (!userId) return [];

  const url = new URL(`https://api.twitter.com/2/users/${userId}/tweets`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "created_at");

  if (lastTweetId) {
    url.searchParams.set("since_id", lastTweetId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`Twitter API error: ${response.status} - ${error}`);
    return [];
  }

  const data = await response.json();
  return data.data || [];
}

/**
 * Get tweets newer than our last seen ID
 */
function getNewTweets(tweets: Tweet[]): Tweet[] {
  if (!lastTweetId) return tweets;

  const newTweets: Tweet[] = [];
  for (const tweet of tweets) {
    if (tweet.id === lastTweetId) break;
    if (BigInt(tweet.id) > BigInt(lastTweetId)) {
      newTweets.push(tweet);
    }
  }

  // Return in chronological order (oldest first)
  return newTweets.reverse();
}

/**
 * Process a tweet for withdrawal announcements
 */
async function processTweet(tweet: Tweet): Promise<void> {
  logger.info(`Twitter: Processing tweet: "${tweet.text.substring(0, 100)}..."`);

  // Parse withdrawal info from tweet
  const withdrawal = parseWithdrawal(tweet.text);

  if (!withdrawal) {
    logger.debug(`Twitter: No withdrawal detected in tweet`);
    return;
  }

  logger.info(`Twitter: Detected ${withdrawal.players.length} withdrawal(s) - Players: ${withdrawal.players.join(", ")}, Tournament: ${withdrawal.tournament || "unknown"}`);

  // Process each withdrawn player
  for (const playerName of withdrawal.players) {
    // Find matching tracked match
    const match = findMatchByPlayer(playerName);

    if (!match) {
      logger.info(`Twitter: No tracked match found for player: ${playerName}`);
      continue;
    }

    logger.success(`Twitter: Found match #${match.id}: ${match.player1} vs ${match.player2} for player ${playerName}`);

    // Send Telegram alert about Twitter detection
    await telegram.broadcastToAdmins(
      `🐦 <b>TWITTER WITHDRAWAL DETECTED</b>\n\n` +
      `@${TWITTER_USERNAME}: "${tweet.text.substring(0, 200)}${tweet.text.length > 200 ? '...' : ''}"\n\n` +
      `🎾 Matched: ${match.player1} vs ${match.player2}\n` +
      `🏃 Player: ${playerName}\n\n` +
      `Triggering walkover...`
    );

    // Trigger walkover
    const result = await monitor.triggerManualWalkover(match.id);

    if (result.success) {
      logger.success(`Twitter: Walkover triggered for match #${match.id}`);

      // Record the Twitter detection
      recordTwitterDetection(match.id, tweet.id, tweet.text, playerName);
    } else {
      logger.error(`Twitter: Failed to trigger walkover: ${result.error}`);

      await telegram.broadcastToAdmins(
        `❌ <b>WALKOVER TRIGGER FAILED</b>\n\n` +
        `Match #${match.id}: ${match.player1} vs ${match.player2}\n` +
        `Error: ${result.error}`
      );
    }
  }
}

/**
 * Parse withdrawal information from tweet text
 *
 * @EntryLists format:
 * - "Australian Open update:\nOUT: Djokovic\nIN: Caruso"
 * - "Toronto update:\nOUT: Sinner, Draper, Djokovic\nIN: Carballes Baena, Ofner, Safiullin"
 *
 * Other formats:
 * - "Player Name has withdrawn from Tournament"
 * - "WD: Player Name (Tournament)"
 * - "Walkover: Player Name"
 */
function parseWithdrawal(text: string): { players: string[]; tournament?: string } | null {
  const lowerText = text.toLowerCase();

  // Skip if doesn't look like a withdrawal
  const withdrawalKeywords = ["withdraw", "wd:", "out:", "walkover", "w/o", "retired", "injury", "pulled out", "forced out", "will not play", "won't play", "scratched"];
  if (!withdrawalKeywords.some((kw) => lowerText.includes(kw))) {
    return null;
  }

  const players: string[] = [];
  let tournament: string | undefined;

  // Try to extract tournament name from "Tournament update:" format
  const tournamentMatch = text.match(/^([A-Za-z\s]+)\s+update:/i);
  if (tournamentMatch) {
    tournament = tournamentMatch[1].trim();
  }

  // @EntryLists format: "OUT: Name1, Name2, Name3"
  const outMatch = text.match(/OUT:\s*([^\n]+)/i);
  if (outMatch) {
    const namesStr = outMatch[1].trim();
    // Split by comma and clean up each name
    const names = namesStr.split(/,\s*/).map(n => n.trim()).filter(n => n.length > 0);
    for (const name of names) {
      // Clean up any parenthetical notes like "(LL)"
      const cleanName = name.replace(/\s*\([^)]*\)\s*/g, "").trim();
      if (cleanName.length >= 3) {
        players.push(cleanName);
      }
    }
    if (players.length > 0) {
      return { players, tournament };
    }
  }

  // Try other patterns for single player
  const patterns = [
    // "Player Name has withdrawn from Tournament"
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:has\s+)?(?:withdrawn|withdraws|pulled out|forced out)/i,
    // "WD: Player Name"
    /WD:\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i,
    // "Walkover: Player Name" or "Walkover for Player Name"
    /walkover(?:\s+for)?[:\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i,
    // "Player Name (injury/illness)"
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\s+\([^)]*(?:injury|illness|sick|medical)[^)]*\)/i,
    // "Player Name won't play" / "will not play"
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\s+(?:won't|will not|cannot|can't)\s+play/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const player = match[1].trim();
      if (player.length >= 3 && player.length <= 50) {
        return { players: [player], tournament };
      }
    }
  }

  return null;
}

/**
 * Find a tracked match by player name
 */
function findMatchByPlayer(playerName: string): TrackedMatch | null {
  const normalizedSearch = normalizePlayerName(playerName);

  const matches = db()
    .prepare(
      `
    SELECT
      id, odds_api_id as oddsApiId, player1, player2,
      commence_time as commenceTime, sport_key as sportKey,
      polymarket_condition_id as polymarketConditionId,
      player1_token_id as player1TokenId, player2_token_id as player2TokenId,
      polymarket_slug as polymarketSlug,
      status, walkover_detected_at as walkoverDetectedAt,
      orders_placed_at as ordersPlacedAt, notes,
      last_seen_in_api as lastSeenInApi,
      COALESCE(consecutive_missing, 0) as consecutiveMissing,
      created_at as createdAt, updated_at as updatedAt
    FROM tracked_matches
    WHERE status = 'pending'
    ORDER BY commence_time ASC
  `
    )
    .all() as TrackedMatch[];

  for (const match of matches) {
    const p1Normalized = normalizePlayerName(match.player1);
    const p2Normalized = normalizePlayerName(match.player2);

    // Check if player name matches either player
    if (playerNameMatches(normalizedSearch, p1Normalized) || playerNameMatches(normalizedSearch, p2Normalized)) {
      return match;
    }
  }

  return null;
}

/**
 * Normalize player name for matching
 */
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z\s]/g, "") // Keep only letters and spaces
    .trim();
}

/**
 * Check if two player names match
 * Handles: full name vs full name, last name only vs full name
 */
function playerNameMatches(search: string, target: string): boolean {
  // Exact match
  if (search === target) return true;

  const searchParts = search.split(/\s+/);
  const targetParts = target.split(/\s+/);

  const searchLast = searchParts[searchParts.length - 1];
  const targetLast = targetParts[targetParts.length - 1];

  // If search is a single word (last name only from @EntryLists)
  if (searchParts.length === 1 && searchLast) {
    // Match against target's last name
    if (searchLast === targetLast) {
      return true;
    }
    // Also check if any part of target name matches (handles hyphenated names)
    for (const part of targetParts) {
      if (part === searchLast || part.includes(searchLast) || searchLast.includes(part)) {
        return true;
      }
    }
  }

  // Full name matching
  if (searchLast && targetLast && searchLast === targetLast) {
    // Last names match, check first initial or first name
    const searchFirst = searchParts[0];
    const targetFirst = targetParts[0];

    if (searchFirst && targetFirst) {
      // First names match or first initial matches
      if (searchFirst === targetFirst || searchFirst[0] === targetFirst[0]) {
        return true;
      }
    }

    // Just last name match with length > 4 (avoid common short names)
    if (searchLast.length > 4) {
      return true;
    }
  }

  // Check if search contains target or vice versa
  if (search.includes(target) || target.includes(search)) {
    return true;
  }

  return false;
}

/**
 * Record Twitter detection in database
 */
function recordTwitterDetection(matchId: number, tweetId: string, tweetText: string, playerName: string): void {
  try {
    db().prepare(
      `
      INSERT INTO walkover_events (match_id, detection_reason, confidence, detected_at, notified, detection_context)
      VALUES (?, 'twitter_entrylists', 'high', ?, 1, ?)
    `
    ).run(
      matchId,
      Math.floor(Date.now() / 1000),
      JSON.stringify({ tweetId, tweetText: tweetText.substring(0, 500), playerName, source: "@EntryLists" })
    );
  } catch (error) {
    logger.error("Twitter: Failed to record detection", error);
  }
}

/**
 * Manually test parsing a tweet
 */
export function testParseTweet(text: string): { players: string[]; tournament?: string } | null {
  return parseWithdrawal(text);
}

/**
 * Manually lookup player in tracked matches
 */
export function testFindPlayer(playerName: string): TrackedMatch | null {
  return findMatchByPlayer(playerName);
}

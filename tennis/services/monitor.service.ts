import { tennisConfig } from "../config";
import { db } from "../db";
import { logger } from "../../lib/logger";
import type { TrackedMatch, OddsApiMatch, WalkoverDetection } from "../types";
import * as oddsApi from "./odds-api.service";
import * as detector from "./walkover-detector.service";
import * as marketFinder from "./market-finder.service";
import * as trading from "./trading.service";
import * as telegram from "../telegram";

// Module state
let isRunning = false;
let pollCount = 0;
let lastPollTime = 0;
let lastScanTime = 0;
const SCAN_INTERVAL_MS = 10 * 60 * 1000; // Scan for new matches every 10 minutes

/**
 * Format time until match starts
 */
function formatTimeUntil(commenceTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = commenceTime - now;

  if (diff < 0) {
    const ago = Math.abs(diff);
    if (ago < 3600) return `started ${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `started ${Math.floor(ago / 3600)}h ago`;
    return `started ${Math.floor(ago / 86400)}d ago`;
  }

  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}

/**
 * Start the monitoring loop
 */
export async function start(): Promise<void> {
  if (isRunning) {
    logger.warn("Monitor already running");
    return;
  }

  isRunning = true;
  logger.success("Tennis walkover monitor started");

  // Initial poll
  await pollCycle();

  // Start polling loop
  while (isRunning) {
    await Bun.sleep(tennisConfig.POLL_INTERVAL_MS);

    if (!isRunning) break;

    await pollCycle();
  }

  logger.info("Tennis walkover monitor stopped");
}

/**
 * Stop the monitoring loop
 */
export function stop(): void {
  isRunning = false;
  logger.info("Stopping tennis walkover monitor...");
}

/**
 * Get monitor status
 */
export function getStatus(): {
  running: boolean;
  pollCount: number;
  lastPollTime: number;
  trackedMatches: number;
  tradingReady: boolean;
} {
  const matches = getTrackedMatches();
  return {
    running: isRunning,
    pollCount,
    lastPollTime,
    trackedMatches: matches.length,
    tradingReady: trading.isReady(),
  };
}

/**
 * Single poll cycle
 */
async function pollCycle(): Promise<void> {
  pollCount++;
  lastPollTime = Date.now();

  try {
    // Periodically scan for new events (every 10 minutes)
    if (Date.now() - lastScanTime > SCAN_INTERVAL_MS) {
      // Primary: Track events from Polymarket (what we can trade)
      const newFromPolymarket = await autoTrackFromPolymarket();
      if (newFromPolymarket > 0) {
        logger.info(`Found ${newFromPolymarket} new events on Polymarket`);
      }

      // Secondary: Link to Odds API for walkover monitoring
      const linkedToOdds = await linkToOddsApi();
      if (linkedToOdds > 0) {
        logger.info(`Linked ${linkedToOdds} events to Odds API`);
      }

      lastScanTime = Date.now();
    }

    // Fetch latest match data
    const apiMatches = await oddsApi.fetchAllUpcomingMatches();
    const scores = await oddsApi.fetchAllScores();

    // Combine into a map
    const matchMap = new Map<string, OddsApiMatch>();
    for (const m of [...apiMatches, ...scores]) {
      matchMap.set(m.id, m);
    }

    // Get tracked matches
    const tracked = detector.getPendingMatches();

    logger.info(`━━━ Poll #${pollCount} ━━━ ${tracked.length} tracked, ${matchMap.size} from API`);

    // Check each tracked match for walkover
    for (const match of tracked) {
      // Skip matches that have already started - walkovers only happen before the match
      const now = Date.now();
      const matchStartTime = match.commenceTime * 1000;
      if (now > matchStartTime) {
        // Match has started - skip walkover detection
        // Could mark as 'live' here if desired
        continue;
      }

      // Skip matches without real Odds API ID (Polymarket-only)
      const hasOddsApiId = match.oddsApiId && !match.oddsApiId.startsWith('pm_');
      const currentState = hasOddsApiId ? (matchMap.get(match.oddsApiId) || null) : null;
      const previousState = hasOddsApiId ? detector.getLatestSnapshot(match.oddsApiId) : null;

      // Track API presence for disappearance detection
      if (hasOddsApiId) {
        if (currentState) {
          // Match is in API - update last seen and reset missing counter
          updateMatchApiPresence(match.id, true);
          detector.saveMatchSnapshot(currentState);

          // Sync commence time if it changed (matches can be rescheduled)
          const apiCommenceTime = Math.floor(new Date(currentState.commence_time).getTime() / 1000);
          if (apiCommenceTime !== match.commenceTime) {
            logger.info(
              `Match #${match.id} start time changed: ${new Date(match.commenceTime * 1000).toISOString()} → ${currentState.commence_time}`
            );
            updateMatchCommenceTime(match.id, apiCommenceTime);
            match.commenceTime = apiCommenceTime; // Update local copy for this cycle
          }
        } else {
          // Match NOT in API response
          // CRITICAL: Only increment missing counter if the API fetch succeeded
          // If the API had errors, we don't know the true state - don't count as missing
          const sportHadError = oddsApi.sportHadFetchError(match.sportKey);
          const fetchHadErrors = oddsApi.lastFetchHadApiErrors();

          if (sportHadError || fetchHadErrors) {
            logger.debug(`Match #${match.id} not in API but API had errors - NOT counting as missing`);
          } else {
            // API worked fine but match not present - this is a real "missing" signal
            const newConsecutiveMissing = updateMatchApiPresence(match.id, false);

            // Calculate time-based metrics
            const pollIntervalMs = tennisConfig.POLL_INTERVAL_MS;
            const timeMissingMinutes = Math.floor((newConsecutiveMissing * pollIntervalMs) / 60000);
            const timeUntilStartMs = (match.commenceTime * 1000) - Date.now();
            const timeUntilStartMinutes = Math.floor(timeUntilStartMs / 60000);

            // Determine required missing time based on how close to match start
            // FAST thresholds - only 5-10 min to take the book
            const twoHoursMs = 2 * 60 * 60 * 1000;
            const fourHoursMs = 4 * 60 * 60 * 1000;
            let requiredMinutes: number;
            if (timeUntilStartMs < twoHoursMs) {
              requiredMinutes = 3;   // HIGH confidence threshold
            } else if (timeUntilStartMs < fourHoursMs) {
              requiredMinutes = 5;   // MEDIUM confidence threshold
            } else {
              requiredMinutes = 999; // Won't trigger if more than 4 hours out
            }

            logger.debug(`Match #${match.id} missing from API: ${timeMissingMinutes}/${requiredMinutes} minutes`);

            // Send Telegram notification once per minute when match is missing
            // Only for matches that haven't started yet and are within 4 hours
            // Use poll count to ensure we only alert once per minute (every 4 polls at 15s)
            const isNewMinute = newConsecutiveMissing % 4 === 0;
            const matchNotStarted = timeUntilStartMs > 0;

            if (matchNotStarted && timeUntilStartMs < fourHoursMs && timeMissingMinutes > 0 && isNewMinute) {
              await telegram.sendMissingPollAlert(
                match.player1,
                match.player2,
                timeMissingMinutes,
                requiredMinutes,
                timeUntilStartMinutes
              );
            }
          }
        }
      }

      // Detect walkover - pass consecutive missing count
      const consecutiveMissing = getMatchConsecutiveMissing(match.id);
      const detection = detector.detectWalkover(match, currentState, previousState, consecutiveMissing);

      if (detection.detected) {
        await handleWalkoverDetected(match, detection, currentState, previousState);
      }
    }

    // Cleanup old snapshots periodically
    if (pollCount % 10 === 0) {
      const cleaned = detector.cleanupOldSnapshots();
      if (cleaned > 0) {
        logger.debug(`Cleaned ${cleaned} old snapshots`);
      }
    }
  } catch (error) {
    logger.error("Poll cycle error", error);
  }
}

/**
 * Handle walkover detection
 */
async function handleWalkoverDetected(
  match: TrackedMatch,
  detection: WalkoverDetection,
  currentApiState: OddsApiMatch | null = null,
  previousApiState: OddsApiMatch | null = null
): Promise<void> {
  logger.success(
    `WALKOVER DETECTED: ${match.player1} vs ${match.player2} (${detection.reason}, ${detection.confidence})`
  );

  // Build detection context
  const now = Date.now();
  const matchStartTime = match.commenceTime * 1000;
  const eventData: detector.WalkoverEventData = {
    currentApiState,
    previousApiState,
    context: {
      matchStartTime: match.commenceTime,
      detectionTime: Math.floor(now / 1000),
      timeSinceStart: now > matchStartTime ? Math.floor((now - matchStartTime) / 1000) : null,
      timeUntilStart: now < matchStartTime ? Math.floor((matchStartTime - now) / 1000) : null,
      additionalNotes: currentApiState?.completed
        ? `API shows completed=${currentApiState.completed}, scores=${JSON.stringify(currentApiState.scores)}`
        : previousApiState && !currentApiState
        ? `Match disappeared from API. Previous state had completed=${previousApiState.completed}`
        : undefined,
    },
  };

  // Record the event with full context
  detector.recordWalkoverEvent(match.id, detection.reason!, detection.confidence!, eventData);
  detector.markWalkoverDetected(match.id);

  // Calculate context for the alert
  const consecutiveMissing = getMatchConsecutiveMissing(match.id);
  const pollIntervalMs = tennisConfig.POLL_INTERVAL_MS;
  const timeMissingMinutes = Math.floor((consecutiveMissing * pollIntervalMs) / 60000);
  const timeUntilStartMinutes = now < matchStartTime ? Math.floor((matchStartTime - now) / 60000) : 0;

  // Determine what was required for detection
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const requiredMinutes = (matchStartTime - now) < twoHoursMs ? 30 : 60;

  // Send walkover alert with context - NOTIFICATION ONLY, no auto-trading
  // User must manually trigger orders via /detect command after verifying
  await telegram.sendWalkoverAlert(
    match.player1,
    match.player2,
    detection.reason || "Unknown",
    detection.confidence || "unknown",
    {
      consecutiveMissing: timeMissingMinutes,
      requiredMissing: requiredMinutes,
      minutesUntilStart: timeUntilStartMinutes,
    }
  );

  // Track whether orders were placed for channel notification
  let ordersPlaced = false;

  // For manual triggers, also place orders
  if (detection.reason === "manual") {
    // Check if we have Polymarket market info
    if (!match.polymarketConditionId || !match.player1TokenId || !match.player2TokenId) {
      logger.warn("Match missing Polymarket market info, attempting to find...");

      const market = await marketFinder.findMarketByPlayers(match.player1, match.player2);

      if (market) {
        updateMatchMarketInfo(match.id, market.conditionId, market.player1TokenId, market.player2TokenId);
        match.polymarketConditionId = market.conditionId;
        match.player1TokenId = market.player1TokenId;
        match.player2TokenId = market.player2TokenId;
      } else {
        logger.error("Could not find Polymarket market for walkover match");
        await telegram.broadcastToAdmins(
          `⚠️ <b>MANUAL INTERVENTION NEEDED</b>\n\n` +
          `Could not find Polymarket market for:\n` +
          `🎾 ${match.player1} vs ${match.player2}\n\n` +
          `Please link market manually.`
        );
        // Still post to channel even if orders couldn't be placed
        await telegram.postWalkoverToChannel(
          match.player1,
          match.player2,
          detection.reason || "unknown",
          detection.confidence || "unknown",
          false
        );
        return;
      }
    }

    // Place orders if trading is ready
    if (trading.isReady()) {
      const result = await trading.placeWalkoverOrders(match);

      if (result.success) {
        logger.success(`Orders placed successfully for ${match.player1} vs ${match.player2}`);
        ordersPlaced = true;
        await telegram.sendOrderPlacedNotification(
          match.player1,
          match.player2,
          result.player1Order?.orderId,
          result.player2Order?.orderId
        );
      } else {
        logger.error(`Failed to place orders: ${result.error}`);
        await telegram.broadcastToAdmins(
          `❌ <b>ORDER PLACEMENT FAILED</b>\n\n` +
          `🎾 ${match.player1} vs ${match.player2}\n` +
          `Error: ${result.error}\n\n` +
          `Please place orders manually.`
        );
      }
    } else {
      logger.warn("Trading not ready - walkover detected but no orders placed");
      await telegram.broadcastToAdmins(
        `⚠️ <b>TRADING NOT READY</b>\n\n` +
        `Walkover detected for:\n` +
        `🎾 ${match.player1} vs ${match.player2}\n\n` +
        `No wallet connected. Please connect wallet and place orders manually.`
      );
    }
  } else {
    // Auto-detection from API - just notify, don't place orders
    await telegram.broadcastToAdmins(
      `ℹ️ Use <code>/detect ${match.id}</code> to place orders if this is a real walkover.`
    );
  }

  // Post to public channel (like sports bets and copy trades)
  await telegram.postWalkoverToChannel(
    match.player1,
    match.player2,
    detection.reason || "unknown",
    detection.confidence || "unknown",
    ordersPlaced
  );
}

/**
 * Track a new match
 */
export function trackMatch(
  oddsApiId: string,
  player1: string,
  player2: string,
  commenceTime: number,
  sportKey: string,
  polymarketConditionId?: string,
  player1TokenId?: string,
  player2TokenId?: string
): number {
  const stmt = db().prepare(`
    INSERT OR IGNORE INTO tracked_matches
    (odds_api_id, player1, player2, commence_time, sport_key,
     polymarket_condition_id, player1_token_id, player2_token_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `);

  const now = Math.floor(Date.now() / 1000);
  const result = stmt.run(
    oddsApiId,
    player1,
    player2,
    commenceTime,
    sportKey,
    polymarketConditionId || null,
    player1TokenId || null,
    player2TokenId || null,
    now,
    now
  );

  logger.info(`Tracking match: ${player1} vs ${player2} (${oddsApiId})`);
  return Number(result.lastInsertRowid);
}

/**
 * Stop tracking a match
 */
export function untrackMatch(matchId: number): void {
  const stmt = db().prepare(`
    UPDATE tracked_matches SET status = 'ignored', updated_at = ? WHERE id = ?
  `);
  stmt.run(Math.floor(Date.now() / 1000), matchId);
  logger.info(`Untracked match ${matchId}`);
}

/**
 * Get all tracked matches
 */
export function getTrackedMatches(): TrackedMatch[] {
  const stmt = db().prepare(`
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
    WHERE status NOT IN ('completed', 'ignored')
    ORDER BY commence_time ASC
  `);

  return stmt.all() as TrackedMatch[];
}

/**
 * Get a specific match by ID
 */
export function getMatch(matchId: number): TrackedMatch | null {
  const stmt = db().prepare(`
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
    WHERE id = ?
  `);

  return stmt.get(matchId) as TrackedMatch | null;
}

/**
 * Update match with Polymarket market info
 */
function updateMatchMarketInfo(
  matchId: number,
  conditionId: string,
  player1TokenId: string,
  player2TokenId: string
): void {
  const stmt = db().prepare(`
    UPDATE tracked_matches
    SET polymarket_condition_id = ?, player1_token_id = ?, player2_token_id = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(conditionId, player1TokenId, player2TokenId, Math.floor(Date.now() / 1000), matchId);
}

/**
 * Update match commence time (when start time changes)
 */
function updateMatchCommenceTime(matchId: number, commenceTime: number): void {
  const stmt = db().prepare(`
    UPDATE tracked_matches
    SET commence_time = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(commenceTime, Math.floor(Date.now() / 1000), matchId);
}

/**
 * Update match API presence tracking
 * Returns the new consecutive_missing count
 */
function updateMatchApiPresence(matchId: number, isPresent: boolean): number {
  const now = Math.floor(Date.now() / 1000);

  if (isPresent) {
    // Match is in API - update last_seen and reset missing counter
    db().prepare(`
      UPDATE tracked_matches
      SET last_seen_in_api = ?, consecutive_missing = 0, updated_at = ?
      WHERE id = ?
    `).run(now, now, matchId);
    return 0;
  } else {
    // Match missing - increment counter
    db().prepare(`
      UPDATE tracked_matches
      SET consecutive_missing = consecutive_missing + 1, updated_at = ?
      WHERE id = ?
    `).run(now, matchId);

    // Return the new count
    const row = db().prepare(`SELECT consecutive_missing FROM tracked_matches WHERE id = ?`).get(matchId) as { consecutive_missing: number } | undefined;
    return row?.consecutive_missing || 1;
  }
}

/**
 * Get consecutive missing count for a match
 */
function getMatchConsecutiveMissing(matchId: number): number {
  const row = db().prepare(`SELECT consecutive_missing FROM tracked_matches WHERE id = ?`).get(matchId) as { consecutive_missing: number } | undefined;
  return row?.consecutive_missing || 0;
}

/**
 * Manually trigger walkover for a match
 */
export async function triggerManualWalkover(matchId: number): Promise<{
  success: boolean;
  error?: string;
}> {
  const match = getMatch(matchId);

  if (!match) {
    return { success: false, error: "Match not found" };
  }

  if (match.status === "orders_placed" || match.status === "completed") {
    return { success: false, error: `Match already in status: ${match.status}` };
  }

  // SAFETY: Never trigger walkover after match has started
  const now = Math.floor(Date.now() / 1000);
  if (now > match.commenceTime) {
    const minutesAgo = Math.floor((now - match.commenceTime) / 60);
    return {
      success: false,
      error: `Match already started ${minutesAgo}m ago. Walkovers only happen before match start.`
    };
  }

  // Get latest API state for context
  const currentApiState = match.oddsApiId && !match.oddsApiId.startsWith("pm_")
    ? detector.getLatestSnapshot(match.oddsApiId)
    : null;

  const detection = detector.triggerManualWalkover(matchId);
  await handleWalkoverDetected(match, detection, currentApiState, null);

  return { success: true };
}

/**
 * Auto-track events from Polymarket (PRIMARY SOURCE)
 * This is the correct approach - track what we can trade, then link to Odds API for monitoring
 */
export async function autoTrackFromPolymarket(): Promise<number> {
  const events = await marketFinder.fetchAllTennisEvents();
  let tracked = 0;

  for (const event of events) {
    // Find the MONEYLINE market - MUST match event title exactly
    // This is the head-to-head winner market, not O/U, handicap, or set winner
    // Priority: exact title match > fallback to "Winner" in question
    let market = event.markets?.find((m) => m.question === event.title);

    // Fallback: look for a market with "Winner" that has player name outcomes
    if (!market) {
      market = event.markets?.find((m) => {
        const question = m.question.toLowerCase();
        // Skip handicap, O/U, and set-specific markets
        if (question.includes("handicap")) return false;
        if (question.includes("o/u")) return false;
        if (question.includes("set 1")) return false;
        if (question.includes("total sets")) return false;

        try {
          const outcomes = JSON.parse(m.outcomes || "[]") as string[];
          if (outcomes.length !== 2) return false;

          // Must not have over/under
          const hasOverUnder = outcomes.some(
            (o) => o.toLowerCase().includes("over") || o.toLowerCase().includes("under")
          );
          if (hasOverUnder) return false;

          // Should be short player names
          return outcomes.every((o) => o.length < 15);
        } catch {
          return false;
        }
      });
    }

    if (!market) continue;

    const existing = db()
      .prepare("SELECT id FROM tracked_matches WHERE polymarket_condition_id = ?")
      .get(market.conditionId);

    if (!existing) {
      // Parse player names from title (e.g., "Australian Open Men's: Carlos Alcaraz vs Adam Walton")
      const { player1, player2 } = parsePlayersFromTitle(event.title);
      if (!player1 || !player2) continue;

      // Parse token IDs and outcomes
      try {
        const outcomes = JSON.parse(market.outcomes || "[]") as string[];
        const tokenIds = JSON.parse(market.clobTokenIds || "[]") as string[];

        if (outcomes.length < 2 || tokenIds.length < 2) continue;

        // Determine sport key from slug
        const sportKey = event.slug.startsWith("wta") ? "tennis_wta" : "tennis_atp";

        // Use startTime from API (actual event start time)
        let commenceTime: number | null = null;

        if (event.startTime) {
          // startTime is an ISO string like "2026-01-16T20:00:00Z"
          commenceTime = Math.floor(new Date(event.startTime).getTime() / 1000);
        }

        // Fallback to slug date if startTime not available
        if (!commenceTime) {
          const slugDateMatch = event.slug.match(/(\d{4}-\d{2}-\d{2})$/);
          if (slugDateMatch) {
            // Default to midnight UTC on that date
            commenceTime = Math.floor(new Date(slugDateMatch[1] + "T00:00:00Z").getTime() / 1000);
          } else {
            commenceTime = Math.floor(Date.now() / 1000) + 86400; // Default to tomorrow
          }
        }

        trackMatchFromPolymarket(
          market.conditionId,
          player1,
          player2,
          tokenIds[0]!,
          tokenIds[1]!,
          commenceTime,
          sportKey,
          event.title,
          event.slug
        );
        tracked++;
      } catch {
        // Skip malformed events
      }
    }
  }

  if (tracked > 0) {
    logger.info(`Auto-tracked ${tracked} new events from Polymarket`);
  }
  return tracked;
}

/**
 * Parse player names from Polymarket event title
 */
function parsePlayersFromTitle(title: string): { player1: string; player2: string } {
  // Format: "Australian Open Men's: Carlos Alcaraz vs Adam Walton"
  // Or: "Carlos Alcaraz vs Adam Walton"
  const vsMatch = title.match(/:\s*(.+?)\s+vs\s+(.+)$/i) || title.match(/^(.+?)\s+vs\s+(.+)$/i);

  if (vsMatch) {
    return { player1: vsMatch[1]!.trim(), player2: vsMatch[2]!.trim() };
  }

  return { player1: "", player2: "" };
}

/**
 * Track a match from Polymarket (with market info already known)
 */
function trackMatchFromPolymarket(
  conditionId: string,
  player1: string,
  player2: string,
  player1TokenId: string,
  player2TokenId: string,
  commenceTime: number,
  sportKey: string,
  title: string,
  slug: string
): number {
  const stmt = db().prepare(`
    INSERT OR IGNORE INTO tracked_matches
    (odds_api_id, player1, player2, commence_time, sport_key,
     polymarket_condition_id, player1_token_id, player2_token_id, polymarket_slug, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);

  const now = Math.floor(Date.now() / 1000);
  // Use conditionId as a placeholder for odds_api_id until we link it
  const result = stmt.run(
    `pm_${conditionId.slice(0, 16)}`, // Placeholder Odds API ID
    player1,
    player2,
    commenceTime,
    sportKey,
    conditionId,
    player1TokenId,
    player2TokenId,
    slug,
    title,
    now,
    now
  );

  logger.debug(`Tracking from Polymarket: ${player1} vs ${player2}`);
  return Number(result.lastInsertRowid);
}

/**
 * Link tracked Polymarket events to Odds API matches (for walkover detection)
 */
export async function linkToOddsApi(): Promise<number> {
  // Get all Odds API matches
  const apiMatches = await oddsApi.fetchAllUpcomingMatches();

  // Get unlinked tracked matches (those with placeholder odds_api_id)
  const unlinked = db().prepare(`
    SELECT id, player1, player2, sport_key as sportKey
    FROM tracked_matches
    WHERE odds_api_id LIKE 'pm_%'
    AND status = 'pending'
  `).all() as Array<{
    id: number;
    player1: string;
    player2: string;
    sportKey: string;
  }>;

  let linked = 0;

  for (const match of unlinked) {
    // Try to find matching Odds API match by player names
    const apiMatch = findMatchingOddsApiMatch(apiMatches, match.player1, match.player2);

    if (apiMatch) {
      // Check if this odds_api_id is already used by another match
      const existingWithOddsId = db()
        .prepare("SELECT id FROM tracked_matches WHERE odds_api_id = ?")
        .get(apiMatch.id);

      if (existingWithOddsId) {
        // Already linked via old method, skip
        continue;
      }

      try {
        const stmt = db().prepare(`
          UPDATE tracked_matches
          SET odds_api_id = ?, commence_time = ?, updated_at = ?
          WHERE id = ?
        `);
        const commenceTime = Math.floor(new Date(apiMatch.commence_time).getTime() / 1000);
        stmt.run(apiMatch.id, commenceTime, Math.floor(Date.now() / 1000), match.id);
        linked++;
        logger.debug(`Linked to Odds API: ${match.player1} vs ${match.player2}`);
      } catch (error) {
        // Constraint error, skip
        logger.debug(`Could not link ${match.player1} vs ${match.player2}: already exists`);
      }
    }
  }

  if (linked > 0) {
    logger.info(`Linked ${linked} matches to Odds API`);
  }
  return linked;
}

/**
 * Find matching Odds API match by player names
 */
function findMatchingOddsApiMatch(
  apiMatches: OddsApiMatch[],
  player1: string,
  player2: string
): OddsApiMatch | null {
  // Normalize: lowercase, decompose accents (ć -> c), remove non-ascii, keep only a-z
  const normalize = (name: string) =>
    name.toLowerCase()
      .normalize("NFD")                    // Decompose: ć -> c + combining accent
      .replace(/[\u0300-\u036f]/g, "")     // Remove combining accents
      .replace(/[^a-z]/g, "");             // Keep only a-z
  const p1Last = normalize(player1.split(" ").pop() || player1);
  const p2Last = normalize(player2.split(" ").pop() || player2);

  for (const match of apiMatches) {
    const { player1: apiP1, player2: apiP2 } = oddsApi.parsePlayerNames(match);
    const api1Last = normalize(apiP1.split(" ").pop() || apiP1);
    const api2Last = normalize(apiP2.split(" ").pop() || apiP2);

    // Match if both last names match (in either order)
    if ((p1Last === api1Last && p2Last === api2Last) ||
        (p1Last === api2Last && p2Last === api1Last)) {
      return match;
    }
  }

  return null;
}

/**
 * Legacy: Auto-track upcoming matches from The Odds API
 * Kept for backwards compatibility
 */
export async function autoTrackUpcomingMatches(): Promise<number> {
  // Now we primarily track from Polymarket, then link to Odds API
  const polymarketTracked = await autoTrackFromPolymarket();
  const oddsLinked = await linkToOddsApi();
  return polymarketTracked;
}

import { db } from "../db";
import { logger } from "../../lib/logger";
import type {
  OddsApiMatch,
  TrackedMatch,
  WalkoverDetection,
  WalkoverReason,
  WalkoverConfidence,
} from "../types";
import { hasScores } from "./odds-api.service";

// Poll interval for calculating time missing (should match config)
const POLL_INTERVAL_MS = 15000; // 15 seconds

/**
 * Detect if a walkover has occurred for a match
 *
 * Detection strategies:
 * 1. Match marked completed with no scores -> HIGH confidence
 * 2. Match disappeared from API before start time:
 *    - TIME-BASED thresholds (not just poll counts):
 *    - Must be within 2 hours of start AND missing for 30+ minutes -> HIGH confidence
 *    - Must be within 4 hours of start AND missing for 60+ minutes -> MEDIUM confidence
 *    - Otherwise: NO detection (matches can disappear from API for many reasons)
 * 3. Manual trigger -> HIGH confidence (external confirmation)
 *
 * IMPORTANT: Matches often disappear from Odds API temporarily due to:
 * - API issues/rate limits
 * - Match rescheduling
 * - Data feed delays
 * Only trigger walkover detection close to match time with SUSTAINED absence
 */
export function detectWalkover(
  trackedMatch: TrackedMatch,
  currentApiState: OddsApiMatch | null,
  previousApiState: OddsApiMatch | null,
  consecutiveMissing: number = 0
): WalkoverDetection {
  const now = Date.now();
  const matchStartTime = trackedMatch.commenceTime * 1000; // Convert to ms
  const timeUntilStart = matchStartTime - now;

  // Time thresholds
  const twoHours = 2 * 60 * 60 * 1000;
  const fourHours = 4 * 60 * 60 * 1000;

  // Calculate how long the match has been missing (based on poll count)
  const timeMissingMs = consecutiveMissing * POLL_INTERVAL_MS;
  const timeMissingMinutes = Math.floor(timeMissingMs / 60000);

  // Required missing duration thresholds
  // FAST thresholds - only 5-10 min to take the book on real walkovers
  // API error handling ensures we don't count rate limits/errors as "missing"
  const threeMinutes = 3 * 60 * 1000;   // 3 minutes = 12 polls at 15s
  const fiveMinutes = 5 * 60 * 1000;    // 5 minutes = 20 polls at 15s

  // SAFETY: Never detect walkover after match has started
  // Walkovers only happen BEFORE the match begins
  if (now > matchStartTime) {
    return { detected: false };
  }

  // Strategy 1: Match completed but no scores (only valid before start time)
  // This is the most reliable signal
  if (currentApiState?.completed && !hasScores(currentApiState)) {
    logger.info(
      `Walkover detected (completed_no_scores): ${trackedMatch.player1} vs ${trackedMatch.player2}`
    );
    return {
      detected: true,
      reason: "completed_no_scores",
      confidence: "high",
    };
  }

  // Strategy 2: Match disappeared from API before start time
  // TIME-BASED requirements to avoid false positives
  if (
    previousApiState !== null &&
    currentApiState === null &&
    now < matchStartTime
  ) {
    // HIGH confidence: Within 2 hours of start AND missing for 3+ minutes
    if (timeUntilStart < twoHours && timeMissingMs >= threeMinutes) {
      logger.info(
        `Walkover detected (disappeared_before_start): ${trackedMatch.player1} vs ${trackedMatch.player2} ` +
        `[missing ${timeMissingMinutes}min, ${Math.floor(timeUntilStart / 60000)}min until start, high confidence]`
      );
      return {
        detected: true,
        reason: "disappeared_before_start",
        confidence: "high",
      };
    }

    // MEDIUM confidence: Within 4 hours of start AND missing for 5+ minutes
    if (timeUntilStart < fourHours && timeMissingMs >= fiveMinutes) {
      logger.info(
        `Walkover detected (disappeared_before_start): ${trackedMatch.player1} vs ${trackedMatch.player2} ` +
        `[missing ${timeMissingMinutes}min, ${Math.floor(timeUntilStart / 60000)}min until start, medium confidence]`
      );
      return {
        detected: true,
        reason: "disappeared_before_start",
        confidence: "medium",
      };
    }

    // Log progress but DON'T detect - not enough evidence yet
    if (consecutiveMissing >= 4) { // Only log after ~1 minute of being missing
      logger.debug(
        `Match disappeared but NOT detecting walkover: ${trackedMatch.player1} vs ${trackedMatch.player2} ` +
        `[missing ${timeMissingMinutes}min (need ${timeUntilStart < twoHours ? 3 : 5}min), ${Math.floor(timeUntilStart / 60000)}min until start]`
      );
    }
  }

  // Strategy 3: Match completed very quickly (within 30 min of start)
  // This could indicate a retirement early in the match or walkover
  if (currentApiState?.completed) {
    const completionTime = currentApiState.last_update
      ? new Date(currentApiState.last_update).getTime()
      : now;

    const matchDuration = completionTime - matchStartTime;
    const thirtyMinutes = 30 * 60 * 1000;

    if (matchDuration > 0 && matchDuration < thirtyMinutes && hasScores(currentApiState)) {
      // Has scores but completed very fast - could be first game retirement
      // Lower confidence as this is not a walkover (match started)
      logger.debug(
        `Quick completion detected but has scores - not a walkover: ${trackedMatch.player1} vs ${trackedMatch.player2}`
      );
    }
  }

  return { detected: false };
}

/**
 * Manually trigger walkover detection for a match
 */
export function triggerManualWalkover(matchId: number): WalkoverDetection {
  logger.info(`Manual walkover triggered for match ${matchId}`);
  return {
    detected: true,
    reason: "manual",
    confidence: "high",
  };
}

/**
 * Save a match snapshot for comparison
 */
export function saveMatchSnapshot(match: OddsApiMatch): void {
  const stmt = db().prepare(`
    INSERT INTO match_snapshots (odds_api_id, snapshot_data, captured_at)
    VALUES (?, ?, ?)
  `);

  stmt.run(match.id, JSON.stringify(match), Math.floor(Date.now() / 1000));
}

/**
 * Get the latest snapshot for a match
 */
export function getLatestSnapshot(oddsApiId: string): OddsApiMatch | null {
  const stmt = db().prepare(`
    SELECT snapshot_data FROM match_snapshots
    WHERE odds_api_id = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `);

  const row = stmt.get(oddsApiId) as { snapshot_data: string } | null;

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.snapshot_data) as OddsApiMatch;
  } catch {
    return null;
  }
}

export interface WalkoverEventData {
  currentApiState: OddsApiMatch | null;
  previousApiState: OddsApiMatch | null;
  context: {
    matchStartTime: number;
    detectionTime: number;
    timeSinceStart: number | null;  // null if before start
    timeUntilStart: number | null;  // null if after start
    additionalNotes?: string;
  };
}

/**
 * Record a walkover event in the database with full context
 */
export function recordWalkoverEvent(
  matchId: number,
  reason: WalkoverReason,
  confidence: WalkoverConfidence,
  eventData?: WalkoverEventData
): number {
  const stmt = db().prepare(`
    INSERT INTO walkover_events (
      match_id, detection_reason, confidence, detected_at, notified,
      current_api_state, previous_api_state, detection_context
    )
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `);

  const now = Math.floor(Date.now() / 1000);

  const result = stmt.run(
    matchId,
    reason,
    confidence,
    now,
    eventData?.currentApiState ? JSON.stringify(eventData.currentApiState) : null,
    eventData?.previousApiState ? JSON.stringify(eventData.previousApiState) : null,
    eventData?.context ? JSON.stringify(eventData.context) : null
  );

  return Number(result.lastInsertRowid);
}

/**
 * Update match status to walkover_detected
 */
export function markWalkoverDetected(matchId: number): void {
  const stmt = db().prepare(`
    UPDATE tracked_matches
    SET status = 'walkover_detected', walkover_detected_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const now = Math.floor(Date.now() / 1000);
  stmt.run(now, now, matchId);
}

/**
 * Get matches pending walkover detection
 */
export function getPendingMatches(): TrackedMatch[] {
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
    WHERE status IN ('pending', 'live')
  `);

  return stmt.all() as TrackedMatch[];
}

/**
 * Clean up old snapshots (keep last 24 hours)
 */
export function cleanupOldSnapshots(): number {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

  const stmt = db().prepare(`
    DELETE FROM match_snapshots WHERE captured_at < ?
  `);

  const result = stmt.run(cutoff);
  return result.changes;
}

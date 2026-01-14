/**
 * Price cache service - tracks latest market prices from real-time feed
 */

import { getMarket } from "../api/polymarket";
import { logger } from "../utils/logger";

interface PriceEntry {
  price: number;
  timestamp: number;
  title?: string;
  outcome?: string;
}

// Cache of condition_id -> latest price
const priceCache = new Map<string, PriceEntry>();

// Max age before price is considered stale (5 minutes)
const MAX_PRICE_AGE_MS = 5 * 60 * 1000;

/**
 * Update price for a condition
 */
export function updatePrice(
  conditionId: string,
  price: number,
  title?: string,
  outcome?: string
): void {
  priceCache.set(conditionId, {
    price,
    timestamp: Date.now(),
    title,
    outcome,
  });
}

/**
 * Get current price for a condition
 */
export function getPrice(conditionId: string): number | null {
  const entry = priceCache.get(conditionId);
  if (!entry) return null;

  // Check if stale
  if (Date.now() - entry.timestamp > MAX_PRICE_AGE_MS) {
    return null;
  }

  return entry.price;
}

/**
 * Get price entry with metadata
 */
export function getPriceEntry(conditionId: string): PriceEntry | null {
  const entry = priceCache.get(conditionId);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > MAX_PRICE_AGE_MS) {
    return null;
  }

  return entry;
}

/**
 * Get all cached prices
 */
export function getAllPrices(): Map<string, PriceEntry> {
  return new Map(priceCache);
}

/**
 * Clear stale prices
 */
export function cleanupStalePrices(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of priceCache.entries()) {
    if (now - entry.timestamp > MAX_PRICE_AGE_MS) {
      priceCache.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; oldestMs: number } {
  let oldest = Date.now();

  for (const entry of priceCache.values()) {
    if (entry.timestamp < oldest) {
      oldest = entry.timestamp;
    }
  }

  return {
    size: priceCache.size,
    oldestMs: Date.now() - oldest,
  };
}

/**
 * Fetch price from API for a specific condition and outcome
 * Used when we don't have recent price data from the websocket feed
 */
export async function fetchPriceFromApi(
  conditionId: string,
  outcome: string
): Promise<number | null> {
  try {
    const market = await getMarket(conditionId);
    if (!market || !market.outcomes || !market.outcomePrices) {
      return null;
    }

    // Find the outcome index
    const outcomeIndex = market.outcomes.findIndex(
      (o) => o.toLowerCase() === outcome.toLowerCase()
    );

    if (outcomeIndex === -1 || !market.outcomePrices[outcomeIndex]) {
      return null;
    }

    const price = parseFloat(market.outcomePrices[outcomeIndex]);

    // Don't cache API prices as "fresh" - use a shorter TTL marker
    // This encourages getting real-time data when available
    return price;
  } catch (error) {
    logger.debug(`Failed to fetch price for ${conditionId}/${outcome}`);
    return null;
  }
}

/**
 * Fetch and cache prices for multiple positions
 * Returns count of positions updated
 */
export async function fetchPricesForPositions(
  positions: Array<{
    conditionId: string;
    assetId?: string;
    outcome: string;
    title?: string;
  }>
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  // Group by conditionId to minimize API calls
  const byCondition = new Map<string, typeof positions>();
  for (const pos of positions) {
    const existing = byCondition.get(pos.conditionId) || [];
    existing.push(pos);
    byCondition.set(pos.conditionId, existing);
  }

  for (const [conditionId, conditionPositions] of byCondition) {
    try {
      const market = await getMarket(conditionId);
      if (!market || !market.outcomes || !market.outcomePrices) {
        logger.debug(`No market data for condition ${conditionId.slice(0, 10)}...`);
        failed += conditionPositions.length;
        continue;
      }

      for (const pos of conditionPositions) {
        const outcomeIndex = market.outcomes.findIndex(
          (o) => o.toLowerCase() === pos.outcome.toLowerCase()
        );

        if (outcomeIndex !== -1 && market.outcomePrices[outcomeIndex]) {
          const price = parseFloat(market.outcomePrices[outcomeIndex]);
          const tokenId = market.tokenIds?.[outcomeIndex];
          const title = pos.title || market.title;

          // Cache with ALL possible keys for maximum compatibility
          const keysToCache = new Set<string>();
          if (tokenId) keysToCache.add(tokenId);
          if (pos.assetId) keysToCache.add(pos.assetId);
          keysToCache.add(pos.conditionId); // Always cache by conditionId too

          for (const key of keysToCache) {
            updatePrice(key, price, title, pos.outcome);
          }

          logger.debug(`Price updated: ${pos.outcome} @ ${price.toFixed(2)} (${keysToCache.size} keys)`);
          updated++;
        } else {
          logger.debug(`Outcome not found: "${pos.outcome}" in [${market.outcomes.join(", ")}]`);
          failed++;
        }
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      logger.debug(`Error fetching market ${conditionId.slice(0, 10)}...: ${error}`);
      failed += conditionPositions.length;
    }
  }

  logger.info(`Price fetch complete: ${updated} updated, ${failed} failed`);
  return { updated, failed };
}

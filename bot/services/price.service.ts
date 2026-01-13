/**
 * Price cache service - tracks latest market prices from real-time feed
 */

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

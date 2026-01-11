import { getDb, type UserSeenTrade } from "../index";

// Check if user has seen a trade
export async function hasUserSeenTrade(
  userId: number,
  tradeHash: string
): Promise<boolean> {
  const db = await getDb();

  const row = db
    .query("SELECT 1 FROM user_seen_trades WHERE user_id = ? AND trade_hash = ?")
    .get(userId, tradeHash);

  return !!row;
}

// Mark trade as seen for user
export async function markTradeSeen(
  userId: number,
  tradeHash: string,
  walletAddress: string
): Promise<void> {
  const db = await getDb();

  try {
    db.run(
      `INSERT INTO user_seen_trades (user_id, trade_hash, wallet_address)
       VALUES (?, ?, ?)`,
      [userId, tradeHash, walletAddress.toLowerCase()]
    );
  } catch {
    // Ignore duplicate key errors
  }
}

// Log alert sent to user
export async function logAlert(params: {
  userId: number;
  walletAddress: string;
  tradeHash: string;
  marketTitle: string;
  tradeSide: string;
  tradeSize: number;
  tradePrice: number;
  telegramMessageId?: string;
}): Promise<void> {
  const db = await getDb();

  db.run(
    `INSERT INTO alert_history
     (user_id, wallet_address, trade_hash, market_title, trade_side, trade_size, trade_price, telegram_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.walletAddress.toLowerCase(),
      params.tradeHash,
      params.marketTitle,
      params.tradeSide,
      params.tradeSize,
      params.tradePrice,
      params.telegramMessageId || null,
    ]
  );
}

// Count alerts sent to user in last hour (for rate limiting)
export async function countRecentAlerts(userId: number, windowMinutes = 60): Promise<number> {
  const db = await getDb();

  const cutoff = Math.floor(Date.now() / 1000) - windowMinutes * 60;

  const row = db
    .query(
      `SELECT COUNT(*) as count
       FROM alert_history
       WHERE user_id = ? AND sent_at > ?`
    )
    .get(userId, cutoff) as { count: number };

  return row.count;
}

// Check if user is rate limited
export async function isRateLimited(userId: number, maxPerHour: number): Promise<boolean> {
  const count = await countRecentAlerts(userId, 60);
  return count >= maxPerHour;
}

// Clean up old seen trades (older than 7 days)
export async function cleanupOldSeenTrades(daysOld = 7): Promise<number> {
  const db = await getDb();

  const cutoff = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;

  const result = db.run(
    "DELETE FROM user_seen_trades WHERE seen_at < ?",
    [cutoff]
  );

  return result.changes;
}

// Clean up old alert history (older than 30 days)
export async function cleanupOldAlertHistory(daysOld = 30): Promise<number> {
  const db = await getDb();

  const cutoff = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;

  const result = db.run(
    "DELETE FROM alert_history WHERE sent_at < ?",
    [cutoff]
  );

  return result.changes;
}

// Get alert history for user
export async function getAlertHistory(
  userId: number,
  limit = 50
): Promise<
  Array<{
    walletAddress: string;
    marketTitle: string;
    tradeSide: string;
    tradeSize: number;
    tradePrice: number;
    sentAt: number;
  }>
> {
  const db = await getDb();

  const rows = db
    .query(
      `SELECT wallet_address as walletAddress, market_title as marketTitle,
              trade_side as tradeSide, trade_size as tradeSize,
              trade_price as tradePrice, sent_at as sentAt
       FROM alert_history
       WHERE user_id = ?
       ORDER BY sent_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as Array<{
    walletAddress: string;
    marketTitle: string;
    tradeSide: string;
    tradeSize: number;
    tradePrice: number;
    sentAt: number;
  }>;

  return rows;
}

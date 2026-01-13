import { db } from "../db/index";
import { config } from "../config";

/**
 * Check if a Telegram user is an admin
 */
export function isAdmin(telegramId: string): boolean {
  return config.ADMIN_TELEGRAM_IDS.includes(telegramId);
}

/**
 * Get overall system stats
 */
export function getSystemStats(): {
  users: { total: number; active: number; banned: number };
  tiers: { free: number; pro: number; enterprise: number };
  wallets: { total: number; unique: number };
  alerts: { today: number; total: number };
  copyTrades: { total: number; executed: number; failed: number };
} {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  // User stats
  const userStats = db().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) as banned
    FROM users
  `).get() as { total: number; active: number; banned: number };

  // Tier breakdown
  const tierStats = db().prepare(`
    SELECT subscription_tier, COUNT(*) as count
    FROM users
    GROUP BY subscription_tier
  `).all() as { subscription_tier: string; count: number }[];

  const tiers = { free: 0, pro: 0, enterprise: 0 };
  for (const row of tierStats) {
    if (row.subscription_tier in tiers) {
      tiers[row.subscription_tier as keyof typeof tiers] = row.count;
    }
  }

  // Wallet stats
  const walletStats = db().prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT wallet_address) as unique_wallets
    FROM user_wallets
  `).get() as { total: number; unique_wallets: number };

  // Alert stats
  const alertStats = db().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN sent_at >= ? THEN 1 ELSE 0 END) as today
    FROM alert_history
  `).get(todayStart) as { total: number; today: number };

  // Copy trade stats
  const copyStats = db().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM copy_trade_history
  `).get() as { total: number; executed: number; failed: number };

  return {
    users: userStats,
    tiers,
    wallets: { total: walletStats.total, unique: walletStats.unique_wallets },
    alerts: { today: alertStats.today || 0, total: alertStats.total },
    copyTrades: copyStats,
  };
}

/**
 * List users with pagination
 */
export function listUsers(limit = 20, offset = 0): {
  users: Array<{
    id: number;
    telegramId: string;
    telegramUsername: string | null;
    tier: string;
    walletCount: number;
    alertsToday: number;
    isActive: boolean;
    isBanned: boolean;
    createdAt: number;
  }>;
  total: number;
} {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const users = db().prepare(`
    SELECT
      u.id,
      u.telegram_id as telegramId,
      u.telegram_username as telegramUsername,
      u.subscription_tier as tier,
      u.is_active as isActive,
      u.is_banned as isBanned,
      u.created_at as createdAt,
      (SELECT COUNT(*) FROM user_wallets WHERE user_id = u.id) as walletCount,
      (SELECT COUNT(*) FROM alert_history WHERE user_id = u.id AND sent_at >= ?) as alertsToday
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(todayStart, limit, offset) as Array<{
    id: number;
    telegramId: string;
    telegramUsername: string | null;
    tier: string;
    walletCount: number;
    alertsToday: number;
    isActive: number;
    isBanned: number;
    createdAt: number;
  }>;

  const countResult = db().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };

  return {
    users: users.map(u => ({
      ...u,
      isActive: u.isActive === 1,
      isBanned: u.isBanned === 1,
    })),
    total: countResult.count,
  };
}

/**
 * Ban a user
 */
export function banUser(userId: number): boolean {
  const result = db().prepare("UPDATE users SET is_banned = 1 WHERE id = ?").run(userId);
  return result.changes > 0;
}

/**
 * Unban a user
 */
export function unbanUser(userId: number): boolean {
  const result = db().prepare("UPDATE users SET is_banned = 0 WHERE id = ?").run(userId);
  return result.changes > 0;
}

/**
 * Get user details by ID
 */
export function getUserById(userId: number): {
  id: number;
  telegramId: string;
  telegramUsername: string | null;
  tier: string;
  stripeCustomerId: string | null;
  walletCount: number;
  alertsToday: number;
  totalAlerts: number;
  isActive: boolean;
  isBanned: boolean;
  createdAt: number;
  lastActiveAt: number | null;
} | null {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const user = db().prepare(`
    SELECT
      u.id,
      u.telegram_id as telegramId,
      u.telegram_username as telegramUsername,
      u.subscription_tier as tier,
      u.stripe_customer_id as stripeCustomerId,
      u.is_active as isActive,
      u.is_banned as isBanned,
      u.created_at as createdAt,
      u.last_active_at as lastActiveAt,
      (SELECT COUNT(*) FROM user_wallets WHERE user_id = u.id) as walletCount,
      (SELECT COUNT(*) FROM alert_history WHERE user_id = u.id AND sent_at >= ?) as alertsToday,
      (SELECT COUNT(*) FROM alert_history WHERE user_id = u.id) as totalAlerts
    FROM users u
    WHERE u.id = ?
  `).get(todayStart, userId) as {
    id: number;
    telegramId: string;
    telegramUsername: string | null;
    tier: string;
    stripeCustomerId: string | null;
    walletCount: number;
    alertsToday: number;
    totalAlerts: number;
    isActive: number;
    isBanned: number;
    createdAt: number;
    lastActiveAt: number | null;
  } | null;

  if (!user) return null;

  return {
    ...user,
    isActive: user.isActive === 1,
    isBanned: user.isBanned === 1,
  };
}

/**
 * Search users by telegram username
 */
export function searchUsers(query: string): Array<{
  id: number;
  telegramId: string;
  telegramUsername: string | null;
  tier: string;
}> {
  return db().prepare(`
    SELECT id, telegram_id as telegramId, telegram_username as telegramUsername, subscription_tier as tier
    FROM users
    WHERE telegram_username LIKE ? OR telegram_id LIKE ?
    LIMIT 10
  `).all(`%${query}%`, `%${query}%`) as Array<{
    id: number;
    telegramId: string;
    telegramUsername: string | null;
    tier: string;
  }>;
}

/**
 * Set user's subscription tier (admin override)
 */
export function setUserTier(userId: number, tier: "free" | "pro" | "enterprise"): boolean {
  const result = db().prepare(`
    UPDATE users SET subscription_tier = ?, subscription_expires_at = NULL
    WHERE id = ?
  `).run(tier, userId);
  return result.changes > 0;
}

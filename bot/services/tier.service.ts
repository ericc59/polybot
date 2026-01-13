import { db } from "../db/index";
import { countUserWallets } from "../db/repositories/wallet.repo";
import type { SubscriptionTier } from "./stripe.service";

export interface TierLimits {
  maxWallets: number;
  maxAlertsPerDay: number;
  canUseCopyTrading: boolean;
}

const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    maxWallets: 5,
    maxAlertsPerDay: 100,
    canUseCopyTrading: false,
  },
  pro: {
    maxWallets: 50,
    maxAlertsPerDay: 1000,
    canUseCopyTrading: true,
  },
  enterprise: {
    maxWallets: 500,
    maxAlertsPerDay: 10000,
    canUseCopyTrading: true,
  },
};

/**
 * Get user's subscription tier
 */
export function getUserTier(userId: number): SubscriptionTier {
  const stmt = db().prepare(`
    SELECT subscription_tier, subscription_expires_at
    FROM users WHERE id = ?
  `);
  const user = stmt.get(userId) as {
    subscription_tier: string;
    subscription_expires_at: number | null;
  } | null;

  if (!user) return "free";

  // Check if subscription has expired
  if (user.subscription_expires_at) {
    const now = Math.floor(Date.now() / 1000);
    if (now > user.subscription_expires_at) {
      // Subscription expired, downgrade to free
      const updateStmt = db().prepare(`
        UPDATE users SET subscription_tier = 'free', subscription_expires_at = NULL
        WHERE id = ?
      `);
      updateStmt.run(userId);
      return "free";
    }
  }

  return (user.subscription_tier as SubscriptionTier) || "free";
}

/**
 * Get limits for a user's tier
 */
export function getTierLimits(userId: number): TierLimits {
  const tier = getUserTier(userId);
  return TIER_LIMITS[tier];
}

/**
 * Check if user can add more wallets
 */
export async function canAddWallet(userId: number): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  tier: SubscriptionTier;
}> {
  const tier = getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const current = await countUserWallets(userId);

  return {
    allowed: current < limits.maxWallets,
    current,
    limit: limits.maxWallets,
    tier,
  };
}

/**
 * Get today's alert count for user
 */
export function getTodayAlertCount(userId: number): number {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const stmt = db().prepare(`
    SELECT COUNT(*) as count FROM alert_history
    WHERE user_id = ? AND sent_at >= ?
  `);
  const result = stmt.get(userId, todayStart) as { count: number };

  return result.count;
}

/**
 * Check if user can receive more alerts today
 */
export function canSendAlert(userId: number): {
  allowed: boolean;
  current: number;
  limit: number;
  tier: SubscriptionTier;
} {
  const tier = getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const current = getTodayAlertCount(userId);

  return {
    allowed: current < limits.maxAlertsPerDay,
    current,
    limit: limits.maxAlertsPerDay,
    tier,
  };
}

/**
 * Check if user can use copy trading
 */
export function canUseCopyTrading(userId: number): {
  allowed: boolean;
  tier: SubscriptionTier;
  requiredTier: SubscriptionTier;
} {
  const tier = getUserTier(userId);
  const limits = TIER_LIMITS[tier];

  return {
    allowed: limits.canUseCopyTrading,
    tier,
    requiredTier: "pro",
  };
}

/**
 * Get user's usage summary
 */
export async function getUsageSummary(userId: number): Promise<{
  tier: SubscriptionTier;
  wallets: { current: number; limit: number };
  alertsToday: { current: number; limit: number };
  copyTrading: boolean;
}> {
  const tier = getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const walletCount = await countUserWallets(userId);
  const alertCount = getTodayAlertCount(userId);

  return {
    tier,
    wallets: { current: walletCount, limit: limits.maxWallets },
    alertsToday: { current: alertCount, limit: limits.maxAlertsPerDay },
    copyTrading: limits.canUseCopyTrading,
  };
}

/**
 * Format tier limits for display
 */
export function formatTierInfo(tier: SubscriptionTier): string {
  const limits = TIER_LIMITS[tier];
  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

  return `${tierName} Plan:
• ${limits.maxWallets} wallets
• ${limits.maxAlertsPerDay.toLocaleString()} alerts/day
• Copy trading: ${limits.canUseCopyTrading ? "Yes" : "No"}`;
}

import Stripe from "stripe";
import { config } from "../config";
import { db } from "../db/index";
import { logger } from "../utils/logger";

// Initialize Stripe client
const stripe = new Stripe(config.STRIPE_SECRET_KEY);

export type SubscriptionTier = "free" | "pro" | "enterprise";

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  expiresAt: number | null;
  customerId: string | null;
  subscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Create or get Stripe customer for a user
 */
export async function getOrCreateCustomer(
  userId: number,
  telegramUsername: string | null
): Promise<string> {
  // Check if user already has a customer ID
  const stmt = db().prepare("SELECT stripe_customer_id FROM users WHERE id = ?");
  const user = stmt.get(userId) as { stripe_customer_id: string | null } | null;

  if (user?.stripe_customer_id) {
    return user.stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    metadata: {
      userId: userId.toString(),
      telegramUsername: telegramUsername || "",
    },
  });

  // Save customer ID to database
  const updateStmt = db().prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?");
  updateStmt.run(customer.id, userId);

  logger.info(`Created Stripe customer ${customer.id} for user ${userId}`);
  return customer.id;
}

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession(
  userId: number,
  telegramUsername: string | null,
  tier: "pro" | "enterprise",
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const customerId = await getOrCreateCustomer(userId, telegramUsername);

  const priceId = tier === "pro"
    ? config.STRIPE_PRO_PRICE_ID
    : config.STRIPE_ENTERPRISE_PRICE_ID;

  if (!priceId) {
    throw new Error(`No price ID configured for ${tier} tier`);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId: userId.toString(),
      tier,
    },
  });

  logger.info(`Created checkout session ${session.id} for user ${userId}`);
  return session.url || "";
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createBillingPortalSession(
  userId: number,
  returnUrl: string
): Promise<string> {
  const stmt = db().prepare("SELECT stripe_customer_id FROM users WHERE id = ?");
  const user = stmt.get(userId) as { stripe_customer_id: string | null } | null;

  if (!user?.stripe_customer_id) {
    throw new Error("No Stripe customer found for user");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Get user's subscription info
 */
export async function getSubscriptionInfo(userId: number): Promise<SubscriptionInfo> {
  const stmt = db().prepare(`
    SELECT stripe_customer_id, subscription_tier, subscription_expires_at
    FROM users WHERE id = ?
  `);
  const user = stmt.get(userId) as {
    stripe_customer_id: string | null;
    subscription_tier: string;
    subscription_expires_at: number | null;
  } | null;

  if (!user) {
    return {
      tier: "free",
      expiresAt: null,
      customerId: null,
      subscriptionId: null,
      cancelAtPeriodEnd: false,
    };
  }

  let subscriptionId: string | null = null;
  let cancelAtPeriodEnd = false;

  // Fetch active subscription from Stripe if customer exists
  if (user.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "active",
        limit: 1,
      });

      const sub = subscriptions.data[0];
      if (sub) {
        subscriptionId = sub.id;
        cancelAtPeriodEnd = sub.cancel_at_period_end;
      }
    } catch (error) {
      logger.error("Failed to fetch Stripe subscription", error);
    }
  }

  return {
    tier: user.subscription_tier as SubscriptionTier,
    expiresAt: user.subscription_expires_at,
    customerId: user.stripe_customer_id,
    subscriptionId,
    cancelAtPeriodEnd,
  };
}

/**
 * Update user's subscription tier (called from webhook)
 */
export function updateUserSubscription(
  customerId: string,
  tier: SubscriptionTier,
  expiresAt: number | null
): boolean {
  try {
    const stmt = db().prepare(`
      UPDATE users
      SET subscription_tier = ?, subscription_expires_at = ?
      WHERE stripe_customer_id = ?
    `);
    stmt.run(tier, expiresAt, customerId);
    logger.info(`Updated subscription for customer ${customerId} to ${tier}`);
    return true;
  } catch (error) {
    logger.error("Failed to update subscription", error);
    return false;
  }
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(userId: number): Promise<boolean> {
  const info = await getSubscriptionInfo(userId);

  if (!info.subscriptionId) {
    return false;
  }

  try {
    await stripe.subscriptions.update(info.subscriptionId, {
      cancel_at_period_end: true,
    });
    logger.info(`Scheduled subscription cancellation for user ${userId}`);
    return true;
  } catch (error) {
    logger.error("Failed to cancel subscription", error);
    return false;
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhookEvent(
  payload: string,
  signature: string
): Promise<{ success: boolean; event?: string }> {
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      config.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: any) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    return { success: false };
  }

  logger.info(`Processing Stripe webhook: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tier = session.metadata?.tier as SubscriptionTier;
      const customerId = session.customer as string;

      if (tier && customerId) {
        // Get subscription end date
        const subscriptionId = session.subscription as string;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data'],
        });
        // In Stripe SDK v20+, current_period_end is on subscription items
        const expiresAt = subscription.items.data[0]?.current_period_end ?? null;

        updateUserSubscription(customerId, tier, expiresAt);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Determine tier from price ID
      const subscriptionItem = subscription.items.data[0];
      const priceId = subscriptionItem?.price.id;
      let tier: SubscriptionTier = "free";

      if (priceId === config.STRIPE_PRO_PRICE_ID) {
        tier = "pro";
      } else if (priceId === config.STRIPE_ENTERPRISE_PRICE_ID) {
        tier = "enterprise";
      }

      // In Stripe SDK v20+, current_period_end is on subscription items
      const expiresAt = subscriptionItem?.current_period_end ?? null;
      updateUserSubscription(customerId, tier, expiresAt);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Downgrade to free tier
      updateUserSubscription(customerId, "free", null);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      logger.warn(`Payment failed for customer ${customerId}`);
      // Could send notification to user here
      break;
    }
  }

  return { success: true, event: event.type };
}

/**
 * Get pricing info for display
 */
export function getPricingInfo(): { pro: number; enterprise: number } {
  return {
    pro: 9.99,
    enterprise: 49.99,
  };
}

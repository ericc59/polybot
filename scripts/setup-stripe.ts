#!/usr/bin/env bun
/**
 * Setup Stripe products and prices for PolySpy
 *
 * Usage: bun scripts/setup-stripe.ts
 *
 * Requires STRIPE_SECRET_KEY in .env file
 */

import Stripe from "stripe";
import { config } from "../bot/config";

const STRIPE_SECRET_KEY = config.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("Error: STRIPE_SECRET_KEY not found in .env file");
  console.log("\nAdd this to your .env file:");
  console.log("STRIPE_SECRET_KEY=sk_test_...");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

interface PlanConfig {
  name: string;
  description: string;
  priceMonthly: number; // in cents
  features: string[];
}

const plans: Record<string, PlanConfig> = {
  pro: {
    name: "PolySpy Pro",
    description: "Track up to 50 wallets with copy trading",
    priceMonthly: 999, // $9.99
    features: [
      "Track up to 50 wallets",
      "1,000 alerts per day",
      "Copy trading (recommend mode)",
      "Category breakdown analytics",
      "Priority support",
    ],
  },
  enterprise: {
    name: "PolySpy Enterprise",
    description: "Unlimited tracking with auto-execute copy trading",
    priceMonthly: 4999, // $49.99
    features: [
      "Track up to 500 wallets",
      "10,000 alerts per day",
      "Auto-execute copy trading",
      "Advanced analytics",
      "API access",
      "Dedicated support",
    ],
  },
};

async function createProductWithPrice(
  key: string,
  config: PlanConfig
): Promise<{ productId: string; priceId: string }> {
  console.log(`\nCreating ${config.name}...`);

  // Check if product already exists
  const existingProducts = await stripe.products.search({
    query: `name:"${config.name}"`,
  });

  let product: Stripe.Product;
  const existingProduct = existingProducts.data[0];

  if (existingProduct) {
    product = existingProduct;
    console.log(`  Product already exists: ${product.id}`);
  } else {
    product = await stripe.products.create({
      name: config.name,
      description: config.description,
      metadata: {
        tier: key,
        features: JSON.stringify(config.features),
      },
    });
    console.log(`  Created product: ${product.id}`);
  }

  // Check if price already exists for this product
  const existingPrices = await stripe.prices.list({
    product: product.id,
    active: true,
    type: "recurring",
  });

  const matchingPrice = existingPrices.data.find(
    (p) =>
      p.unit_amount === config.priceMonthly &&
      p.recurring?.interval === "month"
  );

  if (matchingPrice) {
    console.log(`  Price already exists: ${matchingPrice.id}`);
    return { productId: product.id, priceId: matchingPrice.id };
  }

  // Create new price
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: config.priceMonthly,
    currency: "usd",
    recurring: {
      interval: "month",
    },
    metadata: {
      tier: key,
    },
  });

  console.log(`  Created price: ${price.id} ($${config.priceMonthly / 100}/month)`);

  return { productId: product.id, priceId: price.id };
}

async function main() {
  console.log("=".repeat(50));
  console.log("  PolySpy - Stripe Setup");
  console.log("=".repeat(50));

  const results: Record<string, { productId: string; priceId: string }> = {};

  for (const [key, config] of Object.entries(plans)) {
    results[key] = await createProductWithPrice(key, config);
  }

  console.log("\n" + "=".repeat(50));
  console.log("  Setup Complete!");
  console.log("=".repeat(50));

  console.log("\nAdd these to your .env file:\n");
  console.log(`STRIPE_PRO_PRICE_ID=${results.pro!.priceId}`);
  console.log(`STRIPE_ENTERPRISE_PRICE_ID=${results.enterprise!.priceId}`);

  console.log("\n" + "-".repeat(50));
  console.log("Webhook Setup");
  console.log("-".repeat(50));
  console.log("\n1. Go to: https://dashboard.stripe.com/webhooks");
  console.log("2. Click 'Add endpoint'");
  console.log("3. Enter your webhook URL: https://your-domain.com/stripe/webhook");
  console.log("4. Select these events:");
  console.log("   - checkout.session.completed");
  console.log("   - customer.subscription.updated");
  console.log("   - customer.subscription.deleted");
  console.log("   - invoice.payment_failed");
  console.log("5. Copy the signing secret and add to .env:");
  console.log("   STRIPE_WEBHOOK_SECRET=whsec_...");
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});

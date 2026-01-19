import type { ClobClient } from "@polymarket/clob-client";
import { Side, OrderType } from "@polymarket/clob-client";
import type { OrderParams, MarketOrderParams, TradeResult } from "./types";

/**
 * Place a limit order
 */
export async function placeLimitOrder(
  client: ClobClient,
  params: OrderParams
): Promise<TradeResult> {
  try {
    const userOrder = {
      tokenID: params.tokenId,
      side: params.side === "BUY" ? Side.BUY : Side.SELL,
      size: params.size,
      price: params.price,
    };

    const result = await client.createAndPostOrder(userOrder, undefined, OrderType.GTC);

    return {
      success: true,
      orderId: result.orderID || result.id,
    };
  } catch (error: any) {
    console.error("Failed to place limit order", error);
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

/**
 * Place a market order (FOK - Fill or Kill)
 */
export async function placeMarketOrder(
  client: ClobClient,
  params: MarketOrderParams
): Promise<TradeResult> {
  try {
    // Get current market price before placing order
    let fillPrice: number | undefined;
    try {
      const priceResult = await client.getPrice(params.tokenId, params.side);
      fillPrice = parseFloat(priceResult.price || "0");
    } catch {
      // Price fetch failed, continue without it
    }

    const userMarketOrder = {
      tokenID: params.tokenId,
      side: params.side === "BUY" ? Side.BUY : Side.SELL,
      amount: params.amount,
    };

    const result = await client.createAndPostMarketOrder(userMarketOrder, undefined, OrderType.FOK);

    // Verify the order actually filled
    const resultAny = result as any;
    const rawStatus = resultAny.status;
    const status = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : String(rawStatus || '');
    const hasTransaction = !!(
      result.transactionHash || resultAny.transactionsHashes?.length
    );

    if (status === "FAILED" || status === "CANCELLED" || status === "REJECTED") {
      return {
        success: false,
        error: `Order ${status.toLowerCase()}`,
      };
    }

    // Extract actual fill amount from response
    // The CLOB returns: size (shares), matchedAmount, or originalAmount
    let fillAmount = params.amount; // Default to requested amount

    // Try to get actual filled amount from response
    if (resultAny.matchedAmount !== undefined) {
      fillAmount = parseFloat(resultAny.matchedAmount);
    } else if (resultAny.size !== undefined && fillPrice) {
      // If we have shares filled and price, calculate USDC amount
      const sharesFilled = parseFloat(resultAny.size);
      fillAmount = params.side === "BUY" ? sharesFilled * fillPrice : sharesFilled;
    }

    return {
      success: true,
      orderId: result.orderID || result.id,
      txHash: result.transactionHash || (result as any).transactionsHashes?.[0],
      fillPrice,
      fillAmount,
    };
  } catch (error: any) {
    const errorMsg = error.message || "Unknown error";

    if (errorMsg === "no match" || errorMsg.includes("no match")) {
      return {
        success: false,
        error: "No liquidity - no sellers available",
      };
    }

    console.error("Failed to place market order", error);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Cancel an order
 */
export async function cancelOrder(client: ClobClient, orderId: string): Promise<boolean> {
  try {
    await client.cancelOrder({ orderID: orderId });
    return true;
  } catch (error) {
    console.error(`Failed to cancel order ${orderId}`, error);
    return false;
  }
}

/**
 * Cancel all open orders
 */
export async function cancelAllOrders(client: ClobClient): Promise<boolean> {
  try {
    await client.cancelAll();
    return true;
  } catch (error) {
    console.error("Failed to cancel all orders", error);
    return false;
  }
}

/**
 * Get open orders
 */
export async function getOpenOrders(client: ClobClient): Promise<any[]> {
  try {
    const result = await client.getOpenOrders();
    return result || [];
  } catch (error) {
    console.error("Failed to get open orders", error);
    return [];
  }
}

/**
 * Get market price for a token
 */
export async function getMarketPrice(
  client: ClobClient,
  tokenId: string,
  side: "BUY" | "SELL"
): Promise<number | null> {
  try {
    const result = await client.getPrice(tokenId, side);
    return parseFloat(result.price || "0");
  } catch (error) {
    console.error(`Failed to get market price for ${tokenId}`, error);
    return null;
  }
}

/**
 * Calculate the price for a market order of given size
 */
export async function calculateMarketPrice(
  client: ClobClient,
  tokenId: string,
  side: "BUY" | "SELL",
  amount: number
): Promise<number | null> {
  try {
    const sideEnum = side === "BUY" ? Side.BUY : Side.SELL;
    const price = await client.calculateMarketPrice(tokenId, sideEnum, amount);
    return price;
  } catch (error) {
    console.error("Failed to calculate market price", error);
    return null;
  }
}

/**
 * Order book level
 */
export interface OrderBookLevel {
  price: number;
  size: number;
  total: number; // cumulative USD cost
}

/**
 * Order book summary
 */
export interface OrderBookSummary {
  asks: OrderBookLevel[]; // Sorted by price ascending (cheapest first)
  bids: OrderBookLevel[];
  totalAsksUnderPrice: (maxPrice: number) => { shares: number; cost: number };
}

/**
 * Fetch order book for a token
 */
export async function getOrderBook(
  client: ClobClient,
  tokenId: string
): Promise<OrderBookSummary | null> {
  try {
    const book = await client.getOrderBook(tokenId);

    // Parse asks (sell orders) - sorted by price ascending
    const asks: OrderBookLevel[] = (book.asks || [])
      .map((level: any) => ({
        price: parseFloat(level.price),
        size: parseFloat(level.size),
        total: parseFloat(level.price) * parseFloat(level.size),
      }))
      .sort((a: OrderBookLevel, b: OrderBookLevel) => a.price - b.price);

    // Parse bids (buy orders) - sorted by price descending
    const bids: OrderBookLevel[] = (book.bids || [])
      .map((level: any) => ({
        price: parseFloat(level.price),
        size: parseFloat(level.size),
        total: parseFloat(level.price) * parseFloat(level.size),
      }))
      .sort((a: OrderBookLevel, b: OrderBookLevel) => b.price - a.price);

    return {
      asks,
      bids,
      totalAsksUnderPrice: (maxPrice: number) => {
        let shares = 0;
        let cost = 0;
        for (const level of asks) {
          if (level.price <= maxPrice) {
            shares += level.size;
            cost += level.total;
          }
        }
        return { shares, cost };
      },
    };
  } catch (error) {
    console.error(`Failed to get order book for ${tokenId}`, error);
    return null;
  }
}

/**
 * Place an aggressive limit order to sweep the book up to a max price
 * This is better than market orders because it caps your max price
 */
export async function placeSweepOrder(
  client: ClobClient,
  params: {
    tokenId: string;
    maxPrice: number;
    maxSpend: number;
  }
): Promise<TradeResult & { sharesBought?: number; avgPrice?: number }> {
  try {
    // Get the order book first
    const book = await getOrderBook(client, params.tokenId);
    if (!book) {
      return { success: false, error: "Failed to fetch order book" };
    }

    // Calculate how many shares we can buy under maxPrice with maxSpend
    const available = book.totalAsksUnderPrice(params.maxPrice);

    if (available.shares === 0) {
      return { success: false, error: "No shares available under max price" };
    }

    // Determine how many shares to buy (limited by maxSpend)
    let sharesToBuy = available.shares;
    let estimatedCost = available.cost;

    if (estimatedCost > params.maxSpend) {
      // Scale down to fit budget - buy proportionally less
      const ratio = params.maxSpend / estimatedCost;
      sharesToBuy = Math.floor(available.shares * ratio);
      estimatedCost = sharesToBuy * (available.cost / available.shares); // Recalculate actual cost
    }

    if (sharesToBuy < 1) {
      return { success: false, error: "Insufficient budget for minimum order" };
    }

    // Polymarket minimum order is $1
    if (estimatedCost < 1) {
      return { success: false, error: `Order too small ($${estimatedCost.toFixed(2)}), min is $1` };
    }

    // Place a limit order at maxPrice - this will sweep all asks up to that price
    const userOrder = {
      tokenID: params.tokenId,
      side: Side.BUY,
      size: sharesToBuy,
      price: params.maxPrice,
    };

    // Use GTC (Good Till Cancelled) - it will fill what it can immediately
    const result = await client.createAndPostOrder(userOrder, undefined, OrderType.GTC);

    const resultAny = result as any;
    const filledSize = parseFloat(resultAny.size || resultAny.matchedSize || "0") || sharesToBuy;
    const avgPrice = estimatedCost / sharesToBuy;

    return {
      success: true,
      orderId: result.orderID || result.id,
      txHash: result.transactionHash || resultAny.transactionsHashes?.[0],
      sharesBought: filledSize,
      avgPrice,
    };
  } catch (error: any) {
    console.error("Failed to place sweep order", error);
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

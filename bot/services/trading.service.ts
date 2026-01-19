// Re-export core trading functions from shared library
export {
	createClobClient,
	deriveApiKey,
	isValidPrivateKey,
	getAddressFromPrivateKey,
	POLYGON_RPC,
	CLOB_HOST,
	CHAIN_ID,
} from "../../lib/trading/client";

export {
	getBalance,
	fetchProxyBalance,
} from "../../lib/trading/balance";

export {
	placeLimitOrder,
	placeMarketOrder,
	cancelOrder,
	cancelAllOrders,
	getOpenOrders,
	getMarketPrice,
	calculateMarketPrice,
} from "../../lib/trading/orders";

export type {
	TradingWallet,
	TradeResult,
	OrderParams,
	MarketOrderParams,
} from "../../lib/trading/types";

import type { ClobClient } from "@polymarket/clob-client";
import { placeMarketOrder as libPlaceMarketOrder } from "../../lib/trading/orders";
import { logger } from "../utils/logger";

/**
 * Fetch positions from Polymarket REST API
 * The CLOB client doesn't have a getPositions method, so we use the data API
 */
interface PositionApiResponse {
  asset: string;
  conditionId: string;
  size: string;
  avgPrice: string;
  curPrice: string;
  title: string;
  outcome: string;
  endDate?: string;
}

async function fetchPositionsFromApi(walletAddress: string): Promise<PositionApiResponse[]> {
  try {
    const url = `https://data-api.polymarket.com/positions?user=${walletAddress.toLowerCase()}`;
    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as PositionApiResponse[];
  } catch (error) {
    logger.error("Failed to fetch positions from API", error);
    return [];
  }
}

/**
 * Get user's position for a specific token
 */
export async function getPosition(
  client: ClobClient,
  tokenId: string
): Promise<{ size: number; avgPrice: number } | null> {
  try {
    // Get wallet address from client signer
    const walletAddress = client.signer ? await (client.signer as any).getAddress() : null;
    if (!walletAddress) {
      return null;
    }

    const positions = await fetchPositionsFromApi(walletAddress);
    const position = positions?.find((p) => p.asset === tokenId);

    if (!position || parseFloat(position.size || "0") <= 0) {
      return null;
    }

    return {
      size: parseFloat(position.size || "0"),
      avgPrice: parseFloat(position.avgPrice || "0"),
    };
  } catch (error) {
    logger.error(`Failed to get position for token ${tokenId}`, error);
    return null;
  }
}

/**
 * Get all user positions
 */
export async function getAllPositions(client: ClobClient, proxyAddress?: string): Promise<Array<{
  tokenId: string;
  conditionId?: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  marketTitle?: string;
  outcome?: string;
  endDate?: string;
}>> {
  try {
    // Use proxy address if provided, otherwise get from signer
    let walletAddress = proxyAddress;
    if (!walletAddress) {
      walletAddress = client.signer ? await (client.signer as any).getAddress() : null;
    }
    if (!walletAddress) {
      return [];
    }

    const positions = await fetchPositionsFromApi(walletAddress);
    return (positions || [])
      .filter((p) => parseFloat(p.size || "0") > 0)
      .map((p) => ({
        tokenId: p.asset,
        conditionId: p.conditionId,
        size: parseFloat(p.size || "0"),
        avgPrice: parseFloat(p.avgPrice || "0"),
        curPrice: parseFloat(p.curPrice || "0"),
        marketTitle: p.title,
        outcome: p.outcome,
        endDate: p.endDate,
      }));
  } catch (error) {
    logger.error("Failed to get positions", error);
    return [];
  }
}

/**
 * Check market resolution status from CLOB API
 */
export async function getMarketResolution(conditionId: string): Promise<{
  resolved: boolean;
  winningOutcome: string | null;
} | null> {
  try {
    const url = `https://clob.polymarket.com/markets/${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      condition_id: string;
      tokens: Array<{ outcome: string; winner: boolean }>;
      archived?: boolean;
    };

    // Find the winning outcome - Polymarket marks winner BEFORE archiving
				const winner = data.tokens?.find((t) => t.winner === true);

				// Market is resolved if archived OR if any token is marked as winner
				const isResolved = data.archived === true || !!winner;

    if (!isResolved) {
      return { resolved: false, winningOutcome: null };
    }

    return {
      resolved: true,
      winningOutcome: winner?.outcome || null,
    };
  } catch (error) {
    logger.debug(`Failed to check resolution for ${conditionId}`);
    return null;
  }
}

/**
 * Redeem a resolved position
 * For winning positions, we sell at $1 (or redeem directly)
 * For losing positions, they're worth $0
 */
export async function redeemPosition(
  client: ClobClient,
  tokenId: string,
  size: number,
  isWinner: boolean
): Promise<TradeResult> {
  if (!isWinner) {
    // Losing positions are worth $0, nothing to redeem
    return { success: true, orderId: "LOSER_NO_VALUE" };
  }

  try {
    // For winning positions, sell at market price (should be ~$1)
				// Or use redeem function if available
				const result = await libPlaceMarketOrder(client, {
					tokenId,
					side: "SELL",
					amount: size, // Sell all shares
				});

    return result;
  } catch (error: any) {
    logger.error(`Failed to redeem position ${tokenId}`, error);
    return {
      success: false,
      error: error.message || "Redemption failed",
    };
  }
}

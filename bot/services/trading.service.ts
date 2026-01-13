import { ClobClient } from "@polymarket/clob-client";
import { Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { decryptCredentials } from "../utils/crypto";
import { logger } from "../utils/logger";
import { config } from "../config";

// Polygon RPC endpoint
const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

export interface TradingWallet {
  address: string;
  encryptedCredentials: string;
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  txHash?: string;
  error?: string;
}

export interface OrderParams {
  tokenId: string;
  side: "BUY" | "SELL";
  size: number; // In shares
  price: number; // 0-1 probability price
}

export interface MarketOrderParams {
  tokenId: string;
  side: "BUY" | "SELL";
  amount: number; // USD amount for BUY, shares for SELL
}

/**
 * Create a CLOB client for a user's trading wallet
 */
export async function createClobClient(
  privateKey: string,
  credentials: { apiKey: string; apiSecret: string; passphrase: string }
): Promise<ClobClient> {
  const provider = new JsonRpcProvider(POLYGON_RPC);
  const wallet = new Wallet(privateKey, provider);

  const creds = {
    key: credentials.apiKey,
    secret: credentials.apiSecret,
    passphrase: credentials.passphrase,
  };

  return new ClobClient(CLOB_HOST, CHAIN_ID, wallet, creds);
}

/**
 * Get user's USDC balance and allowance
 */
export async function getBalance(client: ClobClient): Promise<{ balance: number; allowance: number }> {
  try {
    const result = await client.getBalanceAllowance();
    return {
      balance: parseFloat(result.balance || "0"),
      allowance: parseFloat(result.allowance || "0"),
    };
  } catch (error) {
    logger.error("Failed to get balance", error);
    return { balance: 0, allowance: 0 };
  }
}

/**
 * Place a limit order
 */
export async function placeLimitOrder(client: ClobClient, params: OrderParams): Promise<TradeResult> {
  try {
    const userOrder = {
      tokenID: params.tokenId,
      side: params.side === "BUY" ? Side.BUY : Side.SELL,
      size: params.size,
      price: params.price,
    };

    const result = await client.createAndPostOrder(userOrder, undefined, OrderType.GTC);

    logger.info(`Order placed: ${JSON.stringify(result)}`);

    return {
      success: true,
      orderId: result.orderID || result.id,
    };
  } catch (error: any) {
    logger.error("Failed to place limit order", error);
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

/**
 * Place a market order (FOK - Fill or Kill)
 */
export async function placeMarketOrder(client: ClobClient, params: MarketOrderParams): Promise<TradeResult> {
  try {
    const userMarketOrder = {
      tokenID: params.tokenId,
      side: params.side === "BUY" ? Side.BUY : Side.SELL,
      amount: params.amount,
    };

    const result = await client.createAndPostMarketOrder(userMarketOrder, undefined, OrderType.FOK);

    logger.info(`Market order placed: ${JSON.stringify(result)}`);

    return {
      success: true,
      orderId: result.orderID || result.id,
      txHash: result.transactionHash,
    };
  } catch (error: any) {
    logger.error("Failed to place market order", error);
    return {
      success: false,
      error: error.message || "Unknown error",
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
    logger.error(`Failed to cancel order ${orderId}`, error);
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
    logger.error("Failed to cancel all orders", error);
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
    logger.error("Failed to get open orders", error);
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
    logger.error(`Failed to get market price for ${tokenId}`, error);
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
    logger.error(`Failed to calculate market price`, error);
    return null;
  }
}

/**
 * Derive API key for a new wallet (first-time setup)
 */
export async function deriveApiKey(
  privateKey: string
): Promise<{ apiKey: string; apiSecret: string; passphrase: string } | null> {
  try {
    const provider = new JsonRpcProvider(POLYGON_RPC);
    const wallet = new Wallet(privateKey, provider);

    // Create client without creds to derive them
    const client = new ClobClient(CLOB_HOST, CHAIN_ID, wallet);
    const creds = await client.deriveApiKey();

    return {
      apiKey: creds.key,
      apiSecret: creds.secret,
      passphrase: creds.passphrase,
    };
  } catch (error) {
    logger.error("Failed to derive API key", error);
    return null;
  }
}

/**
 * Validate a private key
 */
export function isValidPrivateKey(key: string): boolean {
  try {
    // Remove 0x prefix if present
    const cleanKey = key.startsWith("0x") ? key.slice(2) : key;
    // Check if it's a valid 64-character hex string
    if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
      return false;
    }
    // Try to create a wallet from it
    new Wallet(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get wallet address from private key
 */
export function getAddressFromPrivateKey(privateKey: string): string {
  const wallet = new Wallet(privateKey);
  return wallet.address;
}

/**
 * Get user's position for a specific token
 */
export async function getPosition(
  client: ClobClient,
  tokenId: string
): Promise<{ size: number; avgPrice: number } | null> {
  try {
    // Get all positions and find the one for this token
    const positions = await client.getPositions();
    const position = positions?.find((p: any) => p.asset === tokenId || p.tokenId === tokenId);

    if (!position || parseFloat(position.size || "0") <= 0) {
      return null;
    }

    return {
      size: parseFloat(position.size || "0"),
      avgPrice: parseFloat(position.avgPrice || position.average_price || "0"),
    };
  } catch (error) {
    logger.error(`Failed to get position for token ${tokenId}`, error);
    return null;
  }
}

/**
 * Get all user positions
 */
export async function getAllPositions(client: ClobClient): Promise<Array<{
  tokenId: string;
  size: number;
  avgPrice: number;
  marketTitle?: string;
}>> {
  try {
    const positions = await client.getPositions();
    return (positions || [])
      .filter((p: any) => parseFloat(p.size || "0") > 0)
      .map((p: any) => ({
        tokenId: p.asset || p.tokenId,
        size: parseFloat(p.size || "0"),
        avgPrice: parseFloat(p.avgPrice || p.average_price || "0"),
        marketTitle: p.title || p.market_title,
      }));
  } catch (error) {
    logger.error("Failed to get positions", error);
    return [];
  }
}

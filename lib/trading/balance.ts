import type { ClobClient } from "@polymarket/clob-client";
import type { BalanceResult } from "./types";
import { POLYGON_RPC } from "./client";

// USDC contract on Polygon
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

/**
 * Fetch USDC balance for a wallet directly from Polygon blockchain
 */
export async function fetchProxyBalance(walletAddress: string): Promise<number> {
  // ERC20 balanceOf function selector + padded address
  const data = "0x70a08231" + walletAddress.slice(2).toLowerCase().padStart(64, "0");

  const response = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: USDC_ADDRESS, data }, "latest"],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC error: ${response.status}`);
  }

  const result = (await response.json()) as { result?: string; error?: any };

  if (result.error) {
    throw new Error(result.error.message || "RPC call failed");
  }

  // Parse hex result - USDC has 6 decimals
  const balanceWei = BigInt(result.result || "0x0");
  return Number(balanceWei) / 1_000_000;
}

/**
 * Get user's USDC balance and allowance
 * For proxy wallets, fetches USDC balance directly from Polygon
 */
export async function getBalance(
  client: ClobClient,
  proxyAddress?: string
): Promise<BalanceResult> {
  // If proxy address provided, fetch USDC balance directly from blockchain
  if (proxyAddress) {
    try {
      const balance = await fetchProxyBalance(proxyAddress);
      return { balance, allowance: balance }; // Proxy wallets have pre-approved allowance
    } catch (error) {
      console.error("Failed to get proxy balance", error);
      // Fall through to try CLOB client
    }
  }

  // Standard CLOB client balance check
  try {
    const result = await client.getBalanceAllowance();
    return {
      balance: parseFloat(result.balance || "0"),
      allowance: parseFloat(result.allowance || "0"),
    };
  } catch (error) {
    console.error("Failed to get balance from CLOB", error);
    return { balance: 0, allowance: 0 };
  }
}

export { USDC_ADDRESS };

// Polymarket Data API
const DATA_API = "https://data-api.polymarket.com";

export interface PolymarketPosition {
  asset: string;           // Token ID
  conditionId: string;
  size: number;            // Number of shares
  avgPrice: number;        // Average entry price
  currentPrice: number;    // Current market price
  initialValue: number;    // Cost basis (size * avgPrice)
  currentValue: number;    // Current value (size * currentPrice)
  percentChange: number;
  outcome: string;         // "Yes" or "No" or player name
  title: string;           // Market question
  pnl: number;
}

/**
 * Fetch all positions for a wallet from Polymarket Data API
 */
export interface TradingPosition {
  tokenId: string;
  conditionId: string;
  size: number;           // Number of shares
  avgPrice: number;       // Average entry price
  curPrice: number;       // Current market price
  outcome: string;
  title: string;
}

/**
 * Get all positions for a wallet (for use with ClobClient)
 * Wrapper around fetchPositions that works with proxyAddress
 */
export async function getAllPositions(
  _client: ClobClient,  // Client not needed, but kept for API consistency
  walletAddress?: string
): Promise<TradingPosition[]> {
  if (!walletAddress) {
    return [];
  }

  const positions = await fetchPositions(walletAddress);

  return positions.map(p => ({
    tokenId: p.asset,
    conditionId: p.conditionId,
    size: p.size,
    avgPrice: p.avgPrice,
    curPrice: p.currentPrice,
    outcome: p.outcome,
    title: p.title,
  }));
}

export async function fetchPositions(walletAddress: string): Promise<PolymarketPosition[]> {
  try {
    const url = `${DATA_API}/positions?user=${walletAddress.toLowerCase()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Data API error: ${response.status}`);
    }

    const data = await response.json() as any[];

    return data.map(p => ({
      asset: p.asset || p.tokenId || "",
      conditionId: p.conditionId || "",
      size: parseFloat(p.size || "0"),
      avgPrice: parseFloat(p.avgPrice || "0"),
      currentPrice: parseFloat(p.curPrice || p.currentPrice || "0"),
      initialValue: parseFloat(p.initialValue || "0"),
      currentValue: parseFloat(p.currentValue || "0"),
      percentChange: parseFloat(p.percentChange || "0"),
      outcome: p.outcome || "",
      title: p.title || p.question || "",
      pnl: parseFloat(p.pnl || "0"),
    }));
  } catch (error) {
    console.error("Failed to fetch positions from Polymarket", error);
    return [];
  }
}

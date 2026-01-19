import type { ClobClient } from "@polymarket/clob-client";

export interface TradingCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  privateKey?: string;
}

export interface TradingWallet {
  address: string;
  encryptedCredentials: string;
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  txHash?: string;
  error?: string;
  fillPrice?: number;
  fillAmount?: number; // Actual amount filled (USDC for BUY, shares for SELL)
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

export interface BalanceResult {
  balance: number;
  allowance: number;
}

export type { ClobClient };

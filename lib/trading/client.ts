import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import type { TradingCredentials } from "./types";

const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

/**
 * Create a CLOB client for a user's trading wallet
 * @param privateKey - The private key of the signing wallet (EOA)
 * @param credentials - API credentials
 * @param proxyAddress - Optional proxy/funder wallet address (for Polymarket proxy wallets)
 */
export async function createClobClient(
  privateKey: string,
  credentials: { apiKey: string; apiSecret: string; passphrase: string },
  proxyAddress?: string
): Promise<ClobClient> {
  const provider = new JsonRpcProvider(POLYGON_RPC);
  const wallet = new Wallet(privateKey, provider);

  const creds = {
    key: credentials.apiKey,
    secret: credentials.apiSecret,
    passphrase: credentials.passphrase,
  };

  // SignatureType: 0 = EOA, 1 = POLY_GNOSIS_SAFE, 2 = POLY_PROXY
  // For Polymarket web users with proxy wallets, use POLY_PROXY (2)
  if (proxyAddress) {
    const POLY_PROXY = 2;
    return new ClobClient(CLOB_HOST, CHAIN_ID, wallet, creds, POLY_PROXY, proxyAddress);
  }

  // For direct EOA wallets, use signature type 0
  return new ClobClient(CLOB_HOST, CHAIN_ID, wallet, creds, 0);
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
    console.error("Failed to derive API key", error);
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

export { POLYGON_RPC, CLOB_HOST, CHAIN_ID };

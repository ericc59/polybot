import { test, expect, describe, beforeEach, afterEach } from "bun:test";

// Mock data based on actual Polymarket Data API responses
const MOCK_POSITIONS_API_RESPONSE = [
  {
    proxyWallet: "0x085dc8f3efba535516ac10ab0c45a3fe5a405302",
    asset: "71210672375535912638682284703292196259858005989433991132272775284762208753128",
    conditionId: "0x1208a292b85eb24a7b6e0c8c8c45da5e61771671cf8d5edd05bf5d52c55a3ef6",
    size: 25000,
    avgPrice: 0.001,
    initialValue: 25,
    currentValue: 0,
    cashPnl: -25,
    percentPnl: -100,
    totalBought: 24999.9999,
    realizedPnl: 0,
    percentRealizedPnl: -100,
    curPrice: 0,
    redeemable: true,
    mergeable: false,
    title: "Will FC Internazionale Milano win on 2026-01-14?",
    slug: "sea-int-lec-2026-01-14-int",
    outcome: "No",
    outcomeIndex: 1,
    endDate: "2026-01-14",
    negativeRisk: true,
  },
  {
    proxyWallet: "0x085dc8f3efba535516ac10ab0c45a3fe5a405302",
    asset: "55131559183102232848094659919606716817823138850722565239022300493309926598273",
    conditionId: "0xceeeada82ed2bef926122d33af22523058ae27ef56a7d05a175ecd3396fed34b",
    size: 2032.1859,
    avgPrice: 0.0369,
    initialValue: 74.9957,
    currentValue: 81.29,
    cashPnl: 6.29,
    percentPnl: 8.4,
    totalBought: 2032.1859,
    curPrice: 0.04,
    title: "Hornets vs. Nuggets",
    slug: "nba-cha-den-2026-01-18",
    outcome: "Nuggets",
    outcomeIndex: 1,
    endDate: "2026-01-19",
    negativeRisk: false,
  },
  {
    proxyWallet: "0x085dc8f3efba535516ac10ab0c45a3fe5a405302",
    asset: "37146930759089302727156373823477460005644671488525154303453399494321449789874",
    conditionId: "0xf8abba1bfaa84278c1d378684381f79d81be156f69e56480b4a53a4a71a6522d",
    size: 1500.1453,
    avgPrice: 0.0553,
    initialValue: 82.985,
    currentValue: 90.01,
    cashPnl: 7.02,
    percentPnl: 8.5,
    curPrice: 0.06,
    title: "Pelicans vs. Rockets",
    slug: "nba-nop-hou-2026-01-18",
    outcome: "Pelicans",
    outcomeIndex: 0,
    endDate: "2026-01-19",
    negativeRisk: false,
  },
  {
    proxyWallet: "0x085dc8f3efba535516ac10ab0c45a3fe5a405302",
    asset: "99999",
    conditionId: "0xabc",
    size: 454.5,
    avgPrice: 0.11,
    initialValue: 49.995,
    currentValue: 54.54,
    curPrice: 0.12,
    title: "Jazz vs. Spurs",
    outcome: "Jazz",
  },
];

// Simulate the TradingPosition interface transformation
interface TradingPosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  outcome: string;
  title: string;
}

function transformApiResponse(apiData: typeof MOCK_POSITIONS_API_RESPONSE): TradingPosition[] {
  return apiData.map((p) => ({
    tokenId: p.asset,
    conditionId: p.conditionId,
    size: p.size,
    avgPrice: p.avgPrice,
    curPrice: p.curPrice,
    outcome: p.outcome,
    title: p.title,
  }));
}

describe("Position API Response Transformation", () => {
  test("should transform API response to TradingPosition format", () => {
    const positions = transformApiResponse(MOCK_POSITIONS_API_RESPONSE);

    expect(positions.length).toBe(4);
    expect(positions[0]!.tokenId).toBe(MOCK_POSITIONS_API_RESPONSE[0]!.asset);
    expect(positions[0]!.size).toBe(25000);
    expect(positions[0]!.avgPrice).toBe(0.001);
  });

  test("should preserve all required fields", () => {
    const positions = transformApiResponse(MOCK_POSITIONS_API_RESPONSE);
    const position = positions[1]!; // Hornets vs Nuggets

    expect(position.tokenId).toBe("55131559183102232848094659919606716817823138850722565239022300493309926598273");
    expect(position.conditionId).toBe("0xceeeada82ed2bef926122d33af22523058ae27ef56a7d05a175ecd3396fed34b");
    expect(position.size).toBe(2032.1859);
    expect(position.avgPrice).toBe(0.0369);
    expect(position.curPrice).toBe(0.04);
    expect(position.outcome).toBe("Nuggets");
    expect(position.title).toBe("Hornets vs. Nuggets");
  });

  test("should handle positions with various price formats", () => {
    const positions = transformApiResponse(MOCK_POSITIONS_API_RESPONSE);

    // Very small price (0.1 cents)
    expect(positions[0]!.avgPrice).toBe(0.001);

    // Small price (3.69 cents)
    expect(positions[1]!.avgPrice).toBe(0.0369);

    // Medium price (5.53 cents)
    expect(positions[2]!.avgPrice).toBe(0.0553);

    // Standard price (11 cents)
    expect(positions[3]!.avgPrice).toBe(0.11);
  });
});

describe("Cost Basis from API Data", () => {
  test("should calculate cost basis from size * avgPrice", () => {
    const positions = transformApiResponse(MOCK_POSITIONS_API_RESPONSE);

    // Position 1: 25000 shares @ $0.001 = $25
    expect(positions[0]!.size * positions[0]!.avgPrice).toBeCloseTo(25, 2);

    // Position 2: 2032.1859 shares @ $0.0369 = ~$75
    expect(positions[1]!.size * positions[1]!.avgPrice).toBeCloseTo(74.99, 1);

    // Position 3: 1500.1453 shares @ $0.0553 = ~$83
    expect(positions[2]!.size * positions[2]!.avgPrice).toBeCloseTo(82.96, 1);

    // Position 4: 454.5 shares @ $0.11 = ~$50
    expect(positions[3]!.size * positions[3]!.avgPrice).toBeCloseTo(49.995, 2);
  });

  test("cost basis should match API initialValue", () => {
    // The API provides initialValue which should equal size * avgPrice
    const position = MOCK_POSITIONS_API_RESPONSE[1]!; // Hornets vs Nuggets

    const calculatedCostBasis = position.size * position.avgPrice;
    const apiInitialValue = position.initialValue;

    // Allow for small floating point differences (within 1 cent)
    expect(calculatedCostBasis).toBeCloseTo(apiInitialValue, 1);
  });
});

describe("Balance Cache Logic", () => {
  let balanceCache: Map<string, { balance: number; timestamp: number }>;
  const BALANCE_CACHE_TTL = 30000;

  beforeEach(() => {
    balanceCache = new Map();
  });

  test("should return undefined for uncached wallet", () => {
    const cached = balanceCache.get("0xtest");
    expect(cached).toBeUndefined();
  });

  test("should return cached balance within TTL", () => {
    const walletAddress = "0x085dc8f3efba535516ac10ab0c45a3fe5a405302";
    const balance = 150.75;

    balanceCache.set(walletAddress, { balance, timestamp: Date.now() });

    const cached = balanceCache.get(walletAddress);
    expect(cached).toBeDefined();
    expect(cached!.balance).toBe(150.75);

    const isValid = Date.now() - cached!.timestamp < BALANCE_CACHE_TTL;
    expect(isValid).toBe(true);
  });

  test("should detect expired cache", () => {
    const walletAddress = "0xtest";
    const expiredTimestamp = Date.now() - 60000; // 60 seconds ago

    balanceCache.set(walletAddress, { balance: 100, timestamp: expiredTimestamp });

    const cached = balanceCache.get(walletAddress);
    const isExpired = cached && Date.now() - cached.timestamp >= BALANCE_CACHE_TTL;

    expect(isExpired).toBe(true);
  });

  test("should handle case-insensitive wallet addresses", () => {
    const upperCase = "0x085DC8F3EFBA535516AC10AB0C45A3FE5A405302";
    const lowerCase = upperCase.toLowerCase();

    balanceCache.set(lowerCase, { balance: 200, timestamp: Date.now() });

    // Should find with lowercase
    expect(balanceCache.get(lowerCase)).toBeDefined();

    // Won't find with uppercase (need to normalize before lookup)
    expect(balanceCache.get(upperCase)).toBeUndefined();
    expect(balanceCache.get(upperCase.toLowerCase())).toBeDefined();
  });
});

describe("RPC Balance Parsing", () => {
  test("should parse hex balance correctly", () => {
    // USDC has 6 decimals
    // 100 USDC = 100000000 (100 * 10^6)
    // In hex: 0x5F5E100

    const hexResult = "0x5F5E100";
    const balanceWei = BigInt(hexResult);
    const balance = Number(balanceWei) / 1_000_000;

    expect(balance).toBe(100);
  });

  test("should handle zero balance", () => {
    const hexResult = "0x0";
    const balanceWei = BigInt(hexResult);
    const balance = Number(balanceWei) / 1_000_000;

    expect(balance).toBe(0);
  });

  test("should handle fractional balance", () => {
    // 150.50 USDC = 150500000 (150.50 * 10^6)
    // In hex: 0x8f872a0

    const hexResult = "0x8f872a0";
    const balanceWei = BigInt(hexResult);
    const balance = Number(balanceWei) / 1_000_000;

    expect(balance).toBe(150.5);
  });

  test("should handle empty result", () => {
    const hexResult = "0x0";
    const balanceWei = BigInt(hexResult || "0x0");
    const balance = Number(balanceWei) / 1_000_000;

    expect(balance).toBe(0);
  });
});

describe("Position Filtering for Sports", () => {
  test("should identify vs format as sports", () => {
    const sportsPatterns = [
      "Hornets vs. Nuggets",
      "Jazz vs Spurs",
      "Lakers vs. Celtics",
      "Stanford Cardinal vs. North Carolina Tar Heels (W)",
    ];

    for (const title of sportsPatterns) {
      const lowerTitle = title.toLowerCase();
      const isSports =
        (lowerTitle.includes(" vs ") || lowerTitle.includes(" vs.")) &&
        !lowerTitle.includes("temperature") &&
        !lowerTitle.includes("weather");

      expect(isSports).toBe(true);
    }
  });

  test("should reject non-sports markets", () => {
    const nonSportsPatterns = [
      "Will FC Internazionale Milano win on 2026-01-14?",
      "Will the highest temperature in Dallas be between 56-57°F?",
      "Will Bitcoin reach $100,000?",
      "Who will win the election?",
    ];

    for (const title of nonSportsPatterns) {
      const lowerTitle = title.toLowerCase();
      const isSports =
        (lowerTitle.includes(" vs ") || lowerTitle.includes(" vs.")) &&
        !lowerTitle.includes("temperature") &&
        !lowerTitle.includes("weather") &&
        !lowerTitle.includes("bitcoin");

      expect(isSports).toBe(false);
    }
  });
});

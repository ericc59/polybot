import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// Mock data based on actual Polymarket API responses
const MOCK_POLYMARKET_POSITIONS = [
  {
    asset: "71210672375535912638682284703292196259858005989433991132272775284762208753128",
    conditionId: "0x1208a292b85eb24a7b6e0c8c8c45da5e61771671cf8d5edd05bf5d52c55a3ef6",
    size: 25000,
    avgPrice: 0.001,
    currentPrice: 0,
    initialValue: 25,
    currentValue: 0,
    percentChange: -100,
    outcome: "No",
    title: "Will FC Internazionale Milano win on 2026-01-14?",
    pnl: -25,
  },
  {
    asset: "16866522722022386686848867368404806770108004530151625825312083966515597979141",
    conditionId: "0x371026cfce525965eae36d579ad8a334b69512f010b54bd989e5c62eab9c4e26",
    size: 5000,
    avgPrice: 0.001,
    currentPrice: 0.02,
    initialValue: 5,
    currentValue: 100,
    percentChange: 1900,
    outcome: "North Carolina Tar Heels",
    title: "Stanford Cardinal vs. North Carolina Tar Heels (W)",
    pnl: 95,
  },
  {
    asset: "55131559183102232848094659919606716817823138850722565239022300493309926598273",
    conditionId: "0xceeeada82ed2bef926122d33af22523058ae27ef56a7d05a175ecd3396fed34b",
    size: 2032.1859,
    avgPrice: 0.0369,
    currentPrice: 0.04,
    initialValue: 74.9957,
    currentValue: 81.29,
    percentChange: 8.4,
    outcome: "Nuggets",
    title: "Hornets vs. Nuggets",
    pnl: 6.29,
  },
  {
    asset: "37146930759089302727156373823477460005644671488525154303453399494321449789874",
    conditionId: "0xf8abba1bfaa84278c1d378684381f79d81be156f69e56480b4a53a4a71a6522d",
    size: 1500.1453,
    avgPrice: 0.0553,
    currentPrice: 0.06,
    initialValue: 82.985,
    currentValue: 90.01,
    percentChange: 8.5,
    outcome: "Pelicans",
    title: "Pelicans vs. Rockets",
    pnl: 7.02,
  },
  {
    asset: "65106712619243601715794289334331971129826043918839499458081414165209445508210",
    conditionId: "0x14f0bd9c77c5312a5ecdbb86931692ad69a5a183191d9a51a17ca78875c79a72",
    size: 1000,
    avgPrice: 0.001,
    currentPrice: 0,
    initialValue: 1,
    currentValue: 0,
    percentChange: -100,
    outcome: "Yes",
    title: "Will the highest temperature in Toronto be -10°C on January 15?",
    pnl: -1,
  },
  {
    asset: "99999999999999999999999999999999999999999999999999999999999999999999999999999",
    conditionId: "0xabc123",
    size: 100,
    avgPrice: 0.25,
    currentPrice: 0.30,
    initialValue: 25,
    currentValue: 30,
    percentChange: 20,
    outcome: "Jazz",
    title: "Jazz vs. Spurs",
    pnl: 5,
  },
  {
    asset: "88888888888888888888888888888888888888888888888888888888888888888888888888888",
    conditionId: "0xdef456",
    size: 50,
    avgPrice: 0.10,
    currentPrice: 0.12,
    initialValue: 5,
    currentValue: 6,
    percentChange: 20,
    outcome: "Yes",
    title: "Will Bitcoin reach $100,000 by end of 2026?",
    pnl: 1,
  },
];

// Helper to filter for sports matches (same logic as in sports.service.ts)
function isSportsMatch(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return (
    (lowerTitle.includes(" vs ") || lowerTitle.includes(" vs.")) &&
    !lowerTitle.includes("temperature") &&
    !lowerTitle.includes("weather") &&
    !lowerTitle.includes("price") &&
    !lowerTitle.includes("bitcoin") &&
    !lowerTitle.includes("ethereum")
  );
}

// Helper to calculate cost basis
function calculateCostBasis(position: typeof MOCK_POLYMARKET_POSITIONS[0]): number {
  return position.size * position.avgPrice;
}

describe("Sports Position Filtering", () => {
  test("should identify sports matches correctly", () => {
    const sportsPositions = MOCK_POLYMARKET_POSITIONS.filter((p) =>
      isSportsMatch(p.title)
    );

    expect(sportsPositions.length).toBe(4);
    expect(sportsPositions.map((p) => p.title)).toEqual([
      "Stanford Cardinal vs. North Carolina Tar Heels (W)",
      "Hornets vs. Nuggets",
      "Pelicans vs. Rockets",
      "Jazz vs. Spurs",
    ]);
  });

  test("should exclude weather positions", () => {
    const weatherPosition = MOCK_POLYMARKET_POSITIONS.find((p) =>
      p.title.includes("temperature")
    );
    expect(weatherPosition).toBeDefined();
    expect(isSportsMatch(weatherPosition!.title)).toBe(false);
  });

  test("should exclude crypto positions", () => {
    const cryptoPosition = MOCK_POLYMARKET_POSITIONS.find((p) =>
      p.title.includes("Bitcoin")
    );
    expect(cryptoPosition).toBeDefined();
    expect(isSportsMatch(cryptoPosition!.title)).toBe(false);
  });

  test("should exclude soccer 'will win' markets (not vs format)", () => {
    const soccerPosition = MOCK_POLYMARKET_POSITIONS.find((p) =>
      p.title.includes("FC Internazionale")
    );
    expect(soccerPosition).toBeDefined();
    expect(isSportsMatch(soccerPosition!.title)).toBe(false);
  });
});

describe("Cost Basis Calculation", () => {
  test("should calculate cost basis correctly for small positions", () => {
    // 5000 shares @ $0.001 = $5
    const position = MOCK_POLYMARKET_POSITIONS.find(
      (p) => p.title === "Stanford Cardinal vs. North Carolina Tar Heels (W)"
    );
    expect(calculateCostBasis(position!)).toBeCloseTo(5, 2);
  });

  test("should calculate cost basis correctly for medium positions", () => {
    // 2032.1859 shares @ $0.0369 = ~$75
    const position = MOCK_POLYMARKET_POSITIONS.find(
      (p) => p.title === "Hornets vs. Nuggets"
    );
    expect(calculateCostBasis(position!)).toBeCloseTo(74.99, 1);
  });

  test("should calculate cost basis correctly for larger positions", () => {
    // 1500.1453 shares @ $0.0553 = ~$83
    const position = MOCK_POLYMARKET_POSITIONS.find(
      (p) => p.title === "Pelicans vs. Rockets"
    );
    expect(calculateCostBasis(position!)).toBeCloseTo(82.96, 1);
  });

  test("should calculate total sports exposure correctly", () => {
    const sportsPositions = MOCK_POLYMARKET_POSITIONS.filter((p) =>
      isSportsMatch(p.title)
    );
    const totalExposure = sportsPositions.reduce(
      (sum, p) => sum + calculateCostBasis(p),
      0
    );

    // Stanford: $5 + Nuggets: ~$75 + Pelicans: ~$83 + Jazz: $25 = ~$188
    expect(totalExposure).toBeCloseTo(187.97, 0);
  });
});

describe("Position Sync Logic", () => {
  test("should only sync sports positions", () => {
    const positionsToSync = MOCK_POLYMARKET_POSITIONS.filter((p) => {
      if (p.size <= 0) return false;
      return isSportsMatch(p.title);
    });

    expect(positionsToSync.length).toBe(4);

    // Should not include weather
    expect(positionsToSync.find((p) => p.title.includes("temperature"))).toBeUndefined();

    // Should not include crypto
    expect(positionsToSync.find((p) => p.title.includes("Bitcoin"))).toBeUndefined();

    // Should not include soccer "will win" format
    expect(positionsToSync.find((p) => p.title.includes("FC Internazionale"))).toBeUndefined();
  });

  test("should skip positions with zero size", () => {
    const positionsWithZeroSize = [
      ...MOCK_POLYMARKET_POSITIONS,
      {
        asset: "000000",
        conditionId: "0x000",
        size: 0,
        avgPrice: 0.5,
        currentPrice: 0.5,
        initialValue: 0,
        currentValue: 0,
        percentChange: 0,
        outcome: "Test",
        title: "Test vs. Test",
        pnl: 0,
      },
    ];

    const positionsToSync = positionsWithZeroSize.filter((p) => {
      if (p.size <= 0) return false;
      return isSportsMatch(p.title);
    });

    // Should still be 4 (the zero-size position should be skipped)
    expect(positionsToSync.length).toBe(4);
  });
});

describe("Database Integration", () => {
  let db: Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");

    // Create sports_bets table matching the real schema
    db.exec(`
      CREATE TABLE sports_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        match_id TEXT NOT NULL,
        sport TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        outcome TEXT NOT NULL,
        token_id TEXT,
        shares REAL,
        sharp_prob REAL NOT NULL,
        poly_price REAL NOT NULL,
        edge REAL NOT NULL,
        size REAL NOT NULL,
        order_id TEXT,
        status TEXT DEFAULT 'open',
        sell_price REAL,
        profit REAL,
        condition_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("should insert synced position with correct values", () => {
    const position = MOCK_POLYMARKET_POSITIONS.find(
      (p) => p.title === "Jazz vs. Spurs"
    )!;

    const costBasis = calculateCostBasis(position);

    db.prepare(`
      INSERT INTO sports_bets (
        user_id, match_id, sport, home_team, away_team, outcome, token_id,
        condition_id, status, size, shares, sharp_prob, poly_price, edge, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
    `).run(
      1, // user_id
      position.conditionId,
      "synced",
      position.title,
      "vs",
      position.outcome,
      position.asset,
      position.conditionId,
      costBasis,
      position.size,
      position.currentPrice,
      position.avgPrice,
      0,
      Math.floor(Date.now() / 1000)
    );

    const result = db
      .prepare("SELECT * FROM sports_bets WHERE token_id = ?")
      .get(position.asset) as any;

    expect(result).toBeDefined();
    expect(result.size).toBeCloseTo(25, 2); // $25 cost basis
    expect(result.shares).toBe(100); // 100 shares
    expect(result.poly_price).toBe(0.25); // 25 cents entry price
    expect(result.status).toBe("open");
  });

  test("should calculate total exposure from database", () => {
    // Insert multiple positions
    const sportsPositions = MOCK_POLYMARKET_POSITIONS.filter((p) =>
      isSportsMatch(p.title)
    );

    for (const position of sportsPositions) {
      const costBasis = calculateCostBasis(position);
      db.prepare(`
        INSERT INTO sports_bets (
          user_id, match_id, sport, home_team, away_team, outcome, token_id,
          condition_id, status, size, shares, sharp_prob, poly_price, edge
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
      `).run(
        1,
        position.conditionId,
        "synced",
        position.title,
        "vs",
        position.outcome,
        position.asset,
        position.conditionId,
        costBasis,
        position.size,
        position.currentPrice,
        position.avgPrice,
        0
      );
    }

    const result = db
      .prepare(
        "SELECT COALESCE(SUM(size), 0) as total FROM sports_bets WHERE user_id = ? AND status IN ('placed', 'open')"
      )
      .get(1) as { total: number };

    // Total should be ~$188 (sum of all sports position cost bases)
    expect(result.total).toBeCloseTo(187.97, 0);
  });

  test("should not count sold positions in exposure", () => {
    const position = MOCK_POLYMARKET_POSITIONS.find(
      (p) => p.title === "Jazz vs. Spurs"
    )!;

    // Insert as sold
    db.prepare(`
      INSERT INTO sports_bets (
        user_id, match_id, sport, home_team, away_team, outcome, token_id,
        condition_id, status, size, shares, sharp_prob, poly_price, edge
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sold', ?, ?, ?, ?, ?)
    `).run(
      1,
      position.conditionId,
      "synced",
      position.title,
      "vs",
      position.outcome,
      position.asset,
      position.conditionId,
      25,
      100,
      0.30,
      0.25,
      0
    );

    const result = db
      .prepare(
        "SELECT COALESCE(SUM(size), 0) as total FROM sports_bets WHERE user_id = ? AND status IN ('placed', 'open')"
      )
      .get(1) as { total: number };

    expect(result.total).toBe(0);
  });

  test("should detect duplicate token_ids", () => {
    const position = MOCK_POLYMARKET_POSITIONS.find(
      (p) => p.title === "Jazz vs. Spurs"
    )!;

    // Insert first time
    db.prepare(`
      INSERT INTO sports_bets (
        user_id, match_id, sport, home_team, away_team, outcome, token_id,
        condition_id, status, size, shares, sharp_prob, poly_price, edge
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      1,
      position.conditionId,
      "synced",
      position.title,
      "vs",
      position.outcome,
      position.asset,
      position.conditionId,
      25,
      100,
      0.30,
      0.25,
      0
    );

    // Check if token exists before inserting
    const existing = db
      .prepare(
        "SELECT token_id FROM sports_bets WHERE token_id = ? AND status IN ('open', 'placed')"
      )
      .get(position.asset);

    expect(existing).toBeDefined();
  });
});

describe("Balance Caching", () => {
  test("should cache balance results", async () => {
    // Simulate balance cache behavior
    const balanceCache = new Map<string, { balance: number; timestamp: number }>();
    const BALANCE_CACHE_TTL = 30000;

    const walletAddress = "0x085dC8F3EFbA535516Ac10AB0c45a3fe5A405302".toLowerCase();

    // First call - no cache
    let cached = balanceCache.get(walletAddress);
    expect(cached).toBeUndefined();

    // Simulate fetching and caching
    const balance = 100.50;
    balanceCache.set(walletAddress, { balance, timestamp: Date.now() });

    // Second call - should hit cache
    cached = balanceCache.get(walletAddress);
    expect(cached).toBeDefined();
    expect(cached!.balance).toBe(100.50);
    expect(Date.now() - cached!.timestamp).toBeLessThan(BALANCE_CACHE_TTL);
  });

  test("should expire cache after TTL", async () => {
    const balanceCache = new Map<string, { balance: number; timestamp: number }>();
    const BALANCE_CACHE_TTL = 100; // Short TTL for testing

    const walletAddress = "0xtest";
    balanceCache.set(walletAddress, { balance: 50, timestamp: Date.now() - 200 });

    const cached = balanceCache.get(walletAddress);
    const isExpired = cached && Date.now() - cached.timestamp >= BALANCE_CACHE_TTL;

    expect(isExpired).toBe(true);
  });
});

describe("Edge Cases", () => {
  test("should handle positions with very small prices", () => {
    const position = {
      size: 25000,
      avgPrice: 0.001,
    };
    const costBasis = position.size * position.avgPrice;
    expect(costBasis).toBe(25);
  });

  test("should handle positions with fractional shares", () => {
    const position = {
      size: 2032.1859,
      avgPrice: 0.0369,
    };
    const costBasis = position.size * position.avgPrice;
    expect(costBasis).toBeCloseTo(74.99, 1);
  });

  test("should handle empty position list", () => {
    const positions: typeof MOCK_POLYMARKET_POSITIONS = [];
    const sportsPositions = positions.filter((p) => isSportsMatch(p.title));
    const totalExposure = sportsPositions.reduce(
      (sum, p) => sum + calculateCostBasis(p),
      0
    );
    expect(totalExposure).toBe(0);
  });

  test("should handle positions with missing title", () => {
    const positionWithNoTitle = {
      ...MOCK_POLYMARKET_POSITIONS[0],
      title: "",
    };
    expect(isSportsMatch(positionWithNoTitle.title)).toBe(false);
  });
});

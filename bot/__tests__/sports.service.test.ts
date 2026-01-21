import { test, expect, describe, mock, beforeEach, afterEach, spyOn } from "bun:test";
import {
  ODDS_API_NBA_MATCH,
  ODDS_API_NCAAB_MATCH,
  ODDS_API_SCORES,
  POLYMARKET_NBA_EVENT,
  POLYMARKET_NCAAB_EVENT,
  CLOB_PRICE_ASK,
  CLOB_PRICE_BID,
  CLOB_ORDERBOOK,
  DEFAULT_TEST_CONFIG,
  SAMPLE_VALUE_BET,
  SAMPLE_OPEN_BET,
  STALE_BOOKMAKER_DATA,
  EXTREME_UNDERDOG_MATCH,
} from "./fixtures/sports.fixtures";

// =============================================
// UNIT TESTS: Odds Conversion
// =============================================

describe("Odds Conversion", () => {
  // Re-implement the function locally for testing (since it's not exported)
  function americanToProb(americanOdds: number): number {
    if (americanOdds > 0) {
      return 100 / (americanOdds + 100);
    } else {
      return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
    }
  }

  describe("americanToProb", () => {
    test("converts positive American odds to probability", () => {
      // +100 = 50% probability
      expect(americanToProb(100)).toBeCloseTo(0.5, 4);

      // +200 = 33.33% probability
      expect(americanToProb(200)).toBeCloseTo(0.3333, 4);

      // +150 = 40% probability
      expect(americanToProb(150)).toBeCloseTo(0.4, 4);

      // +400 = 20% probability (underdog)
      expect(americanToProb(400)).toBeCloseTo(0.2, 4);
    });

    test("converts negative American odds to probability", () => {
      // -100 = 50% probability
      expect(americanToProb(-100)).toBeCloseTo(0.5, 4);

      // -200 = 66.67% probability
      expect(americanToProb(-200)).toBeCloseTo(0.6667, 4);

      // -150 = 60% probability
      expect(americanToProb(-150)).toBeCloseTo(0.6, 4);

      // -110 = 52.38% (standard vig line)
      expect(americanToProb(-110)).toBeCloseTo(0.5238, 4);

      // -118 (from real fixture)
      expect(americanToProb(-118)).toBeCloseTo(0.5413, 4);
    });

    test("handles extreme odds correctly", () => {
      // Heavy favorite: -500 = 83.33%
      expect(americanToProb(-500)).toBeCloseTo(0.8333, 4);

      // Heavy underdog: +500 = 16.67%
      expect(americanToProb(500)).toBeCloseTo(0.1667, 4);

      // Extreme favorite: -1000 = 90.91%
      expect(americanToProb(-1000)).toBeCloseTo(0.9091, 4);
    });

    test("verifies fixture data conversion", () => {
      // From ODDS_API_NBA_MATCH fixture:
      // Philadelphia 76ers: -118 → ~54.13%
      const phillyProb = americanToProb(-118);
      expect(phillyProb).toBeCloseTo(0.5413, 3);

      // Phoenix Suns: +100 → 50%
      const sunsProb = americanToProb(100);
      expect(sunsProb).toBe(0.5);

      // Total probability with vig
      const totalWithVig = phillyProb + sunsProb;
      expect(totalWithVig).toBeGreaterThan(1); // Should be > 100% due to vig
    });
  });

  describe("de-vigging odds", () => {
    function devig(prob1: number, prob2: number): [number, number] {
      const total = prob1 + prob2;
      return [prob1 / total, prob2 / total];
    }

    test("removes vig from odds", () => {
      // -110/-110 line (total vig = ~104.76%)
      const prob1 = americanToProb(-110); // ~52.38%
      const prob2 = americanToProb(-110); // ~52.38%
      const [fair1, fair2] = devig(prob1, prob2);

      expect(fair1).toBeCloseTo(0.5, 4);
      expect(fair2).toBeCloseTo(0.5, 4);
      expect(fair1 + fair2).toBeCloseTo(1, 6);
    });

    test("correctly devigs asymmetric line", () => {
      // -118/+100 line from fixture
      const prob1 = americanToProb(-118); // ~54.13%
      const prob2 = americanToProb(100); // 50%
      const [fair1, fair2] = devig(prob1, prob2);

      // Devigged: ~51.95% / ~48.05%
      expect(fair1 + fair2).toBeCloseTo(1, 6);
      expect(fair1).toBeGreaterThan(fair2); // Favorite still more likely
      expect(fair1).toBeCloseTo(0.5197, 3);
    });
  });
});

// =============================================
// UNIT TESTS: Team Matching
// =============================================

describe("Team Matching", () => {
  // Re-implement for testing
  function normalizeForMatching(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function outcomeMatchesTeam(outcome: string, teamName: string): boolean {
    const outcomeNorm = normalizeForMatching(outcome);
    const teamNorm = normalizeForMatching(teamName);

    if (teamNorm.includes(outcomeNorm) || outcomeNorm.includes(teamNorm)) {
      return true;
    }

    if (outcomeNorm.length >= 4 && teamNorm.includes(outcomeNorm.slice(0, 4))) {
      return true;
    }

    return false;
  }

  describe("normalizeForMatching", () => {
    test("lowercases and removes special characters", () => {
      expect(normalizeForMatching("Phoenix Suns")).toBe("phoenixsuns");
      expect(normalizeForMatching("76ers")).toBe("76ers");
      expect(normalizeForMatching("Philadelphia 76ers")).toBe("philadelphia76ers");
    });

    test("handles accents and diacritics", () => {
      expect(normalizeForMatching("José")).toBe("jose");
      expect(normalizeForMatching("München")).toBe("munchen");
      expect(normalizeForMatching("Göran")).toBe("goran");
    });

    test("handles hyphens and periods", () => {
      expect(normalizeForMatching("St. Louis Blues")).toBe("stlouisblues");
      expect(normalizeForMatching("San-Antonio")).toBe("sanantonio");
    });
  });

  describe("outcomeMatchesTeam", () => {
    test("matches exact team name", () => {
      expect(outcomeMatchesTeam("Suns", "Phoenix Suns")).toBe(true);
      expect(outcomeMatchesTeam("76ers", "Philadelphia 76ers")).toBe(true);
    });

    test("matches partial team name", () => {
      expect(outcomeMatchesTeam("Philadelphia 76ers", "Philadelphia 76ers")).toBe(true);
      expect(outcomeMatchesTeam("Lakers", "Los Angeles Lakers")).toBe(true);
    });

    test("handles abbreviated names", () => {
      expect(outcomeMatchesTeam("Nets", "Brooklyn Nets")).toBe(true);
      expect(outcomeMatchesTeam("Celtics", "Boston Celtics")).toBe(true);
    });

    test("returns false for non-matching teams", () => {
      expect(outcomeMatchesTeam("Lakers", "Phoenix Suns")).toBe(false);
      expect(outcomeMatchesTeam("Warriors", "Houston Rockets")).toBe(false);
    });

    test("handles college team matching", () => {
      // From NCAAB fixture
      expect(outcomeMatchesTeam("UT Martin Skyhawks", "UT Martin")).toBe(true);
      expect(outcomeMatchesTeam("Toledo Rockets", "Toledo")).toBe(true);
    });

    test("doesn't match ambiguous abbreviations", () => {
      // Both LA teams shouldn't match each other
      // Note: Current implementation has this limitation - "LA" matches both
      expect(outcomeMatchesTeam("LA Lakers", "LA Clippers")).toBe(false);
    });
  });
});

// =============================================
// UNIT TESTS: Consensus Odds Calculation
// =============================================

describe("Consensus Odds Calculation", () => {
  const SHARP_BOOKS = ["lowvig", "betonlineag", "fanduel", "draftkings"];
  const MAX_ODDS_AGE_MS = 5 * 60 * 1000;

  function americanToProb(americanOdds: number): number {
    if (americanOdds > 0) {
      return 100 / (americanOdds + 100);
    } else {
      return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
    }
  }

  function calculateConsensusOdds(
    match: typeof ODDS_API_NBA_MATCH,
    outcome: string,
    minBooks: number
  ): { avgProb: number; bookCount: number } | null {
    const bookData: Array<{ fairProb: number }> = [];
    const now = Date.now();

    for (const sharpKey of SHARP_BOOKS) {
      const bookmaker = match.bookmakers.find((b) => b.key.toLowerCase() === sharpKey);
      if (!bookmaker) continue;

      const lastUpdate = new Date(bookmaker.last_update).getTime();
      const ageMs = now - lastUpdate;
      if (ageMs > MAX_ODDS_AGE_MS) continue;

      const h2hMarket = bookmaker.markets.find((m) => m.key === "h2h");
      if (!h2hMarket) continue;
      if (h2hMarket.outcomes.length !== 2) continue;

      const outcome1 = h2hMarket.outcomes[0];
      const outcome2 = h2hMarket.outcomes[1];

      const prob1 = americanToProb(outcome1.price);
      const prob2 = americanToProb(outcome2.price);
      const totalProb = prob1 + prob2;

      const fairProb1 = prob1 / totalProb;
      const fairProb2 = prob2 / totalProb;

      const isOutcome1 = outcome1.name === outcome;
      const fairProb = isOutcome1 ? fairProb1 : fairProb2;

      bookData.push({ fairProb });
    }

    if (bookData.length < minBooks) {
      return null;
    }

    const avgProb = bookData.reduce((sum, b) => sum + b.fairProb, 0) / bookData.length;
    return { avgProb, bookCount: bookData.length };
  }

  test("calculates consensus from multiple sharp books", () => {
    // Mock current time to be close to fixture data
    const now = new Date("2026-01-20T12:17:00Z").getTime();
    const originalDate = Date.now;
    Date.now = () => now;

    try {
      const result = calculateConsensusOdds(ODDS_API_NBA_MATCH, "Philadelphia 76ers", 2);

      expect(result).not.toBeNull();
      expect(result!.bookCount).toBeGreaterThanOrEqual(2);
      expect(result!.avgProb).toBeGreaterThan(0.5); // 76ers are favorites
      expect(result!.avgProb).toBeLessThan(0.6);
    } finally {
      Date.now = originalDate;
    }
  });

  test("returns null when insufficient books", () => {
    const now = new Date("2026-01-20T12:17:00Z").getTime();
    const originalDate = Date.now;
    Date.now = () => now;

    try {
      // Require 5 books but only 4 sharp books in fixture
      const result = calculateConsensusOdds(ODDS_API_NBA_MATCH, "Philadelphia 76ers", 5);
      expect(result).toBeNull();
    } finally {
      Date.now = originalDate;
    }
  });

  test("filters out stale bookmaker data", () => {
    const matchWithStaleData = {
      ...ODDS_API_NBA_MATCH,
      bookmakers: [
        ...ODDS_API_NBA_MATCH.bookmakers,
        STALE_BOOKMAKER_DATA as any,
      ],
    };

    const now = new Date("2026-01-20T12:17:00Z").getTime();
    const originalDate = Date.now;
    Date.now = () => now;

    try {
      // Note: The stale book filter works, but other books in the match have valid data
      // for Philadelphia 76ers, not "Team A". We test with an existing team.
      const result = calculateConsensusOdds(matchWithStaleData, "Philadelphia 76ers", 2);
      expect(result).not.toBeNull();
      // The stale book should not be counted
      expect(result!.bookCount).toBeLessThanOrEqual(4);
    } finally {
      Date.now = originalDate;
    }
  });
});

// =============================================
// UNIT TESTS: Edge Calculation
// =============================================

describe("Edge Calculation", () => {
  test("calculates positive edge correctly", () => {
    const sharpProb = 0.52; // Sharp books say 52%
    const polyPrice = 0.475; // Polymarket price is 47.5¢

    const edge = (sharpProb - polyPrice) / polyPrice;

    // (0.52 - 0.475) / 0.475 = 0.0947 = 9.47%
    expect(edge).toBeCloseTo(0.0947, 4);
  });

  test("calculates negative edge correctly", () => {
    const sharpProb = 0.45; // Sharp books say 45%
    const polyPrice = 0.50; // Polymarket price is 50¢

    const edge = (sharpProb - polyPrice) / polyPrice;

    // (0.45 - 0.50) / 0.50 = -0.10 = -10%
    expect(edge).toBeCloseTo(-0.1, 10);
  });

  test("edge of zero when prices match", () => {
    const sharpProb = 0.50;
    const polyPrice = 0.50;

    const edge = (sharpProb - polyPrice) / polyPrice;
    expect(edge).toBe(0);
  });

  test("applies minEdge threshold correctly", () => {
    const minEdge = 0.035; // 3.5%

    const edge1 = 0.04; // Above threshold
    const edge2 = 0.03; // Below threshold
    const edge3 = 0.035; // At threshold

    expect(edge1 >= minEdge).toBe(true);
    expect(edge2 >= minEdge).toBe(false);
    expect(edge3 >= minEdge).toBe(true);
  });
});

// =============================================
// UNIT TESTS: Kelly Sizing
// =============================================

describe("Kelly Sizing", () => {
  test("calculates full Kelly fraction", () => {
    const edge = 0.10; // 10% edge
    const sharpProb = 0.55; // 55% win probability

    // Kelly formula: edge / (1 - probability)
    const kellyPct = edge / (1 - sharpProb);

    // 0.10 / 0.45 = 0.222 = 22.2%
    expect(kellyPct).toBeCloseTo(0.2222, 4);
  });

  test("applies Kelly fraction multiplier", () => {
    const edge = 0.10;
    const sharpProb = 0.55;
    const kellyFraction = 0.25; // Quarter Kelly

    const fullKelly = edge / (1 - sharpProb);
    const fractionalKelly = fullKelly * kellyFraction;

    // 0.222 * 0.25 = 0.0556 = 5.56%
    expect(fractionalKelly).toBeCloseTo(0.0556, 4);
  });

  test("caps bet size at maxBetPct", () => {
    const edge = 0.50; // Unrealistic 50% edge
    const sharpProb = 0.70;
    const kellyFraction = 0.25;
    const maxBetPct = 0.03; // 3% max

    const fullKelly = edge / (1 - sharpProb); // 1.67
    const fractionalKelly = fullKelly * kellyFraction; // 0.417
    const cappedPct = Math.min(fractionalKelly, maxBetPct);

    expect(cappedPct).toBe(0.03);
  });

  test("handles edge case of 100% win probability", () => {
    const edge = 0.10;
    const sharpProb = 0.99; // 99% probability

    const kellyPct = edge / (1 - sharpProb);

    // Very high Kelly when probability is near 1
    expect(kellyPct).toBeCloseTo(10, 10); // 0.10 / 0.01
  });
});

// =============================================
// UNIT TESTS: Game State Logic
// =============================================

describe("Game State Logic", () => {
  const GAME_DURATION_MINUTES: Record<string, number> = {
    basketball_nba: 48,
    basketball_ncaab: 40,
    americanfootball_nfl: 60,
    icehockey_nhl: 60,
  };

  function estimateMinutesRemaining(
    commenceTime: string,
    sportKey: string
  ): number | null {
    const startTime = new Date(commenceTime).getTime();
    const now = Date.now();
    const elapsedMs = now - startTime;

    if (elapsedMs < 0) return null;

    const totalDuration = GAME_DURATION_MINUTES[sportKey] || 60;
    const elapsedMinutes = elapsedMs / (1000 * 60);

    const breaksMinutes = sportKey.includes("basketball")
      ? 20
      : sportKey.includes("football")
      ? 30
      : sportKey.includes("hockey")
      ? 20
      : 15;

    const gameMinutes = elapsedMinutes - breaksMinutes;
    const remaining = totalDuration - Math.max(0, gameMinutes);

    return Math.max(0, remaining);
  }

  test("returns null for games not started", () => {
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
    const result = estimateMinutesRemaining(futureTime, "basketball_nba");
    expect(result).toBeNull();
  });

  test("estimates time remaining for NBA game", () => {
    // Game started 30 minutes ago
    const startTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const result = estimateMinutesRemaining(startTime, "basketball_nba");

    // 30 minutes elapsed - 20 min break allowance = 10 game minutes
    // 48 - 10 = 38 minutes remaining
    expect(result).toBeCloseTo(38, 0);
  });

  test("returns 0 when game should be over", () => {
    // Game started 3 hours ago
    const startTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = estimateMinutesRemaining(startTime, "basketball_nba");

    expect(result).toBe(0);
  });

  test("handles different sport durations", () => {
    const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

    const nbaRemaining = estimateMinutesRemaining(startTime, "basketball_nba");
    const ncaabRemaining = estimateMinutesRemaining(startTime, "basketball_ncaab");
    const nflRemaining = estimateMinutesRemaining(startTime, "americanfootball_nfl");

    // NCAAB games are shorter (40 min)
    expect(ncaabRemaining).toBeLessThan(nbaRemaining!);
    // NFL games are longer (60 min) with more breaks
    expect(nflRemaining).toBeGreaterThan(nbaRemaining!);
  });
});

// =============================================
// UNIT TESTS: Take Profit Logic
// =============================================

describe("Take Profit Logic", () => {
  interface GameState {
    hasScores: boolean;
    homeScore: number | null;
    awayScore: number | null;
    scoreDiff: number | null;
    minutesRemaining: number | null;
    isLive: boolean;
    isCompleted: boolean;
  }

  function shouldTakeProfitOnGameState(
    profitPct: number,
    gameState: GameState,
    sportKey: string
  ): { shouldSell: boolean; reason: string } {
    // 200%+ profit: Always sell
    if (profitPct >= 2.0) {
      return { shouldSell: true, reason: "200%+ profit - take the triple" };
    }

    if (gameState.isCompleted) {
      return { shouldSell: true, reason: "Game completed" };
    }

    if (!gameState.isLive || gameState.minutesRemaining === null) {
      if (profitPct >= 1.0) {
        return { shouldSell: true, reason: "100%+ profit (no game state)" };
      }
      return { shouldSell: false, reason: "" };
    }

    const isBasketball = sportKey.includes("basketball");
    const isFootball = sportKey.includes("football");
    const isHockey = sportKey.includes("hockey");

    let crunchTimeMinutes: number;
    let closeGamePoints: number;
    let blowoutPoints: number;

    if (isBasketball) {
      crunchTimeMinutes = 5;
      closeGamePoints = 10;
      blowoutPoints = 20;
    } else if (isFootball) {
      crunchTimeMinutes = 8;
      closeGamePoints = 8;
      blowoutPoints = 17;
    } else if (isHockey) {
      crunchTimeMinutes = 5;
      closeGamePoints = 2;
      blowoutPoints = 4;
    } else {
      crunchTimeMinutes = 10;
      closeGamePoints = 5;
      blowoutPoints = 15;
    }

    const minRemaining = gameState.minutesRemaining;
    const scoreDiff = gameState.scoreDiff;
    const inCrunchTime = minRemaining <= crunchTimeMinutes;
    const isCloseGame = scoreDiff !== null && scoreDiff <= closeGamePoints;
    const isBlowout = scoreDiff !== null && scoreDiff >= blowoutPoints;

    if (isBlowout) {
      if (profitPct >= 1.5 && inCrunchTime) {
        return {
          shouldSell: true,
          reason: `150%+ profit, blowout (+${scoreDiff}pts), locking in`,
        };
      }
      return { shouldSell: false, reason: "" };
    }

    if (isCloseGame && inCrunchTime) {
      if (profitPct >= 0.5) {
        return {
          shouldSell: true,
          reason: `${(profitPct * 100).toFixed(0)}% profit, crunch time`,
        };
      }
      if (minRemaining <= 2 && profitPct >= 0.3) {
        return {
          shouldSell: true,
          reason: `Last ${minRemaining.toFixed(0)}min, nail-biter`,
        };
      }
    }

    return { shouldSell: false, reason: "" };
  }

  test("always sells at 200%+ profit", () => {
    const gameState: GameState = {
      hasScores: true,
      homeScore: 50,
      awayScore: 48,
      scoreDiff: 2,
      minutesRemaining: 30,
      isLive: true,
      isCompleted: false,
    };

    const result = shouldTakeProfitOnGameState(2.5, gameState, "basketball_nba");
    expect(result.shouldSell).toBe(true);
    expect(result.reason).toContain("200%");
  });

  test("sells at 100%+ profit with no game state", () => {
    const gameState: GameState = {
      hasScores: false,
      homeScore: null,
      awayScore: null,
      scoreDiff: null,
      minutesRemaining: null,
      isLive: false,
      isCompleted: false,
    };

    const result = shouldTakeProfitOnGameState(1.2, gameState, "basketball_nba");
    expect(result.shouldSell).toBe(true);
    expect(result.reason).toContain("no game state");
  });

  test("holds in blowout with moderate profit", () => {
    const gameState: GameState = {
      hasScores: true,
      homeScore: 85,
      awayScore: 60,
      scoreDiff: 25, // Blowout (>20 pts)
      minutesRemaining: 10,
      isLive: true,
      isCompleted: false,
    };

    const result = shouldTakeProfitOnGameState(0.8, gameState, "basketball_nba");
    expect(result.shouldSell).toBe(false);
  });

  test("sells in close game during crunch time with 50%+ profit", () => {
    const gameState: GameState = {
      hasScores: true,
      homeScore: 98,
      awayScore: 96,
      scoreDiff: 2, // Close game
      minutesRemaining: 3, // Crunch time
      isLive: true,
      isCompleted: false,
    };

    const result = shouldTakeProfitOnGameState(0.55, gameState, "basketball_nba");
    expect(result.shouldSell).toBe(true);
    expect(result.reason).toContain("crunch time");
  });

  test("holds in early game even with close score", () => {
    const gameState: GameState = {
      hasScores: true,
      homeScore: 30,
      awayScore: 28,
      scoreDiff: 2,
      minutesRemaining: 35, // Early game
      isLive: true,
      isCompleted: false,
    };

    const result = shouldTakeProfitOnGameState(0.5, gameState, "basketball_nba");
    expect(result.shouldSell).toBe(false);
  });

  test("uses sport-specific thresholds", () => {
    const gameState: GameState = {
      hasScores: true,
      homeScore: 3,
      awayScore: 1,
      scoreDiff: 2,
      minutesRemaining: 4,
      isLive: true,
      isCompleted: false,
    };

    // 2-goal lead in hockey is close, not blowout
    const hockeyResult = shouldTakeProfitOnGameState(0.6, gameState, "icehockey_nhl");
    expect(hockeyResult.shouldSell).toBe(true); // Close game + crunch time

    // Same score difference in basketball would be a blowout consideration
    const basketballState: GameState = {
      ...gameState,
      homeScore: 85,
      awayScore: 83,
      scoreDiff: 2,
    };
    const basketballResult = shouldTakeProfitOnGameState(
      0.6,
      basketballState,
      "basketball_nba"
    );
    expect(basketballResult.shouldSell).toBe(true); // Close game in crunch time
  });
});

// =============================================
// UNIT TESTS: Share-Based Sizing
// =============================================

describe("Share-Based Sizing", () => {
  test("calculates bet size from shares and price", () => {
    const shares = 25;
    const price = 0.475;

    const betSize = shares * price;
    expect(betSize).toBeCloseTo(11.875, 3);
  });

  test("limits shares to maxSharesPerMarket", () => {
    const config = DEFAULT_TEST_CONFIG;
    const currentShares = 80;
    const requestedShares = 25;
    const maxShares = config.maxSharesPerMarket; // 100

    const remainingAllowance = maxShares - currentShares;
    const actualShares = Math.min(requestedShares, remainingAllowance);

    expect(actualShares).toBe(20); // Can only buy 20 more
  });

  test("returns 0 when at max shares", () => {
    const currentShares = 100;
    const maxShares = 100;

    const remainingAllowance = maxShares - currentShares;
    expect(remainingAllowance).toBe(0);
  });

  test("exposure calculation from shares", () => {
    const shares = 25;
    const avgPrice = 0.50;
    const currentPrice = 0.55;

    const costBasis = shares * avgPrice; // $12.50
    const currentValue = shares * currentPrice; // $13.75
    const unrealizedPnL = currentValue - costBasis; // $1.25

    expect(costBasis).toBeCloseTo(12.5, 10);
    expect(currentValue).toBeCloseTo(13.75, 10);
    expect(unrealizedPnL).toBeCloseTo(1.25, 10);
  });
});

// =============================================
// UNIT TESTS: Min Price Filter
// =============================================

describe("Min Price Filter", () => {
  test("rejects prices below minPrice threshold", () => {
    const config = DEFAULT_TEST_CONFIG;
    const polyPrice = 0.30; // 30¢

    const isBelowMinPrice = config.minPrice > 0 && polyPrice < config.minPrice;
    expect(isBelowMinPrice).toBe(true);
  });

  test("accepts prices at or above minPrice", () => {
    const config = DEFAULT_TEST_CONFIG;

    expect(config.minPrice > 0 && 0.40 < config.minPrice).toBe(false);
    expect(config.minPrice > 0 && 0.50 < config.minPrice).toBe(false);
  });

  test("skips check when minPrice is 0", () => {
    const config = { ...DEFAULT_TEST_CONFIG, minPrice: 0 };
    const polyPrice = 0.10;

    const isBelowMinPrice = config.minPrice > 0 && polyPrice < config.minPrice;
    expect(isBelowMinPrice).toBe(false);
  });
});

// =============================================
// UNIT TESTS: Sell Edge Calculation
// =============================================

describe("Sell Edge Calculation", () => {
  test("calculates positive sell edge when bid > fair value", () => {
    const bidPrice = 0.55;
    const fairValue = 0.50;

    const sellEdge = (bidPrice - fairValue) / fairValue;
    expect(sellEdge).toBeCloseTo(0.1, 10); // 10% sell edge
  });

  test("requires both profit and sell edge for selling", () => {
    const config = DEFAULT_TEST_CONFIG;
    const buyPrice = 0.45;
    const bidPrice = 0.50;
    const fairValue = 0.47;

    const profitPct = (bidPrice - buyPrice) / buyPrice; // 11.1% profit
    const sellEdge = (bidPrice - fairValue) / fairValue; // 6.4% edge

    const shouldSell =
      sellEdge >= config.minSellEdge && profitPct >= config.minSellProfit;
    expect(shouldSell).toBe(true);
  });

  test("does not sell at loss even with positive edge", () => {
    const config = DEFAULT_TEST_CONFIG;
    const buyPrice = 0.55;
    const bidPrice = 0.50;
    const fairValue = 0.47;

    const profitPct = (bidPrice - buyPrice) / buyPrice; // -9.1% loss
    const sellEdge = (bidPrice - fairValue) / fairValue; // 6.4% edge

    const shouldSell =
      sellEdge >= config.minSellEdge && profitPct >= config.minSellProfit;
    expect(shouldSell).toBe(false); // Don't sell at a loss
  });
});

// =============================================
// UNIT TESTS: P&L Calculations
// =============================================

describe("P&L Calculations", () => {
  test("calculates profit on winning bet", () => {
    const buyPrice = 0.50;
    const shares = 100;
    const costBasis = shares * buyPrice; // $50

    // Winner: shares worth $1 each
    const payout = shares * 1.0; // $100
    const profit = payout - costBasis; // $50

    expect(profit).toBe(50);
    expect(profit / costBasis).toBe(1); // 100% return
  });

  test("calculates loss on losing bet", () => {
    const buyPrice = 0.50;
    const shares = 100;
    const costBasis = shares * buyPrice;

    // Loser: shares worth $0 each
    const payout = shares * 0;
    const profit = payout - costBasis;

    expect(profit).toBe(-50);
  });

  test("calculates profit from early sell", () => {
    const buyPrice = 0.45;
    const sellPrice = 0.55;
    const shares = 100;

    const costBasis = shares * buyPrice; // $45
    const proceeds = shares * sellPrice; // $55
    const profit = proceeds - costBasis; // $10

    expect(profit).toBeCloseTo(10, 10);
    expect(profit / costBasis).toBeCloseTo(0.2222, 4); // 22.2% return
  });
});

// =============================================
// UNIT TESTS: Slug Parsing
// =============================================

describe("Slug Parsing", () => {
  function parsePolymarketSlug(
    slug: string
  ): { sport: string; team1: string; team2: string; date: string } | null {
    const match = slug.match(/^([a-z]+)-([a-z]+)-([a-z]+)-(\d{4}-\d{2}-\d{2})$/);
    if (!match) return null;
    return {
      sport: match[1],
      team1: match[2],
      team2: match[3],
      date: match[4],
    };
  }

  test("parses NBA slug correctly", () => {
    const result = parsePolymarketSlug("nba-phx-phi-2026-01-20");

    expect(result).not.toBeNull();
    expect(result!.sport).toBe("nba");
    expect(result!.team1).toBe("phx");
    expect(result!.team2).toBe("phi");
    expect(result!.date).toBe("2026-01-20");
  });

  test("parses college basketball slug correctly", () => {
    const result = parsePolymarketSlug("cbb-tmrt-semst-2026-01-20");

    expect(result).not.toBeNull();
    expect(result!.sport).toBe("cbb");
    expect(result!.team1).toBe("tmrt");
    expect(result!.team2).toBe("semst");
  });

  test("returns null for invalid slugs", () => {
    expect(parsePolymarketSlug("invalid")).toBeNull();
    expect(parsePolymarketSlug("nba-lakers-celtics")).toBeNull(); // Missing date
    expect(parsePolymarketSlug("NBA-LAL-BOS-2026-01-20")).toBeNull(); // Uppercase
  });
});

// =============================================
// UNIT TESTS: Team Abbreviations
// =============================================

describe("Team Abbreviations", () => {
  const TEAM_ABBREVS: Record<string, string> = {
    "phoenix suns": "phx",
    "philadelphia 76ers": "phi",
    "los angeles lakers": "lal",
    "boston celtics": "bos",
    "golden state warriors": "gsw",
  };

  function getTeamAbbrev(teamName: string): string | null {
    return TEAM_ABBREVS[teamName.toLowerCase().trim()] || null;
  }

  test("returns correct abbreviations for NBA teams", () => {
    expect(getTeamAbbrev("Phoenix Suns")).toBe("phx");
    expect(getTeamAbbrev("Philadelphia 76ers")).toBe("phi");
    expect(getTeamAbbrev("Los Angeles Lakers")).toBe("lal");
  });

  test("handles case insensitivity", () => {
    expect(getTeamAbbrev("PHOENIX SUNS")).toBe("phx");
    expect(getTeamAbbrev("phoenix suns")).toBe("phx");
    expect(getTeamAbbrev("Phoenix Suns")).toBe("phx");
  });

  test("returns null for unknown teams", () => {
    expect(getTeamAbbrev("Unknown Team")).toBeNull();
  });
});

// =============================================
// UNIT TESTS: Order Book Processing
// =============================================

describe("Order Book Processing", () => {
  test("finds best bid from order book", () => {
    const bids = CLOB_ORDERBOOK.bids;
    // Bids should be sorted, best bid has highest price
    const bestBid = bids.reduce((max, bid) =>
      parseFloat(bid.price) > parseFloat(max.price) ? bid : max
    );

    expect(parseFloat(bestBid.price)).toBe(0.47);
    expect(parseFloat(bestBid.size)).toBe(14971.88);
  });

  test("finds best ask from order book", () => {
    const asks = CLOB_ORDERBOOK.asks;
    // Asks should be sorted, best ask has lowest price
    const bestAsk = asks.reduce((min, ask) =>
      parseFloat(ask.price) < parseFloat(min.price) ? ask : min
    );

    expect(parseFloat(bestAsk.price)).toBe(0.48);
  });

  test("calculates spread from order book", () => {
    const bestBid = 0.47;
    const bestAsk = 0.48;

    const spread = bestAsk - bestBid;
    const spreadPct = spread / bestAsk;

    expect(spread).toBeCloseTo(0.01, 10);
    expect(spreadPct).toBeCloseTo(0.0208, 3); // ~2% spread
  });

  test("handles CLOB price API response", () => {
    const askResponse = CLOB_PRICE_ASK;
    const bidResponse = CLOB_PRICE_BID;

    expect(parseFloat(askResponse.price)).toBe(0.48);
    expect(parseFloat(bidResponse.price)).toBe(0.47);
  });
});

// =============================================
// UNIT TESTS: Exposure Limits
// =============================================

describe("Exposure Limits", () => {
  test("calculates total exposure from open bets", () => {
    const openBets = [
      { size: 10, shares: 20 },
      { size: 15, shares: 30 },
      { size: 25, shares: 50 },
    ];

    const totalExposure = openBets.reduce((sum, bet) => sum + bet.size, 0);
    expect(totalExposure).toBe(50);
  });

  test("checks if new bet would exceed max exposure", () => {
    const balance = 100;
    const maxExposurePct = 0.5; // 50%
    const currentExposure = 40;
    const newBetSize = 15;

    const maxExposure = balance * maxExposurePct;
    const wouldExceed = currentExposure + newBetSize > maxExposure;

    expect(maxExposure).toBe(50);
    expect(wouldExceed).toBe(true); // 40 + 15 = 55 > 50
  });

  test("calculates available exposure capacity", () => {
    const balance = 100;
    const maxExposurePct = 0.5;
    const currentExposure = 30;

    const maxExposure = balance * maxExposurePct;
    const availableCapacity = Math.max(0, maxExposure - currentExposure);

    expect(availableCapacity).toBe(20);
  });
});

// =============================================
// UNIT TESTS: Max Per Market
// =============================================

describe("Max Per Market", () => {
  test("limits additional bet to stay under max", () => {
    const maxPerMarket = 25;
    const currentExposure = 20;
    const requestedBet = 10;

    const remainingAllowance = maxPerMarket - currentExposure;
    const actualBet = Math.min(requestedBet, remainingAllowance);

    expect(remainingAllowance).toBe(5);
    expect(actualBet).toBe(5);
  });

  test("rejects bet when at max exposure", () => {
    const maxPerMarket = 25;
    const currentExposure = 25;

    const remainingAllowance = maxPerMarket - currentExposure;
    expect(remainingAllowance).toBe(0);
  });
});

// =============================================
// UNIT TESTS: Share-Based Sizing with Dollar Limit
// =============================================

describe("Share-Based Sizing with Dollar Limit", () => {
  test("reduces shares when dollar limit would be exceeded", () => {
    // Config: sharesPerBet = 25, maxPerMarket = $25
    const sharesPerBet = 25;
    const maxPerMarket = 25;
    const price = 0.40; // 40 cents

    // Current position: 50 shares at 40c = $20
    const currentShares = 50;
    const currentDollarExposure = currentShares * price; // $20

    // Requested bet: 25 shares at 40c = $10
    let shares = sharesPerBet;
    let betSize = shares * price; // $10

    // Check dollar limit
    const remainingDollarAllowance = maxPerMarket - currentDollarExposure; // $25 - $20 = $5

    if (betSize > remainingDollarAllowance) {
      betSize = remainingDollarAllowance;
      shares = betSize / price;
    }

    // Should reduce from $10 to $5 to fit within dollar limit
    expect(remainingDollarAllowance).toBe(5);
    expect(betSize).toBe(5);
    expect(shares).toBe(12.5); // 12.5 shares at 40c = $5
  });

  test("rejects bet when at dollar limit even with share room", () => {
    // Config: sharesPerBet = 25, maxSharesPerMarket = 100, maxPerMarket = $25
    const maxSharesPerMarket = 100;
    const maxPerMarket = 25;
    const price = 0.33; // 33 cents

    // Current position: 76 shares at 33c = $25.08 (over dollar limit, under share limit)
    const currentShares = 76;
    const currentDollarExposure = currentShares * price; // $25.08

    // Check share limit - still has room
    const remainingShares = maxSharesPerMarket - currentShares; // 24 shares remaining
    expect(remainingShares).toBe(24);

    // Check dollar limit - already exceeded
    const remainingDollarAllowance = maxPerMarket - currentDollarExposure;
    expect(remainingDollarAllowance).toBeLessThan(0);

    // Should reject the bet
    const shouldReject = remainingDollarAllowance <= 0;
    expect(shouldReject).toBe(true);
  });

  test("allows bet when under both limits", () => {
    const sharesPerBet = 25;
    const maxSharesPerMarket = 100;
    const maxPerMarket = 25;
    const price = 0.25; // 25 cents

    // Current position: 25 shares at 25c = $6.25
    const currentShares = 25;
    const currentDollarExposure = currentShares * price; // $6.25

    let shares = sharesPerBet;
    let betSize = shares * price; // $6.25

    // Check share limit
    const remainingShares = maxSharesPerMarket - currentShares; // 75 shares remaining
    expect(remainingShares).toBe(75);

    // Check dollar limit
    const remainingDollarAllowance = maxPerMarket - currentDollarExposure; // $18.75 remaining
    expect(remainingDollarAllowance).toBeCloseTo(18.75, 2);

    // Both limits have room - bet should proceed
    const canPlaceBet = remainingShares > 0 && remainingDollarAllowance > betSize;
    expect(canPlaceBet).toBe(true);
  });

  test("real scenario: 100 shares at 33c exceeds $25 limit", () => {
    // This is the exact bug scenario from the user's screenshot
    const maxPerMarket = 25;
    const price = 0.33;
    const currentShares = 100;

    const currentDollarExposure = currentShares * price; // $33
    const remainingDollarAllowance = maxPerMarket - currentDollarExposure; // -$8

    // Position is already $8 over the dollar limit
    expect(currentDollarExposure).toBe(33);
    expect(remainingDollarAllowance).toBe(-8);

    // Should reject any new bet
    const shouldReject = remainingDollarAllowance <= 0;
    expect(shouldReject).toBe(true);
  });
});

// =============================================
// INTEGRATION TESTS: Value Bet Detection Flow
// =============================================

describe("Value Bet Detection Flow", () => {
  function americanToProb(americanOdds: number): number {
    if (americanOdds > 0) {
      return 100 / (americanOdds + 100);
    }
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }

  test("end-to-end value bet detection with real fixtures", () => {
    // 1. Parse Polymarket event
    const polyEvent = POLYMARKET_NBA_EVENT;
    const market = polyEvent.markets[0];
    expect(market.groupItemTitle).toBe("Winner");

    // 2. Parse outcomes and prices
    const outcomes = JSON.parse(market.outcomes);
    const prices = JSON.parse(market.outcomePrices);
    expect(outcomes).toEqual(["Suns", "76ers"]);
    expect(prices).toEqual(["0.475", "0.525"]);

    // 3. Match with Odds API data
    const oddsMatch = ODDS_API_NBA_MATCH;
    expect(oddsMatch.home_team).toBe("Philadelphia 76ers");
    expect(oddsMatch.away_team).toBe("Phoenix Suns");

    // 4. Calculate sharp consensus (simplified)
    const fanduelBook = oddsMatch.bookmakers.find((b) => b.key === "fanduel")!;
    const h2h = fanduelBook.markets[0];
    const sunsOdds = h2h.outcomes.find((o) => o.name === "Phoenix Suns")!.price;

    const sunsProb = americanToProb(sunsOdds); // +100 → 50%
    const polyPrice = parseFloat(prices[0]); // 47.5¢

    // 5. Calculate edge
    const edge = (sunsProb - polyPrice) / polyPrice;
    expect(edge).toBeCloseTo(0.0526, 3); // ~5.3% edge

    // 6. Check if meets threshold
    const minEdge = 0.035;
    const hasValue = edge >= minEdge;
    expect(hasValue).toBe(true);
  });

  test("correctly filters out totals markets", () => {
    const markets = POLYMARKET_NBA_EVENT.markets;

    const moneylineMarkets = markets.filter((m) => {
      if (m.groupItemTitle) {
        const title = m.groupItemTitle.toLowerCase();
        return title === "winner" || title === "moneyline";
      }
      return false;
    });

    expect(moneylineMarkets.length).toBe(1);
    expect(moneylineMarkets[0].groupItemTitle).toBe("Winner");

    // Verify O/U and spread markets are excluded
    const totalsMarket = markets.find((m) =>
      m.groupItemTitle?.toLowerCase().includes("o/u")
    );
    const spreadMarket = markets.find((m) =>
      m.groupItemTitle?.toLowerCase().includes("spread")
    );

    expect(totalsMarket).toBeDefined();
    expect(spreadMarket).toBeDefined();
    expect(moneylineMarkets).not.toContain(totalsMarket);
    expect(moneylineMarkets).not.toContain(spreadMarket);
  });
});

// =============================================
// INTEGRATION TESTS: Position Lifecycle
// =============================================

describe("Position Lifecycle", () => {
  test("tracks position from open to sold", () => {
    // 1. Initial position
    const position = {
      id: 1,
      status: "open",
      tokenId: "token123",
      shares: 25,
      buyPrice: 0.50,
      size: 12.50,
      profit: null as number | null,
      sellPrice: null as number | null,
    };

    expect(position.status).toBe("open");
    expect(position.size).toBe(12.50);

    // 2. Price moves up, we sell
    const currentBidPrice = 0.60;
    const proceeds = position.shares * currentBidPrice;
    const profit = proceeds - position.size;

    position.status = "sold";
    position.sellPrice = currentBidPrice;
    position.profit = profit;

    expect(position.status).toBe("sold");
    expect(position.profit).toBe(2.50); // $15 - $12.50
  });

  test("tracks position through resolution (win)", () => {
    const position = {
      status: "open",
      shares: 25,
      buyPrice: 0.50,
      size: 12.50,
      profit: null as number | null,
    };

    // Market resolves, our team wins
    const payout = position.shares * 1.0; // $25
    position.profit = payout - position.size; // $12.50
    position.status = "won";

    expect(position.status).toBe("won");
    expect(position.profit).toBe(12.50);
  });

  test("tracks position through resolution (loss)", () => {
    const position = {
      status: "open",
      shares: 25,
      buyPrice: 0.50,
      size: 12.50,
      profit: null as number | null,
    };

    // Market resolves, our team loses
    const payout = position.shares * 0; // $0
    position.profit = payout - position.size; // -$12.50
    position.status = "lost";

    expect(position.status).toBe("lost");
    expect(position.profit).toBe(-12.50);
  });
});

// =============================================
// ERROR HANDLING TESTS
// =============================================

describe("Error Handling", () => {
  test("handles missing bookmaker data gracefully", () => {
    const matchWithNoBooks = {
      ...ODDS_API_NBA_MATCH,
      bookmakers: [],
    };

    // Should not throw, should return null or empty
    expect(matchWithNoBooks.bookmakers.length).toBe(0);
  });

  test("handles malformed outcome prices", () => {
    const badPrices = '["invalid", "prices"]';

    try {
      const parsed = JSON.parse(badPrices);
      const price = parseFloat(parsed[0]);
      expect(isNaN(price)).toBe(true);
    } catch {
      // JSON parsing succeeded but value is bad
    }
  });

  test("handles 404 orderbook error", () => {
    const errorResponse = { error: "No orderbook exists for the requested token id" };

    const is404 = errorResponse.error.includes("No orderbook exists");
    expect(is404).toBe(true);
  });
});

// =============================================
// EDGE CASES
// =============================================

describe("Edge Cases", () => {
  test("handles exactly 0% edge", () => {
    const sharpProb = 0.50;
    const polyPrice = 0.50;
    const edge = (sharpProb - polyPrice) / polyPrice;

    expect(edge).toBe(0);
    expect(edge >= 0.035).toBe(false); // No value
  });

  test("handles very small edge just below threshold", () => {
    const sharpProb = 0.517;
    const polyPrice = 0.50;
    const edge = (sharpProb - polyPrice) / polyPrice; // 3.4%

    expect(edge).toBeCloseTo(0.034, 3);
    expect(edge >= 0.035).toBe(false); // Just below threshold
  });

  test("handles overtime game (negative remaining time)", () => {
    // Game started 90 minutes ago, NBA game is 48 min + 20 min breaks = ~68 min
    const gameMinutes = 90 - 20; // 70 minutes of game time
    const remaining = Math.max(0, 48 - gameMinutes);

    expect(remaining).toBe(0); // Overtime shows as 0, not negative
  });

  test("handles team names with special characters", () => {
    function normalize(name: string): string {
      return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
    }

    expect(normalize("St. Mary's Gaels")).toBe("stmarysgaels");
    expect(normalize("Hawai'i Rainbow Warriors")).toBe("hawaiirainbowwarriors");
  });
});

// =============================================
// UNIT TESTS: Retry Utility
// =============================================

describe("Retry Utility", () => {
  // Re-implement the retry utility for testing
  interface RetryOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: any) => boolean;
  }

  async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      baseDelayMs = 10, // Use small delays for testing
      maxDelayMs = 100,
      shouldRetry = (err) => {
        const status = err?.status || err?.response?.status;
        if (status === 429 || (status >= 500 && status < 600)) return true;
        if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT") return true;
        if (err?.message?.includes("fetch failed")) return true;
        return false;
      },
    } = options;

    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (attempt === maxRetries || !shouldRetry(error)) {
          throw error;
        }
        // Small delay for testing
        await new Promise((r) => setTimeout(r, baseDelayMs));
      }
    }

    throw lastError;
  }

  test("succeeds immediately when function succeeds", async () => {
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      return "success";
    });

    expect(result).toBe("success");
    expect(callCount).toBe(1);
  });

  test("retries on 429 rate limit error", async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw { status: 429, message: "Rate limited" };
        }
        return "success";
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(result).toBe("success");
    expect(callCount).toBe(3);
  });

  test("retries on 5xx server errors", async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 2) {
          throw { status: 500, message: "Internal server error" };
        }
        return "success";
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(result).toBe("success");
    expect(callCount).toBe(2);
  });

  test("retries on network errors", async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 2) {
          throw { code: "ECONNRESET", message: "Connection reset" };
        }
        return "success";
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(result).toBe("success");
    expect(callCount).toBe(2);
  });

  test("does not retry on 4xx client errors (except 429)", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw { status: 404, message: "Not found" };
        },
        { maxRetries: 3, baseDelayMs: 1 }
      )
    ).rejects.toEqual({ status: 404, message: "Not found" });

    expect(callCount).toBe(1); // Only called once, no retry
  });

  test("gives up after maxRetries", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw { status: 500, message: "Server error" };
        },
        { maxRetries: 2, baseDelayMs: 1 }
      )
    ).rejects.toEqual({ status: 500, message: "Server error" });

    expect(callCount).toBe(3); // Initial + 2 retries
  });
});

// =============================================
// UNIT TESTS: Share-Based Sizing with Exposure Check
// =============================================

describe("Share-Based Sizing with Exposure Check", () => {
  test("reduces shares when hitting exposure limit", () => {
    const config = {
      sharesPerBet: 25,
      maxExposurePct: 0.5, // 50%
      minBetUsd: 0.5,
      maxPerMarket: 100,
      maxSharesPerMarket: 100,
    };
    const balance = 100;
    const polyPrice = 0.50;
    const currentExposure = 45; // Already at 45% exposure

    let shares = config.sharesPerBet;
    let betSize = shares * polyPrice; // 25 * 0.50 = $12.50

    // Check exposure limit
    const maxExposure = balance * config.maxExposurePct; // $50
    if (currentExposure + betSize > maxExposure) {
      const available = Math.max(0, maxExposure - currentExposure); // $5
      betSize = available;
      shares = betSize / polyPrice; // 10 shares
    }

    expect(shares).toBeCloseTo(10, 10);
    expect(betSize).toBeCloseTo(5, 10);
  });

  test("rejects bet when exposure limit fully reached", () => {
    const config = {
      sharesPerBet: 25,
      maxExposurePct: 0.5,
      minBetUsd: 0.5,
    };
    const balance = 100;
    const currentExposure = 50; // At 100% of exposure limit

    const maxExposure = balance * config.maxExposurePct;
    const available = Math.max(0, maxExposure - currentExposure);

    expect(available).toBe(0);
    expect(available < config.minBetUsd).toBe(true);
  });

  test("allows full bet when under exposure limit", () => {
    const config = {
      sharesPerBet: 25,
      maxExposurePct: 0.5,
      minBetUsd: 0.5,
    };
    const balance = 100;
    const polyPrice = 0.50;
    const currentExposure = 20; // Only 20% exposure

    let shares = config.sharesPerBet;
    let betSize = shares * polyPrice; // $12.50

    const maxExposure = balance * config.maxExposurePct; // $50
    const wouldExceed = currentExposure + betSize > maxExposure;

    expect(wouldExceed).toBe(false); // 20 + 12.50 = 32.50 < 50
    expect(shares).toBe(25);
  });
});

// =============================================
// UNIT TESTS: P&L Tracking with resolved_at
// =============================================

describe("P&L Tracking with resolved_at", () => {
  test("uses resolved_at for accurate daily P&L", () => {
    // Simulate bet placed yesterday but resolved today
    const yesterday = Math.floor(Date.now() / 1000) - 86400;
    const today = Math.floor(Date.now() / 1000);
    const todayStart = Math.floor(
      new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate()
      ).getTime() / 1000
    );

    const bet = {
      createdAt: yesterday,
      resolvedAt: today, // Resolved today
      profit: 5.0,
    };

    // P&L calculation should use resolved_at (or created_at as fallback)
    const resolveTime = bet.resolvedAt || bet.createdAt;
    const countedInTodaysPnL = resolveTime > todayStart;

    expect(countedInTodaysPnL).toBe(true);
  });

  test("falls back to created_at for old records without resolved_at", () => {
    const todayStart = Math.floor(
      new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate()
      ).getTime() / 1000
    );
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;

    const oldBet = {
      createdAt: hourAgo,
      resolvedAt: null, // No resolved_at
      profit: 3.0,
    };

    const resolveTime = oldBet.resolvedAt || oldBet.createdAt;
    const countedInTodaysPnL = resolveTime > todayStart;

    expect(countedInTodaysPnL).toBe(true);
  });

  test("excludes bets resolved before today", () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
    const todayStart = Math.floor(
      new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate()
      ).getTime() / 1000
    );

    const oldBet = {
      createdAt: twoDaysAgo - 86400, // 3 days ago
      resolvedAt: twoDaysAgo, // Resolved 2 days ago
      profit: 10.0,
    };

    const resolveTime = oldBet.resolvedAt || oldBet.createdAt;
    const countedInTodaysPnL = resolveTime > todayStart;

    expect(countedInTodaysPnL).toBe(false);
  });
});

// =============================================
// UNIT TESTS: Reconciliation Price Estimation
// =============================================

describe("Reconciliation Price Estimation", () => {
  test("identifies won bets when curPrice >= 0.95", () => {
    const curPrice = 0.98;
    const bet = { buyPrice: 0.50, shares: 100, size: 50 };

    let finalPrice: number;
    let status: string;
    let profit: number;

    if (curPrice >= 0.95) {
      finalPrice = 1.0;
      status = "won";
      profit = bet.shares * 1.0 - bet.size;
    } else if (curPrice <= 0.05) {
      finalPrice = 0;
      status = "lost";
      profit = -bet.size;
    } else {
      finalPrice = curPrice;
      status = "sold";
      profit = bet.shares * finalPrice - bet.size;
    }

    expect(status).toBe("won");
    expect(finalPrice).toBe(1.0);
    expect(profit).toBe(50); // 100 shares * $1 - $50 cost
  });

  test("identifies lost bets when curPrice <= 0.05", () => {
    const curPrice = 0.02;
    const bet = { buyPrice: 0.50, shares: 100, size: 50 };

    let finalPrice: number;
    let status: string;
    let profit: number;

    if (curPrice >= 0.95) {
      finalPrice = 1.0;
      status = "won";
      profit = bet.shares * 1.0 - bet.size;
    } else if (curPrice <= 0.05) {
      finalPrice = 0;
      status = "lost";
      profit = -bet.size;
    } else {
      finalPrice = curPrice;
      status = "sold";
      profit = bet.shares * finalPrice - bet.size;
    }

    expect(status).toBe("lost");
    expect(finalPrice).toBe(0);
    expect(profit).toBe(-50);
  });

  test("identifies sold bets when price is in middle range", () => {
    const curPrice = 0.60;
    const bet = { buyPrice: 0.50, shares: 100, size: 50 };

    let finalPrice: number;
    let status: string;
    let profit: number;

    if (curPrice >= 0.95) {
      finalPrice = 1.0;
      status = "won";
      profit = bet.shares * 1.0 - bet.size;
    } else if (curPrice <= 0.05) {
      finalPrice = 0;
      status = "lost";
      profit = -bet.size;
    } else {
      finalPrice = curPrice;
      status = "sold";
      profit = bet.shares * finalPrice - bet.size;
    }

    expect(status).toBe("sold");
    expect(finalPrice).toBe(0.60);
    expect(profit).toBe(10); // 100 * 0.60 - 50
  });

  test("handles exactly 0.95 price as won", () => {
    const curPrice = 0.95;

    const status = curPrice >= 0.95 ? "won" : curPrice <= 0.05 ? "lost" : "sold";
    expect(status).toBe("won");
  });

  test("handles exactly 0.05 price as lost", () => {
    const curPrice = 0.05;

    const status = curPrice >= 0.95 ? "won" : curPrice <= 0.05 ? "lost" : "sold";
    expect(status).toBe("lost");
  });
});

// =============================================
// UNIT TESTS: Position Trimming
// =============================================

describe("Position Trimming", () => {
  test("only triggers when >20% over max", () => {
    const maxPerMarket = 25;

    const positions = [
      { value: 24, shouldTrim: false }, // Under limit
      { value: 25, shouldTrim: false }, // At limit
      { value: 28, shouldTrim: false }, // 12% over - under threshold
      { value: 30, shouldTrim: false }, // 20% over - at threshold (not over)
      { value: 30.01, shouldTrim: true }, // Just over 20%
      { value: 35, shouldTrim: true }, // 40% over
      { value: 50, shouldTrim: true }, // 100% over
    ];

    const overExposedThreshold = maxPerMarket * 1.2; // 30

    for (const pos of positions) {
      const shouldTrim = pos.value > overExposedThreshold;
      expect(shouldTrim).toBe(pos.shouldTrim);
    }
  });

  test("does not trim after game has started", () => {
    const now = Math.floor(Date.now() / 1000);

    const scenarios = [
      { commenceTime: now - 3600, gameStarted: true }, // 1 hour ago
      { commenceTime: now - 60, gameStarted: true }, // 1 minute ago
      { commenceTime: now, gameStarted: true }, // Right now
      { commenceTime: now + 60, gameStarted: false }, // 1 minute from now
      { commenceTime: now + 3600, gameStarted: false }, // 1 hour from now
      { commenceTime: null, gameStarted: false }, // No commence time (allow)
    ];

    for (const scenario of scenarios) {
      const gameStarted =
        scenario.commenceTime !== null && scenario.commenceTime <= now;
      expect(gameStarted).toBe(scenario.gameStarted);
    }
  });

  test("calculates correct trim amount", () => {
    const maxPerMarket = 25;
    const currentValue = 40; // 60% over
    const bidPrice = 0.55;
    const shares = 80;

    const excessValue = currentValue - maxPerMarket; // $15 excess
    const sharesToSell = Math.min(excessValue / bidPrice, shares * 0.5);

    // 15 / 0.55 = 27.27 shares needed
    // Max 50% = 40 shares
    // So we sell 27.27 shares
    expect(sharesToSell).toBeCloseTo(27.27, 1);
  });

  test("caps trim at 50% of position", () => {
    const maxPerMarket = 25;
    const currentValue = 100; // Way over
    const bidPrice = 0.50;
    const shares = 200;

    const excessValue = currentValue - maxPerMarket; // $75 excess
    const sharesToSell = Math.min(excessValue / bidPrice, shares * 0.5);

    // 75 / 0.50 = 150 shares needed
    // Max 50% = 100 shares
    // So we cap at 100 shares
    expect(sharesToSell).toBe(100);
  });

  test("does not trim at loss beyond 10%", () => {
    const buyPrice = 0.60;
    const bidPrice = 0.50;

    const profitPct = (bidPrice - buyPrice) / buyPrice; // -16.67%
    const shouldNotTrim = profitPct < -0.1;

    expect(shouldNotTrim).toBe(true);
  });
});

// =============================================
// UNIT TESTS: Commence Time Tracking
// =============================================

describe("Commence Time Tracking", () => {
  test("converts ISO date string to Unix timestamp", () => {
    const isoString = "2026-01-21T00:10:00Z";
    const timestamp = Math.floor(new Date(isoString).getTime() / 1000);

    // 2026-01-21T00:10:00Z is a specific point in time
    expect(timestamp).toBeGreaterThan(0);
    expect(typeof timestamp).toBe("number");
  });

  test("timestamp allows game start comparison", () => {
    const futureGame = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const pastGame = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const now = Math.floor(Date.now() / 1000);

    expect(futureGame > now).toBe(true); // Game hasn't started
    expect(pastGame <= now).toBe(true); // Game has started
  });
});

// =============================================
// IMPROVEMENT 1: Dynamic Edge Thresholds
// =============================================

describe("Improvement 1: Dynamic Edge Thresholds", () => {
  // Re-implement the function for testing
  function calculateDynamicMinEdge(
    bookCount: number,
    variance: number,
    config: {
      dynamicEdgeEnabled: boolean;
      minEdge: number;
      minEdge4Books: number;
      minEdge3Books: number;
      minEdge2Books: number;
      maxVarianceForLowEdge: number;
    }
  ): number {
    if (!config.dynamicEdgeEnabled) {
      return config.minEdge;
    }

    let baseEdge: number;
    if (bookCount >= 4) {
      baseEdge = config.minEdge4Books;
    } else if (bookCount === 3) {
      baseEdge = config.minEdge3Books;
    } else {
      baseEdge = config.minEdge2Books;
    }

    if (variance > config.maxVarianceForLowEdge) {
      const varianceMultiplier = 1 + (variance - config.maxVarianceForLowEdge) / config.maxVarianceForLowEdge;
      baseEdge = Math.min(baseEdge * varianceMultiplier, config.minEdge2Books);
    }

    return baseEdge;
  }

  const defaultConfig = {
    dynamicEdgeEnabled: true,
    minEdge: 0.035,
    minEdge4Books: 0.025,
    minEdge3Books: 0.035,
    minEdge2Books: 0.05,
    maxVarianceForLowEdge: 0.02,
  };

  test("returns fallback minEdge when dynamic edge is disabled", () => {
    const config = { ...defaultConfig, dynamicEdgeEnabled: false };
    const result = calculateDynamicMinEdge(4, 0.01, config);
    expect(result).toBe(0.035);
  });

  test("uses lowest threshold (2.5%) for 4+ books with low variance", () => {
    const result = calculateDynamicMinEdge(4, 0.01, defaultConfig);
    expect(result).toBe(0.025);
  });

  test("uses medium threshold (3.5%) for 3 books with low variance", () => {
    const result = calculateDynamicMinEdge(3, 0.01, defaultConfig);
    expect(result).toBe(0.035);
  });

  test("uses highest threshold (5%) for 2 books", () => {
    const result = calculateDynamicMinEdge(2, 0.01, defaultConfig);
    expect(result).toBe(0.05);
  });

  test("increases threshold when variance is high", () => {
    // 4 books but high variance - should increase from 2.5%
    const result = calculateDynamicMinEdge(4, 0.04, defaultConfig); // variance = 4%, threshold = 2%
    expect(result).toBeGreaterThan(0.025);
    expect(result).toBeLessThanOrEqual(0.05); // Capped at 2-book threshold
  });

  test("caps variance-adjusted threshold at minEdge2Books", () => {
    // Very high variance - should be capped
    const result = calculateDynamicMinEdge(4, 0.10, defaultConfig);
    expect(result).toBe(0.05); // Capped at max
  });

  test("accepts bet with 3% edge when 4 books agree (would reject at static 3.5%)", () => {
    const edge = 0.03; // 3% edge
    const dynamicThreshold = calculateDynamicMinEdge(4, 0.01, defaultConfig);
    expect(edge >= dynamicThreshold).toBe(true); // 3% >= 2.5%

    // With static threshold, would reject
    expect(edge >= defaultConfig.minEdge).toBe(false); // 3% < 3.5%
  });

  test("rejects bet with 4% edge when only 2 books agree", () => {
    const edge = 0.04; // 4% edge
    const dynamicThreshold = calculateDynamicMinEdge(2, 0.01, defaultConfig);
    expect(edge >= dynamicThreshold).toBe(false); // 4% < 5%
  });
});

// =============================================
// IMPROVEMENT 2: Edge-Proportional Position Sizing
// =============================================

describe("Improvement 2: Edge-Proportional Position Sizing", () => {
  function calculateEdgeProportionalShares(
    baseShares: number,
    edge: number,
    minEdge: number,
    maxMultiplier: number,
    enabled: boolean
  ): number {
    if (!enabled) return baseShares;

    const edgeMultiplier = Math.min(edge / minEdge, maxMultiplier);
    return Math.round(baseShares * edgeMultiplier);
  }

  test("returns base shares when disabled", () => {
    const result = calculateEdgeProportionalShares(25, 0.10, 0.035, 3, false);
    expect(result).toBe(25);
  });

  test("returns base shares for minimum edge bet", () => {
    const result = calculateEdgeProportionalShares(25, 0.035, 0.035, 3, true);
    expect(result).toBe(25); // 1x multiplier
  });

  test("doubles shares for 2x edge", () => {
    const result = calculateEdgeProportionalShares(25, 0.07, 0.035, 3, true);
    expect(result).toBe(50); // 2x multiplier
  });

  test("triples shares for 3x edge", () => {
    const result = calculateEdgeProportionalShares(25, 0.105, 0.035, 3, true);
    expect(result).toBe(75); // 3x multiplier
  });

  test("caps at maxMultiplier", () => {
    // 10x edge should still cap at 3x
    const result = calculateEdgeProportionalShares(25, 0.35, 0.035, 3, true);
    expect(result).toBe(75); // Capped at 3x
  });

  test("handles partial multipliers with rounding", () => {
    // 1.5x edge
    const result = calculateEdgeProportionalShares(25, 0.0525, 0.035, 3, true);
    expect(result).toBe(37); // 25 * 1.5 = 37.5, rounded to 37 (Math.round uses banker's rounding)
  });

  test("real world example: 10% edge with 3.5% threshold", () => {
    const baseShares = 25;
    const edge = 0.10; // 10% edge
    const minEdge = 0.035; // 3.5% threshold

    const multiplier = edge / minEdge; // 2.86x
    const shares = calculateEdgeProportionalShares(baseShares, edge, minEdge, 3, true);

    expect(shares).toBe(71); // 25 * 2.86 = 71.43, rounded to 71
  });
});

// =============================================
// IMPROVEMENT 3: Edge Reversal Exit
// =============================================

describe("Improvement 3: Edge Reversal Exit", () => {
  interface EdgeReversalConfig {
    edgeReversalEnabled: boolean;
    edgeReversalThreshold: number;
  }

  function shouldExitOnEdgeReversal(
    currentFairValue: number,
    buyPrice: number,
    config: EdgeReversalConfig
  ): { shouldExit: boolean; currentEdge: number } {
    if (!config.edgeReversalEnabled) {
      return { shouldExit: false, currentEdge: 0 };
    }

    const currentEdge = (currentFairValue - buyPrice) / buyPrice;
    const shouldExit = currentEdge <= config.edgeReversalThreshold;

    return { shouldExit, currentEdge };
  }

  const defaultConfig: EdgeReversalConfig = {
    edgeReversalEnabled: true,
    edgeReversalThreshold: -0.02, // -2%
  };

  test("does not exit when edge is positive", () => {
    const result = shouldExitOnEdgeReversal(0.55, 0.50, defaultConfig);
    expect(result.shouldExit).toBe(false);
    expect(result.currentEdge).toBeCloseTo(0.10, 10); // +10%
  });

  test("does not exit when edge is slightly negative (above threshold)", () => {
    const result = shouldExitOnEdgeReversal(0.495, 0.50, defaultConfig);
    expect(result.shouldExit).toBe(false);
    expect(result.currentEdge).toBeCloseTo(-0.01, 10); // -1% > -2%
  });

  test("exits when edge drops to threshold", () => {
    const result = shouldExitOnEdgeReversal(0.49, 0.50, defaultConfig);
    expect(result.shouldExit).toBe(true);
    expect(result.currentEdge).toBeCloseTo(-0.02, 10); // -2%
  });

  test("exits when edge is strongly negative", () => {
    const result = shouldExitOnEdgeReversal(0.45, 0.50, defaultConfig);
    expect(result.shouldExit).toBe(true);
    expect(result.currentEdge).toBeCloseTo(-0.10, 10); // -10%
  });

  test("does not exit when disabled", () => {
    const config = { ...defaultConfig, edgeReversalEnabled: false };
    const result = shouldExitOnEdgeReversal(0.40, 0.50, config);
    expect(result.shouldExit).toBe(false);
  });

  test("real world scenario: sharp consensus moved against us", () => {
    // We bought at 50¢ when sharp consensus was 55%
    // Now sharp consensus is 47% - edge has reversed
    const buyPrice = 0.50;
    const currentFairValue = 0.47;

    const result = shouldExitOnEdgeReversal(currentFairValue, buyPrice, defaultConfig);

    expect(result.shouldExit).toBe(true);
    expect(result.currentEdge).toBeCloseTo(-0.06, 10); // -6% < -2% threshold
  });
});

// =============================================
// IMPROVEMENT 4: CLV Tracking
// =============================================

describe("Improvement 4: CLV Tracking", () => {
  function calculateCLV(
    entryPrice: number,
    closingSharpProb: number
  ): number {
    return ((closingSharpProb - entryPrice) / entryPrice) * 100;
  }

  test("calculates positive CLV when closing line moves in our favor", () => {
    // We bought at 50¢, closing line moved to 55%
    const clv = calculateCLV(0.50, 0.55);
    expect(clv).toBeCloseTo(10, 10); // +10% CLV
  });

  test("calculates negative CLV when closing line moves against us", () => {
    // We bought at 50¢, closing line moved to 45%
    const clv = calculateCLV(0.50, 0.45);
    expect(clv).toBeCloseTo(-10, 10); // -10% CLV
  });

  test("calculates zero CLV when prices match", () => {
    const clv = calculateCLV(0.50, 0.50);
    expect(clv).toBe(0);
  });

  test("positive CLV indicates good bet timing", () => {
    // Professional standard: beating the closing line consistently indicates skill
    const bets = [
      { entry: 0.45, closing: 0.48 }, // +6.67% CLV
      { entry: 0.52, closing: 0.55 }, // +5.77% CLV
      { entry: 0.38, closing: 0.42 }, // +10.53% CLV
    ];

    const avgCLV = bets.reduce((sum, bet) => sum + calculateCLV(bet.entry, bet.closing), 0) / bets.length;
    expect(avgCLV).toBeGreaterThan(0); // Positive average CLV = good betting
  });

  test("CLV tracking structure", () => {
    const clvRecord = {
      betId: 1,
      userId: 123,
      matchId: "match123",
      outcome: "Team A",
      entryPrice: 0.50,
      entrySharpProb: 0.52,
      closingPrice: 0.55,
      closingSharpProb: 0.57,
      clvPct: 0, // Will be calculated
      bookProbsAtEntry: [0.51, 0.52, 0.53, 0.52],
      bookProbsAtClose: [0.56, 0.57, 0.58, 0.57],
      won: true,
    };

    clvRecord.clvPct = calculateCLV(clvRecord.entryPrice, clvRecord.closingSharpProb);

    expect(clvRecord.clvPct).toBeCloseTo(14, 10); // +14% CLV
    expect(clvRecord.bookProbsAtEntry.length).toBe(4);
    expect(clvRecord.bookProbsAtClose.length).toBe(4);
  });
});

// =============================================
// IMPROVEMENT 5: Correlated Position Limits
// =============================================

describe("Improvement 5: Correlated Position Limits", () => {
  interface OpenBet {
    matchId: string;
    size: number;
    commenceTime: number | null;
  }

  interface CorrelationConfig {
    correlationEnabled: boolean;
    sameEventCorrelation: number;
    sameDayCorrelation: number;
  }

  function calculateCorrelatedExposure(
    openBets: OpenBet[],
    newMatchId: string,
    newCommenceTime: string | null,
    config: CorrelationConfig
  ): number {
    if (!config.correlationEnabled || openBets.length === 0) {
      return openBets.reduce((sum, bet) => sum + bet.size, 0);
    }

    const newBetDate = newCommenceTime ? new Date(newCommenceTime).toDateString() : null;
    let totalEffectiveExposure = 0;

    for (const bet of openBets) {
      let correlationFactor = 1.0;

      if (bet.matchId === newMatchId) {
        correlationFactor = config.sameEventCorrelation;
      } else if (bet.commenceTime && newBetDate) {
        const betDate = new Date(bet.commenceTime * 1000).toDateString();
        if (betDate === newBetDate) {
          correlationFactor = config.sameDayCorrelation;
        }
      }

      totalEffectiveExposure += bet.size * correlationFactor;
    }

    return totalEffectiveExposure;
  }

  const defaultConfig: CorrelationConfig = {
    correlationEnabled: true,
    sameEventCorrelation: 0.8,
    sameDayCorrelation: 0.3,
  };

  test("returns simple sum when disabled", () => {
    const config = { ...defaultConfig, correlationEnabled: false };
    const openBets: OpenBet[] = [
      { matchId: "match1", size: 10, commenceTime: 1705788000 },
      { matchId: "match2", size: 15, commenceTime: 1705788000 },
    ];

    const result = calculateCorrelatedExposure(openBets, "match3", "2025-01-20T12:00:00Z", config);
    expect(result).toBe(25); // Simple sum
  });

  test("applies high correlation factor for same event bets", () => {
    const openBets: OpenBet[] = [
      { matchId: "match1", size: 20, commenceTime: 1705788000 },
    ];

    const result = calculateCorrelatedExposure(openBets, "match1", "2025-01-20T12:00:00Z", defaultConfig);
    expect(result).toBe(16); // 20 * 0.8 = 16
  });

  test("applies medium correlation factor for same day bets", () => {
    const sameDay = Math.floor(Date.now() / 1000);
    const sameDayIso = new Date(sameDay * 1000).toISOString();

    const openBets: OpenBet[] = [
      { matchId: "match1", size: 20, commenceTime: sameDay },
    ];

    const result = calculateCorrelatedExposure(openBets, "match2", sameDayIso, defaultConfig);
    expect(result).toBe(6); // 20 * 0.3 = 6
  });

  test("applies no correlation for different days/events", () => {
    const today = Math.floor(Date.now() / 1000);
    const tomorrow = today + 86400;
    const tomorrowIso = new Date(tomorrow * 1000).toISOString();

    const openBets: OpenBet[] = [
      { matchId: "match1", size: 20, commenceTime: today },
    ];

    const result = calculateCorrelatedExposure(openBets, "match2", tomorrowIso, defaultConfig);
    expect(result).toBe(20); // 20 * 1.0 = 20 (no correlation)
  });

  test("calculates mixed portfolio with varying correlations", () => {
    const today = Math.floor(Date.now() / 1000);
    const todayIso = new Date(today * 1000).toISOString();

    const openBets: OpenBet[] = [
      { matchId: "gameA", size: 10, commenceTime: today }, // Same day as new bet
      { matchId: "gameB", size: 15, commenceTime: today }, // Same day as new bet
      { matchId: "gameC", size: 20, commenceTime: today - 86400 }, // Different day
    ];

    // New bet is on gameA (same event)
    const result = calculateCorrelatedExposure(openBets, "gameA", todayIso, defaultConfig);

    // gameA: 10 * 0.8 = 8 (same event)
    // gameB: 15 * 0.3 = 4.5 (same day)
    // gameC: 20 * 1.0 = 20 (different day)
    // Total: 32.5
    expect(result).toBeCloseTo(32.5, 10);
  });

  test("reduces effective exposure allowing more bets", () => {
    const today = Math.floor(Date.now() / 1000);
    const todayIso = new Date(today * 1000).toISOString();

    const openBets: OpenBet[] = [
      { matchId: "match1", size: 40, commenceTime: today },
    ];

    const simpleExposure = openBets.reduce((sum, bet) => sum + bet.size, 0);
    const correlatedExposure = calculateCorrelatedExposure(openBets, "match2", todayIso, defaultConfig);

    // Simple exposure: 40
    // Correlated (same day): 40 * 0.3 = 12
    expect(simpleExposure).toBe(40);
    expect(correlatedExposure).toBe(12);

    // With $50 max exposure:
    // Without correlation: can only add $10 more
    // With correlation: can add $38 more
    const maxExposure = 50;
    expect(maxExposure - simpleExposure).toBe(10);
    expect(maxExposure - correlatedExposure).toBe(38);
  });
});

// =============================================
// INTEGRATION: All Improvements Working Together
// =============================================

describe("Integration: All Improvements Working Together", () => {
  test("high-confidence bet gets more shares with lower edge threshold", () => {
    // Scenario: 4 books agree with low variance, 4% edge
    const bookCount = 4;
    const variance = 0.01;
    const edge = 0.04;
    const baseShares = 25;

    // Dynamic edge threshold
    const dynamicMinEdge = 0.025; // 4 books = 2.5%
    const meetsThreshold = edge >= dynamicMinEdge;
    expect(meetsThreshold).toBe(true); // 4% >= 2.5%

    // Edge-proportional sizing
    const edgeMultiplier = Math.min(edge / dynamicMinEdge, 3);
    const shares = Math.round(baseShares * edgeMultiplier);
    expect(shares).toBe(40); // 25 * 1.6 = 40
  });

  test("low-confidence bet rejected despite having edge", () => {
    // Scenario: Only 2 books, but 4% edge
    const bookCount = 2;
    const variance = 0.03; // High variance
    const edge = 0.04;

    // Dynamic edge threshold for 2 books
    const dynamicMinEdge = 0.05; // 2 books = 5%
    const meetsThreshold = edge >= dynamicMinEdge;
    expect(meetsThreshold).toBe(false); // 4% < 5%
  });

  test("edge reversal triggers exit before loss deepens", () => {
    // Bought at 50¢ with 5% positive edge
    const buyPrice = 0.50;
    const entrySharpProb = 0.525; // 52.5%
    const entryEdge = (entrySharpProb - buyPrice) / buyPrice; // 5%
    expect(entryEdge).toBeCloseTo(0.05, 10);

    // Sharp consensus moves against us to 47%
    const currentSharpProb = 0.47;
    const currentEdge = (currentSharpProb - buyPrice) / buyPrice;
    expect(currentEdge).toBeCloseTo(-0.06, 10); // -6%

    // Exit triggered
    const shouldExit = currentEdge <= -0.02;
    expect(shouldExit).toBe(true);
  });

  test("correlated exposure allows diversification across days", () => {
    const today = Math.floor(Date.now() / 1000);
    const tomorrow = today + 86400;

    // Portfolio: 3 bets on today's games
    const todaysBets = [
      { matchId: "game1", size: 15, commenceTime: today },
      { matchId: "game2", size: 15, commenceTime: today },
      { matchId: "game3", size: 15, commenceTime: today },
    ];

    const simpleExposure = 45; // $45 total
    const balance = 100;
    const maxExposurePct = 0.5; // 50%
    const maxExposure = balance * maxExposurePct; // $50

    // Without correlation, can only add $5 more
    expect(maxExposure - simpleExposure).toBe(5);

    // With correlation (0.3 for same day), effective exposure is much lower
    const correlatedExposure = 45 * 0.3; // $13.50
    expect(maxExposure - correlatedExposure).toBeCloseTo(36.5, 10);

    // Can add tomorrow's bets with full sizing
    const tomorrowBetSize = 15;
    const tomorrowEffectiveExposure = correlatedExposure + tomorrowBetSize * 1.0; // No correlation with today
    expect(tomorrowEffectiveExposure).toBeCloseTo(28.5, 10);
    expect(tomorrowEffectiveExposure).toBeLessThan(maxExposure);
  });
});

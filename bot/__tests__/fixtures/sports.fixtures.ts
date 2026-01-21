// Real API responses captured on 2026-01-20 for comprehensive testing
// These fixtures represent actual production data from Odds API, Polymarket Gamma API, and CLOB API

// =============================================
// ODDS API FIXTURES
// =============================================

export const ODDS_API_NBA_MATCH = {
  id: "8b31228a946c10f7e851d0948dd174f0",
  sport_key: "basketball_nba",
  sport_title: "NBA",
  commence_time: "2026-01-21T00:10:00Z",
  home_team: "Philadelphia 76ers",
  away_team: "Phoenix Suns",
  bookmakers: [
    {
      key: "fanduel",
      title: "FanDuel",
      last_update: "2026-01-20T12:16:41Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-20T12:16:41Z",
          outcomes: [
            { name: "Philadelphia 76ers", price: -118 },
            { name: "Phoenix Suns", price: 100 },
          ],
        },
      ],
    },
    {
      key: "draftkings",
      title: "DraftKings",
      last_update: "2026-01-20T12:16:03Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-20T12:16:03Z",
          outcomes: [
            { name: "Philadelphia 76ers", price: -118 },
            { name: "Phoenix Suns", price: -102 },
          ],
        },
      ],
    },
    {
      key: "betonlineag",
      title: "BetOnline.ag",
      last_update: "2026-01-20T12:16:00Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-20T12:16:00Z",
          outcomes: [
            { name: "Philadelphia 76ers", price: -115 },
            { name: "Phoenix Suns", price: -105 },
          ],
        },
      ],
    },
    {
      key: "lowvig",
      title: "LowVig",
      last_update: "2026-01-20T12:15:50Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-20T12:15:50Z",
          outcomes: [
            { name: "Philadelphia 76ers", price: -112 },
            { name: "Phoenix Suns", price: -108 },
          ],
        },
      ],
    },
  ],
};

export const ODDS_API_NCAAB_MATCH = {
  id: "c7c7a4e3300099ab799f0698f18dd9f4",
  sport_key: "basketball_ncaab",
  sport_title: "NCAAB",
  commence_time: "2026-01-20T23:00:00Z",
  home_team: "Massachusetts Minutemen",
  away_team: "Toledo Rockets",
  bookmakers: [
    {
      key: "draftkings",
      title: "DraftKings",
      last_update: "2026-01-20T12:16:23Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-20T12:16:23Z",
          outcomes: [
            { name: "Massachusetts Minutemen", price: -130 },
            { name: "Toledo Rockets", price: 110 },
          ],
        },
      ],
    },
    {
      key: "fanduel",
      title: "FanDuel",
      last_update: "2026-01-20T12:17:19Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-01-20T12:17:19Z",
          outcomes: [
            { name: "Massachusetts Minutemen", price: -134 },
            { name: "Toledo Rockets", price: 112 },
          ],
        },
      ],
    },
  ],
};

export const ODDS_API_SCORES = [
  {
    id: "60b04efecd19028a2eb20c81649abaf1",
    sport_key: "basketball_nba",
    sport_title: "NBA",
    commence_time: "2026-01-19T18:12:00Z",
    completed: true,
    home_team: "Atlanta Hawks",
    away_team: "Milwaukee Bucks",
    scores: [
      { name: "Atlanta Hawks", score: "110" },
      { name: "Milwaukee Bucks", score: "112" },
    ],
    last_update: "2026-01-20T10:54:19Z",
  },
  {
    id: "d9b1ce3cf25e2645fdb24e89d4f1a38e",
    sport_key: "basketball_nba",
    sport_title: "NBA",
    commence_time: "2026-01-19T19:43:00Z",
    completed: true,
    home_team: "Cleveland Cavaliers",
    away_team: "Oklahoma City Thunder",
    scores: [
      { name: "Cleveland Cavaliers", score: "104" },
      { name: "Oklahoma City Thunder", score: "136" },
    ],
    last_update: "2026-01-20T10:54:19Z",
  },
  {
    id: "live_game_close",
    sport_key: "basketball_nba",
    sport_title: "NBA",
    commence_time: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 mins ago (close game)
    completed: false,
    home_team: "Lakers",
    away_team: "Celtics",
    scores: [
      { name: "Lakers", score: "98" },
      { name: "Celtics", score: "96" },
    ],
    last_update: new Date().toISOString(),
  },
  {
    id: "live_game_blowout",
    sport_key: "basketball_nba",
    sport_title: "NBA",
    commence_time: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago
    completed: false,
    home_team: "Warriors",
    away_team: "Rockets",
    scores: [
      { name: "Warriors", score: "85" },
      { name: "Rockets", score: "60" },
    ],
    last_update: new Date().toISOString(),
  },
];

// =============================================
// POLYMARKET GAMMA API FIXTURES
// =============================================

export const POLYMARKET_NBA_EVENT = {
  id: "163905",
  ticker: "nba-phx-phi-2026-01-20",
  slug: "nba-phx-phi-2026-01-20",
  title: "Suns vs. 76ers",
  startDate: "2026-01-14T15:03:11.940577Z",
  endDate: "2026-01-21T00:00:00Z",
  markets: [
    {
      id: "1182905",
      question: "Suns vs. 76ers",
      conditionId: "0x85c21822935272188a7e4120b41e22c3e9c8a7a83748775927b2fffb50579189",
      slug: "nba-phx-phi-2026-01-20",
      outcomes: '["Suns", "76ers"]',
      outcomePrices: '["0.475", "0.525"]',
      clobTokenIds:
        '["26310511444966676152901239545213464869875480698266972830365142324057733576025", "107304261111525064103207984838181959789682970840092415021608210339948891720616"]',
      groupItemTitle: "Winner",
    },
    {
      id: "1224113",
      question: "Spread: 76ers (-1.5)",
      conditionId: "0xb8edcccde8a3f4506cf79a3748424d4f89fe5f86a94680eb38ab21e09559faff",
      outcomes: '["76ers", "Suns"]',
      outcomePrices: '["0.50", "0.50"]',
      clobTokenIds: '["75185733208318247032936865912332363200793790896954973394879515783960001573330", "44683415962066682900056622910696635423446780384386533842243604852271942386010"]',
      groupItemTitle: "Spread -1.5",
    },
    {
      id: "1224114",
      question: "Suns vs. 76ers: O/U 224.5",
      conditionId: "0xbcfce0bad4e57c61533bae95154a27b45ac9af09d73c5e03cb7f297ac9e6d1f4",
      outcomes: '["Over", "Under"]',
      outcomePrices: '["0.505", "0.495"]',
      clobTokenIds: '["101679764064642550551590177148320815758771022397472067091646688197033776355114", "79639708567359544282903652600193160722488569767745609397703803599462820042682"]',
      groupItemTitle: "O/U 224.5",
    },
  ],
};

export const POLYMARKET_NCAAB_EVENT = {
  id: "163915",
  ticker: "cbb-tmrt-semst-2026-01-20",
  slug: "cbb-tmrt-semst-2026-01-20",
  title: "UT Martin Skyhawks vs. Southeast Missouri State Redhawks",
  startDate: "2026-01-14T15:07:01.927099Z",
  endDate: "2026-01-21T01:30:00Z",
  markets: [
    {
      id: "1182954",
      question: "UT Martin Skyhawks vs. Southeast Missouri State Redhawks",
      conditionId: "0x4617f3ed56219f35d00e960fc62a740715bac7c1cde1251a929ff841b09e331f",
      outcomes: '["UT Martin Skyhawks", "Southeast Missouri State Redhawks"]',
      outcomePrices: '["0.43", "0.57"]',
      clobTokenIds: '["12345678901234567890", "09876543210987654321"]',
      groupItemTitle: "Winner",
    },
  ],
};

// =============================================
// CLOB API FIXTURES
// =============================================

export const CLOB_PRICE_ASK = { price: "0.48" };
export const CLOB_PRICE_BID = { price: "0.47" };

export const CLOB_ORDERBOOK = {
  market: "0x85c21822935272188a7e4120b41e22c3e9c8a7a83748775927b2fffb50579189",
  asset_id: "26310511444966676152901239545213464869875480698266972830365142324057733576025",
  timestamp: "1768911536630",
  hash: "6fd4745ce8505c836cdfc0f861c2b102bd87e43f",
  bids: [
    { price: "0.47", size: "14971.88" },
    { price: "0.46", size: "25500.32" },
    { price: "0.45", size: "18863.96" },
    { price: "0.44", size: "23645.63" },
    { price: "0.43", size: "587" },
    { price: "0.42", size: "1100" },
  ],
  asks: [
    { price: "0.48", size: "22588.01" },
    { price: "0.49", size: "13787.54" },
    { price: "0.50", size: "13807.13" },
    { price: "0.51", size: "17288.91" },
    { price: "0.52", size: "30104.86" },
    { price: "0.53", size: "21699.11" },
  ],
  min_order_size: "5",
  tick_size: "0.01",
  neg_risk: false,
  last_trade_price: "0.470",
};

// =============================================
// SPORTS CONFIG FIXTURES
// =============================================

export const DEFAULT_TEST_CONFIG = {
  enabled: true,
  minEdge: 0.035,
  minSellEdge: 0.05,
  minSellProfit: 0.05,
  kellyFraction: 0.25,
  maxBetPct: 0.03,
  maxExposurePct: 0.5,
  minBetUsd: 0.5,
  maxBetUsd: 5,
  maxPerMarket: 25,
  sharesPerBet: 25,
  maxSharesPerMarket: 100,
  booksRequired: 2,
  maxBetsPerEvent: 15,
  sports: ["basketball_nba", "basketball_ncaab"],
  autoTrade: true,
  maxHoldPrice: 0.85,
  minPrice: 0.4,
};

// =============================================
// VALUE BET FIXTURES
// =============================================

export const SAMPLE_VALUE_BET = {
  id: "8b31228a946c10f7e851d0948dd174f0-0",
  matchId: "8b31228a946c10f7e851d0948dd174f0",
  sport: "NBA",
  homeTeam: "Philadelphia 76ers",
  awayTeam: "Phoenix Suns",
  commenceTime: "2026-01-21T00:10:00Z",
  outcome: "Suns",
  sharpOdds: 0,
  sharpProb: 0.52,
  polymarketPrice: 0.475,
  edge: 0.0947, // (0.52 - 0.475) / 0.475
  expectedValue: 0.045,
  recommendedSize: 0.01,
  bookmakerConsensus: 4,
  polymarketTokenId: "26310511444966676152901239545213464869875480698266972830365142324057733576025",
  polymarketConditionId: "0x85c21822935272188a7e4120b41e22c3e9c8a7a83748775927b2fffb50579189",
  detectedAt: Math.floor(Date.now() / 1000),
};

// =============================================
// OPEN BET FIXTURES
// =============================================

export const SAMPLE_OPEN_BET = {
  id: 1,
  userId: 1,
  matchId: "8b31228a946c10f7e851d0948dd174f0",
  sport: "NBA",
  homeTeam: "Philadelphia 76ers",
  awayTeam: "Phoenix Suns",
  outcome: "Suns",
  tokenId: "26310511444966676152901239545213464869875480698266972830365142324057733576025",
  shares: 25,
  buyPrice: 0.475,
  size: 11.875, // 25 shares * $0.475
};

// =============================================
// EDGE CASES
// =============================================

export const STALE_BOOKMAKER_DATA = {
  key: "stale_book",
  title: "Stale Book",
  last_update: "2026-01-20T12:00:00Z", // More than 5 minutes old
  markets: [
    {
      key: "h2h",
      last_update: "2026-01-20T12:00:00Z",
      outcomes: [
        { name: "Team A", price: -110 },
        { name: "Team B", price: -110 },
      ],
    },
  ],
};

export const EXTREME_UNDERDOG_MATCH = {
  id: "underdog_match",
  sport_key: "basketball_nba",
  sport_title: "NBA",
  commence_time: "2026-01-21T00:10:00Z",
  home_team: "Team Favorite",
  away_team: "Team Underdog",
  bookmakers: [
    {
      key: "draftkings",
      title: "DraftKings",
      last_update: new Date().toISOString(),
      markets: [
        {
          key: "h2h",
          last_update: new Date().toISOString(),
          outcomes: [
            { name: "Team Favorite", price: -500 },
            { name: "Team Underdog", price: 400 },
          ],
        },
      ],
    },
    {
      key: "fanduel",
      title: "FanDuel",
      last_update: new Date().toISOString(),
      markets: [
        {
          key: "h2h",
          last_update: new Date().toISOString(),
          outcomes: [
            { name: "Team Favorite", price: -450 },
            { name: "Team Underdog", price: 350 },
          ],
        },
      ],
    },
  ],
};

import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'polybot.db');

// Fetch current bid price from Polymarket CLOB (what you'd get if you sell)
// Returns: number (valid price), 0 (market resolved/404), or null (network error)
async function fetchCurrentPrice(tokenId: string): Promise<number | null> {
  try {
    const url = `https://clob.polymarket.com/price?token_id=${tokenId}&side=buy`;
    const response = await fetch(url, { cache: 'no-store' });
    if (response.status === 404) {
      // 404 = token doesn't exist = market resolved
      console.log(`CLOB token not found (resolved): ${tokenId}`);
      return 0;
    }
    if (!response.ok) {
      console.log(`CLOB price fetch failed for ${tokenId}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const price = parseFloat(data.price);
    console.log(`CLOB price for ${tokenId}: ${price}`);
    return isNaN(price) ? null : price;
  } catch (err) {
    console.log(`CLOB price error for ${tokenId}:`, err);
    return null;
  }
}

interface SportsBetRow {
  id: number;
  match_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  outcome: string;
  token_id: string;
  condition_id: string;
  shares: number;
  sharp_prob: number;
  poly_price: number;
  edge: number;
  size: number;
  order_id: string;
  status: string;
  sell_price: number | null;
  profit: number | null;
  created_at: number;
}

interface Position {
  id: string;
  matchId: string;
  sport: string;
  league: string;
  icon: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  tokenId: string;
  conditionId: string;
  shares: number;
  entryPrice: number;
  curPrice: number; // Would need live data for this
  edge: number;
  size: number;
  value: number;
  toWin: number;
  pnl: number;
  pnlPercent: number;
  orderId: string;
  status: string;
  createdAt: number;
}

function detectLeague(sport: string): { league: string; icon: string } {
  const s = sport.toLowerCase();
  if (s.includes('basketball_nba') || s.includes('nba')) return { league: 'NBA', icon: '🏀' };
  if (s.includes('basketball_ncaa') || s.includes('ncaab')) return { league: 'NCAAB', icon: '🏀' };
  if (s.includes('football') || s.includes('nfl')) return { league: 'NFL', icon: '🏈' };
  if (s.includes('hockey') || s.includes('nhl')) return { league: 'NHL', icon: '🏒' };
  if (s.includes('baseball') || s.includes('mlb')) return { league: 'MLB', icon: '⚾' };
  if (s.includes('soccer')) return { league: 'Soccer', icon: '⚽' };
  if (s.includes('tennis')) return { league: 'Tennis', icon: '🎾' };
  return { league: 'Other', icon: '📊' };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'open'; // Default to open positions
    const league = searchParams.get('league'); // Optional league filter

    const db = new Database(DB_PATH, { readonly: true });

    // Get bets from sports_bets table
    // Status 'open' or 'placed' are both considered "active" positions
    let query = `
      SELECT id, match_id, sport, home_team, away_team, outcome,
             token_id, condition_id, shares, sharp_prob, poly_price, edge, size,
             order_id, status, sell_price, profit, created_at
      FROM sports_bets
    `;

    let rows: SportsBetRow[];
    if (status === 'open') {
      // Include both 'open' and 'placed' as active
      query += ` WHERE status IN ('open', 'placed') ORDER BY created_at DESC`;
      rows = db.prepare(query).all() as SportsBetRow[];
    } else if (status === 'all') {
      query += ` ORDER BY created_at DESC`;
      rows = db.prepare(query).all() as SportsBetRow[];
    } else {
      query += ` WHERE status = ? ORDER BY created_at DESC`;
      rows = db.prepare(query).all(status) as SportsBetRow[];
    }
    db.close();

    // Fetch live prices for unique tokens in parallel
    const uniqueTokenIds = [...new Set(rows.map((row) => row.token_id).filter(Boolean))];
    console.log(`Fetching prices for ${uniqueTokenIds.length} unique tokens`);
    const pricePromises = uniqueTokenIds.map((tokenId) => fetchCurrentPrice(tokenId));
    const prices = await Promise.all(pricePromises);
    const priceMap = new Map<string, number | null>();
    uniqueTokenIds.forEach((tokenId, i) => {
      priceMap.set(tokenId, prices[i]); // Store null too so we know we tried
    });

    // Group positions by tokenId (same market + outcome)
    const groupedPositions = new Map<string, {
      rows: SportsBetRow[];
      curPrice: number;
    }>();

    for (const row of rows) {
      const key = row.token_id || `${row.match_id}-${row.outcome}`;
      const existing = groupedPositions.get(key);

      // Get live price - if API failed (null), fall back to entry price
      // If API returned 0, the market resolved (lost)
      const livePrice = priceMap.get(row.token_id);
      const curPrice = livePrice !== null && livePrice !== undefined ? livePrice : (row.poly_price ?? 0);

      if (existing) {
        existing.rows.push(row);
      } else {
        groupedPositions.set(key, { rows: [row], curPrice });
      }
    }

    // Transform to aggregated positions format
    const positions: Position[] = Array.from(groupedPositions.entries()).map(([key, { rows: groupRows, curPrice }]) => {
      const firstRow = groupRows[0];
      const { league: detectedLeague, icon } = detectLeague(firstRow.sport);

      // Aggregate values across all rows in the group
      const totalShares = groupRows.reduce((sum, r) => sum + (r.shares || 0), 0);
      const totalSize = groupRows.reduce((sum, r) => sum + (r.size || 0), 0);
      const avgEntryPrice = totalShares > 0
        ? groupRows.reduce((sum, r) => sum + (r.shares || 0) * (r.poly_price || 0), 0) / totalShares
        : firstRow.poly_price || 0;
      const avgEdge = groupRows.reduce((sum, r) => sum + r.edge, 0) / groupRows.length;
      const earliestCreatedAt = Math.min(...groupRows.map(r => r.created_at));

      const value = totalShares * curPrice;
      const toWin = totalShares - totalSize; // Profit if it wins
      const pnl = value - totalSize;
      const pnlPercent = totalSize > 0 ? (pnl / totalSize) * 100 : 0;

      return {
        id: groupRows.map(r => r.id).join(','),
        matchId: firstRow.match_id,
        sport: firstRow.sport,
        league: detectedLeague,
        icon,
        match: `${firstRow.home_team} vs ${firstRow.away_team}`,
        homeTeam: firstRow.home_team,
        awayTeam: firstRow.away_team,
        outcome: firstRow.outcome,
        tokenId: firstRow.token_id,
        conditionId: firstRow.condition_id,
        shares: totalShares,
        entryPrice: avgEntryPrice,
        curPrice,
        edge: avgEdge,
        size: totalSize,
        value,
        toWin,
        pnl,
        pnlPercent,
        orderId: groupRows.map(r => r.order_id).join(','),
        status: firstRow.status,
        createdAt: earliestCreatedAt * 1000,
      };
    });

    // Filter out near-zero value positions (likely resolved/lost)
    console.log(`Positions before filter: ${positions.length}`);
    positions.forEach(p => console.log(`  ${p.outcome}: curPrice=${p.curPrice}, value=${p.value}`));
    let filteredPositions = positions.filter((p) => p.curPrice >= 0.01);
    console.log(`Positions after filter: ${filteredPositions.length}`);

    // Filter by league if specified
    if (league) {
      filteredPositions = filteredPositions.filter((p) => p.league.toLowerCase() === league.toLowerCase());
    }

    // Calculate summary
    const summary = {
      totalPositions: filteredPositions.length,
      totalValue: filteredPositions.reduce((sum, p) => sum + p.value, 0),
      totalCost: filteredPositions.reduce((sum, p) => sum + p.size, 0),
      totalPnl: filteredPositions.reduce((sum, p) => sum + p.pnl, 0),
      totalToWin: filteredPositions.reduce((sum, p) => sum + p.toWin, 0),
      avgEdge: filteredPositions.length > 0
        ? filteredPositions.reduce((sum, p) => sum + p.edge, 0) / filteredPositions.length
        : 0,
    };

    return NextResponse.json({
      positions: filteredPositions,
      summary,
    });
  } catch (error: any) {
    console.error('Failed to fetch positions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch positions' },
      { status: 500 }
    );
  }
}

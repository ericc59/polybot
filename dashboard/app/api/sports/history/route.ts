import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'polybot.db');

interface SportsBetRow {
  id: number;
  user_id: number;
  match_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  outcome: string;
  token_id: string;
  shares: number;
  sharp_prob: number;
  poly_price: number;
  edge: number;
  size: number;
  order_id: string;
  status: string;
  sell_price: number | null;
  profit: number | null;  // Column is 'profit' not 'pnl'
  created_at: number;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const status = searchParams.get('status'); // 'open', 'won', 'lost', 'sold', or null for all

    const db = new Database(DB_PATH, { readonly: true });

    let query = `
      SELECT id, user_id, match_id, sport, home_team, away_team, outcome,
             token_id, shares, sharp_prob, poly_price, edge, size, order_id,
             status, sell_price, profit, created_at
      FROM sports_bets
    `;

    const params: any[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params) as SportsBetRow[];
    db.close();

    const bets = rows.map((row) => ({
      id: row.id.toString(),
      matchId: row.match_id,
      sport: row.sport,
      match: `${row.home_team} vs ${row.away_team}`,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      outcome: row.outcome,
      tokenId: row.token_id,
      shares: row.shares || 0,
      sharpProb: row.sharp_prob,
      entryPrice: row.poly_price,
      edge: row.edge,
      size: row.size,
      orderId: row.order_id,
      status: row.status || 'open',
      sellPrice: row.sell_price,
      pnl: row.profit,  // Use 'profit' column
      createdAt: row.created_at * 1000, // Convert to milliseconds
      settledAt: null,  // Not tracked in schema
    }));

    // Calculate summary stats
    // 'open' and 'placed' are both considered active/open bets
    const isOpenStatus = (s: string) => s === 'open' || s === 'placed';
    const openBets = bets.filter((b) => isOpenStatus(b.status));
    const settledBets = bets.filter((b) => !isOpenStatus(b.status));
    const totalPnl = settledBets.reduce((sum, b) => sum + (b.pnl || 0), 0);
    const winCount = settledBets.filter((b) => b.status === 'won').length;
    const lostCount = settledBets.filter((b) => b.status === 'lost').length;
    const totalWagered = settledBets.reduce((sum, b) => sum + b.size, 0);
    const openValue = openBets.reduce((sum, b) => sum + b.size, 0);

    return NextResponse.json({
      bets,
      stats: {
        totalBets: bets.length,
        openBets: openBets.length,
        settledBets: settledBets.length,
        winCount,
        lostCount,
        winRate: settledBets.length > 0 ? winCount / settledBets.length : 0,
        totalPnl,
        totalWagered,
        openValue,
        roi: totalWagered > 0 ? totalPnl / totalWagered : 0,
      },
    });
  } catch (error: any) {
    console.error('Failed to fetch sports history:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch sports history' },
      { status: 500 }
    );
  }
}

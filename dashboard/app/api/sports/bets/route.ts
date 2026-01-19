import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

// Connect to the main bot's database
const dbPath = path.join(process.cwd(), '..', 'data', 'polybot.db');

interface SportsBet {
  id: number;
  userId: number;
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  tokenId: string | null;
  shares: number | null;
  sharpProb: number;
  polyPrice: number;
  edge: number;
  size: number;
  orderId: string | null;
  conditionId: string | null;
  status: string;
  sellPrice: number | null;
  profit: number | null;
  createdAt: number;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open'; // open, sold, won, lost, all
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  try {
    const db = new Database(dbPath, { readonly: true });

    let query = `
      SELECT
        id,
        user_id as userId,
        match_id as matchId,
        sport,
        home_team as homeTeam,
        away_team as awayTeam,
        outcome,
        token_id as tokenId,
        shares,
        sharp_prob as sharpProb,
        poly_price as polyPrice,
        edge,
        size,
        order_id as orderId,
        condition_id as conditionId,
        status,
        sell_price as sellPrice,
        profit,
        created_at as createdAt
      FROM sports_bets
    `;

    if (status !== 'all') {
      query += ` WHERE status = ?`;
    }
    query += ` ORDER BY created_at DESC LIMIT ?`;

    const bets = status !== 'all'
      ? db.prepare(query).all(status, limit) as SportsBet[]
      : db.prepare(query).all(limit) as SportsBet[];

    db.close();

    // Calculate summary stats
    const openBets = bets.filter(b => b.status === 'open');
    const wonBets = bets.filter(b => b.status === 'won');
    const lostBets = bets.filter(b => b.status === 'lost');
    const soldBets = bets.filter(b => b.status === 'sold');

    const summary = {
      totalBets: bets.length,
      openCount: openBets.length,
      openValue: openBets.reduce((sum, b) => sum + b.size, 0),
      wonCount: wonBets.length,
      lostCount: lostBets.length,
      soldCount: soldBets.length,
      totalProfit: bets.reduce((sum, b) => sum + (b.profit || 0), 0),
      avgEdge: bets.length > 0
        ? bets.reduce((sum, b) => sum + b.edge, 0) / bets.length
        : 0,
    };

    return NextResponse.json({
      bets,
      summary,
    });
  } catch (error) {
    console.error('Error fetching sports bets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sports bets', details: String(error) },
      { status: 500 }
    );
  }
}

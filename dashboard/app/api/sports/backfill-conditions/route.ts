import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'polybot.db');
const GAMMA_API = 'https://gamma-api.polymarket.com';

interface BetWithoutCondition {
  id: number;
  token_id: string;
  home_team: string;
  away_team: string;
}

interface GammaMarket {
  conditionId: string;
  clobTokenIds: string;
}

/**
 * Try to find condition_id by searching for the token_id in Polymarket markets
 */
async function findConditionByTokenId(tokenId: string): Promise<string | null> {
  try {
    // Search recent sports markets
    const response = await fetch(
      `${GAMMA_API}/markets?closed=false&tag=sports&limit=500`
    );
    if (!response.ok) return null;

    const markets = await response.json() as GammaMarket[];

    for (const market of markets) {
      if (!market.clobTokenIds) continue;
      try {
        const tokenIds = JSON.parse(market.clobTokenIds) as string[];
        if (tokenIds.includes(tokenId)) {
          return market.conditionId;
        }
      } catch {
        continue;
      }
    }

    // Also search closed markets
    const closedResponse = await fetch(
      `${GAMMA_API}/markets?closed=true&tag=sports&limit=500`
    );
    if (closedResponse.ok) {
      const closedMarkets = await closedResponse.json() as GammaMarket[];
      for (const market of closedMarkets) {
        if (!market.clobTokenIds) continue;
        try {
          const tokenIds = JSON.parse(market.clobTokenIds) as string[];
          if (tokenIds.includes(tokenId)) {
            return market.conditionId;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function POST() {
  try {
    const db = new Database(DB_PATH);

    // Get all bets without condition_id
    const betsWithoutCondition = db.prepare(`
      SELECT id, token_id, home_team, away_team
      FROM sports_bets
      WHERE condition_id IS NULL AND token_id IS NOT NULL
    `).all() as BetWithoutCondition[];

    if (betsWithoutCondition.length === 0) {
      db.close();
      return NextResponse.json({ message: 'All bets already have condition IDs', updated: 0 });
    }

    // Group by token_id to avoid duplicate lookups
    const tokenIds = [...new Set(betsWithoutCondition.map(b => b.token_id))];

    let updated = 0;
    const results: string[] = [];

    for (const tokenId of tokenIds) {
      const conditionId = await findConditionByTokenId(tokenId);

      if (conditionId) {
        // Update all bets with this token_id
        const result = db.prepare(`
          UPDATE sports_bets
          SET condition_id = ?
          WHERE token_id = ? AND condition_id IS NULL
        `).run(conditionId, tokenId);

        updated += result.changes;
        const bet = betsWithoutCondition.find(b => b.token_id === tokenId);
        results.push(`Found condition for ${bet?.home_team} vs ${bet?.away_team}: ${conditionId.slice(0, 10)}...`);
      }

      // Small delay between API calls
      await new Promise(r => setTimeout(r, 200));
    }

    db.close();

    return NextResponse.json({
      message: `Backfilled ${updated} bets with condition IDs`,
      total: betsWithoutCondition.length,
      updated,
      results,
    });
  } catch (error: any) {
    console.error('Failed to backfill conditions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to backfill conditions' },
      { status: 500 }
    );
  }
}

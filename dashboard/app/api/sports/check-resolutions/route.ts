import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'polybot.db');
const CLOB_API = 'https://clob.polymarket.com';

interface OpenBet {
  id: number;
  outcome: string;
  shares: number;
  size: number;
  condition_id: string;
  home_team: string;
  away_team: string;
}

async function getMarketResolution(conditionId: string): Promise<{ resolved: boolean; winningOutcome: string | null } | null> {
  try {
    const response = await fetch(`${CLOB_API}/markets/${conditionId}`);
    if (!response.ok) return null;

    const data = await response.json() as {
      condition_id: string;
      tokens: Array<{ outcome: string; winner: boolean }>;
      archived?: boolean;
    };

    const isResolved = data.archived === true;
    if (!isResolved) {
      return { resolved: false, winningOutcome: null };
    }

    const winner = data.tokens?.find(t => t.winner === true);
    return {
      resolved: true,
      winningOutcome: winner?.outcome || null,
    };
  } catch {
    return null;
  }
}

export async function POST() {
  try {
    const db = new Database(DB_PATH);

    // Get all open bets with condition_id
    const openBets = db.prepare(`
      SELECT id, outcome, shares, size, condition_id, home_team, away_team
      FROM sports_bets
      WHERE status = 'open' AND condition_id IS NOT NULL
    `).all() as OpenBet[];

    if (openBets.length === 0) {
      db.close();
      return NextResponse.json({ message: 'No open bets to check', checked: 0, resolved: 0 });
    }

    // Group by condition ID
    const betsByCondition = new Map<string, OpenBet[]>();
    for (const bet of openBets) {
      const existing = betsByCondition.get(bet.condition_id) || [];
      existing.push(bet);
      betsByCondition.set(bet.condition_id, existing);
    }

    let resolved = 0;
    let won = 0;
    let lost = 0;
    const results: string[] = [];

    for (const [conditionId, bets] of betsByCondition) {
      const resolution = await getMarketResolution(conditionId);

      if (!resolution || !resolution.resolved) {
        continue;
      }

      resolved += bets.length;

      for (const bet of bets) {
        const betWon = resolution.winningOutcome?.toLowerCase() === bet.outcome.toLowerCase();

        if (betWon) {
          const payout = bet.shares * 1.0;
          const profit = payout - bet.size;
          db.prepare(`
            UPDATE sports_bets
            SET status = 'won', profit = ?, sell_price = 1.0
            WHERE id = ?
          `).run(profit, bet.id);
          won++;
          results.push(`WON: ${bet.outcome} (${bet.home_team} vs ${bet.away_team}) +$${profit.toFixed(2)}`);
        } else {
          const loss = -bet.size;
          db.prepare(`
            UPDATE sports_bets
            SET status = 'lost', profit = ?, sell_price = 0
            WHERE id = ?
          `).run(loss, bet.id);
          lost++;
          results.push(`LOST: ${bet.outcome} (${bet.home_team} vs ${bet.away_team}) -$${bet.size.toFixed(2)}`);
        }
      }

      // Small delay between API calls
      await new Promise(r => setTimeout(r, 100));
    }

    db.close();

    return NextResponse.json({
      message: `Checked ${openBets.length} open bets, ${resolved} resolved`,
      checked: openBets.length,
      resolved,
      won,
      lost,
      results,
    });
  } catch (error: any) {
    console.error('Failed to check resolutions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check resolutions' },
      { status: 500 }
    );
  }
}

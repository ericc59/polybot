import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const VALUE_BETS_FILE = path.join(process.cwd(), '..', 'data', 'sports-value-bets.json');

interface ValueBet {
  id: string;
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcome: string;
  sharpOdds: number;
  sharpProb: number;
  polymarketPrice: number;
  edge: number;
  expectedValue: number;
  recommendedSize: number;
  bookmakerConsensus: number;
  polymarketTokenId: string;
  polymarketConditionId: string;
  detectedAt: number;
}

function detectLeague(sport: string): { league: string; icon: string } {
  const s = sport.toLowerCase();
  if (s.includes('basketball_nba') || s.includes('nba')) return { league: 'NBA', icon: '🏀' };
  if (s.includes('basketball_ncaab') || s.includes('ncaab') || s.includes('cbb')) return { league: 'CBB', icon: '🏀' };
  if (s.includes('americanfootball_nfl') || s.includes('nfl')) return { league: 'NFL', icon: '🏈' };
  if (s.includes('americanfootball_ncaaf') || s.includes('ncaaf') || s.includes('cfb')) return { league: 'CFB', icon: '🏈' };
  if (s.includes('hockey') || s.includes('nhl')) return { league: 'NHL', icon: '🏒' };
  if (s.includes('baseball') || s.includes('mlb')) return { league: 'MLB', icon: '⚾' };
  return { league: 'Other', icon: '📊' };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = searchParams.get('league');

    let valueBets: ValueBet[] = [];
    let updatedAt = 0;

    if (existsSync(VALUE_BETS_FILE)) {
      const content = readFileSync(VALUE_BETS_FILE, 'utf-8');
      const data = JSON.parse(content);
      valueBets = data.valueBets || [];
      updatedAt = data.updatedAt || 0;
    }

    // Add league info to each bet
    const betsWithLeague = valueBets.map((bet) => {
      const { league: detectedLeague, icon } = detectLeague(bet.sport);
      return {
        ...bet,
        league: detectedLeague,
        icon,
      };
    });

    // Filter by league if specified
    const filteredBets = league && league !== 'all'
      ? betsWithLeague.filter((b) => b.league.toLowerCase() === league.toLowerCase())
      : betsWithLeague;

    // Get unique leagues for filter options
    const leagues = [...new Set(betsWithLeague.map((b) => b.league))];

    return NextResponse.json({
      valueBets: filteredBets,
      leagues,
      updatedAt,
      total: betsWithLeague.length,
    });
  } catch (error: any) {
    console.error('Failed to get value bets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get value bets' },
      { status: 500 }
    );
  }
}

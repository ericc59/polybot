import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const TRACKED_EVENTS_FILE = path.join(process.cwd(), '..', 'data', 'sports-tracked-events.json');

interface TrackedEvent {
  id: string;
  slug: string;
  sport: string;
  title: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcomes: Array<{
    name: string;
    price: number;
    tokenId: string;
  }>;
  hasValueBet: boolean;
  valueBetEdge?: number;
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

    let events: TrackedEvent[] = [];
    let updatedAt = 0;

    if (existsSync(TRACKED_EVENTS_FILE)) {
      const content = readFileSync(TRACKED_EVENTS_FILE, 'utf-8');
      const data = JSON.parse(content);
      events = data.events || [];
      updatedAt = data.updatedAt || 0;
    }

    // Add league info to each event
    const eventsWithLeague = events.map((event) => {
      const { league: detectedLeague, icon } = detectLeague(event.sport);
      return {
        ...event,
        league: detectedLeague,
        icon,
      };
    });

    // Filter by league if specified
    const filteredEvents = league && league !== 'all'
      ? eventsWithLeague.filter((e) => e.league.toLowerCase() === league.toLowerCase())
      : eventsWithLeague;

    // Sort by commence time
    filteredEvents.sort((a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime());

    // Get counts by league
    const leagueCounts: Record<string, number> = {};
    eventsWithLeague.forEach((e) => {
      leagueCounts[e.league] = (leagueCounts[e.league] || 0) + 1;
    });

    return NextResponse.json({
      events: filteredEvents,
      leagueCounts,
      updatedAt,
      total: eventsWithLeague.length,
    });
  } catch (error: any) {
    console.error('Failed to get tracked events:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get events' },
      { status: 500 }
    );
  }
}

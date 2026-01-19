import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

interface OddsApiMatch {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  completed?: boolean;
  scores?: Array<{ name: string; score: string }> | null;
  last_update?: string;
}

interface OddsApiSport {
  key: string;
  title: string;
  active: boolean;
  group: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'sports';

  if (!ODDS_API_KEY) {
    return NextResponse.json(
      { error: 'ODDS_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    let data: unknown;
    let requestsRemaining = -1;
    let requestsUsed = -1;

    if (action === 'sports') {
      // Fetch available tennis sports
      const response = await fetch(
        `${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}`
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      requestsRemaining = parseInt(response.headers.get('x-requests-remaining') || '-1');
      requestsUsed = parseInt(response.headers.get('x-requests-used') || '-1');

      const sports = (await response.json()) as OddsApiSport[];
      data = sports.filter((s) => s.key.startsWith('tennis_') && s.active);
    } else if (action === 'matches') {
      // Fetch all tennis matches
      const sportKey = searchParams.get('sport');

      if (sportKey) {
        // Fetch for specific sport
        const response = await fetch(
          `${ODDS_API_BASE}/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}`
        );

        if (!response.ok) {
          if (response.status === 404) {
            data = [];
          } else {
            throw new Error(`API error: ${response.status}`);
          }
        } else {
          requestsRemaining = parseInt(response.headers.get('x-requests-remaining') || '-1');
          requestsUsed = parseInt(response.headers.get('x-requests-used') || '-1');
          data = await response.json();
        }
      } else {
        // Fetch sports first, then all matches
        const sportsResponse = await fetch(
          `${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}`
        );

        if (!sportsResponse.ok) {
          throw new Error(`API error: ${sportsResponse.status}`);
        }

        const sports = (await sportsResponse.json()) as OddsApiSport[];
        const tennisSports = sports.filter((s) => s.key.startsWith('tennis_') && s.active);

        const allMatches: OddsApiMatch[] = [];

        for (const sport of tennisSports) {
          try {
            const response = await fetch(
              `${ODDS_API_BASE}/sports/${sport.key}/events?apiKey=${ODDS_API_KEY}`
            );

            if (response.ok) {
              requestsRemaining = parseInt(response.headers.get('x-requests-remaining') || '-1');
              requestsUsed = parseInt(response.headers.get('x-requests-used') || '-1');

              const matches = (await response.json()) as OddsApiMatch[];
              allMatches.push(...matches);
            }

            // Small delay between requests
            await new Promise((r) => setTimeout(r, 100));
          } catch {
            // Skip failed sports
          }
        }

        data = allMatches;
      }
    } else if (action === 'scores') {
      // Fetch scores for all tennis sports
      const sportsResponse = await fetch(
        `${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}`
      );

      if (!sportsResponse.ok) {
        throw new Error(`API error: ${sportsResponse.status}`);
      }

      const sports = (await sportsResponse.json()) as OddsApiSport[];
      const tennisSports = sports.filter((s) => s.key.startsWith('tennis_') && s.active);

      const allScores: OddsApiMatch[] = [];

      for (const sport of tennisSports) {
        try {
          const response = await fetch(
            `${ODDS_API_BASE}/sports/${sport.key}/scores?apiKey=${ODDS_API_KEY}&daysFrom=1`
          );

          if (response.ok) {
            requestsRemaining = parseInt(response.headers.get('x-requests-remaining') || '-1');
            requestsUsed = parseInt(response.headers.get('x-requests-used') || '-1');

            const scores = (await response.json()) as OddsApiMatch[];
            allScores.push(...scores);
          }

          await new Promise((r) => setTimeout(r, 100));
        } catch {
          // Skip failed sports
        }
      }

      data = allScores;
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({
      data,
      rateLimit: {
        remaining: requestsRemaining,
        used: requestsUsed,
      },
    });
  } catch (error) {
    console.error('Error fetching from Odds API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Odds API' },
      { status: 500 }
    );
  }
}

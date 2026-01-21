import { NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), '..', 'data');
const TRACKED_EVENTS_FILE = path.join(DATA_DIR, 'sports-tracked-events.json');
const VALUE_BETS_FILE = path.join(DATA_DIR, 'sports-value-bets.json');
const LATEST_BETS_FILE = path.join(DATA_DIR, 'sports-latest-bets.json');
const BET_REPORTS_DIR = path.join(DATA_DIR, 'bet-reports');
const DB_PATH = path.join(DATA_DIR, 'polybot.db');

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

interface ValueBet {
  id: string;
  matchId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  sharpProb: number;
  polymarketPrice: number;
  edge: number;
  bookmakerConsensus: number;
  polymarketTokenId: string;
  polymarketConditionId: string;
  bookData?: Array<{
    key: string;
    odds: number;
    rawProb: number;
    fairProb: number;
    vig: number;
  }>;
  otherSide?: {
    outcome: string;
    polymarketPrice: number;
    sharpProb: number;
    edge: number;
    bookData?: Array<{
      key: string;
      odds: number;
      rawProb: number;
      fairProb: number;
      vig: number;
    }>;
  };
}

interface SportsBet {
  id: number;
  match_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  outcome: string;
  token_id: string;
  condition_id: string;
  shares: number;
  buy_price: number;
  size: number;
  edge: number;
  status: string;
  pnl: number | null;
  created_at: number;
}

// Normalize team name for fuzzy matching
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if two team names match (fuzzy)
function teamsMatch(name1: string, name2: string): boolean {
  const n1 = normalizeTeamName(name1);
  const n2 = normalizeTeamName(name2);

  // Exact match after normalization
  if (n1 === n2) return true;

  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Check if key words match (e.g., "Maryland" in both)
  const words1 = n1.split(' ').filter(w => w.length > 3);
  const words2 = n2.split(' ').filter(w => w.length > 3);

  for (const w1 of words1) {
    for (const w2 of words2) {
      if (w1 === w2) return true;
    }
  }

  return false;
}

// Check if an event matches (by teams)
function eventMatches(
  eventHome: string,
  eventAway: string,
  otherHome: string,
  otherAway: string
): boolean {
  return (
    (teamsMatch(eventHome, otherHome) && teamsMatch(eventAway, otherAway)) ||
    (teamsMatch(eventHome, otherAway) && teamsMatch(eventAway, otherHome))
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);

    // Find the event in tracked events
    let event: TrackedEvent | null = null;
    if (existsSync(TRACKED_EVENTS_FILE)) {
      const content = readFileSync(TRACKED_EVENTS_FILE, 'utf-8');
      const data = JSON.parse(content);
      const events: TrackedEvent[] = data.events || [];
      event = events.find((e) => e.id === decodedId || e.slug === decodedId) || null;
    }

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Find current value bets for this event (fuzzy match on team names)
    let valueBets: ValueBet[] = [];
    if (existsSync(VALUE_BETS_FILE)) {
      const content = readFileSync(VALUE_BETS_FILE, 'utf-8');
      const data = JSON.parse(content);
      const allValueBets: ValueBet[] = data.valueBets || [];
      valueBets = allValueBets.filter(
        (vb) =>
          vb.matchId === event?.id ||
          eventMatches(event!.homeTeam, event!.awayTeam, vb.homeTeam, vb.awayTeam)
      );
    }

    // Find bet reports for this event (fuzzy match)
    let betReports: any[] = [];
    if (existsSync(LATEST_BETS_FILE)) {
      try {
        const content = readFileSync(LATEST_BETS_FILE, 'utf-8');
        const allReports = JSON.parse(content);
        betReports = allReports.filter(
          (r: any) =>
            r.match?.homeTeam && r.match?.awayTeam &&
            eventMatches(event!.homeTeam, event!.awayTeam, r.match.homeTeam, r.match.awayTeam)
        );
      } catch {
        // Ignore parse errors
      }
    }

    // Also check individual bet report files
    if (existsSync(BET_REPORTS_DIR)) {
      try {
        const files = readdirSync(BET_REPORTS_DIR).filter((f) => f.endsWith('.json'));
        for (const file of files.slice(-100)) {
          // Check last 100 files
          try {
            const content = readFileSync(path.join(BET_REPORTS_DIR, file), 'utf-8');
            const report = JSON.parse(content);
            if (
              report.match?.homeTeam && report.match?.awayTeam &&
              eventMatches(event!.homeTeam, event!.awayTeam, report.match.homeTeam, report.match.awayTeam)
            ) {
              // Avoid duplicates
              if (!betReports.find((r) => r.id === report.id)) {
                betReports.push(report);
              }
            }
          } catch {
            // Skip invalid files
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    // Get bets from database (fetch recent and filter with fuzzy matching)
    let dbBets: SportsBet[] = [];
    if (existsSync(DB_PATH)) {
      try {
        const db = new Database(DB_PATH, { readonly: true });
        // Get recent bets and filter by fuzzy team match
        const allBets = db
          .prepare(
            `SELECT * FROM sports_bets ORDER BY created_at DESC LIMIT 500`
          )
          .all() as SportsBet[];
        db.close();

        // Filter by fuzzy team name match
        dbBets = allBets.filter(
          (b) =>
            b.match_id === event.id ||
            eventMatches(event.homeTeam, event.awayTeam, b.home_team, b.away_team)
        );
      } catch (err) {
        console.error('Failed to query sports_bets:', err);
      }
    }

    // Try to get odds from database first (more reliable)
    let dbOdds: any = null;
    if (existsSync(DB_PATH)) {
      try {
        const db = new Database(DB_PATH, { readonly: true });
        // Try to find odds by fuzzy match
        const allOdds = db.prepare(`SELECT * FROM sports_odds ORDER BY updated_at DESC LIMIT 200`).all() as any[];
        db.close();

        dbOdds = allOdds.find(
          (o) => eventMatches(event.homeTeam, event.awayTeam, o.home_team, o.away_team)
        );
      } catch (err) {
        console.error('Failed to query sports_odds:', err);
      }
    }

    // Build odds breakdown from database or value bets
    let oddsBreakdown = null;
    if (dbOdds) {
      oddsBreakdown = buildOddsBreakdownFromDb(dbOdds);
    } else if (valueBets.length > 0) {
      oddsBreakdown = buildOddsBreakdown(valueBets, event);
    }

    return NextResponse.json({
      event: {
        ...event,
        league: detectLeague(event.sport).league,
        icon: detectLeague(event.sport).icon,
      },
      oddsBreakdown,
      // Include raw odds data from database
      rawOdds: dbOdds ? {
        homeTeam: dbOdds.home_team,
        awayTeam: dbOdds.away_team,
        polyHomePrice: dbOdds.poly_home_price,
        polyAwayPrice: dbOdds.poly_away_price,
        sharpHomeProb: dbOdds.sharp_home_prob,
        sharpAwayProb: dbOdds.sharp_away_prob,
        homeEdge: dbOdds.home_edge,
        awayEdge: dbOdds.away_edge,
        bookCount: dbOdds.book_count,
        updatedAt: dbOdds.updated_at,
        minEdge: dbOdds.min_edge_required,
        homeBookData: (() => { try { return JSON.parse(dbOdds.home_book_data || '[]'); } catch { return []; } })(),
        awayBookData: (() => { try { return JSON.parse(dbOdds.away_book_data || '[]'); } catch { return []; } })(),
        homeExcludedBooks: (() => { try { return JSON.parse(dbOdds.home_excluded_books || '[]'); } catch { return []; } })(),
        awayExcludedBooks: (() => { try { return JSON.parse(dbOdds.away_excluded_books || '[]'); } catch { return []; } })(),
      } : null,
      valueBets,
      betReports: betReports.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
      dbBets: dbBets.map((b) => ({
        id: b.id,
        outcome: b.outcome,
        shares: b.shares,
        buyPrice: b.buy_price,
        size: b.size,
        edge: b.edge,
        status: b.status,
        pnl: b.pnl,
        createdAt: b.created_at,
      })),
    });
  } catch (error: any) {
    console.error('Failed to get event details:', error);
    return NextResponse.json({ error: error.message || 'Failed to get event' }, { status: 500 });
  }
}

function detectLeague(sport: string): { league: string; icon: string } {
  const s = sport.toLowerCase();
  if (s.includes('basketball_nba') || s.includes('nba')) return { league: 'NBA', icon: '🏀' };
  if (s.includes('basketball_ncaab') || s.includes('ncaab') || s.includes('cbb'))
    return { league: 'CBB', icon: '🏀' };
  if (s.includes('americanfootball_nfl') || s.includes('nfl')) return { league: 'NFL', icon: '🏈' };
  if (s.includes('americanfootball_ncaaf') || s.includes('ncaaf') || s.includes('cfb'))
    return { league: 'CFB', icon: '🏈' };
  if (s.includes('hockey') || s.includes('nhl')) return { league: 'NHL', icon: '🏒' };
  if (s.includes('baseball') || s.includes('mlb')) return { league: 'MLB', icon: '⚾' };
  return { league: 'Other', icon: '📊' };
}

function buildOddsBreakdown(valueBets: ValueBet[], event: TrackedEvent) {
  // Get the most recent value bet data (has book breakdown)
  const primaryBet = valueBets[0];
  if (!primaryBet) return null;

  const outcomes: Array<{
    name: string;
    polymarketPrice: number;
    sharpProb: number;
    edge: number;
    isValueBet: boolean;
    bookData?: Array<{
      key: string;
      odds: number;
      fairProb: number;
    }>;
  }> = [];

  // Add primary outcome
  outcomes.push({
    name: primaryBet.outcome,
    polymarketPrice: primaryBet.polymarketPrice,
    sharpProb: primaryBet.sharpProb,
    edge: primaryBet.edge,
    isValueBet: true,
    bookData: primaryBet.bookData?.map((b) => ({
      key: b.key,
      odds: b.odds,
      fairProb: b.fairProb,
    })),
  });

  // Add other side if available
  if (primaryBet.otherSide) {
    outcomes.push({
      name: primaryBet.otherSide.outcome,
      polymarketPrice: primaryBet.otherSide.polymarketPrice,
      sharpProb: primaryBet.otherSide.sharpProb,
      edge: primaryBet.otherSide.edge,
      isValueBet: primaryBet.otherSide.edge > 0.05, // Assume 5% threshold
      bookData: primaryBet.otherSide.bookData?.map((b) => ({
        key: b.key,
        odds: b.odds,
        fairProb: b.fairProb,
      })),
    });
  }

  // Calculate totals
  const totalPolymarket = outcomes.reduce((sum, o) => sum + o.polymarketPrice, 0);
  const totalSharp = outcomes.reduce((sum, o) => sum + o.sharpProb, 0);

  return {
    outcomes,
    totalPolymarket,
    totalSharp,
    polymarketVig: totalPolymarket - 1,
    bookCount: primaryBet.bookmakerConsensus,
  };
}

function buildOddsBreakdownFromDb(dbOdds: any) {
  const outcomes: Array<{
    name: string;
    polymarketPrice: number;
    sharpProb: number;
    edge: number;
    isValueBet: boolean;
    bookData?: Array<{
      key: string;
      odds: number;
      fairProb: number;
    }>;
  }> = [];

  // Parse book data from JSON
  let homeBookData: any[] = [];
  let awayBookData: any[] = [];
  try {
    homeBookData = JSON.parse(dbOdds.home_book_data || '[]');
  } catch {}
  try {
    awayBookData = JSON.parse(dbOdds.away_book_data || '[]');
  } catch {}

  const minEdge = dbOdds.min_edge_required || 0.06;

  // Home team outcome
  if (dbOdds.poly_home_price !== null) {
    outcomes.push({
      name: dbOdds.home_team,
      polymarketPrice: dbOdds.poly_home_price,
      sharpProb: dbOdds.sharp_home_prob || 0,
      edge: dbOdds.home_edge || 0,
      isValueBet: (dbOdds.home_edge || 0) >= minEdge,
      bookData: homeBookData.map((b: any) => ({
        key: b.key,
        odds: b.odds,
        fairProb: b.fairProb,
      })),
    });
  }

  // Away team outcome
  if (dbOdds.poly_away_price !== null) {
    outcomes.push({
      name: dbOdds.away_team,
      polymarketPrice: dbOdds.poly_away_price,
      sharpProb: dbOdds.sharp_away_prob || 0,
      edge: dbOdds.away_edge || 0,
      isValueBet: (dbOdds.away_edge || 0) >= minEdge,
      bookData: awayBookData.map((b: any) => ({
        key: b.key,
        odds: b.odds,
        fairProb: b.fairProb,
      })),
    });
  }

  if (outcomes.length === 0) return null;

  const totalPolymarket = outcomes.reduce((sum, o) => sum + (o.polymarketPrice || 0), 0);
  const totalSharp = outcomes.reduce((sum, o) => sum + (o.sharpProb || 0), 0);

  return {
    outcomes,
    totalPolymarket,
    totalSharp,
    polymarketVig: totalPolymarket - 1,
    bookCount: dbOdds.book_count || 0,
    updatedAt: dbOdds.updated_at,
  };
}

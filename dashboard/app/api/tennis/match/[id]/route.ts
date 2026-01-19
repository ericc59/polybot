import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

// Connect to tennis database
const tennisDbPath = path.join(process.cwd(), '..', 'data', 'tennis.db');

function getTennisDb(): Database.Database {
  return new Database(tennisDbPath, { readonly: true });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const matchId = parseInt(id);

  if (isNaN(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  try {
    const db = getTennisDb();

    // Get match from our database
    const match = db.prepare(`
      SELECT
        id,
        odds_api_id as oddsApiId,
        player1,
        player2,
        commence_time as commenceTime,
        sport_key as sportKey,
        polymarket_condition_id as polymarketConditionId,
        polymarket_slug as polymarketSlug,
        player1_token_id as player1TokenId,
        player2_token_id as player2TokenId,
        status,
        walkover_detected_at as walkoverDetectedAt,
        orders_placed_at as ordersPlacedAt,
        notes,
        created_at as createdAt,
        updated_at as updatedAt
      FROM tracked_matches
      WHERE id = ?
    `).get(matchId) as Record<string, unknown> | undefined;

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    // Get Odds API data from stored snapshots (no extra API calls!)
    let oddsApiData = null;
    let snapshotHistory: Array<{ data: unknown; capturedAt: number }> = [];

    const oddsApiId = match.oddsApiId as string;
    if (oddsApiId && !oddsApiId.startsWith('pm_')) {
      // Get the latest snapshot
      const latestSnapshot = db.prepare(`
        SELECT snapshot_data, captured_at as capturedAt
        FROM match_snapshots
        WHERE odds_api_id = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `).get(oddsApiId) as { snapshot_data: string; capturedAt: number } | undefined;

      if (latestSnapshot) {
        try {
          oddsApiData = JSON.parse(latestSnapshot.snapshot_data);
          oddsApiData._capturedAt = latestSnapshot.capturedAt;
        } catch {
          // Invalid JSON
        }
      }

      // Get snapshot history (last 10 snapshots for timeline view)
      const snapshots = db.prepare(`
        SELECT snapshot_data, captured_at as capturedAt
        FROM match_snapshots
        WHERE odds_api_id = ?
        ORDER BY captured_at DESC
        LIMIT 10
      `).all(oddsApiId) as Array<{ snapshot_data: string; capturedAt: number }>;

      snapshotHistory = snapshots.map((s) => {
        try {
          return { data: JSON.parse(s.snapshot_data), capturedAt: s.capturedAt };
        } catch {
          return { data: null, capturedAt: s.capturedAt };
        }
      });
    }

    // Get order book data from Polymarket if we have token IDs
    let orderBook = null;
    const player1TokenId = match.player1TokenId as string;
    const player2TokenId = match.player2TokenId as string;

    if (player1TokenId && player2TokenId) {
      try {
        const [book1Response, book2Response] = await Promise.all([
          fetch(`https://clob.polymarket.com/book?token_id=${player1TokenId}`),
          fetch(`https://clob.polymarket.com/book?token_id=${player2TokenId}`),
        ]);

        if (book1Response.ok && book2Response.ok) {
          const book1 = await book1Response.json();
          const book2 = await book2Response.json();

          // Calculate shares under $0.49 for each side
          const calculateUnderPrice = (asks: Array<{ price: string; size: string }>, maxPrice: number) => {
            let totalShares = 0;
            let totalCost = 0;

            for (const ask of asks || []) {
              const price = parseFloat(ask.price);
              const size = parseFloat(ask.size);

              if (price <= maxPrice) {
                totalShares += size;
                totalCost += price * size;
              }
            }

            return { shares: totalShares, cost: totalCost };
          };

          const player1Under49 = calculateUnderPrice(book1.asks, 0.49);
          const player2Under49 = calculateUnderPrice(book2.asks, 0.49);

          orderBook = {
            player1: {
              tokenId: player1TokenId,
              bestAsk: book1.asks?.[0]?.price || null,
              bestBid: book1.bids?.[0]?.price || null,
              asksUnder49: player1Under49,
              asks: (book1.asks || []).slice(0, 10),
              bids: (book1.bids || []).slice(0, 10),
            },
            player2: {
              tokenId: player2TokenId,
              bestAsk: book2.asks?.[0]?.price || null,
              bestBid: book2.bids?.[0]?.price || null,
              asksUnder49: player2Under49,
              asks: (book2.asks || []).slice(0, 10),
              bids: (book2.bids || []).slice(0, 10),
            },
            totalOpportunity: {
              shares: player1Under49.shares + player2Under49.shares,
              cost: player1Under49.cost + player2Under49.cost,
              expectedProfit: (player1Under49.shares + player2Under49.shares) * 0.5 - (player1Under49.cost + player2Under49.cost),
            },
          };
        }
      } catch (err) {
        console.error('Error fetching order book:', err);
      }
    }

    // Get walkover detection events for this match
    const walkoverEvents = db.prepare(`
      SELECT
        id,
        match_id as matchId,
        detection_reason as reason,
        confidence,
        detected_at as detectedAt,
        notified,
        current_api_state as currentApiState,
        previous_api_state as previousApiState,
        detection_context as detectionContext
      FROM walkover_events
      WHERE match_id = ?
      ORDER BY detected_at DESC
    `).all(matchId) as Array<{
      id: number;
      matchId: number;
      reason: string;
      confidence: string;
      detectedAt: number;
      notified: number;
      currentApiState: string | null;
      previousApiState: string | null;
      detectionContext: string | null;
    }>;

    // Parse JSON fields
    const parsedWalkoverEvents = walkoverEvents.map((event) => ({
      ...event,
      currentApiState: event.currentApiState ? JSON.parse(event.currentApiState) : null,
      previousApiState: event.previousApiState ? JSON.parse(event.previousApiState) : null,
      detectionContext: event.detectionContext ? JSON.parse(event.detectionContext) : null,
    }));

    db.close();

    return NextResponse.json({
      match,
      oddsApiData,
      snapshotHistory,
      orderBook,
      walkoverEvents: parsedWalkoverEvents,
    });
  } catch (error) {
    console.error('Error fetching match:', error);
    return NextResponse.json(
      { error: 'Failed to fetch match' },
      { status: 500 }
    );
  }
}

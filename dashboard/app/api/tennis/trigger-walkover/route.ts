import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TENNIS_API_URL = process.env.TENNIS_API_URL || 'http://localhost:3456';

export async function POST(request: Request) {
  try {
    const { matchId } = await request.json();

    if (!matchId) {
      return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
    }

    // Call the tennis bot's HTTP API to trigger the walkover
    const response = await fetch(`${TENNIS_API_URL}/trigger-walkover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to trigger walkover' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error triggering walkover:', error);

    // Check if it's a connection error (tennis bot not running)
    if (error.cause?.code === 'ECONNREFUSED') {
      return NextResponse.json(
        { error: 'Tennis bot not running. Start it with: bun tennis/index.ts start' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to trigger walkover' },
      { status: 500 }
    );
  }
}

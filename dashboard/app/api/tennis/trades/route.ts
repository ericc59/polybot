import { NextResponse } from 'next/server';
import { getTennisTrades } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');

    const trades = getTennisTrades(limit);
    return NextResponse.json(trades);
  } catch (error) {
    console.error('Error fetching tennis trades:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tennis trades' },
      { status: 500 }
    );
  }
}

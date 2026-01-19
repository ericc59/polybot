import { NextResponse } from 'next/server';
import { getTennisMatches } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');

    const matches = getTennisMatches(limit);
    return NextResponse.json(matches);
  } catch (error) {
    console.error('Error fetching tennis matches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tennis matches' },
      { status: 500 }
    );
  }
}

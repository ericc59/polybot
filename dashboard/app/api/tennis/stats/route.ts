import { NextResponse } from 'next/server';
import { getTennisStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = getTennisStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching tennis stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tennis stats' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getCopyTrades, getCopyTradingStats, getTradingAccount } from '@/lib/db';

export async function GET() {
  try {
    const stats = getCopyTradingStats();
    const trades = getCopyTrades(50);
    const account = getTradingAccount();

    return NextResponse.json({
      stats,
      trades,
      account,
    });
  } catch (error) {
    console.error('Failed to get copy trading data:', error);
    return NextResponse.json({ error: 'Failed to get copy trading data' }, { status: 500 });
  }
}

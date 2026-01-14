import { NextResponse } from 'next/server';
import { getWallets, getWalletCount } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const wallets = getWallets(limit, offset);
    const total = getWalletCount();

    return NextResponse.json({
      wallets,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching wallets:', error);
    return NextResponse.json({ error: 'Failed to fetch wallets' }, { status: 500 });
  }
}

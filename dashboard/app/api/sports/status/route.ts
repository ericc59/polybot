import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

const STATUS_FILE = path.join(process.cwd(), '..', 'data', 'sports-status.json');
const DB_PATH = path.join(process.cwd(), '..', 'data', 'polybot.db');

interface SportsStatus {
  monitoring: boolean;
  lastPollTime: number;
  valueBetsCount: number;
  updatedAt: number;
}

export async function GET() {
  try {
    // Read status file
    let status: SportsStatus = {
      monitoring: false,
      lastPollTime: 0,
      valueBetsCount: 0,
      updatedAt: 0,
    };

    if (existsSync(STATUS_FILE)) {
      const content = readFileSync(STATUS_FILE, 'utf-8');
      status = JSON.parse(content);

      // If status file is older than 30 seconds and claims to be monitoring,
      // assume the bot crashed and monitoring stopped
      const age = Date.now() - status.updatedAt;
      if (age > 30000 && status.monitoring) {
        status.monitoring = false;
      }
    }

    // Get today's stats from database
    let todaysVolume = 0;
    let todaysBets = 0;
    let totalPositions = 0;

    try {
      const db = new Database(DB_PATH, { readonly: true });

      // Get today's start timestamp (midnight local time)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = Math.floor(today.getTime() / 1000);

      // Today's bets
      const todayStats = db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as volume
        FROM sports_bets
        WHERE created_at >= ?
      `).get(todayStart) as { count: number; volume: number };

      todaysBets = todayStats.count;
      todaysVolume = todayStats.volume;

      // Open positions
      const openStats = db.prepare(`
        SELECT COUNT(*) as count
        FROM sports_bets
        WHERE status IN ('open', 'placed')
      `).get() as { count: number };

      totalPositions = openStats.count;

      db.close();
    } catch (dbError) {
      console.error('Failed to read sports stats from database:', dbError);
    }

    return NextResponse.json({
      monitoring: status.monitoring,
      lastPollTime: status.lastPollTime,
      valueBetsCount: status.valueBetsCount,
      todaysVolume,
      todaysBets,
      totalPositions,
    });
  } catch (error: any) {
    console.error('Failed to get sports status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    );
  }
}

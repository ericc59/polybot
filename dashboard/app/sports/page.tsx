'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PositionsTable from '../../components/sports/PositionsTable';

const leagues = [
  { key: 'all', name: 'All', icon: '📊' },
  { key: 'NBA', name: 'NBA', icon: '🏀' },
  { key: 'NCAAB', name: 'NCAAB', icon: '🏀' },
  { key: 'NFL', name: 'NFL', icon: '🏈' },
  { key: 'NCAAF', name: 'NCAAF', icon: '🏈' },
  { key: 'MLB', name: 'MLB', icon: '⚾' },
  { key: 'NHL', name: 'NHL', icon: '🏒' },
];

interface QuickStats {
  monitoring: boolean;
  todaysVolume: number;
  todaysBets: number;
  valueBetsFound: number;
  totalPositions: number;
}

export default function SportsPage() {
  const [filterLeague, setFilterLeague] = useState<string>('all');
  const [stats, setStats] = useState<QuickStats>({
    monitoring: false,
    todaysVolume: 0,
    todaysBets: 0,
    valueBetsFound: 0,
    totalPositions: 0,
  });

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/sports/status');
        if (res.ok) {
          const data = await res.json();
          setStats({
            monitoring: data.monitoring,
            todaysVolume: data.todaysVolume || 0,
            todaysBets: data.todaysBets || 0,
            valueBetsFound: data.valueBetsCount || 0,
            totalPositions: data.totalPositions || 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch sports status:', err);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Sports Betting</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Value betting on Polymarket using sharp bookmaker odds
          </p>
        </div>
        <Link
          href="/sports/settings"
          className="px-4 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded font-medium text-sm hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Status</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`w-2 h-2 rounded-full ${
                stats.monitoring ? 'bg-[var(--positive)] pulse' : 'bg-[var(--text-muted)]'
              }`}
            ></span>
            <span className="font-semibold">{stats.monitoring ? 'Monitoring' : 'Stopped'}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Use Telegram /sports start
          </p>
        </div>

        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Today's Volume</div>
          <div className="font-semibold text-xl mt-1">${stats.todaysVolume.toFixed(2)}</div>
          <p className="text-xs text-[var(--text-muted)] mt-1">{stats.todaysBets} bets placed</p>
        </div>

        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Value Bets Found</div>
          <div className="font-semibold text-xl mt-1">{stats.valueBetsFound}</div>
          <p className="text-xs text-[var(--text-muted)] mt-1">Last scan</p>
        </div>

        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Open Positions</div>
          <div className="font-semibold text-xl mt-1">{stats.totalPositions}</div>
          <p className="text-xs text-[var(--text-muted)] mt-1">Active bets</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-4 border-b border-[var(--border-color)]">
        <Link
          href="/sports"
          className="px-4 py-2 text-sm font-medium text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)] -mb-px"
        >
          Positions
        </Link>
        <Link
          href="/sports/events"
          className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Events
        </Link>
        <Link
          href="/sports/value"
          className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Value Bets
        </Link>
        <Link
          href="/sports/history"
          className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          History
        </Link>
      </div>

      {/* League Filters */}
      <div className="flex flex-wrap gap-2">
        {leagues.map((league) => (
          <button
            key={league.key}
            onClick={() => setFilterLeague(league.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
              filterLeague === league.key
                ? 'bg-[var(--accent-primary)] text-black font-medium'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <span>{league.icon}</span>
            <span>{league.name}</span>
          </button>
        ))}
      </div>

      {/* Positions Table */}
      <PositionsTable filterLeague={filterLeague === 'all' ? undefined : filterLeague} />
    </div>
  );
}

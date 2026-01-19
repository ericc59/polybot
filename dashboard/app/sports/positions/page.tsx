'use client';

import { useState } from 'react';
import PositionsTable from '../../../components/sports/PositionsTable';

const leagues = [
  { key: 'all', name: 'All', icon: '📊' },
  { key: 'NBA', name: 'NBA', icon: '🏀' },
  { key: 'NFL', name: 'NFL', icon: '🏈' },
  { key: 'MLB', name: 'MLB', icon: '⚾' },
  { key: 'NHL', name: 'NHL', icon: '🏒' },
  { key: 'Soccer', name: 'Soccer', icon: '⚽' },
  { key: 'Tennis', name: 'Tennis', icon: '🎾' },
  { key: 'Combat', name: 'Combat', icon: '🥊' },
  { key: 'Golf', name: 'Golf', icon: '⛳' },
  { key: 'Other', name: 'Other', icon: '📈' },
];

export default function PositionsPage() {
  const [filterLeague, setFilterLeague] = useState<string>('all');

  return (
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Positions</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Your current Polymarket positions
          </p>
        </div>
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

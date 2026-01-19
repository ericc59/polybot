'use client';

import { useEffect, useState } from 'react';

interface TennisStatsData {
  trackedMatches: number;
  todayMatches: number;
  walkoversDetected: number;
  totalTrades: number;
  totalProfit: number;
  winRate: number;
  botStatus: 'running' | 'stopped' | 'error';
}

export default function TennisStats() {
  const [stats, setStats] = useState<TennisStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/tennis/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch tennis stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card p-4">
            <div className="h-4 w-20 bg-[var(--bg-tertiary)] rounded animate-pulse mb-2"></div>
            <div className="h-8 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
          </div>
        ))}
      </div>
    );
  }

  const statItems = [
    {
      label: 'Bot Status',
      value: stats?.botStatus || 'unknown',
      isStatus: true,
    },
    {
      label: 'Tracked Matches',
      value: stats?.trackedMatches ?? 0,
    },
    {
      label: 'Today',
      value: stats?.todayMatches ?? 0,
    },
    {
      label: 'Walkovers',
      value: stats?.walkoversDetected ?? 0,
    },
    {
      label: 'Total Trades',
      value: stats?.totalTrades ?? 0,
    },
    {
      label: 'Total Profit',
      value: `$${(stats?.totalProfit ?? 0).toFixed(2)}`,
      isProfit: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {statItems.map((item) => (
        <div key={item.label} className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
            {item.label}
          </div>
          {item.isStatus ? (
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  item.value === 'running'
                    ? 'bg-[var(--positive)] pulse'
                    : item.value === 'stopped'
                    ? 'bg-[var(--warning)]'
                    : 'bg-[var(--negative)]'
                }`}
              ></span>
              <span className="text-lg font-bold capitalize">{item.value}</span>
            </div>
          ) : (
            <div
              className={`text-2xl font-bold ${
                item.isProfit && (stats?.totalProfit ?? 0) > 0
                  ? 'text-[var(--positive)]'
                  : item.isProfit && (stats?.totalProfit ?? 0) < 0
                  ? 'text-[var(--negative)]'
                  : ''
              }`}
            >
              {item.value}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

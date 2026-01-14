'use client';

import { useEffect, useState } from 'react';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalWalletsTracked: number;
  uniqueWalletsTracked: number;
  alertsToday: number;
  subscriptionBreakdown: {
    free: number;
    pro: number;
    enterprise: number;
  };
}

function StatCard({
  label,
  value,
  subValue,
  accent = false,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  accent?: boolean;
}) {
  return (
    <div className={`card p-6 ${accent ? 'border-pulse glow-box' : ''}`}>
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2 font-mono">
        {label}
      </div>
      <div className={`text-3xl font-bold font-mono ${accent ? 'text-[var(--accent-primary)] glow-text' : 'text-[var(--text-primary)]'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subValue && (
        <div className="text-xs text-[var(--text-secondary)] mt-2 font-mono">
          {subValue}
        </div>
      )}
    </div>
  );
}

export default function StatsCards() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-6 animate-pulse">
            <div className="h-3 bg-[var(--bg-tertiary)] rounded w-20 mb-3"></div>
            <div className="h-8 bg-[var(--bg-tertiary)] rounded w-16"></div>
          </div>
        ))}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
      <StatCard
        label="Active Users"
        value={stats.activeUsers}
        subValue={`${stats.totalUsers} total`}
        accent
      />
      <StatCard
        label="Wallets Tracked"
        value={stats.uniqueWalletsTracked}
        subValue={`${stats.totalWalletsTracked} subscriptions`}
      />
      <StatCard
        label="Alerts Today"
        value={stats.alertsToday}
      />
      <StatCard
        label="Subscribers"
        value={`${stats.subscriptionBreakdown.pro + stats.subscriptionBreakdown.enterprise}`}
        subValue={`${stats.subscriptionBreakdown.pro} Pro / ${stats.subscriptionBreakdown.enterprise} Enterprise`}
      />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

interface CopyTradingData {
  stats: {
    totalTrades: number;
    executedTrades: number;
    failedTrades: number;
    totalVolume: number;
    todayVolume: number;
    todayTrades: number;
  };
  account: {
    walletAddress: string;
    proxyAddress: string | null;
    copyEnabled: boolean;
    copyPercentage: number;
    maxTradeSize: number | null;
    dailyLimit: number | null;
  } | null;
}

function StatCard({
  label,
  value,
  subValue,
  accent = false,
  color,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  accent?: boolean;
  color?: 'green' | 'red';
}) {
  const colorClass = color === 'green'
    ? 'text-[var(--status-profit)]'
    : color === 'red'
    ? 'text-[var(--status-loss)]'
    : accent
    ? 'text-[var(--accent-primary)] glow-text'
    : 'text-[var(--text-primary)]';

  return (
    <div className={`card p-6 ${accent ? 'border-pulse glow-box' : ''}`}>
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2 font-mono">
        {label}
      </div>
      <div className={`text-3xl font-bold font-mono ${colorClass}`}>
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

export default function CopyTradingStats() {
  const [data, setData] = useState<CopyTradingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/copy-trading');
        const json = await res.json();
        setData(json);
      } catch (error) {
        console.error('Failed to fetch copy trading data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 10000);
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

  if (!data) {
    return null;
  }

  const { stats, account } = data;
  const successRate = stats.totalTrades > 0
    ? ((stats.executedTrades / stats.totalTrades) * 100).toFixed(0)
    : '0';

  return (
    <div className="space-y-6">
      {/* Account Info */}
      {account && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-[var(--text-muted)] font-mono">TRADING ACCOUNT</span>
              <div className="font-mono text-sm text-[var(--text-secondary)]">
                {account.proxyAddress
                  ? `${account.proxyAddress.slice(0, 10)}...${account.proxyAddress.slice(-8)}`
                  : `${account.walletAddress.slice(0, 10)}...${account.walletAddress.slice(-8)}`
                }
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-[var(--text-muted)]">Max Trade</div>
                <div className="font-mono text-[var(--text-primary)]">
                  ${account.maxTradeSize || '∞'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[var(--text-muted)]">Daily Limit</div>
                <div className="font-mono text-[var(--text-primary)]">
                  ${account.dailyLimit || '∞'}
                </div>
              </div>
              <div className={`px-3 py-1 rounded text-xs font-mono ${
                account.copyEnabled
                  ? 'bg-[var(--status-profit)]/20 text-[var(--status-profit)]'
                  : 'bg-[var(--status-loss)]/20 text-[var(--status-loss)]'
              }`}>
                {account.copyEnabled ? 'AUTO ON' : 'AUTO OFF'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
        <StatCard
          label="Total Volume"
          value={`$${stats.totalVolume.toFixed(2)}`}
          subValue={`${stats.executedTrades} trades executed`}
          accent
        />
        <StatCard
          label="Today's Volume"
          value={`$${stats.todayVolume.toFixed(2)}`}
          subValue={`${stats.todayTrades} trades today`}
        />
        <StatCard
          label="Success Rate"
          value={`${successRate}%`}
          subValue={`${stats.failedTrades} failed`}
          color={parseInt(successRate) >= 80 ? 'green' : parseInt(successRate) < 50 ? 'red' : undefined}
        />
        <StatCard
          label="Copy %"
          value={`${account?.copyPercentage || 0}%`}
          subValue="of whale trades"
        />
      </div>
    </div>
  );
}

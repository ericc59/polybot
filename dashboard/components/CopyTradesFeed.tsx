'use client';

import { useEffect, useState } from 'react';

interface CopyTrade {
  id: number;
  userId: number;
  sourceWallet: string;
  marketTitle: string;
  side: string;
  size: number;
  price: number;
  status: string;
  createdAt: number;
  executedAt: number | null;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 86400000) { // Less than 24 hours
    return formatTime(timestamp);
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }) + ' ' + formatTime(timestamp);
}

export default function CopyTradesFeed({ limit = 20 }: { limit?: number }) {
  const [trades, setTrades] = useState<CopyTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrades() {
      try {
        const res = await fetch('/api/copy-trading');
        const data = await res.json();
        setTrades(data.trades || []);
      } catch (error) {
        console.error('Failed to fetch copy trades:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">YOUR COPY TRADES</h2>
        </div>
        <div className="divide-y divide-[var(--border-primary)]">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-4 animate-pulse">
              <div className="h-4 bg-[var(--bg-tertiary)] rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-[var(--bg-tertiary)] rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const displayTrades = trades.slice(0, limit);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] font-mono">YOUR COPY TRADES</h2>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)] animate-pulse"></span>
          <span className="text-xs text-[var(--text-muted)] font-mono">Auto-refresh 10s</span>
        </div>
      </div>

      {displayTrades.length === 0 ? (
        <div className="p-8 text-center text-[var(--text-muted)]">
          <div className="text-4xl mb-4">📋</div>
          <div className="font-mono">No copy trades yet</div>
          <div className="text-xs mt-2">Enable auto-trading and subscribe to whales to see trades here</div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-primary)]">
          {displayTrades.map((trade) => (
            <div
              key={trade.id}
              className="p-4 hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                        trade.side === 'BUY'
                          ? 'bg-[var(--status-profit)]/20 text-[var(--status-profit)]'
                          : 'bg-[var(--status-loss)]/20 text-[var(--status-loss)]'
                      }`}
                    >
                      {trade.side}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono ${
                        trade.status === 'executed'
                          ? 'bg-[var(--status-profit)]/10 text-[var(--status-profit)]'
                          : trade.status === 'failed'
                          ? 'bg-[var(--status-loss)]/10 text-[var(--status-loss)]'
                          : trade.status === 'skipped'
                          ? 'bg-yellow-500/10 text-yellow-500'
                          : 'bg-blue-500/10 text-blue-500'
                      }`}
                    >
                      {trade.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm text-[var(--text-primary)] font-medium truncate">
                    {trade.marketTitle || 'Unknown Market'}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono mt-1">
                    Copied from {trade.sourceWallet.slice(0, 10)}...
                  </div>
                </div>
                <div className="text-right ml-4">
                  <div className="text-lg font-bold font-mono text-[var(--text-primary)]">
                    ${(trade.size * trade.price).toFixed(2)}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    @ {(trade.price * 100).toFixed(0)}¢
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] font-mono mt-1">
                    {formatDate(trade.createdAt)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

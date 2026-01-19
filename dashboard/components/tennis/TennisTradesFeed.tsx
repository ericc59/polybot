'use client';

import { useEffect, useState } from 'react';

interface TennisTrade {
  id: number;
  matchId: number;
  player1: string;
  player2: string;
  side: string;
  shares: number;
  price: number;
  cost: number;
  profit: number | null;
  status: string;
  createdAt: number;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TennisTradesFeed({ limit = 10 }: { limit?: number }) {
  const [trades, setTrades] = useState<TennisTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrades() {
      try {
        const res = await fetch(`/api/tennis/trades?limit=${limit}`);
        if (res.ok) {
          const data = await res.json();
          setTrades(data);
        }
      } catch (error) {
        console.error('Failed to fetch tennis trades:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);
    return () => clearInterval(interval);
  }, [limit]);

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--border-color)]">
        <h2 className="text-lg font-semibold">Recent Trades</h2>
      </div>

      <div className="divide-y divide-[var(--border-color)]">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="p-4">
              <div className="h-4 w-32 bg-[var(--bg-tertiary)] rounded animate-pulse mb-2"></div>
              <div className="h-3 w-20 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
            </div>
          ))
        ) : trades.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">
            No trades yet
          </div>
        ) : (
          trades.map((trade) => (
            <div key={trade.id} className="p-4 hover:bg-[var(--bg-secondary)] transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">
                  {trade.player1} vs {trade.player2}
                </span>
                <span
                  className={`text-sm font-mono ${
                    trade.profit !== null && trade.profit > 0
                      ? 'text-[var(--positive)]'
                      : trade.profit !== null && trade.profit < 0
                      ? 'text-[var(--negative)]'
                      : ''
                  }`}
                >
                  {trade.profit !== null
                    ? `${trade.profit > 0 ? '+' : ''}$${trade.profit.toFixed(2)}`
                    : `$${trade.cost.toFixed(2)}`}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>
                  {trade.shares.toLocaleString()} shares @ ${trade.price.toFixed(2)}
                </span>
                <span>{formatTime(trade.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

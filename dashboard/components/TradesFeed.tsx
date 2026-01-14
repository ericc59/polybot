'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Trade {
  id: number;
  wallet_address: string;
  market_title: string;
  trade_side: string;
  trade_size: number;
  trade_price: number;
  sent_at: number;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatSize(size: number): string {
  if (size >= 1000000) return `$${(size / 1000000).toFixed(2)}M`;
  if (size >= 1000) return `$${(size / 1000).toFixed(1)}K`;
  return `$${size.toFixed(0)}`;
}

export default function TradesFeed({ limit = 50 }: { limit?: number }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    async function fetchTrades() {
      try {
        const res = await fetch(`/api/trades?limit=${limit}`);
        const data = await res.json();
        setTrades(data.trades || []);
        setLastUpdate(new Date());
      } catch (error) {
        console.error('Failed to fetch trades:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);
    return () => clearInterval(interval);
  }, [limit]);

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-[var(--bg-tertiary)] rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            LIVE TRADES
          </h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--positive)] pulse"></span>
            <span className="text-xs font-mono text-[var(--text-muted)]">
              Auto-refresh 10s
            </span>
          </div>
        </div>
        {lastUpdate && (
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Updated {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="divide-y divide-[var(--border-color)]">
        {trades.map((trade, index) => (
          <div
            key={trade.id}
            className="p-4 hover:bg-[rgba(0,255,136,0.02)] transition-colors fade-in"
            style={{ animationDelay: `${index * 0.03}s` }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <Link
                    href={`/wallet/${trade.wallet_address}`}
                    className="font-mono text-sm text-[var(--accent-primary)] hover:underline"
                  >
                    {formatAddress(trade.wallet_address)}
                  </Link>
                  <span
                    className={`badge ${
                      trade.trade_side?.toLowerCase() === 'buy'
                        ? 'badge-active'
                        : 'badge-dormant'
                    }`}
                  >
                    {trade.trade_side || 'TRADE'}
                  </span>
                </div>
                <div className="text-sm text-[var(--text-primary)] truncate">
                  {trade.market_title || 'Unknown Market'}
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <div className="font-mono text-lg font-semibold text-[var(--text-primary)]">
                  {formatSize(trade.trade_size)}
                </div>
                <div className="text-xs font-mono text-[var(--text-muted)]">
                  @ {(trade.trade_price * 100).toFixed(1)}¢
                </div>
              </div>

              <div className="text-right flex-shrink-0 w-24">
                <div className="text-xs font-mono text-[var(--text-muted)]">
                  {formatTime(trade.sent_at)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {trades.length === 0 && (
        <div className="p-12 text-center text-[var(--text-muted)]">
          <div className="text-4xl mb-4">📡</div>
          <div>No recent trades detected</div>
          <div className="text-xs mt-2">Waiting for whale activity...</div>
        </div>
      )}
    </div>
  );
}

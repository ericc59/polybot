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
  orderId: string | null;
  createdAt: number;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TennisTradesTable() {
  const [trades, setTrades] = useState<TennisTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrades() {
      try {
        const res = await fetch(`/api/tennis/trades?limit=100`);
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
  }, []);

  // Calculate totals
  const totalCost = trades.reduce((sum, t) => sum + t.cost, 0);
  const totalProfit = trades.reduce((sum, t) => sum + (t.profit ?? 0), 0);
  const totalShares = trades.reduce((sum, t) => sum + t.shares, 0);

  return (
    <div className="card">
      {/* Summary Stats */}
      <div className="p-4 border-b border-[var(--border-color)] grid grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase">Total Trades</div>
          <div className="text-xl font-bold">{trades.length}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase">Total Shares</div>
          <div className="text-xl font-bold">{totalShares.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase">Total Cost</div>
          <div className="text-xl font-bold">${totalCost.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase">Total Profit</div>
          <div
            className={`text-xl font-bold ${
              totalProfit > 0
                ? 'text-[var(--positive)]'
                : totalProfit < 0
                ? 'text-[var(--negative)]'
                : ''
            }`}
          >
            {totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Side</th>
              <th>Shares</th>
              <th>Price</th>
              <th>Cost</th>
              <th>Profit</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i}>
                  {[...Array(8)].map((_, j) => (
                    <td key={j}>
                      <div className="h-4 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                    </td>
                  ))}
                </tr>
              ))
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-[var(--text-muted)]">
                  No trades yet
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr key={trade.id}>
                  <td>
                    <div className="font-medium">
                      {trade.player1} vs {trade.player2}
                    </div>
                  </td>
                  <td>
                    <span className="font-mono text-sm">{trade.side}</span>
                  </td>
                  <td className="font-mono">{trade.shares.toLocaleString()}</td>
                  <td className="font-mono">${trade.price.toFixed(2)}</td>
                  <td className="font-mono">${trade.cost.toFixed(2)}</td>
                  <td
                    className={`font-mono ${
                      trade.profit !== null && trade.profit > 0
                        ? 'text-[var(--positive)]'
                        : trade.profit !== null && trade.profit < 0
                        ? 'text-[var(--negative)]'
                        : ''
                    }`}
                  >
                    {trade.profit !== null
                      ? `${trade.profit > 0 ? '+' : ''}$${trade.profit.toFixed(2)}`
                      : '-'}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        trade.status === 'filled'
                          ? 'badge-active'
                          : trade.status === 'pending'
                          ? 'badge-dormant'
                          : 'badge-sniper'
                      }`}
                    >
                      {trade.status}
                    </span>
                  </td>
                  <td className="text-[var(--text-secondary)]">
                    {formatDateTime(trade.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

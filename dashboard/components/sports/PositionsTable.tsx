'use client';

import { useEffect, useState } from 'react';

interface Position {
  id: string;
  matchId: string;
  sport: string;
  league: string;
  icon: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  tokenId: string;
  conditionId: string;
  shares: number;
  entryPrice: number;
  curPrice: number;
  edge: number;
  size: number;
  value: number;
  toWin: number;
  pnl: number;
  pnlPercent: number;
  orderId: string;
  status: string;
  createdAt: number;
}

interface PositionsData {
  positions: Position[];
  summary: {
    totalPositions: number;
    totalValue: number;
    totalCost: number;
    totalPnl: number;
    totalToWin: number;
    avgEdge: number;
  };
}

interface PositionsTableProps {
  filterLeague?: string;
}

function formatPrice(price: number): string {
  const cents = price * 100;
  if (cents < 1) return `${cents.toFixed(1)}¢`;
  return `${cents.toFixed(0)}¢`;
}

function formatMoney(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(2)}K`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PositionsTable({ filterLeague }: PositionsTableProps) {
  const [data, setData] = useState<PositionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'value' | 'edge' | 'size'>('size');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchPositions() {
      try {
        const res = await fetch('/api/sports/positions');
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to fetch');
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch positions');
      } finally {
        setLoading(false);
      }
    }

    fetchPositions();
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="p-4 border-b border-[var(--border-color)]">
          <div className="h-6 w-32 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
        </div>
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[var(--negative)] mb-2">{error}</div>
        <p className="text-sm text-[var(--text-muted)]">
          Make sure the bot database exists at data/polybot.db
        </p>
      </div>
    );
  }

  if (!data || data.positions.length === 0) {
    return (
      <div className="card p-8 text-center">
        <div className="text-[var(--text-muted)]">No open positions</div>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Bets will appear here when the sports bot places orders
        </p>
      </div>
    );
  }

  // Filter and sort positions
  let positions = [...data.positions];

  // Filter by league if specified
  if (filterLeague && filterLeague !== 'all') {
    positions = positions.filter((p) => p.league === filterLeague);
  }

  // Filter by search
  if (search) {
    const searchLower = search.toLowerCase();
    positions = positions.filter(
      (p) =>
        p.match.toLowerCase().includes(searchLower) ||
        p.outcome.toLowerCase().includes(searchLower) ||
        p.league.toLowerCase().includes(searchLower)
    );
  }

  // Sort
  positions.sort((a, b) => {
    switch (sortBy) {
      case 'edge':
        return b.edge - a.edge;
      case 'value':
        return b.value - a.value;
      default:
        return b.size - a.size;
    }
  });

  // Calculate filtered summary
  const filteredSummary = {
    totalValue: positions.reduce((sum, p) => sum + p.value, 0),
    totalCost: positions.reduce((sum, p) => sum + p.size, 0),
    totalToWin: positions.reduce((sum, p) => sum + p.toWin, 0),
    avgEdge: positions.length > 0
      ? positions.reduce((sum, p) => sum + p.edge, 0) / positions.length
      : 0,
    positionCount: positions.length,
  };

  return (
    <div className="card">
      {/* Header with search and sort */}
      <div className="p-4 border-b border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search matches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-primary)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'value' | 'edge' | 'size')}
            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1 text-sm"
          >
            <option value="size">Size</option>
            <option value="edge">Edge</option>
            <option value="value">Value</option>
          </select>
        </div>
      </div>

      {/* Summary row */}
      <div className="p-4 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-[var(--text-muted)] text-xs">POSITIONS</div>
          <div className="font-semibold">{filteredSummary.positionCount}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)] text-xs">TOTAL WAGERED</div>
          <div className="font-semibold">{formatMoney(filteredSummary.totalCost)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)] text-xs">TO WIN</div>
          <div className="font-semibold">{formatMoney(filteredSummary.totalToWin)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)] text-xs">AVG EDGE</div>
          <div className="font-semibold text-[var(--positive)]">+{(filteredSummary.avgEdge * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Mobile Cards View */}
      <div className="sm:hidden divide-y divide-[var(--border-color)]">
        {positions.map((position) => (
          <div key={position.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded bg-[var(--bg-tertiary)] flex items-center justify-center text-lg flex-shrink-0">
                {position.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[var(--text-primary)] truncate">
                  {position.match}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="badge badge-sniper text-xs">{position.outcome}</span>
                  <span className="text-xs text-[var(--positive)]">+{(position.edge * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-[var(--text-muted)]">Size</div>
                <div className="font-mono">{formatMoney(position.size)}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Entry</div>
                <div className="font-mono">{formatPrice(position.entryPrice)}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Shares</div>
                <div className="font-mono">{position.shares.toFixed(1)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Outcome</th>
              <th>Edge</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Shares</th>
              <th>To Win</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{position.icon}</span>
                    <div>
                      <div className="font-medium">{position.match}</div>
                      <div className="text-xs text-[var(--text-muted)]">{position.league}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge badge-sniper">{position.outcome}</span>
                </td>
                <td className="font-mono text-[var(--positive)]">+{(position.edge * 100).toFixed(1)}%</td>
                <td className="font-mono">{formatMoney(position.size)}</td>
                <td className="font-mono">{formatPrice(position.entryPrice)}</td>
                <td className="font-mono">{position.shares.toFixed(1)}</td>
                <td className="font-mono">{formatMoney(position.toWin)}</td>
                <td className="text-[var(--text-muted)] text-sm">{formatDate(position.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[var(--border-color)] text-xs text-[var(--text-muted)] text-center">
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}

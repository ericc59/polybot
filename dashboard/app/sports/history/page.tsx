'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface HistoricalBet {
  id: string;
  matchId: string;
  sport: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  tokenId: string;
  shares: number;
  sharpProb: number;
  entryPrice: number;
  edge: number;
  size: number;
  orderId: string;
  status: string;
  sellPrice: number | null;
  pnl: number | null;
  createdAt: number;
  settledAt: number | null;
}

interface Stats {
  totalBets: number;
  openBets: number;
  settledBets: number;
  winCount: number;
  lostCount: number;
  winRate: number;
  totalPnl: number;
  totalWagered: number;
  openValue: number;
  roi: number;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getSportIcon(sport: string): string {
  const s = sport.toLowerCase();
  if (s.includes('basketball') || s.includes('nba') || s.includes('ncaa')) return '🏀';
  if (s.includes('football') || s.includes('nfl')) return '🏈';
  if (s.includes('hockey') || s.includes('nhl')) return '🏒';
  if (s.includes('baseball') || s.includes('mlb')) return '⚾';
  if (s.includes('soccer') || s.includes('mls')) return '⚽';
  return '🎯';
}

export default function HistoryPage() {
  const [bets, setBets] = useState<HistoricalBet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'settled'>('all');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch('/api/sports/history?limit=200');
        if (res.ok) {
          const data = await res.json();
          setBets(data.bets);
          setStats(data.stats);
        }
      } catch (error) {
        console.error('Failed to fetch sports history:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, []);

  async function checkResolutions() {
    setChecking(true);
    setCheckResult(null);
    try {
      await fetch('/api/sports/backfill-conditions', { method: 'POST' });
      const res = await fetch('/api/sports/check-resolutions', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setCheckResult(`Checked ${data.checked} bets: ${data.won} won, ${data.lost} lost`);
        const refreshRes = await fetch('/api/sports/history?limit=200');
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setBets(refreshData.bets);
          setStats(refreshData.stats);
        }
      } else {
        setCheckResult(`Error: ${data.error}`);
      }
    } catch (error) {
      setCheckResult('Failed to check resolutions');
    } finally {
      setChecking(false);
    }
  }

  const filteredBets = bets.filter((bet) => {
    if (filter === 'open') return bet.status === 'open';
    if (filter === 'settled') return bet.status !== 'open';
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">Sports Betting History</h1>
        <p className="text-sm sm:text-base text-[var(--text-secondary)] mt-1">
          Track your sports value betting performance
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-4 border-b border-[var(--border-color)]">
        <Link
          href="/sports"
          className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
          className="px-4 py-2 text-sm font-medium text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)] -mb-px"
        >
          History
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="card p-3 sm:p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Total P&L</div>
          <div className={`text-xl sm:text-2xl font-bold mt-1 ${(stats?.totalPnl || 0) >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
            {(stats?.totalPnl || 0) >= 0 ? '+' : ''}${(stats?.totalPnl || 0).toFixed(2)}
          </div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Win Rate</div>
          <div className="text-xl sm:text-2xl font-bold mt-1">{((stats?.winRate || 0) * 100).toFixed(1)}%</div>
          <div className="text-xs text-[var(--text-muted)]">{stats?.winCount || 0}/{stats?.settledBets || 0}</div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">ROI</div>
          <div className={`text-xl sm:text-2xl font-bold mt-1 ${(stats?.roi || 0) >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
            {(stats?.roi || 0) >= 0 ? '+' : ''}{((stats?.roi || 0) * 100).toFixed(1)}%
          </div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Wagered</div>
          <div className="text-xl sm:text-2xl font-bold mt-1">${(stats?.totalWagered || 0).toFixed(0)}</div>
        </div>
        <div className="card p-3 sm:p-4 col-span-2 sm:col-span-1">
          <div className="text-xs text-[var(--text-muted)] uppercase">Open</div>
          <div className="text-xl sm:text-2xl font-bold mt-1">{stats?.openBets || 0}</div>
          <div className="text-xs text-[var(--text-muted)]">${(stats?.openValue || 0).toFixed(0)} at risk</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'open', 'settled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 sm:px-4 py-2 text-sm rounded transition-colors ${
                filter === f
                  ? 'bg-[var(--accent-primary)] text-black font-medium'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}

          <button
            onClick={checkResolutions}
            disabled={checking}
            className="px-3 sm:px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking...' : 'Check'}
          </button>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 sm:ml-auto">
          {checkResult && (
            <span className="text-xs sm:text-sm text-[var(--text-secondary)] truncate max-w-[200px]">{checkResult}</span>
          )}
          <span className="text-sm text-[var(--text-muted)] whitespace-nowrap">
            {filteredBets.length} bets
          </span>
        </div>
      </div>

      {/* Mobile Cards View */}
      <div className="sm:hidden space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 w-32 bg-[var(--bg-tertiary)] rounded mb-2"></div>
              <div className="h-3 w-24 bg-[var(--bg-tertiary)] rounded"></div>
            </div>
          ))
        ) : filteredBets.length === 0 ? (
          <div className="card p-8 text-center text-[var(--text-muted)]">No bets found</div>
        ) : (
          filteredBets.map((bet) => (
            <div key={bet.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{bet.match}</div>
                  <div className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                    {getSportIcon(bet.sport)} {formatDate(bet.createdAt)}
                  </div>
                </div>
                <span
                  className={`badge text-xs ${
                    bet.status === 'won'
                      ? 'badge-active'
                      : bet.status === 'lost'
                      ? 'bg-[var(--negative)]/20 text-[var(--negative)]'
                      : bet.status === 'open'
                      ? 'badge-dormant'
                      : 'badge-sniper'
                  }`}
                >
                  {bet.status.toUpperCase()}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <span className="badge badge-sniper text-xs">{bet.outcome}</span>
                <span className="text-xs font-mono text-[var(--positive)]">+{(bet.edge * 100).toFixed(1)}%</span>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[var(--text-muted)]">Size</div>
                  <div className="font-mono">${bet.size.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Entry</div>
                  <div className="font-mono">{(bet.entryPrice * 100).toFixed(0)}¢</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Shares</div>
                  <div className="font-mono">{bet.shares.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">P&L</div>
                  {bet.pnl !== null ? (
                    <div className={`font-semibold ${bet.pnl >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
                      {bet.pnl >= 0 ? '+' : ''}${bet.pnl.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-[var(--text-muted)]">-</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <div className="card hidden sm:block">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Match</th>
                <th>Outcome</th>
                <th>Edge</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Shares</th>
                <th>Status</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(9)].map((_, j) => (
                      <td key={j}>
                        <div className="h-4 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredBets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-[var(--text-muted)]">
                    No bets found
                  </td>
                </tr>
              ) : (
                filteredBets.map((bet) => (
                  <tr key={bet.id}>
                    <td className="text-[var(--text-muted)] whitespace-nowrap">{formatDate(bet.createdAt)}</td>
                    <td>
                      <div className="font-medium">{bet.match}</div>
                      <div className="text-xs text-[var(--text-muted)]">{getSportIcon(bet.sport)} {bet.sport}</div>
                    </td>
                    <td>
                      <span className="badge badge-sniper">{bet.outcome}</span>
                    </td>
                    <td className="font-mono text-[var(--positive)]">+{(bet.edge * 100).toFixed(1)}%</td>
                    <td className="font-mono">${bet.size.toFixed(2)}</td>
                    <td className="font-mono">{(bet.entryPrice * 100).toFixed(0)}¢</td>
                    <td className="font-mono">{bet.shares.toFixed(1)}</td>
                    <td>
                      <span
                        className={`badge ${
                          bet.status === 'won'
                            ? 'badge-active'
                            : bet.status === 'lost'
                            ? 'bg-[var(--negative)]/20 text-[var(--negative)]'
                            : bet.status === 'open'
                            ? 'badge-dormant'
                            : 'badge-sniper'
                        }`}
                      >
                        {bet.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      {bet.pnl !== null ? (
                        <span className={`font-semibold ${bet.pnl >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
                          {bet.pnl >= 0 ? '+' : ''}${bet.pnl.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

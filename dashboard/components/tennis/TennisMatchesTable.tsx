'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TennisMatch {
  id: number;
  oddsApiId: string;
  player1: string;
  player2: string;
  commenceTime: number;
  sportKey: string;
  status: string;
  polymarketConditionId: string | null;
  polymarketSlug: string | null;
  walkoverDetectedAt: number | null;
  ordersPlacedAt: number | null;
  notes: string | null;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeUntil(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;

  if (diff < 0) {
    const ago = Math.abs(diff);
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
    return `${Math.floor(ago / 86400)}d ago`;
  }

  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}

export default function TennisMatchesTable() {
  const [matches, setMatches] = useState<TennisMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'today' | 'pending' | 'walkover'>('today');
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  async function triggerWalkover(matchId: number) {
    setTriggeringId(matchId);
    try {
      const res = await fetch('/api/tennis/trigger-walkover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId }),
      });

      const data = await res.json();

      if (res.ok) {
        // Refresh matches
        const refreshRes = await fetch(`/api/tennis/matches?limit=100`);
        if (refreshRes.ok) {
          setMatches(await refreshRes.json());
        }
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      alert('Failed to trigger walkover');
      console.error(error);
    } finally {
      setTriggeringId(null);
    }
  }

  useEffect(() => {
    async function fetchMatches() {
      try {
        const res = await fetch(`/api/tennis/matches?limit=100`);
        if (res.ok) {
          const data = await res.json();
          setMatches(data);
        }
      } catch (error) {
        console.error('Failed to fetch tennis matches:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMatches();
    const interval = setInterval(fetchMatches, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredMatches = matches.filter((match) => {
    if (filter === 'all') return true;
    if (filter === 'today') {
      const today = new Date();
      const matchDate = new Date(match.commenceTime * 1000);
      return (
        matchDate.getDate() === today.getDate() &&
        matchDate.getMonth() === today.getMonth() &&
        matchDate.getFullYear() === today.getFullYear()
      );
    }
    if (filter === 'pending') return match.status === 'pending';
    if (filter === 'walkover') return match.walkoverDetectedAt !== null;
    return true;
  });

  return (
    <div className="card">
      {/* Filters */}
      <div className="p-4 border-b border-[var(--border-color)] flex flex-wrap items-center gap-2">
        {(['all', 'today', 'pending', 'walkover'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              filter === f
                ? 'bg-[var(--accent-primary)] text-black font-medium'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-sm text-[var(--text-muted)]">
          {filteredMatches.length} matches
        </span>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden">
        {loading ? (
          <div className="p-4 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-[var(--bg-tertiary)] rounded-lg p-4 animate-pulse">
                <div className="h-4 w-3/4 bg-[var(--bg-secondary)] rounded mb-2"></div>
                <div className="h-3 w-1/2 bg-[var(--bg-secondary)] rounded"></div>
              </div>
            ))}
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">No matches found</div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {filteredMatches.map((match) => (
              <div key={match.id} className="p-4">
                <Link href={`/tennis/match/${match.id}`} className="block">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-xs text-[var(--text-muted)]">#{match.id}</span>
                    <span className="badge badge-sniper flex-shrink-0">
                      {match.sportKey === 'tennis_wta' ? 'WTA' : 'ATP'}
                    </span>
                  </div>
                  <div className="font-medium text-[var(--text-primary)] leading-tight mb-2">
                    {match.player1} vs {match.player2}
                  </div>
                </Link>

                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-3">
                  <span>{formatDateTime(match.commenceTime)}</span>
                  <span className="text-[var(--text-muted)]">•</span>
                  <span className="text-[var(--text-muted)]">{formatTimeUntil(match.commenceTime)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`badge ${
                        match.walkoverDetectedAt
                          ? 'badge-active'
                          : match.status === 'pending'
                          ? 'badge-dormant'
                          : match.status === 'orders_placed'
                          ? 'badge-active'
                          : 'badge-sniper'
                      }`}
                    >
                      {match.walkoverDetectedAt ? 'WALKOVER' : match.status}
                    </span>
                    {match.oddsApiId && !match.oddsApiId.startsWith('pm_') ? (
                      <span className="badge badge-active">API</span>
                    ) : (
                      <span className="badge badge-dormant">No API</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {match.polymarketSlug && (
                      <a
                        href={`https://polymarket.com/event/${match.polymarketSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent-primary)] hover:underline text-sm"
                      >
                        Market
                      </a>
                    )}
                    {match.polymarketConditionId && (
                      <button
                        onClick={() => triggerWalkover(match.id)}
                        disabled={triggeringId === match.id || match.ordersPlacedAt !== null}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                          match.ordersPlacedAt !== null
                            ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
                            : match.walkoverDetectedAt !== null
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-[var(--accent-primary)] text-black hover:opacity-90'
                        }`}
                      >
                        {triggeringId === match.id
                          ? '...'
                          : match.ordersPlacedAt !== null
                          ? 'Placed'
                          : match.walkoverDetectedAt !== null
                          ? 'Walkover!'
                          : 'Trigger'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Tournament</th>
              <th>Time</th>
              <th>Odds API</th>
              <th>Status</th>
              <th>Market</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i}>
                  <td>
                    <div className="h-4 w-40 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                  <td>
                    <div className="h-4 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                  <td>
                    <div className="h-4 w-20 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                  <td>
                    <div className="h-4 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                  <td>
                    <div className="h-4 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                  <td>
                    <div className="h-4 w-12 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                  <td>
                    <div className="h-4 w-16 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
                  </td>
                </tr>
              ))
            ) : filteredMatches.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-[var(--text-muted)]">
                  No matches found
                </td>
              </tr>
            ) : (
              filteredMatches.map((match) => (
                <tr key={match.id} className="cursor-pointer">
                  <td>
                    <Link href={`/tennis/match/${match.id}`} className="block hover:text-[var(--accent-primary)]">
                      <div className="text-xs text-[var(--text-muted)] mb-0.5">#{match.id}</div>
                      <div className="font-medium">
                        {match.player1} vs {match.player2}
                      </div>
                      {match.notes && (
                        <div className="text-xs text-[var(--text-muted)] mt-1 truncate max-w-xs">
                          {match.notes}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td>
                    <span className="badge badge-sniper">
                      {match.sportKey === 'tennis_wta' ? 'WTA' : 'ATP'}
                    </span>
                  </td>
                  <td>
                    <div>{formatDateTime(match.commenceTime)}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {formatTimeUntil(match.commenceTime)}
                    </div>
                  </td>
                  <td>
                    {match.oddsApiId && !match.oddsApiId.startsWith('pm_') ? (
                      <span className="badge badge-active">Linked</span>
                    ) : (
                      <span className="badge badge-dormant">Not in API</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        match.walkoverDetectedAt
                          ? 'badge-active'
                          : match.status === 'pending'
                          ? 'badge-dormant'
                          : match.status === 'orders_placed'
                          ? 'badge-active'
                          : 'badge-sniper'
                      }`}
                    >
                      {match.walkoverDetectedAt ? 'WALKOVER' : match.status}
                    </span>
                  </td>
                  <td>
                    {match.polymarketSlug ? (
                      <a
                        href={`https://polymarket.com/event/${match.polymarketSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent-primary)] hover:underline text-sm"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-[var(--text-muted)]">-</span>
                    )}
                  </td>
                  <td>
                    {match.polymarketConditionId ? (
                      <button
                        onClick={() => triggerWalkover(match.id)}
                        disabled={triggeringId === match.id || match.ordersPlacedAt !== null}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                          match.ordersPlacedAt !== null
                            ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed'
                            : match.walkoverDetectedAt !== null
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-[var(--accent-primary)] text-black hover:opacity-90'
                        }`}
                      >
                        {triggeringId === match.id
                          ? 'Triggering...'
                          : match.ordersPlacedAt !== null
                          ? 'Placed'
                          : match.walkoverDetectedAt !== null
                          ? 'Walkover!'
                          : 'Trigger'}
                      </button>
                    ) : (
                      <span className="text-[var(--text-muted)] text-xs">No market</span>
                    )}
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

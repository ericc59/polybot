'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TennisMatch {
  id: number;
  player1: string;
  player2: string;
  commenceTime: number;
  sportKey: string;
  status: string;
  polymarketConditionId: string | null;
  walkoverDetectedAt: number | null;
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

export default function TennisMatchesFeed({ limit = 10 }: { limit?: number }) {
  const [matches, setMatches] = useState<TennisMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMatches() {
      try {
        const res = await fetch(`/api/tennis/matches?limit=${limit}`);
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
  }, [limit]);

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--border-color)]">
        <h2 className="text-lg font-semibold">Upcoming Matches</h2>
      </div>

      <div className="divide-y divide-[var(--border-color)]">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 w-48 bg-[var(--bg-tertiary)] rounded animate-pulse mb-2"></div>
                <div className="h-3 w-24 bg-[var(--bg-tertiary)] rounded animate-pulse"></div>
              </div>
            </div>
          ))
        ) : matches.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">
            No tracked matches
          </div>
        ) : (
          matches.map((match) => (
            <Link
              key={match.id}
              href={`/tennis/match/${match.id}`}
              className="p-4 flex items-center justify-between hover:bg-[var(--bg-secondary)] transition-colors block"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    match.polymarketConditionId
                      ? 'bg-[var(--positive)]'
                      : 'bg-[var(--warning)]'
                  }`}
                ></div>
                <div>
                  <div className="font-medium">
                    {match.player1} vs {match.player2}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {match.sportKey === 'tennis_wta' ? 'WTA' : 'ATP'} &bull;{' '}
                    {formatTimeUntil(match.commenceTime)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {match.walkoverDetectedAt && (
                  <span className="badge badge-active">WALKOVER</span>
                )}
                <span
                  className={`badge ${
                    match.status === 'pending'
                      ? 'badge-dormant'
                      : match.status === 'orders_placed'
                      ? 'badge-active'
                      : 'badge-sniper'
                  }`}
                >
                  {match.status}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

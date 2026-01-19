'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TrackedEvent {
  id: string;
  slug: string;
  sport: string;
  league: string;
  icon: string;
  title: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  outcomes: Array<{
    name: string;
    price: number;
    tokenId: string;
  }>;
  hasValueBet: boolean;
  valueBetEdge?: number;
}

interface ApiResponse {
  events: TrackedEvent[];
  leagueCounts: Record<string, number>;
  updatedAt: number;
  total: number;
}

const defaultLeagues = [
  { key: 'all', name: 'All', icon: '📊' },
  { key: 'NBA', name: 'NBA', icon: '🏀' },
  { key: 'CBB', name: 'CBB', icon: '🏀' },
  { key: 'NFL', name: 'NFL', icon: '🏈' },
  { key: 'CFB', name: 'CFB', icon: '🏈' },
  { key: 'NHL', name: 'NHL', icon: '🏒' },
  { key: 'MLB', name: 'MLB', icon: '⚾' },
];

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'Live';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }
  return date.toLocaleDateString();
}

function formatLastUpdate(timestamp: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function EventsPage() {
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [leagueCounts, setLeagueCounts] = useState<Record<string, number>>({});
  const [filterLeague, setFilterLeague] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  async function fetchEvents() {
    try {
      const res = await fetch(`/api/sports/events?league=${filterLeague}`);
      if (res.ok) {
        const data: ApiResponse = await res.json();
        setEvents(data.events);
        setLeagueCounts(data.leagueCounts);
        setLastUpdate(data.updatedAt);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 10000);
    return () => clearInterval(interval);
  }, [filterLeague]);

  return (
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Today's Events</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            All games being tracked on Polymarket today
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={() => fetchEvents()}
            className="px-4 py-2 bg-[var(--bg-tertiary)] rounded text-sm hover:bg-[var(--bg-secondary)] transition-colors"
          >
            Refresh
          </button>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Updated {formatLastUpdate(lastUpdate)}
          </div>
        </div>
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
          className="px-4 py-2 text-sm font-medium text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)] -mb-px"
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
          className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          History
        </Link>
      </div>

      {/* League Filters with counts */}
      <div className="flex flex-wrap gap-2">
        {defaultLeagues.map((league) => {
          const count = league.key === 'all'
            ? Object.values(leagueCounts).reduce((a, b) => a + b, 0)
            : leagueCounts[league.key] || 0;
          return (
            <button
              key={league.key}
              onClick={() => setFilterLeague(league.key)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                filterLeague === league.key
                  ? 'bg-[var(--accent-primary)] text-black font-medium'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              <span>{league.icon}</span>
              <span>{league.name}</span>
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  filterLeague === league.key
                    ? 'bg-black/20'
                    : 'bg-[var(--bg-secondary)]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Events Grid */}
      {loading ? (
        <div className="card p-8 text-center">
          <div className="text-[var(--text-muted)]">Loading...</div>
        </div>
      ) : events.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">📅</div>
          <div className="text-[var(--text-muted)]">No events found</div>
          <div className="text-sm text-[var(--text-muted)] mt-2">
            Start the sports bot to track events
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <div
              key={event.id}
              className={`card p-4 ${event.hasValueBet ? 'border-[var(--positive)]/50' : ''}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{event.icon}</span>
                  <span className="text-xs text-[var(--text-muted)]">{event.league}</span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {formatTime(event.commenceTime)}
                </div>
              </div>

              {/* Teams */}
              <div className="mb-3">
                <div className="font-medium text-[var(--text-primary)]">{event.awayTeam}</div>
                <div className="text-xs text-[var(--text-muted)]">@</div>
                <div className="font-medium text-[var(--text-primary)]">{event.homeTeam}</div>
              </div>

              {/* Outcomes/Prices */}
              {event.outcomes.length > 0 && (
                <div className="flex gap-2 mb-3">
                  {event.outcomes.map((outcome, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-[var(--bg-tertiary)] rounded p-2 text-center"
                    >
                      <div className="text-xs text-[var(--text-muted)] truncate">{outcome.name}</div>
                      <div className="font-mono font-semibold text-[var(--text-primary)]">
                        {formatPercent(outcome.price)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Value Bet Indicator */}
              {event.hasValueBet && (
                <div className="flex items-center gap-2 text-sm text-[var(--positive)]">
                  <span>💰</span>
                  <span>Value Bet: +{((event.valueBetEdge || 0) * 100).toFixed(1)}% edge</span>
                </div>
              )}

              {/* Link to Polymarket */}
              <a
                href={`https://polymarket.com/event/${event.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block text-center text-xs text-[var(--accent-primary)] hover:underline"
              >
                View on Polymarket →
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      {events.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Total Events</div>
            <div className="text-2xl font-semibold text-[var(--text-primary)]">{events.length}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">With Value Bets</div>
            <div className="text-2xl font-semibold text-[var(--positive)]">
              {events.filter((e) => e.hasValueBet).length}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Starting Soon</div>
            <div className="text-2xl font-semibold text-[var(--text-primary)]">
              {events.filter((e) => {
                const diff = new Date(e.commenceTime).getTime() - Date.now();
                return diff > 0 && diff < 3600000;
              }).length}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Live Now</div>
            <div className="text-2xl font-semibold text-[var(--negative)]">
              {events.filter((e) => new Date(e.commenceTime).getTime() < Date.now()).length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

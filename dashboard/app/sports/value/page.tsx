'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ValueBet {
  id: string;
  matchId: string;
  sport: string;
  league: string;
  icon: string;
  homeTeam: string;
  awayTeam: string;
  outcome: string;
  sharpProb: number;
  polymarketPrice: number;
  edge: number;
  recommendedSize: number;
  bookmakerConsensus: number;
  commenceTime: string;
  detectedAt: number;
}

interface ApiResponse {
  valueBets: ValueBet[];
  leagues: string[];
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
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'Started';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function formatLastUpdate(timestamp: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function ValueBetsPage() {
  const [valueBets, setValueBets] = useState<ValueBet[]>([]);
  const [filterLeague, setFilterLeague] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  async function fetchValueBets() {
    try {
      const res = await fetch(`/api/sports/value-bets?league=${filterLeague}`);
      if (res.ok) {
        const data: ApiResponse = await res.json();
        setValueBets(data.valueBets);
        setLastUpdate(data.updatedAt);
      }
    } catch (err) {
      console.error('Failed to fetch value bets:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchValueBets();
    const interval = setInterval(fetchValueBets, 5000);
    return () => clearInterval(interval);
  }, [filterLeague]);

  return (
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Value Bets</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Opportunities where Polymarket price is below sharp bookmaker consensus
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={() => fetchValueBets()}
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
          className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Events
        </Link>
        <Link
          href="/sports/value"
          className="px-4 py-2 text-sm font-medium text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)] -mb-px"
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

      {/* League Filters */}
      <div className="flex flex-wrap gap-2">
        {defaultLeagues.map((league) => (
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
          </button>
        ))}
      </div>

      {/* Info Card */}
      <div className="card p-4 bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/30">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div>
            <div className="font-medium text-[var(--text-primary)]">How Value Betting Works</div>
            <div className="text-sm text-[var(--text-secondary)] mt-1">
              We compare Polymarket prices to consensus odds from sharp bookmakers (DraftKings, FanDuel, etc.).
              When Polymarket offers better odds than the sharp line, that's a value bet.
              Edge = (Sharp Probability - Polymarket Price) / Polymarket Price
            </div>
          </div>
        </div>
      </div>

      {/* Value Bets Table */}
      {loading ? (
        <div className="card p-8 text-center">
          <div className="text-[var(--text-muted)]">Loading...</div>
        </div>
      ) : valueBets.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <div className="text-[var(--text-muted)]">No value bets found right now</div>
          <div className="text-sm text-[var(--text-muted)] mt-2">
            Checking for opportunities with {'>'}5% edge across enabled sports
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Outcome</th>
                  <th>Sharp Prob</th>
                  <th>Poly Price</th>
                  <th>Edge</th>
                  <th>Books</th>
                  <th>Starts</th>
                </tr>
              </thead>
              <tbody>
                {valueBets.map((bet) => (
                  <tr key={bet.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{bet.icon}</span>
                        <div>
                          <div className="font-medium">{bet.homeTeam} vs {bet.awayTeam}</div>
                          <div className="text-xs text-[var(--text-muted)]">{bet.league}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-active">{bet.outcome}</span>
                    </td>
                    <td className="font-mono">{formatPercent(bet.sharpProb)}</td>
                    <td className="font-mono">{formatPercent(bet.polymarketPrice)}</td>
                    <td>
                      <span className="text-[var(--positive)] font-semibold">
                        +{formatPercent(bet.edge)}
                      </span>
                    </td>
                    <td>
                      <span className="text-[var(--text-muted)]">{bet.bookmakerConsensus} books</span>
                    </td>
                    <td className="text-[var(--text-muted)]">{formatTime(bet.commenceTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stats */}
      {valueBets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Total Value Bets</div>
            <div className="text-2xl font-semibold text-[var(--text-primary)]">{valueBets.length}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Avg Edge</div>
            <div className="text-2xl font-semibold text-[var(--positive)]">
              +{formatPercent(valueBets.reduce((sum, b) => sum + b.edge, 0) / valueBets.length)}
            </div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Best Edge</div>
            <div className="text-2xl font-semibold text-[var(--positive)]">
              +{formatPercent(Math.max(...valueBets.map((b) => b.edge)))}
            </div>
          </div>
        </div>
      )}

      {/* Explanation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Sharp Probability</div>
          <div className="text-[var(--text-secondary)]">
            Consensus implied probability from professional sportsbooks
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Polymarket Price</div>
          <div className="text-[var(--text-secondary)]">
            Current price on Polymarket (also the implied probability)
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Edge</div>
          <div className="text-[var(--text-secondary)]">
            Your expected profit margin. 10% edge = 10% expected return
          </div>
        </div>
      </div>
    </div>
  );
}

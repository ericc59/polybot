'use client';

import { useState } from 'react';

interface OddsApiMatch {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  completed?: boolean;
  scores?: Array<{ name: string; score: string }> | null;
}

interface OddsApiSport {
  key: string;
  title: string;
  active: boolean;
}

interface TrackedMatch {
  id: number;
  player1: string;
  player2: string;
  oddsApiId: string;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeUntil(isoString: string): string {
  const timestamp = Math.floor(new Date(isoString).getTime() / 1000);
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

export default function OddsApiAnalysis() {
  const [sports, setSports] = useState<OddsApiSport[]>([]);
  const [matches, setMatches] = useState<OddsApiMatch[]>([]);
  const [trackedMatches, setTrackedMatches] = useState<TrackedMatch[]>([]);
  const [rateLimit, setRateLimit] = useState<{ remaining: number; used: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'sports' | 'matches' | 'scores'>('sports');
  const [error, setError] = useState<string | null>(null);

  async function fetchSports() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tennis/odds-api?action=sports');
      const json = await res.json();

      if (json.error) {
        setError(json.error);
      } else {
        setSports(json.data || []);
        setRateLimit(json.rateLimit);
      }
    } catch (err) {
      setError('Failed to fetch sports');
    } finally {
      setLoading(false);
    }
  }

  async function fetchMatches() {
    setLoading(true);
    setError(null);
    try {
      // Fetch both Odds API matches and tracked matches in parallel
      const [oddsRes, trackedRes] = await Promise.all([
        fetch('/api/tennis/odds-api?action=matches'),
        fetch('/api/tennis/matches?limit=500'),
      ]);

      const oddsJson = await oddsRes.json();
      const trackedJson = await trackedRes.json();

      if (oddsJson.error) {
        setError(oddsJson.error);
      } else {
        setMatches(oddsJson.data || []);
        setTrackedMatches(trackedJson || []);
        setRateLimit(oddsJson.rateLimit);
      }
    } catch (err) {
      setError('Failed to fetch matches');
    } finally {
      setLoading(false);
    }
  }

  async function fetchScores() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tennis/odds-api?action=scores');
      const json = await res.json();

      if (json.error) {
        setError(json.error);
      } else {
        setMatches(json.data || []);
        setRateLimit(json.rateLimit);
      }
    } catch (err) {
      setError('Failed to fetch scores');
    } finally {
      setLoading(false);
    }
  }

  function isMatchTracked(match: OddsApiMatch): boolean {
    // Check by odds API ID
    if (trackedMatches.some((t) => t.oddsApiId === match.id)) {
      return true;
    }

    // Check by player names (fuzzy match)
    const matchPlayers = [match.home_team.toLowerCase(), match.away_team.toLowerCase()];
    return trackedMatches.some((t) => {
      const trackedPlayers = [t.player1.toLowerCase(), t.player2.toLowerCase()];
      const lastNames1 = matchPlayers.map((p) => p.split(' ').pop() || p);
      const lastNames2 = trackedPlayers.map((p) => p.split(' ').pop() || p);
      return (
        lastNames1.some((n) => lastNames2.includes(n)) &&
        lastNames1.filter((n) => lastNames2.includes(n)).length >= 2
      );
    });
  }

  const handleTabClick = (tab: 'sports' | 'matches' | 'scores') => {
    setActiveTab(tab);
    if (tab === 'sports') fetchSports();
    else if (tab === 'matches') fetchMatches();
    else fetchScores();
  };

  // Group matches by sport
  const matchesBySport = matches.reduce((acc, match) => {
    if (!acc[match.sport_key]) {
      acc[match.sport_key] = { title: match.sport_title, matches: [] };
    }
    acc[match.sport_key].matches.push(match);
    return acc;
  }, {} as Record<string, { title: string; matches: OddsApiMatch[] }>);

  return (
    <div className="card">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Odds API Data</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Live data from The Odds API
          </p>
        </div>

        {rateLimit && (
          <div className="text-right">
            <div className="text-xs text-[var(--text-muted)]">API Requests</div>
            <div className="text-sm font-mono">
              <span className="text-[var(--positive)]">{rateLimit.remaining}</span>
              <span className="text-[var(--text-muted)]"> remaining</span>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="p-4 border-b border-[var(--border-color)] flex items-center gap-2">
        {(['sports', 'matches', 'scores'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabClick(tab)}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded transition-colors ${
              activeTab === tab
                ? 'bg-[var(--accent-primary)] text-black font-medium'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {tab === 'sports' ? 'Active Sports' : tab === 'matches' ? 'All Matches' : 'Live Scores'}
          </button>
        ))}

        {loading && (
          <span className="ml-2 text-sm text-[var(--text-muted)]">Loading...</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-[var(--negative)]/10 border-b border-[var(--negative)]/30 text-[var(--negative)] text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {!sports.length && !matches.length && !loading && !error && (
          <div className="text-center py-8 text-[var(--text-muted)]">
            Click a tab above to fetch data from the Odds API
          </div>
        )}

        {/* Sports List */}
        {activeTab === 'sports' && sports.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm text-[var(--text-muted)] mb-4">
              {sports.length} active tennis tournaments
            </div>
            {sports.map((sport) => (
              <div
                key={sport.key}
                className="p-3 bg-[var(--bg-secondary)] rounded flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{sport.title}</div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">{sport.key}</div>
                </div>
                <span className="badge badge-active">Active</span>
              </div>
            ))}
          </div>
        )}

        {/* Matches List */}
        {(activeTab === 'matches' || activeTab === 'scores') && matches.length > 0 && (
          <div className="space-y-6">
            <div className="text-sm text-[var(--text-muted)]">
              {matches.length} matches found
              {trackedMatches.length > 0 && (
                <span>
                  {' '}&bull; {matches.filter(isMatchTracked).length} tracked on Polymarket
                </span>
              )}
            </div>

            {Object.entries(matchesBySport).map(([sportKey, { title, matches: sportMatches }]) => (
              <div key={sportKey}>
                <h3 className="text-sm font-semibold text-[var(--accent-primary)] mb-3">
                  {title}
                  <span className="text-[var(--text-muted)] font-normal ml-2">
                    ({sportMatches.length} matches)
                  </span>
                </h3>

                <div className="space-y-2">
                  {sportMatches
                    .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
                    .map((match) => {
                      const tracked = isMatchTracked(match);
                      return (
                        <div
                          key={match.id}
                          className={`p-3 rounded flex items-center justify-between ${
                            tracked
                              ? 'bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30'
                              : 'bg-[var(--bg-secondary)]'
                          }`}
                        >
                          <div className="flex-1">
                            <div className="font-medium">
                              {match.home_team} vs {match.away_team}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] mt-1">
                              {formatDateTime(match.commence_time)} &bull; {formatTimeUntil(match.commence_time)}
                            </div>

                            {/* Scores */}
                            {match.scores && match.scores.length > 0 && (
                              <div className="mt-2 flex gap-4 text-sm">
                                {match.scores.map((score) => (
                                  <div key={score.name} className="font-mono">
                                    <span className="text-[var(--text-muted)]">{score.name}:</span>{' '}
                                    <span className="text-[var(--positive)]">{score.score}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {match.completed && (
                              <span className="badge badge-sniper">Completed</span>
                            )}
                            {tracked ? (
                              <span className="badge badge-active">Tracked</span>
                            ) : (
                              <span className="badge badge-dormant">Not Tracked</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

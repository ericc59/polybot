'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface SnapshotData {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed?: boolean;
  home_team: string;
  away_team: string;
  scores?: Array<{ name: string; score: string }> | null;
  last_update?: string | null;
}

interface WalkoverEvent {
  id: number;
  matchId: number;
  reason: string;
  confidence: string;
  detectedAt: number;
  notified: number;
  currentApiState: {
    id: string;
    completed?: boolean;
    scores?: Array<{ name: string; score: string }> | null;
    commence_time: string;
    home_team: string;
    away_team: string;
  } | null;
  previousApiState: {
    id: string;
    completed?: boolean;
    scores?: Array<{ name: string; score: string }> | null;
  } | null;
  detectionContext: {
    matchStartTime: number;
    detectionTime: number;
    timeSinceStart: number | null;
    timeUntilStart: number | null;
    additionalNotes?: string;
  } | null;
}

interface MatchData {
  match: {
    id: number;
    oddsApiId: string;
    player1: string;
    player2: string;
    commenceTime: number;
    sportKey: string;
    polymarketConditionId: string | null;
    polymarketSlug: string | null;
    player1TokenId: string | null;
    player2TokenId: string | null;
    status: string;
    walkoverDetectedAt: number | null;
    notes: string | null;
  };
  oddsApiData: {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    completed?: boolean;
    scores?: Array<{ name: string; score: string }> | null;
    _capturedAt?: number;
  } | null;
  snapshotHistory: Array<{
    data: SnapshotData | null;
    capturedAt: number;
  }>;
  orderBook: {
    player1: {
      tokenId: string;
      bestAsk: string | null;
      bestBid: string | null;
      asksUnder49: { shares: number; cost: number };
      asks: Array<{ price: string; size: string }>;
      bids: Array<{ price: string; size: string }>;
    };
    player2: {
      tokenId: string;
      bestAsk: string | null;
      bestBid: string | null;
      asksUnder49: { shares: number; cost: number };
      asks: Array<{ price: string; size: string }>;
      bids: Array<{ price: string; size: string }>;
    };
    totalOpportunity: {
      shares: number;
      cost: number;
      expectedProfit: number;
    };
  } | null;
  walkoverEvents: WalkoverEvent[];
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatTimeUntil(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;

  if (diff < 0) {
    const ago = Math.abs(diff);
    if (ago < 3600) return `Started ${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `Started ${Math.floor(ago / 3600)}h ago`;
    return `Started ${Math.floor(ago / 86400)}d ago`;
  }

  if (diff < 3600) return `Starts in ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `Starts in ${Math.floor(diff / 3600)}h`;
  return `Starts in ${Math.floor(diff / 86400)}d`;
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.id as string;

  const [data, setData] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<{ data: SnapshotData | null; capturedAt: number } | null>(null);

  useEffect(() => {
    async function fetchMatch() {
      try {
        const res = await fetch(`/api/tennis/match/${matchId}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to fetch match');
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch match');
      } finally {
        setLoading(false);
      }
    }

    fetchMatch();
    const interval = setInterval(fetchMatch, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [matchId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6">
        <div className="animate-pulse">
          <div className="h-8 w-64 bg-[var(--bg-tertiary)] rounded mb-4"></div>
          <div className="h-4 w-48 bg-[var(--bg-tertiary)] rounded mb-8"></div>
          <div className="grid grid-cols-2 gap-6">
            <div className="h-64 bg-[var(--bg-tertiary)] rounded"></div>
            <div className="h-64 bg-[var(--bg-tertiary)] rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-6">
        <div className="card p-8 text-center">
          <div className="text-[var(--negative)] mb-4">{error || 'Match not found'}</div>
          <Link href="/tennis/matches" className="text-[var(--accent-primary)] hover:underline">
            Back to matches
          </Link>
        </div>
      </div>
    );
  }

  const { match, oddsApiData, snapshotHistory, orderBook, walkoverEvents } = data;

  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Back link */}
      <Link
        href="/tennis/matches"
        className="text-sm text-[var(--text-muted)] hover:text-[var(--accent-primary)] mb-4 inline-block"
      >
        &larr; Back to matches
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          {match.player1} vs {match.player2}
        </h1>
        <div className="flex items-center gap-4 text-[var(--text-secondary)]">
          <span className="badge badge-sniper">
            {match.sportKey === 'tennis_wta' ? 'WTA' : 'ATP'}
          </span>
          <span>{formatDateTime(match.commenceTime)}</span>
          <span className="text-[var(--accent-primary)]">{formatTimeUntil(match.commenceTime)}</span>
          <span
            className={`badge ${
              match.walkoverDetectedAt
                ? 'badge-active'
                : match.status === 'pending'
                ? 'badge-dormant'
                : 'badge-sniper'
            }`}
          >
            {match.walkoverDetectedAt ? 'WALKOVER' : match.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Odds API Data */}
        <div className="card">
          <div className="p-4 border-b border-[var(--border-color)]">
            <h2 className="text-lg font-semibold">Odds API Data</h2>
            {oddsApiData?._capturedAt && (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Last updated: {formatTimeAgo(oddsApiData._capturedAt)}
              </p>
            )}
          </div>

          <div className="p-4">
            {oddsApiData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase">Tournament</div>
                    <div className="font-medium">{oddsApiData.sport_title}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase">Status</div>
                    <div className={`font-medium ${oddsApiData.completed ? 'text-[var(--positive)]' : ''}`}>
                      {oddsApiData.completed ? 'Completed' : 'Scheduled'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase">Player 1</div>
                    <div className="font-medium">{oddsApiData.home_team}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase">Player 2</div>
                    <div className="font-medium">{oddsApiData.away_team}</div>
                  </div>
                </div>

                {/* Scores */}
                {oddsApiData.scores && oddsApiData.scores.length > 0 && (
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-2">Live Scores</div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3">
                      {oddsApiData.scores.map((score) => (
                        <div key={score.name} className="flex justify-between font-mono">
                          <span>{score.name}</span>
                          <span className="text-[var(--positive)]">{score.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Snapshot History */}
                {snapshotHistory.length > 0 && (
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-2">
                      Snapshot History ({snapshotHistory.length})
                    </div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {snapshotHistory.map((snapshot, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedSnapshot(snapshot)}
                          className="w-full text-xs flex justify-between bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded px-2 py-1.5 transition-colors text-left"
                        >
                          <span className="text-[var(--text-muted)]">
                            {formatTimeAgo(snapshot.capturedAt)}
                          </span>
                          <span>
                            {snapshot.data?.completed
                              ? 'Completed'
                              : snapshot.data?.scores?.length
                              ? 'In Progress'
                              : 'Scheduled'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-[var(--text-muted)] font-mono">
                  ID: {oddsApiData.id}
                </div>
              </div>
            ) : (
              <div className="text-[var(--text-muted)] text-center py-8">
                {match.oddsApiId?.startsWith('pm_')
                  ? 'Not linked to Odds API (Polymarket only)'
                  : 'No Odds API data available'}
              </div>
            )}
          </div>
        </div>

        {/* Order Book / Walkover Opportunity */}
        <div className="card">
          <div className="p-4 border-b border-[var(--border-color)]">
            <h2 className="text-lg font-semibold">Order Book Analysis</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Walkover arbitrage opportunity
            </p>
          </div>

          <div className="p-4">
            {orderBook ? (
              <div className="space-y-4">
                {/* Total Opportunity */}
                <div className="bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30 rounded p-4">
                  <div className="text-xs text-[var(--accent-primary)] uppercase mb-2">
                    Total Opportunity (shares under $0.49)
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-2xl font-bold">
                        {orderBook.totalOpportunity.shares.toLocaleString()}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">shares</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        ${orderBook.totalOpportunity.cost.toFixed(2)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">cost</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-[var(--positive)]">
                        ${orderBook.totalOpportunity.expectedProfit.toFixed(2)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">expected profit</div>
                    </div>
                  </div>
                </div>

                {/* Per-Player Breakdown */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Player 1 */}
                  <div className="bg-[var(--bg-secondary)] rounded p-3">
                    <div className="text-sm font-medium mb-2">{match.player1}</div>
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Best Ask:</span>
                        <span className="font-mono">
                          ${orderBook.player1.bestAsk || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Shares &lt;$0.49:</span>
                        <span className="font-mono">
                          {orderBook.player1.asksUnder49.shares.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Cost:</span>
                        <span className="font-mono">
                          ${orderBook.player1.asksUnder49.cost.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Player 2 */}
                  <div className="bg-[var(--bg-secondary)] rounded p-3">
                    <div className="text-sm font-medium mb-2">{match.player2}</div>
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Best Ask:</span>
                        <span className="font-mono">
                          ${orderBook.player2.bestAsk || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Shares &lt;$0.49:</span>
                        <span className="font-mono">
                          {orderBook.player2.asksUnder49.shares.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Cost:</span>
                        <span className="font-mono">
                          ${orderBook.player2.asksUnder49.cost.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ROI */}
                {orderBook.totalOpportunity.cost > 0 && (
                  <div className="text-center">
                    <span className="text-[var(--text-muted)]">Expected ROI: </span>
                    <span className="text-[var(--positive)] font-bold">
                      {((orderBook.totalOpportunity.expectedProfit / orderBook.totalOpportunity.cost) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[var(--text-muted)] text-center py-8">
                No Polymarket market linked
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Walkover Detection History */}
      {walkoverEvents && walkoverEvents.length > 0 && (
        <div className="mt-6 card">
          <div className="p-4 border-b border-[var(--border-color)]">
            <h2 className="text-lg font-semibold text-[var(--positive)]">
              Walkover Detection Events ({walkoverEvents.length})
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Historical record of when and why walkover was detected
            </p>
          </div>

          <div className="p-4 space-y-4">
            {walkoverEvents.map((event) => (
              <div
                key={event.id}
                className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-color)]"
              >
                {/* Event Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`badge ${
                        event.confidence === 'high' ? 'badge-active' : 'badge-sniper'
                      }`}
                    >
                      {event.confidence.toUpperCase()} confidence
                    </span>
                    <span className="badge badge-dormant">{event.reason}</span>
                  </div>
                  <span className="text-sm text-[var(--text-muted)]">
                    {formatTimeAgo(event.detectedAt)}
                  </span>
                </div>

                {/* Detection Context */}
                {event.detectionContext && (
                  <div className="mb-3 text-sm">
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Detection Context</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[var(--text-muted)]">Detected at: </span>
                        <span className="font-mono">
                          {formatDateTime(event.detectionContext.detectionTime)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Match start: </span>
                        <span className="font-mono">
                          {formatDateTime(event.detectionContext.matchStartTime)}
                        </span>
                      </div>
                      {event.detectionContext.timeSinceStart !== null && (
                        <div>
                          <span className="text-[var(--text-muted)]">Time since start: </span>
                          <span className="font-mono">
                            {Math.floor(event.detectionContext.timeSinceStart / 60)}m
                          </span>
                        </div>
                      )}
                      {event.detectionContext.timeUntilStart !== null && (
                        <div>
                          <span className="text-[var(--text-muted)]">Time until start: </span>
                          <span className="font-mono">
                            {Math.floor(event.detectionContext.timeUntilStart / 60)}m
                          </span>
                        </div>
                      )}
                    </div>
                    {event.detectionContext.additionalNotes && (
                      <div className="mt-2 text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded p-2 font-mono">
                        {event.detectionContext.additionalNotes}
                      </div>
                    )}
                  </div>
                )}

                {/* Current API State */}
                {event.currentApiState && (
                  <div className="mb-3">
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">
                      Current API State (at detection)
                    </div>
                    <div className="bg-[var(--bg-tertiary)] rounded p-2 text-xs font-mono">
                      <div>completed: {String(event.currentApiState.completed)}</div>
                      <div>
                        scores: {event.currentApiState.scores
                          ? JSON.stringify(event.currentApiState.scores)
                          : 'null'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Previous API State */}
                {event.previousApiState && (
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">
                      Previous API State (before detection)
                    </div>
                    <div className="bg-[var(--bg-tertiary)] rounded p-2 text-xs font-mono">
                      <div>completed: {String(event.previousApiState.completed)}</div>
                      <div>
                        scores: {event.previousApiState.scores
                          ? JSON.stringify(event.previousApiState.scores)
                          : 'null'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Show reason explanation */}
                <div className="mt-3 text-xs text-[var(--text-secondary)] italic">
                  {event.reason === 'completed_no_scores' && (
                    'Match was marked as completed in the API but had no scores - indicates walkover.'
                  )}
                  {event.reason === 'disappeared_before_start' && (
                    'Match disappeared from the API before its scheduled start time - possible walkover.'
                  )}
                  {event.reason === 'manual' && (
                    'Walkover was manually triggered by operator.'
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Polymarket Links */}
      {match.polymarketSlug && (
        <div className="mt-6 card p-4">
          <h3 className="text-sm font-semibold mb-3">Polymarket Links</h3>
          <div className="flex gap-4 text-sm">
            <a
              href={`https://polymarket.com/event/${match.polymarketSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-primary)] hover:underline"
            >
              View on Polymarket &rarr;
            </a>
            {match.notes && (
              <span className="text-[var(--text-muted)]">{match.notes}</span>
            )}
          </div>
        </div>
      )}

      {/* Snapshot Detail Modal */}
      {selectedSnapshot && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedSnapshot(null)}
        >
          <div
            className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
              <h3 className="font-semibold">Snapshot Details</h3>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Timestamp */}
              <div>
                <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Captured At</div>
                <div className="font-mono text-sm">
                  {new Date(selectedSnapshot.capturedAt * 1000).toISOString()}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {formatTimeAgo(selectedSnapshot.capturedAt)} ({formatDateTime(selectedSnapshot.capturedAt)})
                </div>
              </div>

              {selectedSnapshot.data ? (
                <>
                  {/* Match Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Home Team</div>
                      <div className="font-medium">{selectedSnapshot.data.home_team}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Away Team</div>
                      <div className="font-medium">{selectedSnapshot.data.away_team}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Tournament</div>
                      <div>{selectedSnapshot.data.sport_title || selectedSnapshot.data.sport_key}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Status</div>
                      <div className={selectedSnapshot.data.completed ? 'text-[var(--positive)]' : ''}>
                        {selectedSnapshot.data.completed ? 'Completed' : selectedSnapshot.data.scores?.length ? 'In Progress' : 'Scheduled'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Commence Time</div>
                    <div className="font-mono text-sm">{selectedSnapshot.data.commence_time}</div>
                  </div>

                  {/* Scores */}
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Scores</div>
                    {selectedSnapshot.data.scores && selectedSnapshot.data.scores.length > 0 ? (
                      <div className="bg-[var(--bg-secondary)] rounded p-2 space-y-1">
                        {selectedSnapshot.data.scores.map((score, idx) => (
                          <div key={idx} className="flex justify-between font-mono text-sm">
                            <span>{score.name}</span>
                            <span className="text-[var(--positive)]">{score.score}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[var(--text-muted)]">null</div>
                    )}
                  </div>

                  {/* Last Update */}
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Last Update</div>
                    <div className="font-mono text-sm">{selectedSnapshot.data.last_update || 'null'}</div>
                  </div>

                  {/* Raw JSON */}
                  <div>
                    <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Raw JSON</div>
                    <pre className="bg-[var(--bg-secondary)] rounded p-2 text-xs font-mono overflow-x-auto">
                      {JSON.stringify(selectedSnapshot.data, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="text-[var(--text-muted)] text-center py-4">
                  No data available for this snapshot
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

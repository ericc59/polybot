'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Outcome {
  name: string;
  polymarketPrice: number;
  sharpProb: number;
  edge: number;
  isValueBet: boolean;
  bookData?: Array<{
    key: string;
    odds: number;
    fairProb: number;
  }>;
}

interface OddsBreakdown {
  outcomes: Outcome[];
  totalPolymarket: number;
  totalSharp: number;
  polymarketVig: number;
  bookCount: number;
  updatedAt?: number;
}

interface BetReport {
  id: string;
  timestamp: number;
  timestampISO: string;
  match: {
    homeTeam: string;
    awayTeam: string;
    sport: string;
  };
  bet: {
    outcome: string;
    shares: number;
    cost: number;
    pricePerShare: number;
  };
  polymarket: {
    bettingSide: { outcome: string; price: number };
    otherSide: { outcome: string; price: number } | null;
  };
  sharpConsensus: {
    bettingSide: {
      outcome: string;
      fairProb: number;
      bookCount: number;
      books?: Array<{ key: string; odds: number; fairProb: number }>;
    };
    otherSide?: {
      outcome: string;
      fairProb: number;
      books?: Array<{ key: string; odds: number; fairProb: number }>;
    };
  };
  edge: {
    bettingSide: { outcome: string; edge: number; edgePct: string };
    otherSide?: { outcome: string; edge: number; edgePct: string };
    minRequiredPct: string;
  };
  expectedValue: { total: number };
  payout: { ifWin: number; profit: number };
}

interface DbBet {
  id: number;
  outcome: string;
  shares: number;
  buyPrice: number;
  size: number;
  edge: number;
  status: string;
  pnl: number | null;
  createdAt: number;
}

interface BookDataItem {
  key: string;
  odds: number;
  fairProb: number;
  rawProb?: number;
  vig?: number;
}

interface ExcludedBook {
  key: string;
  reason: 'missing' | 'stale' | 'skip' | 'outlier';
  odds?: number;
  fairProb?: number;
  details?: string;
}

interface RawOdds {
  homeTeam: string;
  awayTeam: string;
  polyHomePrice: number | null;
  polyAwayPrice: number | null;
  sharpHomeProb: number | null;
  sharpAwayProb: number | null;
  homeEdge: number | null;
  awayEdge: number | null;
  bookCount: number;
  updatedAt: number;
  minEdge: number | null;
  homeBookData: BookDataItem[];
  awayBookData: BookDataItem[];
  homeExcludedBooks: ExcludedBook[];
  awayExcludedBooks: ExcludedBook[];
}

interface EventDetails {
  event: {
    id: string;
    slug: string;
    sport: string;
    league: string;
    icon: string;
    title: string;
    homeTeam: string;
    awayTeam: string;
    commenceTime: string;
    outcomes: Array<{ name: string; price: number; tokenId: string }>;
    hasValueBet: boolean;
    valueBetEdge?: number;
  };
  oddsBreakdown: OddsBreakdown | null;
  rawOdds: RawOdds | null;
  valueBets: any[];
  betReports: BetReport[];
  dbBets: DbBet[];
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCents(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'LIVE';
  if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `in ${hours}h ${mins}m`;
  }
  return date.toLocaleDateString();
}

function formatLastUpdated(timestamp: number | undefined): string {
  if (!timestamp) return 'Unknown';
  const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp * 1000).toLocaleString();
}

export default function EventDetailPage() {
  const params = useParams();
  const eventId = params.id as string;

  const [data, setData] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<BetReport | null>(null);

  async function fetchEventDetails() {
    try {
      const res = await fetch(`/api/sports/events/${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error('Event not found');
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEventDetails();
    const interval = setInterval(fetchEventDetails, 15000);
    return () => clearInterval(interval);
  }, [eventId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="card p-8 text-center">
          <div className="text-[var(--text-muted)]">Loading event details...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">404</div>
          <div className="text-[var(--text-muted)]">{error || 'Event not found'}</div>
          <Link href="/sports/events" className="text-[var(--accent-primary)] hover:underline mt-4 block">
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const { event, oddsBreakdown, rawOdds, betReports, dbBets } = data;

  return (
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/sports/events" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          ← Back
        </Link>
      </div>

      {/* Event Header Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{event.icon}</span>
            <div>
              <span className="text-sm text-[var(--text-muted)]">{event.league}</span>
              <div className="text-sm text-[var(--text-muted)]">{formatRelativeTime(event.commenceTime)}</div>
            </div>
          </div>
          {event.hasValueBet && (
            <div className="px-3 py-1 bg-[var(--positive)]/20 text-[var(--positive)] rounded-full text-sm font-medium">
              +{((event.valueBetEdge || 0) * 100).toFixed(1)}% Edge
            </div>
          )}
        </div>

        <div className="text-center py-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{event.awayTeam}</div>
          <div className="text-[var(--text-muted)] my-2">@</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">{event.homeTeam}</div>
        </div>

        <div className="text-center text-sm text-[var(--text-muted)]">
          {formatTime(event.commenceTime)}
        </div>

        <div className="mt-4 text-center">
          <a
            href={`https://polymarket.com/event/${event.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-primary)] hover:underline text-sm"
          >
            View on Polymarket →
          </a>
        </div>
      </div>

      {/* Odds Breakdown */}
      {oddsBreakdown && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Odds Breakdown</h2>
            <div className="text-xs text-[var(--text-muted)]">
              Updated {formatLastUpdated(oddsBreakdown.updatedAt || rawOdds?.updatedAt)}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left py-2 text-[var(--text-muted)]">Outcome</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Polymarket</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Sharp Fair</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Edge</th>
                  <th className="text-center py-2 text-[var(--text-muted)]">Value?</th>
                </tr>
              </thead>
              <tbody>
                {oddsBreakdown.outcomes.map((outcome, i) => (
                  <tr key={i} className="border-b border-[var(--border-color)]/50">
                    <td className="py-3 font-medium text-[var(--text-primary)]">{outcome.name}</td>
                    <td className="py-3 text-right font-mono">{formatCents(outcome.polymarketPrice)}</td>
                    <td className="py-3 text-right font-mono">{formatPercent(outcome.sharpProb)}</td>
                    <td className={`py-3 text-right font-mono font-semibold ${outcome.edge > 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
                      {outcome.edge > 0 ? '+' : ''}{formatPercent(outcome.edge)}
                    </td>
                    <td className="py-3 text-center">
                      {outcome.isValueBet ? '✅' : '❌'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[var(--bg-tertiary)]">
                  <td className="py-3 font-medium text-[var(--text-muted)]">Total</td>
                  <td className="py-3 text-right font-mono text-[var(--text-muted)]">
                    {formatCents(oddsBreakdown.totalPolymarket)}
                    <span className="text-xs ml-1">({formatPercent(oddsBreakdown.polymarketVig)} vig)</span>
                  </td>
                  <td className="py-3 text-right font-mono text-[var(--text-muted)]">{formatPercent(oddsBreakdown.totalSharp)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Book-by-Book Breakdown */}
          {oddsBreakdown.outcomes.some((o) => o.bookData && o.bookData.length > 0) && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
                Sharp Book Odds ({oddsBreakdown.bookCount} books)
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                {oddsBreakdown.outcomes.map((outcome, i) => (
                  <div key={i} className="bg-[var(--bg-tertiary)] rounded-lg p-4">
                    <div className="font-medium text-[var(--text-primary)] mb-2">{outcome.name}</div>
                    {outcome.bookData && outcome.bookData.length > 0 ? (
                      <div className="space-y-1">
                        {outcome.bookData.map((book, j) => (
                          <div key={j} className="flex justify-between text-sm">
                            <span className="text-[var(--text-muted)]">{book.key}</span>
                            <span className="font-mono">
                              <span className="text-[var(--text-secondary)]">{formatOdds(book.odds)}</span>
                              <span className="text-[var(--text-muted)] mx-2">→</span>
                              <span className="text-[var(--text-primary)]">{formatPercent(book.fairProb)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-[var(--text-muted)]">No book data</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edge Thresholds by Price Range */}
          <div className="mt-6 bg-[var(--bg-tertiary)] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Min Edge by Price Range</h3>
            <div className="grid grid-cols-4 gap-2 text-xs text-center">
              <div className="bg-[var(--bg-secondary)] rounded p-2">
                <div className="text-[var(--text-muted)]">15-25¢</div>
                <div className="font-mono font-semibold text-[var(--text-primary)]">12%</div>
              </div>
              <div className="bg-[var(--bg-secondary)] rounded p-2">
                <div className="text-[var(--text-muted)]">25-35¢</div>
                <div className="font-mono font-semibold text-[var(--text-primary)]">8%</div>
              </div>
              <div className="bg-[var(--bg-secondary)] rounded p-2">
                <div className="text-[var(--text-muted)]">35-65¢</div>
                <div className="font-mono font-semibold text-[var(--accent-primary)]">6%</div>
              </div>
              <div className="bg-[var(--bg-secondary)] rounded p-2">
                <div className="text-[var(--text-muted)]">65-85¢</div>
                <div className="font-mono font-semibold text-[var(--text-primary)]">8%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Current Prices with Odds API comparison */}
      {!oddsBreakdown && event.outcomes.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Current Prices</h2>
            {rawOdds && (
              <div className="text-xs text-[var(--text-muted)]">
                Updated {formatLastUpdated(rawOdds.updatedAt)}
              </div>
            )}
          </div>

          {/* Side by side comparison */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left py-2 text-[var(--text-muted)]">Outcome</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Polymarket</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Sharp Fair</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Edge</th>
                  <th className="text-center py-2 text-[var(--text-muted)]">Value?</th>
                </tr>
              </thead>
              <tbody>
                {event.outcomes.map((outcome, i) => {
                  // Try to match with rawOdds data
                  const isHome = outcome.name.toLowerCase().includes(event.homeTeam.toLowerCase().split(' ')[0] || '') ||
                                 event.homeTeam.toLowerCase().includes(outcome.name.toLowerCase().split(' ')[0] || '');
                  const sharpProb = rawOdds ? (isHome ? rawOdds.sharpHomeProb : rawOdds.sharpAwayProb) : null;
                  const edge = rawOdds ? (isHome ? rawOdds.homeEdge : rawOdds.awayEdge) : null;
                  const minEdge = rawOdds?.minEdge || 0.06;
                  const isValueBet = edge !== null && edge >= minEdge;

                  return (
                    <tr key={i} className="border-b border-[var(--border-color)]/50">
                      <td className="py-3 font-medium text-[var(--text-primary)]">{outcome.name}</td>
                      <td className="py-3 text-right font-mono text-lg">{formatCents(outcome.price)}</td>
                      <td className="py-3 text-right font-mono text-lg">
                        {sharpProb !== null ? formatPercent(sharpProb) : <span className="text-[var(--text-muted)]">-</span>}
                      </td>
                      <td className={`py-3 text-right font-mono font-semibold ${
                        edge !== null && edge > 0 ? 'text-[var(--positive)]' :
                        edge !== null && edge < 0 ? 'text-[var(--negative)]' : ''
                      }`}>
                        {edge !== null ? `${edge > 0 ? '+' : ''}${formatPercent(edge)}` : <span className="text-[var(--text-muted)]">-</span>}
                      </td>
                      <td className="py-3 text-center">
                        {edge !== null ? (isValueBet ? '✅' : '❌') : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rawOdds && (
            <>
              <div className="mt-4 text-xs text-[var(--text-muted)] text-center">
                Sharp consensus from {rawOdds.bookCount} books • Min edge: {formatPercent(rawOdds.minEdge || 0.06)} • Updated {new Date(rawOdds.updatedAt * 1000).toLocaleTimeString()}
              </div>

              {/* EV Calculation Breakdown */}
              <div className="mt-6 bg-[var(--bg-tertiary)] rounded-lg p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">EV Calculation</h3>
                <div className="text-xs font-mono text-[var(--text-muted)] space-y-1">
                  <div className="flex justify-between">
                    <span>Edge Formula:</span>
                    <span className="text-[var(--text-secondary)]">(SharpProb - PolyPrice) / PolyPrice</span>
                  </div>
                  {rawOdds.sharpHomeProb !== null && rawOdds.polyHomePrice !== null && (
                    <div className="flex justify-between">
                      <span>{rawOdds.homeTeam}:</span>
                      <span className="text-[var(--text-secondary)]">
                        ({formatPercent(rawOdds.sharpHomeProb)} - {formatCents(rawOdds.polyHomePrice)}) / {formatCents(rawOdds.polyHomePrice)} = {rawOdds.homeEdge !== null ? (rawOdds.homeEdge > 0 ? '+' : '') + formatPercent(rawOdds.homeEdge) : '-'}
                      </span>
                    </div>
                  )}
                  {rawOdds.sharpAwayProb !== null && rawOdds.polyAwayPrice !== null && (
                    <div className="flex justify-between">
                      <span>{rawOdds.awayTeam}:</span>
                      <span className="text-[var(--text-secondary)]">
                        ({formatPercent(rawOdds.sharpAwayProb)} - {formatCents(rawOdds.polyAwayPrice)}) / {formatCents(rawOdds.polyAwayPrice)} = {rawOdds.awayEdge !== null ? (rawOdds.awayEdge > 0 ? '+' : '') + formatPercent(rawOdds.awayEdge) : '-'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Edge Thresholds by Price Range */}
              <div className="mt-4 bg-[var(--bg-tertiary)] rounded-lg p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Min Edge by Price Range</h3>
                <div className="grid grid-cols-4 gap-2 text-xs text-center">
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <div className="text-[var(--text-muted)]">15-25¢</div>
                    <div className="font-mono font-semibold text-[var(--text-primary)]">12%</div>
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <div className="text-[var(--text-muted)]">25-35¢</div>
                    <div className="font-mono font-semibold text-[var(--text-primary)]">8%</div>
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <div className="text-[var(--text-muted)]">35-65¢</div>
                    <div className="font-mono font-semibold text-[var(--accent-primary)]">6%</div>
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded p-2">
                    <div className="text-[var(--text-muted)]">65-85¢</div>
                    <div className="font-mono font-semibold text-[var(--text-primary)]">8%</div>
                  </div>
                </div>
              </div>

              {/* Book-by-Book Breakdown */}
              {(rawOdds.homeBookData.length > 0 || rawOdds.awayBookData.length > 0 || rawOdds.homeExcludedBooks?.length > 0 || rawOdds.awayExcludedBooks?.length > 0) && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
                    Sharp Book Odds ({rawOdds.bookCount} books)
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Home Team Books */}
                    <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
                      <div className="font-medium text-[var(--text-primary)] mb-2">{rawOdds.homeTeam}</div>
                      {rawOdds.homeBookData.length > 0 || rawOdds.homeExcludedBooks?.length > 0 ? (
                        <div className="space-y-1">
                          {/* Included books */}
                          {rawOdds.homeBookData.map((book, j) => (
                            <div key={j} className="flex justify-between text-sm">
                              <span className="text-[var(--text-muted)]">{book.key}</span>
                              <span className="font-mono">
                                <span className="text-[var(--text-secondary)]">{formatOdds(book.odds)}</span>
                                <span className="text-[var(--text-muted)] mx-2">→</span>
                                <span className="text-[var(--text-primary)]">{formatPercent(book.fairProb)}</span>
                              </span>
                            </div>
                          ))}
                          {/* Excluded books with strikethrough */}
                          {rawOdds.homeExcludedBooks?.map((book, j) => (
                            <div key={`ex-${j}`} className="flex justify-between text-sm opacity-50">
                              <span className="line-through text-[var(--text-muted)]">{book.key}</span>
                              <span className="font-mono text-xs">
                                {book.reason === 'missing' && <span className="text-yellow-500">no odds</span>}
                                {book.reason === 'stale' && <span className="text-orange-500">{book.details || 'stale'}</span>}
                                {book.reason === 'outlier' && (
                                  <span className="text-red-500">
                                    outlier {book.fairProb !== undefined ? formatPercent(book.fairProb) : ''}
                                  </span>
                                )}
                                {book.reason === 'skip' && <span className="text-gray-500">skipped</span>}
                              </span>
                            </div>
                          ))}
                          <div className="pt-2 mt-2 border-t border-[var(--border-color)] flex justify-between text-sm font-semibold">
                            <span className="text-[var(--text-muted)]">Avg (Sharp)</span>
                            <span className="text-[var(--accent-primary)]">{rawOdds.sharpHomeProb !== null ? formatPercent(rawOdds.sharpHomeProb) : '-'}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--text-muted)]">No book data</div>
                      )}
                    </div>

                    {/* Away Team Books */}
                    <div className="bg-[var(--bg-tertiary)] rounded-lg p-4">
                      <div className="font-medium text-[var(--text-primary)] mb-2">{rawOdds.awayTeam}</div>
                      {rawOdds.awayBookData.length > 0 || rawOdds.awayExcludedBooks?.length > 0 ? (
                        <div className="space-y-1">
                          {/* Included books */}
                          {rawOdds.awayBookData.map((book, j) => (
                            <div key={j} className="flex justify-between text-sm">
                              <span className="text-[var(--text-muted)]">{book.key}</span>
                              <span className="font-mono">
                                <span className="text-[var(--text-secondary)]">{formatOdds(book.odds)}</span>
                                <span className="text-[var(--text-muted)] mx-2">→</span>
                                <span className="text-[var(--text-primary)]">{formatPercent(book.fairProb)}</span>
                              </span>
                            </div>
                          ))}
                          {/* Excluded books with strikethrough */}
                          {rawOdds.awayExcludedBooks?.map((book, j) => (
                            <div key={`ex-${j}`} className="flex justify-between text-sm opacity-50">
                              <span className="line-through text-[var(--text-muted)]">{book.key}</span>
                              <span className="font-mono text-xs">
                                {book.reason === 'missing' && <span className="text-yellow-500">no odds</span>}
                                {book.reason === 'stale' && <span className="text-orange-500">{book.details || 'stale'}</span>}
                                {book.reason === 'outlier' && (
                                  <span className="text-red-500">
                                    outlier {book.fairProb !== undefined ? formatPercent(book.fairProb) : ''}
                                  </span>
                                )}
                                {book.reason === 'skip' && <span className="text-gray-500">skipped</span>}
                              </span>
                            </div>
                          ))}
                          <div className="pt-2 mt-2 border-t border-[var(--border-color)] flex justify-between text-sm font-semibold">
                            <span className="text-[var(--text-muted)]">Avg (Sharp)</span>
                            <span className="text-[var(--accent-primary)]">{rawOdds.sharpAwayProb !== null ? formatPercent(rawOdds.sharpAwayProb) : '-'}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--text-muted)]">No book data</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!rawOdds && (
            <div className="mt-4 text-center text-sm text-[var(--text-muted)]">
              Sharp book odds will appear after the bot scans this game
            </div>
          )}
        </div>
      )}

      {/* Bets Placed */}
      {dbBets.length > 0 && (
        <div className="card p-6">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Bets Placed</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className="text-left py-2 text-[var(--text-muted)]">Outcome</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Shares</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Price</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Cost</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Edge</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">Status</th>
                  <th className="text-right py-2 text-[var(--text-muted)]">P&L</th>
                </tr>
              </thead>
              <tbody>
                {dbBets.map((bet) => (
                  <tr key={bet.id} className="border-b border-[var(--border-color)]/50">
                    <td className="py-3 font-medium text-[var(--text-primary)]">{bet.outcome}</td>
                    <td className="py-3 text-right font-mono">{bet.shares.toFixed(1)}</td>
                    <td className="py-3 text-right font-mono">{typeof bet.buyPrice === 'number' ? formatCents(bet.buyPrice) : '-'}</td>
                    <td className="py-3 text-right font-mono">${bet.size.toFixed(2)}</td>
                    <td className="py-3 text-right font-mono text-[var(--positive)]">+{formatPercent(bet.edge)}</td>
                    <td className="py-3 text-right">
                      <span className={`px-2 py-1 rounded text-xs ${
                        bet.status === 'open' ? 'bg-blue-500/20 text-blue-400' :
                        bet.status === 'won' ? 'bg-green-500/20 text-green-400' :
                        bet.status === 'lost' ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {bet.status}
                      </span>
                    </td>
                    <td className={`py-3 text-right font-mono ${
                      typeof bet.pnl === 'number' && bet.pnl > 0 ? 'text-[var(--positive)]' :
                      typeof bet.pnl === 'number' && bet.pnl < 0 ? 'text-[var(--negative)]' : ''
                    }`}>
                      {typeof bet.pnl === 'number' ? `$${bet.pnl.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bet Reports */}
      {betReports.length > 0 && (
        <div className="card p-6">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Bet Reports</h2>
          <div className="space-y-3">
            {betReports.map((report) => (
              <div
                key={report.id}
                onClick={() => setSelectedReport(selectedReport?.id === report.id ? null : report)}
                className="bg-[var(--bg-tertiary)] rounded-lg p-4 cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-[var(--text-primary)]">{report.bet.outcome}</span>
                    <span className="text-[var(--text-muted)] ml-2">
                      {report.bet.shares.toFixed(1)} shares @ {formatCents(report.bet.pricePerShare)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[var(--positive)] font-mono">
                      +{report.edge.bettingSide.edgePct}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {new Date(report.timestamp).toLocaleString()}
                    </span>
                    <span className="text-[var(--text-muted)]">{selectedReport?.id === report.id ? '▼' : '▶'}</span>
                  </div>
                </div>

                {/* Expanded Report */}
                {selectedReport?.id === report.id && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-color)] space-y-4">
                    {/* Polymarket Prices */}
                    <div>
                      <div className="text-sm font-medium text-[var(--text-muted)] mb-2">POLYMARKET</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--positive)]">→ {report.polymarket.bettingSide.outcome}</span>
                          <span className="font-mono">{formatCents(report.polymarket.bettingSide.price)}</span>
                        </div>
                        {report.polymarket.otherSide && (
                          <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">{report.polymarket.otherSide.outcome}</span>
                            <span className="font-mono">{formatCents(report.polymarket.otherSide.price)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sharp Consensus */}
                    <div>
                      <div className="text-sm font-medium text-[var(--text-muted)] mb-2">
                        SHARP CONSENSUS ({report.sharpConsensus.bettingSide.bookCount} books)
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--positive)]">→ {report.sharpConsensus.bettingSide.outcome}</span>
                          <span className="font-mono">{formatPercent(report.sharpConsensus.bettingSide.fairProb)}</span>
                        </div>
                        {report.sharpConsensus.otherSide && (
                          <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">{report.sharpConsensus.otherSide.outcome}</span>
                            <span className="font-mono">{formatPercent(report.sharpConsensus.otherSide.fairProb)}</span>
                          </div>
                        )}
                      </div>

                      {/* Book breakdown */}
                      {report.sharpConsensus.bettingSide.books && (
                        <div className="mt-2 pl-4 text-xs space-y-1">
                          {report.sharpConsensus.bettingSide.books.map((book, i) => (
                            <div key={i} className="flex justify-between text-[var(--text-muted)]">
                              <span>{book.key}</span>
                              <span className="font-mono">{formatOdds(book.odds)} → {formatPercent(book.fairProb)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Edge */}
                    <div>
                      <div className="text-sm font-medium text-[var(--text-muted)] mb-2">EDGE</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--positive)]">→ {report.edge.bettingSide.outcome}</span>
                          <span className="font-mono text-[var(--positive)]">+{report.edge.bettingSide.edgePct}</span>
                        </div>
                        {report.edge.otherSide && (
                          <div className="flex justify-between">
                            <span className="text-[var(--text-muted)]">{report.edge.otherSide.outcome}</span>
                            <span className={`font-mono ${report.edge.otherSide.edge > 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
                              {report.edge.otherSide.edge > 0 ? '+' : ''}{report.edge.otherSide.edgePct}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1">
                        Min required: {report.edge.minRequiredPct}
                      </div>
                    </div>

                    {/* Order Details */}
                    <div className="bg-[var(--bg-secondary)] rounded p-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Cost</span>
                          <span className="font-mono font-semibold">${report.bet.cost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Payout if win</span>
                          <span className="font-mono">${report.payout.ifWin.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Profit if win</span>
                          <span className="font-mono text-[var(--positive)]">+${report.payout.profit.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">Expected Value</span>
                          <span className="font-mono text-[var(--positive)]">+${report.expectedValue.total.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Data State */}
      {!oddsBreakdown && dbBets.length === 0 && betReports.length === 0 && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">📊</div>
          <div className="text-[var(--text-muted)]">No odds data or bets for this event yet</div>
          <div className="text-sm text-[var(--text-muted)] mt-2">
            Data will appear when the bot scans this game
          </div>
        </div>
      )}
    </div>
  );
}

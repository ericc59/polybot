'use client';

import { useState } from 'react';
import Link from 'next/link';

interface SportConfig {
  key: string;
  name: string;
  icon: string;
  enabled: boolean;
}

const defaultSports: SportConfig[] = [
  { key: 'NBA', name: 'NBA Basketball', icon: '🏀', enabled: true },
  { key: 'NCAAB', name: 'College Basketball', icon: '🏀', enabled: true },
  { key: 'NFL', name: 'NFL Football', icon: '🏈', enabled: false },
  { key: 'NCAAF', name: 'College Football', icon: '🏈', enabled: false },
  { key: 'MLB', name: 'MLB Baseball', icon: '⚾', enabled: false },
  { key: 'NHL', name: 'NHL Hockey', icon: '🏒', enabled: false },
  { key: 'Soccer', name: 'Soccer', icon: '⚽', enabled: false },
  { key: 'Tennis', name: 'Tennis', icon: '🎾', enabled: false },
  { key: 'Combat', name: 'UFC/Boxing', icon: '🥊', enabled: false },
  { key: 'Golf', name: 'Golf', icon: '⛳', enabled: false },
];

const bettingConfig = {
  minEdge: 5,
  kellyFraction: 25,
  maxBetPct: 3,
  maxDailyPct: 15,
  minBetUsd: 25,
  maxBetUsd: 500,
  maxBetsPerEvent: 5,
  booksRequired: 3,
  autoTrade: false,
};

export default function SportsSettingsPage() {
  const [sports, setSports] = useState<SportConfig[]>(defaultSports);
  const [config, setConfig] = useState(bettingConfig);
  const [saving, setSaving] = useState(false);

  const toggleSport = (key: string) => {
    setSports((prev) =>
      prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const enabledSports = sports.filter((s) => s.enabled);

  const handleSave = async () => {
    setSaving(true);
    // TODO: Save to API
    await new Promise(resolve => setTimeout(resolve, 500));
    setSaving(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-2">
            <Link href="/sports" className="hover:text-[var(--text-primary)]">Sports</Link>
            <span>/</span>
            <span>Settings</span>
          </div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Settings</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Configure sports betting parameters
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Enabled Sports</div>
          <div className="font-semibold mt-1">{enabledSports.length} / {sports.length}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {enabledSports.map((s) => s.icon).join(' ') || 'None'}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Min Edge</div>
          <div className="font-semibold mt-1">{config.minEdge}%</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Required for bet</div>
        </div>

        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Max Bet</div>
          <div className="font-semibold mt-1">${config.maxBetUsd}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Per position</div>
        </div>

        <div className="card p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase">Max Per Event</div>
          <div className="font-semibold mt-1">{config.maxBetsPerEvent}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Bets per event</div>
        </div>
      </div>

      {/* Sport Selection */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold">Enabled Sports</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Select which sports markets to monitor for value bets
          </p>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {sports.map((sport) => (
            <button
              key={sport.key}
              onClick={() => toggleSport(sport.key)}
              className={`p-3 rounded-lg border transition-all ${
                sport.enabled
                  ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)] text-[var(--text-primary)]'
                  : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
              }`}
            >
              <div className="text-2xl mb-1">{sport.icon}</div>
              <div className="text-sm font-medium">{sport.name}</div>
              <div className="text-xs mt-1">
                {sport.enabled ? (
                  <span className="text-[var(--positive)]">Enabled</span>
                ) : (
                  <span>Disabled</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Betting Configuration */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold">Betting Configuration</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Set your risk parameters and betting limits
          </p>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Min Edge %</label>
            <input
              type="number"
              value={config.minEdge}
              onChange={(e) => setConfig({ ...config, minEdge: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Kelly Fraction %</label>
            <input
              type="number"
              value={config.kellyFraction}
              onChange={(e) => setConfig({ ...config, kellyFraction: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Min Bet $</label>
            <input
              type="number"
              value={config.minBetUsd}
              onChange={(e) => setConfig({ ...config, minBetUsd: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Max Bet $</label>
            <input
              type="number"
              value={config.maxBetUsd}
              onChange={(e) => setConfig({ ...config, maxBetUsd: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Max Bets Per Event</label>
            <input
              type="number"
              value={config.maxBetsPerEvent}
              onChange={(e) => setConfig({ ...config, maxBetsPerEvent: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Max Daily %</label>
            <input
              type="number"
              value={config.maxDailyPct}
              onChange={(e) => setConfig({ ...config, maxDailyPct: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Books Required</label>
            <input
              type="number"
              value={config.booksRequired}
              onChange={(e) => setConfig({ ...config, booksRequired: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] uppercase">Max Bet % of Bankroll</label>
            <input
              type="number"
              value={config.maxBetPct}
              onChange={(e) => setConfig({ ...config, maxBetPct: Number(e.target.value) })}
              className="w-full mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="p-4 border-t border-[var(--border-color)] flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoTrade}
              onChange={(e) => setConfig({ ...config, autoTrade: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Auto-trade (place bets automatically when value is found)</span>
          </label>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[var(--accent-primary)] text-black rounded font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Excluded Books */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold">Excluded Bookmakers</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            These bookmakers will not be used in odds consensus calculation
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 bg-[var(--negative)]/10 text-[var(--negative)] rounded text-sm">
              Bovada (excluded)
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3">
            Configure excluded books via Telegram: /sports exclude &lt;book&gt;
          </p>
        </div>
      </div>
    </div>
  );
}

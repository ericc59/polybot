'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Wallet {
  address: string;
  total_pnl: number;
  win_rate: number;
  total_trades: number;
  avg_trade_size: number;
  whale_type: string;
  last_trade_at: number;
  subscriber_count: number;
}

function formatPnL(pnl: number): string {
  if (pnl >= 1000000) return `$${(pnl / 1000000).toFixed(2)}M`;
  if (pnl >= 1000) return `$${(pnl / 1000).toFixed(1)}K`;
  return `$${pnl.toFixed(0)}`;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return 'Just now';
}

function WhaleTypeBadge({ type }: { type: string }) {
  const className = `badge badge-${type?.toLowerCase() || 'active'}`;
  return <span className={className}>{type || 'Active'}</span>;
}

type SortKey = 'total_pnl' | 'win_rate' | 'total_trades' | 'last_trade_at' | 'subscriber_count';

export default function WalletTable({ limit = 100 }: { limit?: number }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('total_pnl');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchWallets() {
      try {
        const res = await fetch(`/api/wallets?limit=${limit}`);
        const data = await res.json();
        setWallets(data.wallets || []);
      } catch (error) {
        console.error('Failed to fetch wallets:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchWallets();
    const interval = setInterval(fetchWallets, 60000);
    return () => clearInterval(interval);
  }, [limit]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedWallets = [...wallets]
    .filter(w => search === '' || w.address.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aVal = a[sortKey] || 0;
      const bVal = b[sortKey] || 0;
      return sortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <th
      onClick={() => handleSort(sortKeyName)}
      className="cursor-pointer hover:text-[var(--accent-primary)] transition-colors"
    >
      {label}
      {sortKey === sortKeyName && (
        <span className="ml-1 text-[var(--accent-primary)]">
          {sortDir === 'desc' ? '↓' : '↑'}
        </span>
      )}
    </th>
  );

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-[var(--bg-tertiary)] rounded"></div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-[var(--bg-tertiary)] rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            TRACKED WALLETS
          </h3>
          <span className="text-xs font-mono text-[var(--text-muted)]">
            {sortedWallets.length} results
          </span>
        </div>
        <input
          type="text"
          placeholder="Search address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] w-64"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Address</th>
              <SortHeader label="PnL" sortKeyName="total_pnl" />
              <SortHeader label="Win Rate" sortKeyName="win_rate" />
              <SortHeader label="Trades" sortKeyName="total_trades" />
              <th>Type</th>
              <SortHeader label="Last Trade" sortKeyName="last_trade_at" />
              <SortHeader label="Subs" sortKeyName="subscriber_count" />
            </tr>
          </thead>
          <tbody>
            {sortedWallets.map((wallet, index) => (
              <tr key={wallet.address} style={{ animationDelay: `${index * 0.02}s` }} className="fade-in">
                <td>
                  <Link
                    href={`/wallet/${wallet.address}`}
                    className="text-[var(--accent-primary)] hover:underline"
                  >
                    {formatAddress(wallet.address)}
                  </Link>
                </td>
                <td className={wallet.total_pnl >= 0 ? 'text-positive' : 'text-negative'}>
                  {wallet.total_pnl >= 0 ? '+' : ''}{formatPnL(wallet.total_pnl)}
                </td>
                <td className={wallet.win_rate >= 0.55 ? 'text-positive' : wallet.win_rate >= 0.45 ? 'text-[var(--text-primary)]' : 'text-negative'}>
                  {(wallet.win_rate * 100).toFixed(1)}%
                </td>
                <td>{wallet.total_trades?.toLocaleString() || 0}</td>
                <td><WhaleTypeBadge type={wallet.whale_type} /></td>
                <td className="text-[var(--text-secondary)]">{formatTime(wallet.last_trade_at)}</td>
                <td className="text-[var(--text-secondary)]">{wallet.subscriber_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedWallets.length === 0 && (
        <div className="p-12 text-center text-[var(--text-muted)]">
          No wallets found
        </div>
      )}
    </div>
  );
}

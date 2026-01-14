'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Wallet {
  address: string;
  total_pnl: number;
  win_rate: number;
  total_trades: number;
  whale_type: string;
}

function formatPnL(pnl: number): string {
  if (pnl >= 1000000) return `$${(pnl / 1000000).toFixed(2)}M`;
  if (pnl >= 1000) return `$${(pnl / 1000).toFixed(1)}K`;
  return `$${pnl.toFixed(0)}`;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function TopWallets() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWallets() {
      try {
        const res = await fetch('/api/wallets?limit=10');
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
  }, []);

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-[var(--bg-tertiary)] rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] font-mono">
          TRACKED WHALES
        </h3>
      </div>

      <div className="divide-y divide-[var(--border-color)]">
        {wallets.slice(0, 10).map((wallet, index) => (
          <Link
            key={wallet.address}
            href={`/wallet/${wallet.address}`}
            className="flex items-center justify-between p-4 hover:bg-[rgba(0,255,136,0.02)] transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="w-6 h-6 rounded bg-[var(--bg-tertiary)] flex items-center justify-center font-mono text-xs text-[var(--text-muted)]">
                {index + 1}
              </div>
              <div>
                <div className="font-mono text-sm text-[var(--accent-primary)] group-hover:underline">
                  {formatAddress(wallet.address)}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {wallet.total_trades?.toLocaleString() || 0} trades · {((wallet.win_rate || 0) * 100).toFixed(0)}% win
                </div>
              </div>
            </div>

            <div className={`font-mono font-semibold ${(wallet.total_pnl || 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
              {(wallet.total_pnl || 0) >= 0 ? '+' : ''}{formatPnL(wallet.total_pnl || 0)}
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/wallets"
        className="block p-4 text-center text-sm text-[var(--accent-primary)] hover:bg-[rgba(0,255,136,0.02)] transition-colors border-t border-[var(--border-color)]"
      >
        View all wallets →
      </Link>
    </div>
  );
}

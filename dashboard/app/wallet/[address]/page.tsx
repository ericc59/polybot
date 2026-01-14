'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';

interface Wallet {
  address: string;
  total_pnl: number;
  win_rate: number;
  total_trades: number;
  avg_trade_size: number;
  whale_type: string;
  last_trade_at: number;
  pnl_per_trade: number;
  trade_frequency: number;
  category_pnl: string | null;
  subscriber_count: number;
}

interface Trade {
  id: number;
  wallet_address: string;
  market_title: string;
  trade_side: string;
  trade_size: number;
  trade_price: number;
  sent_at: number;
}

function formatPnL(pnl: number): string {
  if (!pnl) return '$0';
  if (Math.abs(pnl) >= 1000000) return `$${(pnl / 1000000).toFixed(2)}M`;
  if (Math.abs(pnl) >= 1000) return `$${(pnl / 1000).toFixed(1)}K`;
  return `$${pnl.toFixed(0)}`;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

function formatSize(size: number): string {
  if (!size) return '$0';
  if (size >= 1000000) return `$${(size / 1000000).toFixed(2)}M`;
  if (size >= 1000) return `$${(size / 1000).toFixed(1)}K`;
  return `$${size.toFixed(0)}`;
}

function StatBlock({ label, value, subValue, positive }: { label: string; value: string; subValue?: string; positive?: boolean }) {
  return (
    <div className="card p-6">
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2 font-mono">
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono ${positive === true ? 'text-positive' : positive === false ? 'text-negative' : 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
      {subValue && (
        <div className="text-xs text-[var(--text-secondary)] mt-2">
          {subValue}
        </div>
      )}
    </div>
  );
}

export default function WalletDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWallet() {
      try {
        const res = await fetch(`/api/wallet/${address}`);
        if (!res.ok) {
          throw new Error('Wallet not found');
        }
        const data = await res.json();
        setWallet(data.wallet);
        setTrades(data.trades || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch wallet');
      } finally {
        setLoading(false);
      }
    }

    fetchWallet();
  }, [address]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6">
        <div className="animate-pulse">
          <div className="h-8 bg-[var(--bg-tertiary)] rounded w-64 mb-4"></div>
          <div className="h-4 bg-[var(--bg-tertiary)] rounded w-96 mb-8"></div>
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-[var(--bg-tertiary)] rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !wallet) {
    return (
      <div className="max-w-7xl mx-auto px-6">
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <div className="text-xl text-[var(--text-primary)] mb-2">Wallet Not Found</div>
          <div className="text-[var(--text-muted)] mb-6">{error || 'This wallet is not in our tracking database.'}</div>
          <Link href="/wallets" className="text-[var(--accent-primary)] hover:underline">
            ← Back to wallets
          </Link>
        </div>
      </div>
    );
  }

  const categoryPnl = wallet.category_pnl ? JSON.parse(wallet.category_pnl) : null;

  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-2">
          <Link href="/wallets" className="hover:text-[var(--accent-primary)]">Wallets</Link>
          <span>/</span>
          <span className="text-[var(--text-secondary)]">Detail</span>
        </div>
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] font-mono">
            {address}
          </h1>
          <span className={`badge badge-${wallet.whale_type?.toLowerCase() || 'active'}`}>
            {wallet.whale_type || 'Active'}
          </span>
        </div>
        <p className="text-[var(--text-secondary)]">
          {wallet.subscriber_count || 0} users tracking this wallet
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger">
        <StatBlock
          label="Total PnL"
          value={(wallet.total_pnl >= 0 ? '+' : '') + formatPnL(wallet.total_pnl)}
          positive={wallet.total_pnl >= 0}
        />
        <StatBlock
          label="Win Rate"
          value={`${((wallet.win_rate || 0) * 100).toFixed(1)}%`}
          positive={(wallet.win_rate || 0) >= 0.55}
        />
        <StatBlock
          label="Total Trades"
          value={(wallet.total_trades || 0).toLocaleString()}
        />
        <StatBlock
          label="Avg Trade"
          value={formatSize(wallet.avg_trade_size || 0)}
        />
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger">
        <StatBlock
          label="PnL per Trade"
          value={formatPnL(wallet.pnl_per_trade || 0)}
          positive={(wallet.pnl_per_trade || 0) >= 0}
        />
        <StatBlock
          label="Trade Frequency"
          value={`${(wallet.trade_frequency || 0).toFixed(1)}/day`}
        />
        <StatBlock
          label="Last Trade"
          value={wallet.last_trade_at ? new Date(wallet.last_trade_at * 1000).toLocaleDateString() : 'N/A'}
          subValue={wallet.last_trade_at ? new Date(wallet.last_trade_at * 1000).toLocaleTimeString() : undefined}
        />
        <StatBlock
          label="Subscribers"
          value={(wallet.subscriber_count || 0).toString()}
        />
      </div>

      {/* Category Performance */}
      {categoryPnl && Object.keys(categoryPnl).length > 0 && (
        <div className="card p-6 mb-8">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 uppercase tracking-wider">
            Category Performance
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(categoryPnl).map(([category, pnl]) => (
              <div key={category} className="bg-[var(--bg-tertiary)] rounded p-4">
                <div className="text-xs text-[var(--text-muted)] uppercase mb-1">{category}</div>
                <div className={`font-mono font-semibold ${(pnl as number) >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {(pnl as number) >= 0 ? '+' : ''}{formatPnL(pnl as number)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            Recent Trades
          </h3>
        </div>

        {trades.length > 0 ? (
          <div className="divide-y divide-[var(--border-color)]">
            {trades.map((trade) => (
              <div key={trade.id} className="p-4 hover:bg-[rgba(0,255,136,0.02)] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`badge ${trade.trade_side?.toLowerCase() === 'buy' ? 'badge-active' : 'badge-dormant'}`}>
                        {trade.trade_side || 'TRADE'}
                      </span>
                      <span className="text-xs font-mono text-[var(--text-muted)]">
                        {formatTime(trade.sent_at)}
                      </span>
                    </div>
                    <div className="text-sm text-[var(--text-primary)]">
                      {trade.market_title || 'Unknown Market'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono text-lg font-semibold text-[var(--text-primary)]">
                      {formatSize(trade.trade_size)}
                    </div>
                    <div className="text-xs font-mono text-[var(--text-muted)]">
                      @ {((trade.trade_price || 0) * 100).toFixed(1)}¢
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-[var(--text-muted)]">
            No trade history available for this wallet
          </div>
        )}
      </div>
    </div>
  );
}

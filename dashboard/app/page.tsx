import CopyTradingStats from "@/components/CopyTradingStats";
import CopyTradesFeed from "@/components/CopyTradesFeed";
import TopWallets from "@/components/TopWallets";

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Dashboard
        </h1>
        <p className="text-[var(--text-secondary)]">
          Copy trading performance and account overview
        </p>
      </div>

      {/* Copy Trading Stats */}
      <div className="mb-8">
        <CopyTradingStats />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Copy Trades Feed */}
        <div className="lg:col-span-2">
          <CopyTradesFeed limit={20} />
        </div>

        {/* Top Performers (whales you're tracking) */}
        <div className="lg:col-span-1">
          <TopWallets />
        </div>
      </div>
    </div>
  );
}

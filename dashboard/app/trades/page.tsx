import TradesFeed from "@/components/TradesFeed";

export default function TradesPage() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Live Trades
        </h1>
        <p className="text-[var(--text-secondary)]">
          Real-time feed of trades from tracked whale wallets
        </p>
      </div>

      {/* Trades Feed */}
      <TradesFeed limit={100} />
    </div>
  );
}

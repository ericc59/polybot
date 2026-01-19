import TennisStats from "@/components/tennis/TennisStats";
import TennisMatchesFeed from "@/components/tennis/TennisMatchesFeed";
import TennisTradesFeed from "@/components/tennis/TennisTradesFeed";

export default function TennisOverview() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Tennis Walkover Bot
        </h1>
        <p className="text-[var(--text-secondary)]">
          Automated walkover detection and arbitrage trading
        </p>
      </div>

      {/* Stats */}
      <div className="mb-8">
        <TennisStats />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Matches */}
        <div className="lg:col-span-2">
          <TennisMatchesFeed limit={10} />
        </div>

        {/* Recent Trades */}
        <div className="lg:col-span-1">
          <TennisTradesFeed limit={10} />
        </div>
      </div>
    </div>
  );
}

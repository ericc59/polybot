import TennisTradesTable from "@/components/tennis/TennisTradesTable";

export default function TennisTrades() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Trade History
        </h1>
        <p className="text-[var(--text-secondary)]">
          All walkover trades executed by the bot
        </p>
      </div>

      {/* Trades Table */}
      <TennisTradesTable />
    </div>
  );
}

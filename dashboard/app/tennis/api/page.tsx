import OddsApiAnalysis from "@/components/tennis/OddsApiAnalysis";

export default function TennisApiPage() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Odds API Analysis
        </h1>
        <p className="text-[var(--text-secondary)]">
          View and analyze data from The Odds API - compare with tracked Polymarket events
        </p>
      </div>

      {/* Odds API Data */}
      <OddsApiAnalysis />
    </div>
  );
}

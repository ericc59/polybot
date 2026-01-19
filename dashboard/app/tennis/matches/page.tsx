import TennisMatchesTable from "@/components/tennis/TennisMatchesTable";

export default function TennisMatches() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Tracked Matches
        </h1>
        <p className="text-[var(--text-secondary)]">
          All tennis matches being monitored for walkover opportunities
        </p>
      </div>

      {/* Matches Table */}
      <TennisMatchesTable />
    </div>
  );
}

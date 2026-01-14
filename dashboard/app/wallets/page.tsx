import WalletTable from "@/components/WalletTable";

export default function WalletsPage() {
  return (
    <div className="max-w-7xl mx-auto px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Tracked Wallets
        </h1>
        <p className="text-[var(--text-secondary)]">
          All whale wallets being monitored by PolySpy users
        </p>
      </div>

      {/* Wallet Table */}
      <WalletTable limit={200} />
    </div>
  );
}

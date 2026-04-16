import { TradingDashboard } from "@/components/dashboard/trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Live Cala leaderboard &middot; Fire harvest runs &middot; Track Team Nuke
        </p>
      </div>
      <TradingDashboard />
    </div>
  );
}

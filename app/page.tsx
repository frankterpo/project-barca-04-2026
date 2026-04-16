import { TradingDashboard } from "@/components/dashboard/trading-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Team Nuke</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Portfolio deep dive &middot; Fire harvest sessions &middot; Track performance
        </p>
      </div>
      <TradingDashboard />
    </div>
  );
}

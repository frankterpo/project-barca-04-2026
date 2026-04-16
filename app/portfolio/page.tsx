import { HoldingsTable } from "@/components/portfolio/holdings-table";
import { RunStrip } from "@/components/portfolio/run-strip";
import { loadRunSummarySafe } from "@/lib/load-run";

export default async function PortfolioPage() {
  const summary = await loadRunSummarySafe();

  if (!summary) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <div
          className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary"
          role="status"
        >
          <p className="font-medium text-text-primary">No run data found.</p>
          <p className="mt-4">
            Generate mock fixtures with{" "}
            <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-text-primary">
              pnpm run demo:seed
            </code>{" "}
            then refresh.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-text-secondary">
            Mock committee output — JSON-backed DecisionStore (v0).
          </p>
        </div>
      </div>
      <RunStrip summary={summary} />
      <HoldingsTable holdings={summary.holdings} />
    </div>
  );
}

import type { PortfolioRunSummary } from "@/lib/types";

export function RunStrip({ summary }: { summary: PortfolioRunSummary }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Active run
          </div>
          <div className="mt-1 font-mono text-sm text-text-primary">{summary.id}</div>
          <div className="text-xs text-text-secondary">{summary.branchLabel}</div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-xs text-text-muted">Last updated</div>
          <div className="text-sm text-text-primary">
            {new Date(summary.updatedAt).toLocaleString()}
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-xs text-text-muted">Portfolio value</div>
          <div className="text-lg font-semibold tabular-nums text-accent">
            ${summary.portfolioValueUsd.toLocaleString()}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-text-secondary">{summary.benchmarkNote}</p>
    </div>
  );
}

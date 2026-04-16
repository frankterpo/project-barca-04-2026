"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── types ──────────────────────────────────────────────────────────

interface PortfolioRun {
  run_id: string;
  branch_label: string;
  portfolio_value_usd: number;
  return_pct: number | null;
  updated_at: string;
}

interface HoldingRow {
  ticker: string;
  name: string;
  weight_pct: number;
  conviction_band: "A" | "B" | "C";
}

type ViewState = { kind: "list" } | { kind: "detail"; run: PortfolioRun; holdings: HoldingRow[] };

// ── omnigraph query helper ─────────────────────────────────────────

async function graphQuery<T>(query: string, params?: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch("/api/graph/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, params }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok ? (json.data as T) : null;
  } catch {
    return null;
  }
}

// ── helpers ────────────────────────────────────────────────────────

function fmtReturn(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function returnColor(pct: number | null | undefined): string {
  if (pct == null) return "text-text-muted";
  return pct >= 0 ? "text-positive" : "text-negative";
}

function bandBadge(band: string) {
  const style =
    band === "A"
      ? "bg-positive/15 text-positive ring-1 ring-positive/30"
      : band === "B"
        ? "bg-warning/15 text-warning ring-1 ring-warning/30"
        : "bg-negative/10 text-negative ring-1 ring-negative/25";
  return (
    <span className={`inline-flex min-w-[2rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {band}
    </span>
  );
}

// ── sparkline chart (pure CSS) ─────────────────────────────────────

function ReturnSparkline({ runs }: { runs: PortfolioRun[] }) {
  const valid = runs.filter((r) => r.return_pct != null).slice(-40);
  if (valid.length < 2) return null;

  const vals = valid.map((r) => r.return_pct!);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const barH = 120;

  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        Return % timeline (last {valid.length} runs)
      </div>
      <div className="flex items-end gap-px" style={{ height: barH }}>
        {valid.map((r, i) => {
          const pct = ((r.return_pct! - min) / range) * 100;
          const h = Math.max(pct, 2);
          const color = r.return_pct! >= 0 ? "bg-positive" : "bg-negative";
          return (
            <div key={r.run_id} className="group relative flex-1 min-w-[4px]" style={{ height: "100%" }}>
              <div className={`absolute bottom-0 w-full rounded-t ${color}`} style={{ height: `${h}%` }} />
              <div className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-bg-muted px-2 py-1 text-xs text-text-primary shadow-lg group-hover:block">
                {fmtReturn(r.return_pct)} — {r.branch_label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-text-muted tabular-nums">
        <span>{new Date(valid[0].updated_at).toLocaleDateString()}</span>
        <span>{new Date(valid[valid.length - 1].updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ── stat card ──────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────

export function GraphDashboard() {
  const [runs, setRuns] = useState<PortfolioRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ kind: "list" });
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await graphQuery<PortfolioRun[]>("all_runs");
      if (data) {
        setRuns(data);
      } else {
        setError("Could not load runs from Omnigraph. Is the server running?");
      }
      setLoading(false);
    })();
  }, []);

  const openRun = useCallback(async (run: PortfolioRun) => {
    setDetailLoading(true);
    const data = await graphQuery<HoldingRow[]>("holdings_for_run", { run_id: run.run_id });
    setView({ kind: "detail", run, holdings: data ?? [] });
    setDetailLoading(false);
  }, []);

  const stats = useMemo(() => {
    if (runs.length === 0) return null;
    const withReturn = runs.filter((r) => r.return_pct != null);
    const best = withReturn.reduce((a, b) => ((a.return_pct ?? -Infinity) > (b.return_pct ?? -Infinity) ? a : b), withReturn[0]);
    const strategies = new Set(runs.map((r) => r.branch_label));
    return { total: runs.length, best, strategies: strategies.size };
  }, [runs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary" role="alert">
        <p className="font-medium text-text-primary">Omnigraph unavailable</p>
        <p className="mt-2">{error}</p>
        <p className="mt-2 text-text-muted">
          Start Omnigraph with <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-text-primary">omnigraph serve</code>, then refresh.
        </p>
      </div>
    );
  }

  if (view.kind === "detail") {
    const { run, holdings } = view;
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setView({ kind: "list" })}
          className="text-sm text-accent hover:text-accent-muted"
        >
          ← Back to runs
        </button>

        <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-mono text-sm text-text-primary">{run.run_id}</div>
              <div className="text-xs text-text-secondary">{run.branch_label}</div>
            </div>
            <div className="flex gap-6">
              <div className="text-right">
                <div className="text-xs text-text-muted">Value</div>
                <div className="text-lg font-semibold tabular-nums text-accent">{fmtUsd(run.portfolio_value_usd)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-text-muted">Return</div>
                <div className={`text-lg font-semibold tabular-nums ${returnColor(run.return_pct)}`}>
                  {fmtReturn(run.return_pct)}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs text-text-muted">{new Date(run.updated_at).toLocaleString()}</div>
        </div>

        {detailLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : holdings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-center text-sm text-text-secondary">
            No holdings linked to this run.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">Weight</th>
                  <th className="px-4 py-3 text-right">Band</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {holdings.map((h) => (
                  <tr key={h.ticker} className="hover:bg-bg-muted/40">
                    <td className="px-4 py-3 font-mono font-medium text-text-primary">{h.ticker}</td>
                    <td className="px-4 py-3 text-text-secondary">{h.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{h.weight_pct.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right">{bandBadge(h.conviction_band)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── list view ──────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total runs" value={stats.total} sub={`${stats.strategies} strategies`} />
          <StatCard
            label="Best return"
            value={
              <span className={returnColor(stats.best?.return_pct)}>
                {fmtReturn(stats.best?.return_pct)}
              </span>
            }
            sub={stats.best?.branch_label}
          />
          <StatCard
            label="Latest run"
            value={runs[0]?.branch_label ?? "—"}
            sub={runs[0] ? new Date(runs[0].updated_at).toLocaleString() : undefined}
          />
        </div>
      )}

      <ReturnSparkline runs={[...runs].reverse()} />

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-3">Run ID</th>
              <th className="px-4 py-3">Strategy</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-right">Return</th>
              <th className="px-4 py-3 text-right">Date</th>
              <th className="px-4 py-3 text-right">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {runs.map((r) => (
              <tr key={r.run_id} className="hover:bg-bg-muted/40">
                <td className="px-4 py-3 font-mono text-xs text-text-secondary max-w-[200px] truncate">
                  {r.run_id}
                </td>
                <td className="px-4 py-3 text-text-primary">{r.branch_label}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                  {fmtUsd(r.portfolio_value_usd)}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${returnColor(r.return_pct)}`}>
                  {fmtReturn(r.return_pct)}
                </td>
                <td className="px-4 py-3 text-right text-xs text-text-muted">
                  {new Date(r.updated_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => openRun(r)}
                    className="text-accent hover:text-accent-muted text-sm"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

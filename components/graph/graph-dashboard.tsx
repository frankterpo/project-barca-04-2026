"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface PortfolioRun {
  run_id: string;
  branch_label: string;
  portfolio_value_usd: number;
  return_pct: number | null;
  updated_at: string;
}

interface OmnigraphHolding {
  ticker: string;
  name: string;
  weightPct: number;
  convictionBand: string;
}

interface LocalHolding {
  ticker: string;
  purchasePrice: number;
  evalPrice: number;
  returnPct: number;
  quantity: number;
  purchaseDate: string;
}

type DataSource = "omnigraph" | "local" | "none";

function fmtReturn(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v < 0.001 && v > 0) return `$${v.toExponential(2)}`;
  if (v < 1 && v > 0) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function returnColor(pct: number | null | undefined): string {
  if (pct == null) return "text-text-muted";
  return pct >= 0 ? "text-positive" : "text-negative";
}

function ReturnSparkline({ holdings }: { holdings: LocalHolding[] }) {
  const sorted = holdings
    .filter((h) => Math.abs(h.returnPct) < 100_000)
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, 40);

  if (sorted.length < 2) return null;

  const vals = sorted.map((h) => h.returnPct);
  const max = Math.max(...vals.map(Math.abs));
  const scale = max || 1;
  const barH = 140;

  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">
        Return % by Ticker (top {sorted.length})
      </div>
      <div className="flex items-end gap-px" style={{ height: barH }}>
        {sorted.map((h) => {
          const pct = (Math.abs(h.returnPct) / scale) * 100;
          const hw = Math.max(pct, 2);
          const color = h.returnPct >= 0 ? "bg-positive" : "bg-negative";
          return (
            <div key={h.ticker} className="group relative flex-1 min-w-[4px]" style={{ height: "100%" }}>
              <div className={`absolute bottom-0 w-full rounded-t ${color} opacity-80`} style={{ height: `${hw}%` }} />
              <div className="pointer-events-none absolute -top-14 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-bg-muted px-2 py-1 text-xs text-text-primary shadow-lg group-hover:block">
                <span className="font-mono font-semibold">{h.ticker}</span>
                <br />
                {fmtReturn(h.returnPct)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
    </div>
  );
}

function OmnigraphView({
  run,
  allRuns,
  holdings,
  selectedRunId,
  onSelectRun,
}: {
  run: PortfolioRun;
  allRuns: PortfolioRun[];
  holdings: OmnigraphHolding[];
  selectedRunId: string;
  onSelectRun: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-muted/40 px-3 py-1 text-xs text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          Omnigraph Connected
        </span>
        {run.updated_at && (
          <span className="text-xs text-text-muted">
            {new Date(run.updated_at).toLocaleString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Portfolio Value"
          value={<span className="text-positive">{fmtUsd(run.portfolio_value_usd)}</span>}
          sub={run.branch_label}
        />
        <StatCard
          label="Return"
          value={
            <span className={returnColor(run.return_pct)}>
              {fmtReturn(run.return_pct)}
            </span>
          }
        />
        <StatCard label="Holdings" value={holdings.length} sub={`${allRuns.length} total runs`} />
        <StatCard
          label="Top Conviction"
          value={holdings.filter((h) => h.convictionBand === "A").length}
          sub="Band A stocks"
        />
      </div>

      {allRuns.length > 1 && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
          <div className="border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Run History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-4 py-3">Run</th>
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Return</th>
                  <th className="px-4 py-3 text-right">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {allRuns.slice(0, 10).map((r) => (
                  <tr
                    key={r.run_id}
                    className={`cursor-pointer hover:bg-bg-muted/40 ${r.run_id === selectedRunId ? "bg-accent/5" : ""}`}
                    onClick={() => onSelectRun(r.run_id)}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{r.run_id.slice(0, 20)}...</td>
                    <td className="px-4 py-2.5 text-text-primary">{r.branch_label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">{fmtUsd(r.portfolio_value_usd)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${returnColor(r.return_pct)}`}>
                      {fmtReturn(r.return_pct)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-text-muted">
                      {new Date(r.updated_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
        <div className="border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Holdings ({holdings.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3 text-right">Weight %</th>
                <th className="px-4 py-3 text-right">Band</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {holdings.map((h, i) => (
                <tr key={h.ticker} className="hover:bg-bg-muted/40">
                  <td className="px-4 py-2.5 text-xs text-text-muted tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5 font-mono font-medium text-text-primary">{h.ticker}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">{h.weightPct.toFixed(2)}%</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      h.convictionBand === "A"
                        ? "bg-positive/10 text-positive"
                        : h.convictionBand === "B"
                          ? "bg-warning/10 text-warning"
                          : "bg-bg-muted text-text-muted"
                    }`}>
                      {h.convictionBand}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function GraphDashboard() {
  const [localHoldings, setLocalHoldings] = useState<LocalHolding[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>("none");

  const [ogRun, setOgRun] = useState<PortfolioRun | null>(null);
  const [ogAllRuns, setOgAllRuns] = useState<PortfolioRun[]>([]);
  const [ogHoldings, setOgHoldings] = useState<OmnigraphHolding[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");

  const [filter, setFilter] = useState<"all" | "winners" | "losers">("all");
  const [sortKey, setSortKey] = useState<"returnPct" | "ticker" | "evalPrice">("returnPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/graph/portfolio");
      const json = await res.json();
      if (!json.ok) {
        setSource("none");
        return;
      }

      if (json.source === "omnigraph") {
        setSource("omnigraph");
        setOgRun(json.run);
        setOgAllRuns(json.allRuns ?? []);
        setOgHoldings(json.holdings ?? []);
        setSelectedRunId(json.run?.run_id ?? "");
      } else {
        setSource("local");
        setLocalHoldings(json.holdings ?? []);
        setLastUpdated(json.lastUpdated ?? null);
      }
    } catch {
      setSource("none");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);

  const handleSelectRun = useCallback(async (runId: string) => {
    setSelectedRunId(runId);
    try {
      const res = await fetch("/api/graph/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "holdings_for_run", params: { run_id: runId } }),
      });
      const json = await res.json();
      if (json.ok && json.data?.rows) {
        setOgHoldings(json.data.rows.map((r: Record<string, unknown>) => ({
          ticker: r.ticker,
          name: r.name ?? r.ticker,
          weightPct: r.weight_pct ?? r["$run.holds.weight_pct"] ?? 0,
          convictionBand: r.conviction_band ?? r["$run.holds.conviction_band"] ?? "C",
        })));
        const matchedRun = ogAllRuns.find((r) => r.run_id === runId);
        if (matchedRun) setOgRun(matchedRun);
      }
    } catch { /* keep current holdings */ }
  }, [ogAllRuns]);

  const toggleSort = useCallback(
    (key: typeof sortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(key === "ticker" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    let list = localHoldings;
    if (filter === "winners") list = list.filter((h) => h.returnPct > 0);
    if (filter === "losers") list = list.filter((h) => h.returnPct <= 0);

    return [...list].sort((a, b) => {
      let cmp: number;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "evalPrice") cmp = a.evalPrice - b.evalPrice;
      else cmp = a.returnPct - b.returnPct;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [localHoldings, filter, sortKey, sortDir]);

  const stats = useMemo(() => {
    if (localHoldings.length === 0) return null;
    const sorted = [...localHoldings].sort((a, b) => b.returnPct - a.returnPct);
    const winners = localHoldings.filter((h) => h.returnPct > 0).length;
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const avgReturn = localHoldings.reduce((s, h) => s + h.returnPct, 0) / localHoldings.length;
    return { total: localHoldings.length, winners, best, worst, avgReturn };
  }, [localHoldings]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-xs text-text-muted">Loading knowledge graph...</p>
      </div>
    );
  }

  if (source === "omnigraph" && ogRun) {
    return (
      <OmnigraphView
        run={ogRun}
        allRuns={ogAllRuns}
        holdings={ogHoldings}
        selectedRunId={selectedRunId}
        onSelectRun={handleSelectRun}
      />
    );
  }

  if (source === "local" && localHoldings.length > 0) {
    const sortIcon = (key: typeof sortKey) => {
      if (sortKey !== key) return null;
      return <span className="ml-1 text-accent">{sortDir === "desc" ? "↓" : "↑"}</span>;
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-muted/40 px-3 py-1 text-xs text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Local Price DB
          </span>
          {lastUpdated && (
            <span className="text-xs text-text-muted">
              Updated {new Date(lastUpdated).toLocaleString()}
            </span>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Holdings" value={stats.total} sub={`${stats.winners} winners`} />
            <StatCard
              label="Best"
              value={<span className="text-positive">{fmtReturn(stats.best?.returnPct)}</span>}
              sub={stats.best?.ticker}
            />
            <StatCard
              label="Worst"
              value={<span className="text-negative">{fmtReturn(stats.worst?.returnPct)}</span>}
              sub={stats.worst?.ticker}
            />
            <StatCard
              label="Avg Return"
              value={<span className={returnColor(stats.avgReturn)}>{fmtReturn(stats.avgReturn)}</span>}
            />
          </div>
        )}

        <ReturnSparkline holdings={localHoldings} />

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
          <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Holdings ({filtered.length})</h2>
            <div className="flex gap-1">
              {(["all", "winners", "losers"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-xs transition ${
                    filter === f
                      ? "bg-accent/15 text-accent font-medium"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {f === "all" ? "All" : f === "winners" ? "Winners" : "Losers"}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              No holdings match this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-4 py-3 w-12">#</th>
                    <th className="px-4 py-3 cursor-pointer hover:text-text-secondary" onClick={() => toggleSort("ticker")}>
                      Ticker{sortIcon("ticker")}
                    </th>
                    <th className="px-4 py-3 text-right">Buy Price</th>
                    <th className="px-4 py-3 text-right cursor-pointer hover:text-text-secondary" onClick={() => toggleSort("evalPrice")}>
                      Current{sortIcon("evalPrice")}
                    </th>
                    <th className="px-4 py-3 text-right cursor-pointer hover:text-text-secondary" onClick={() => toggleSort("returnPct")}>
                      Return{sortIcon("returnPct")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filtered.slice(0, 100).map((h, i) => (
                    <tr key={h.ticker} className="hover:bg-bg-muted/40">
                      <td className="px-4 py-2.5 text-xs text-text-muted tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-medium text-text-primary">{h.ticker}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{fmtUsd(h.purchasePrice)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">{fmtUsd(h.evalPrice)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${returnColor(h.returnPct)}`}>
                        {fmtReturn(h.returnPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 100 && (
                <div className="border-t border-border-subtle px-4 py-3 text-center text-xs text-text-muted">
                  Showing 100 of {filtered.length} holdings
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary"
      role="status"
    >
      <p className="font-medium text-text-primary">No portfolio data yet</p>
      <p className="mt-4">
        Run the price harvester to generate portfolio data, or connect Omnigraph for the full knowledge graph.
      </p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface PortfolioRun {
  run_id: string;
  branch_label: string;
  portfolio_value_usd: number;
  return_pct: number | null;
  updated_at: string;
}

interface HoldingRow {
  ticker: string;
  purchasePrice: number;
  evalPrice: number;
  returnPct: number;
  quantity: number;
  purchaseDate: string;
}

type DataSource = "omnigraph" | "local";

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

function ReturnSparkline({ holdings }: { holdings: HoldingRow[] }) {
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

export function GraphDashboard() {
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>("local");
  const [filter, setFilter] = useState<"all" | "winners" | "losers">("all");
  const [sortKey, setSortKey] = useState<"returnPct" | "ticker" | "evalPrice">("returnPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    (async () => {
      setLoading(true);

      const healthRes = await fetch("/api/graph/health").catch(() => null);
      const omnigraphUp = healthRes?.ok && (await healthRes.json().catch(() => null))?.ok;

      if (omnigraphUp) {
        try {
          const res = await fetch("/api/graph/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "all_runs" }),
          });
          const json = await res.json();
          if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
            setSource("omnigraph");
            setLoading(false);
            return;
          }
        } catch {}
      }

      try {
        const res = await fetch("/api/graph/portfolio");
        const json = await res.json();
        if (json.ok && Array.isArray(json.holdings)) {
          setHoldings(json.holdings);
          setLastUpdated(json.priceDb?.lastUpdated ?? null);
          setSource("local");
        }
      } catch {}

      setLoading(false);
    })();
  }, []);

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
    let list = holdings;
    if (filter === "winners") list = list.filter((h) => h.returnPct > 0);
    if (filter === "losers") list = list.filter((h) => h.returnPct <= 0);

    return [...list].sort((a, b) => {
      let cmp: number;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "evalPrice") cmp = a.evalPrice - b.evalPrice;
      else cmp = a.returnPct - b.returnPct;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [holdings, filter, sortKey, sortDir]);

  const stats = useMemo(() => {
    if (holdings.length === 0) return null;
    const winners = holdings.filter((h) => h.returnPct > 0).length;
    const best = holdings[0];
    const worst = holdings[holdings.length - 1];
    const avgReturn = holdings.reduce((s, h) => s + h.returnPct, 0) / holdings.length;
    return { total: holdings.length, winners, best, worst, avgReturn };
  }, [holdings]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-xs text-text-muted">Loading knowledge graph...</p>
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-center text-sm text-text-secondary" role="alert">
        <p className="font-medium text-text-primary">No portfolio data yet</p>
        <p className="mt-2">Run the price harvester first to generate portfolio data, then come back here.</p>
      </div>
    );
  }

  const sortIcon = (key: typeof sortKey) => {
    if (sortKey !== key) return null;
    return <span className="ml-1 text-accent">{sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-muted/40 px-3 py-1 text-xs text-text-muted">
            {source === "omnigraph" ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                Omnigraph
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                Local Price DB
              </>
            )}
          </span>
        </div>
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
            value={
              <span className="text-positive">
                {fmtReturn(stats.best?.returnPct)}
              </span>
            }
            sub={stats.best?.ticker}
          />
          <StatCard
            label="Worst"
            value={
              <span className="text-negative">
                {fmtReturn(stats.worst?.returnPct)}
              </span>
            }
            sub={stats.worst?.ticker}
          />
          <StatCard
            label="Avg Return"
            value={
              <span className={returnColor(stats.avgReturn)}>
                {fmtReturn(stats.avgReturn)}
              </span>
            }
          />
        </div>
      )}

      <ReturnSparkline holdings={holdings} />

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
        <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Holdings ({filtered.length})
          </h2>
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
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-text-secondary"
                    onClick={() => toggleSort("ticker")}
                  >
                    Ticker{sortIcon("ticker")}
                  </th>
                  <th className="px-4 py-3 text-right">Buy Price</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-text-secondary"
                    onClick={() => toggleSort("evalPrice")}
                  >
                    Current{sortIcon("evalPrice")}
                  </th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-text-secondary"
                    onClick={() => toggleSort("returnPct")}
                  >
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
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{h.quantity}</td>
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

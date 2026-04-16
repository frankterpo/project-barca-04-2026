"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ──────────────────────────────────────────────── */

interface TeamRow {
  team_name: string;
  return_pct: number;
  total_value: number;
  num_transactions: number;
  model_agent_version: string;
}

interface Ticker {
  ticker: string;
  purchasePrice: number;
  evalPrice: number;
  returnPct: number;
}

interface PortfolioData {
  ok: boolean;
  lastUpdated: string;
  totalTickers: number;
  winnersCount: number;
  losersCount: number;
  avgReturn: number;
  bestPerformer: Ticker | null;
  worstPerformer: Ticker | null;
  top30: Ticker[];
  bottom10: Ticker[];
}

type HarvestState = "idle" | "running" | "done" | "error";

/* ── Formatters ─────────────────────────────────────────── */

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtPrice(v: number): string {
  if (v < 0.001) return v.toExponential(2);
  if (v < 1) return `$${v.toFixed(4)}`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Pulse indicator ───────────────────────────────────── */

function Pulse() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-positive" />
    </span>
  );
}

/* ── Stat card ─────────────────────────────────────────── */

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${accent ? "text-accent" : "text-text-primary"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-text-secondary truncate">{sub}</div>}
    </div>
  );
}

/* ── Return bar for holdings ───────────────────────────── */

function HoldingBar({ ticker, returnPct, maxAbs }: { ticker: string; returnPct: number; maxAbs: number }) {
  const w = Math.max((Math.abs(returnPct) / maxAbs) * 100, 0.5);
  const positive = returnPct >= 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-14 shrink-0 font-mono font-medium text-text-primary text-right">{ticker}</div>
      <div className="flex-1 h-5 relative rounded-sm overflow-hidden bg-bg-muted/40">
        <div
          className={`absolute inset-y-0 left-0 rounded-sm transition-all duration-500 ${positive ? "bg-positive/50" : "bg-negative/50"}`}
          style={{ width: `${w}%` }}
        />
        <span className={`absolute inset-y-0 right-1.5 flex items-center text-xs tabular-nums font-medium ${positive ? "text-positive" : "text-negative"}`}>
          {fmtPct(returnPct)}
        </span>
      </div>
    </div>
  );
}

/* ── Main Dashboard ────────────────────────────────────── */

export function TradingDashboard() {
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [totalTeams, setTotalTeams] = useState(0);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [harvest, setHarvest] = useState<HarvestState>("idle");
  const [harvestLog, setHarvestLog] = useState<string[]>([]);
  const [showLosers, setShowLosers] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchTeamNuke = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const json = await res.json();
      if (json.ok && Array.isArray(json.rows)) {
        const rows = json.rows as TeamRow[];
        setTotalTeams(rows.length);
        const idx = rows.findIndex(
          (r) => r.team_name?.toLowerCase().includes("nuke") || (r as unknown as Record<string, unknown>).team_id?.toString().toLowerCase().includes("nuke"),
        );
        if (idx >= 0) {
          setTeam(rows[idx]);
          setRank(idx + 1);
        }
      }
    } catch {}
  }, []);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/graph/portfolio");
      const json = await res.json();
      if (json.ok) setPortfolio(json as PortfolioData);
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchTeamNuke(), fetchPortfolio()]).then(() => setLoading(false));
    const id = setInterval(fetchTeamNuke, 60_000);
    return () => clearInterval(id);
  }, [fetchTeamNuke, fetchPortfolio]);

  const fireHarvest = useCallback(async () => {
    if (harvest === "running") return;
    setHarvest("running");
    setHarvestLog(["Launching price harvester..."]);

    try {
      const res = await fetch("/api/harvest/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      });

      if (!res.body) {
        setHarvestLog(["No streaming response"]);
        setHarvest("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6));
              setHarvestLog((prev) => [...prev, msg]);
              if (typeof msg === "string" && msg.startsWith("[done]")) {
                const success = msg.includes("code 0");
                setHarvest(success ? "done" : "error");
                fetchTeamNuke();
                fetchPortfolio();
              }
            } catch {}
          }
        }
      }

      setHarvest((s) => (s === "running" ? "done" : s));
    } catch (e) {
      setHarvestLog((prev) => [...prev, e instanceof Error ? e.message : "Network error"]);
      setHarvest("error");
    }
  }, [harvest, fetchTeamNuke, fetchPortfolio]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [harvestLog]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-sm text-text-muted">Loading Team Nuke data...</p>
      </div>
    );
  }

  const displayTickers = showLosers ? (portfolio?.bottom10 ?? []) : (portfolio?.top30 ?? []);
  const maxAbs = Math.max(...displayTickers.map((t) => Math.abs(t.returnPct)), 1);

  return (
    <div className="space-y-6">
      {/* ── Hero: Team Nuke ──────────────────────────────── */}
      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-6 relative overflow-hidden">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Pulse />
              <span className="text-xs font-medium uppercase tracking-widest text-text-muted">Team Nuke</span>
              {rank && (
                <span className="ml-2 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent tabular-nums">
                  #{rank} of {totalTeams}
                </span>
              )}
            </div>
            <div className={`mt-2 text-5xl font-bold tabular-nums tracking-tight ${team && team.return_pct >= 0 ? "text-positive" : "text-negative"}`}>
              {team ? fmtPct(team.return_pct) : "—"}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
              {team && (
                <>
                  <span>{team.num_transactions} stocks</span>
                  <span className="text-text-muted">&middot;</span>
                  <span>{fmtPrice(team.total_value)} portfolio</span>
                  <span className="text-text-muted">&middot;</span>
                  <span className="font-mono text-xs">{team.model_agent_version}</span>
                </>
              )}
            </div>
          </div>
          <a
            href="https://cala-leaderboard.apps.rebolt.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-muted/60 px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:border-accent/40 transition shrink-0"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Full Leaderboard
          </a>
        </div>
      </div>

      {/* ── Portfolio Stats ──────────────────────────────── */}
      {portfolio && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Holdings" value={String(portfolio.totalTickers)} sub={`${portfolio.winnersCount} green · ${portfolio.losersCount} red`} />
          <StatCard label="Avg Return" value={fmtPct(portfolio.avgReturn)} accent />
          <StatCard
            label="Best"
            value={portfolio.bestPerformer?.ticker ?? "—"}
            sub={portfolio.bestPerformer ? fmtPct(portfolio.bestPerformer.returnPct) : undefined}
          />
          <StatCard
            label="Worst"
            value={portfolio.worstPerformer?.ticker ?? "—"}
            sub={portfolio.worstPerformer ? fmtPct(portfolio.worstPerformer.returnPct) : undefined}
          />
          <StatCard label="Win Rate" value={portfolio.totalTickers > 0 ? `${((portfolio.winnersCount / portfolio.totalTickers) * 100).toFixed(0)}%` : "—"} />
          <StatCard label="Updated" value={portfolio.lastUpdated ? timeAgo(portfolio.lastUpdated) : "—"} />
        </div>
      )}

      {/* ── Fire Harvest + Log ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 flex flex-col gap-3">
          <button
            type="button"
            onClick={fireHarvest}
            disabled={harvest === "running"}
            className={`
              group relative w-full rounded-xl border px-5 py-4 text-left transition-all
              ${harvest === "running"
                ? "border-warning/40 bg-warning/5 cursor-wait"
                : harvest === "done"
                  ? "border-positive/40 bg-positive/5 hover:bg-positive/10 cursor-pointer"
                  : harvest === "error"
                    ? "border-negative/40 bg-negative/5 hover:bg-negative/10 cursor-pointer"
                    : "border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent/60 cursor-pointer"
              }
            `}
          >
            <div className="flex items-center gap-3">
              {harvest === "running" ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-warning border-t-transparent" />
              ) : (
                <svg className="h-5 w-5 text-accent group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {harvest === "running" ? "Harvesting..." : harvest === "done" ? "Harvest Complete" : harvest === "error" ? "Retry Harvest" : "Fire Harvest"}
                </div>
                <div className="text-xs text-text-secondary">
                  Scan tickers, optimize & submit to Cala
                </div>
              </div>
            </div>
          </button>

          {harvest === "done" && (
            <button
              type="button"
              onClick={() => { setHarvest("idle"); setHarvestLog([]); }}
              className="text-xs text-text-muted hover:text-text-secondary transition"
            >
              Clear log
            </button>
          )}
        </div>

        {harvestLog.length > 0 && (
          <div className="lg:col-span-2 rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Harvest Log</span>
              {harvest === "running" && (
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                  <span className="text-xs text-warning">Running</span>
                </div>
              )}
            </div>
            <div ref={logRef} className="max-h-72 overflow-y-auto p-3 font-mono text-xs text-text-secondary leading-relaxed">
              {harvestLog.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.includes("[error]") || line.includes("ERROR") || line.includes("fail")
                      ? "text-negative"
                      : line.includes("Run locally:") || line.includes("pnpm tsx")
                        ? "text-accent font-semibold"
                        : line.includes("submit") || line.includes("BEST") || line.includes("[done]")
                          ? "text-positive"
                          : line.includes("[stderr]")
                            ? "text-warning"
                            : ""
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Portfolio Holdings ────────────────────────────── */}
      {portfolio && (portfolio.top30.length > 0 || portfolio.bottom10.length > 0) && (
        <div className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">
              Portfolio Allocation
            </h2>
            <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-bg-muted/60 p-0.5">
              <button
                type="button"
                onClick={() => setShowLosers(false)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${!showLosers ? "bg-bg-elevated text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}
              >
                Top 30
              </button>
              <button
                type="button"
                onClick={() => setShowLosers(true)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${showLosers ? "bg-bg-elevated text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}
              >
                Bottom 10
              </button>
            </div>
          </div>

          <div className="p-4 space-y-1.5">
            {displayTickers.map((t) => (
              <HoldingBar key={t.ticker} ticker={t.ticker} returnPct={t.returnPct} maxAbs={maxAbs} />
            ))}
          </div>

          {/* Detail table */}
          <div className="border-t border-border-subtle">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-muted/40 text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-4 py-2">Ticker</th>
                  <th className="px-4 py-2 text-right">Buy Price</th>
                  <th className="px-4 py-2 text-right">Current</th>
                  <th className="px-4 py-2 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/50">
                {displayTickers.map((t) => (
                  <tr key={t.ticker} className="hover:bg-bg-muted/30">
                    <td className="px-4 py-2 font-mono font-medium text-text-primary">{t.ticker}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{fmtPrice(t.purchasePrice)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-primary">{fmtPrice(t.evalPrice)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${t.returnPct >= 0 ? "text-positive" : "text-negative"}`}>
                      {fmtPct(t.returnPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

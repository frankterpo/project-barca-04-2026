"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LeaderboardRow {
  team_id: string;
  team_name: string;
  model_agent_version: string;
  num_transactions: number;
  total_value: number;
  return_pct: number;
  is_baseline: boolean;
  submitted_at: number | null;
  logo_url: string | null;
}

type HarvestState = "idle" | "running" | "done" | "error";

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function rankBadge(i: number) {
  if (i === 0) return <span className="text-lg">&#x1F947;</span>;
  if (i === 1) return <span className="text-lg">&#x1F948;</span>;
  if (i === 2) return <span className="text-lg">&#x1F949;</span>;
  return <span className="text-xs text-text-muted tabular-nums">#{i + 1}</span>;
}

function isTeamNuke(r: LeaderboardRow) {
  return r.team_name?.toLowerCase().includes("nuke") || r.team_id?.toLowerCase().includes("nuke");
}

function ReturnBar({ rows }: { rows: LeaderboardRow[] }) {
  const valid = rows.slice(0, 20);
  if (valid.length < 2) return null;
  const max = Math.max(...valid.map((r) => Math.abs(r.return_pct)));
  const scale = max || 1;

  return (
    <div className="space-y-1.5">
      {valid.map((r, i) => {
        const pct = r.return_pct;
        const w = Math.max((Math.abs(pct) / scale) * 100, 1);
        const us = isTeamNuke(r);
        const color = us
          ? "bg-accent"
          : r.is_baseline
            ? "bg-text-muted/40"
            : pct >= 0
              ? "bg-positive/60"
              : "bg-negative/60";
        return (
          <div key={r.team_id + i} className="flex items-center gap-2 text-xs">
            <div className="w-6 text-right shrink-0">{rankBadge(i)}</div>
            <div className={`w-28 truncate font-mono shrink-0 ${us ? "text-accent font-semibold" : "text-text-secondary"}`}>
              {r.team_name}
            </div>
            <div className="flex-1 h-5 relative rounded-sm overflow-hidden bg-bg-muted/40">
              <div
                className={`absolute inset-y-0 left-0 ${color} rounded-sm transition-all duration-500`}
                style={{ width: `${w}%` }}
              />
              <span className={`absolute inset-y-0 right-1 flex items-center text-xs tabular-nums font-medium ${pct >= 0 ? "text-positive" : "text-negative"}`}>
                {fmtPct(pct)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pulse() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-positive" />
    </span>
  );
}

export function TradingDashboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [harvest, setHarvest] = useState<HarvestState>("idle");
  const [harvestLog, setHarvestLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const json = await res.json();
      if (json.ok && Array.isArray(json.rows)) {
        setRows(json.rows);
        setError(null);
      } else {
        setError(json.error || "Failed to load leaderboard");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const id = setInterval(fetchLeaderboard, 30_000);
    return () => clearInterval(id);
  }, [fetchLeaderboard]);

  const fireHarvest = useCallback(async () => {
    if (harvest === "running") return;
    setHarvest("running");
    setHarvestLog(["Launching price harvester..."]);

    try {
      const res = await fetch("/api/harvest/trigger", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setHarvestLog(json.output || ["Harvest complete."]);
        setHarvest("done");
        fetchLeaderboard();
      } else {
        setHarvestLog(json.output || [json.error || "Harvest failed."]);
        setHarvest("error");
      }
    } catch (e) {
      setHarvestLog([e instanceof Error ? e.message : "Network error"]);
      setHarvest("error");
    }
  }, [harvest, fetchLeaderboard]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [harvestLog]);

  const ourTeam = rows.find(isTeamNuke);
  const ourRank = ourTeam ? rows.indexOf(ourTeam) + 1 : null;
  const leader = rows[0];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-sm text-text-muted">Connecting to Cala leaderboard...</p>
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-6 text-center">
          <p className="text-sm text-warning font-medium">Leaderboard temporarily unavailable</p>
          <p className="mt-1 text-xs text-text-muted">{error}</p>
          <button type="button" onClick={fetchLeaderboard} className="mt-3 text-xs text-accent hover:underline">
            Retry
          </button>
        </div>

        <button
          type="button"
          onClick={fireHarvest}
          disabled={harvest === "running"}
          className="group relative w-full rounded-xl border border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent/60 px-6 py-5 text-left transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <svg className="h-6 w-6 text-accent group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <div>
              <div className="text-sm font-semibold text-text-primary">Fire Harvest</div>
              <div className="text-xs text-text-secondary">Run price-harvester.ts to scan, optimize & submit to Cala</div>
            </div>
          </div>
        </button>

        {harvestLog.length > 0 && (
          <div className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Harvest Log</span>
            </div>
            <div ref={logRef} className="max-h-48 overflow-y-auto p-3 font-mono text-xs text-text-secondary leading-relaxed">
              {harvestLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="col-span-1 sm:col-span-2 rounded-xl border border-border-subtle bg-bg-elevated p-5 relative overflow-hidden">
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <Pulse />
              <span className="text-xs font-medium uppercase tracking-widest text-text-muted">
                Team Nuke
              </span>
            </div>
            <div className={`mt-2 text-4xl font-bold tabular-nums tracking-tight ${ourTeam && (ourTeam.return_pct ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
              {ourTeam ? fmtPct(ourTeam.return_pct) : "Not found"}
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-text-secondary">
              {ourRank && (
                <span>
                  Rank <strong className="text-text-primary">#{ourRank}</strong> of {rows.length}
                </span>
              )}
              {ourTeam && (
                <span>
                  {ourTeam.num_transactions} stocks &middot; {fmtUsd(ourTeam.total_value)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5">
          <div className="text-xs font-medium uppercase tracking-widest text-text-muted">Leader</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-text-primary">
            {leader ? fmtPct(leader.return_pct) : "—"}
          </div>
          <div className="mt-1 text-xs text-text-secondary font-mono truncate">
            {leader?.model_agent_version || "—"}
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5">
          <div className="text-xs font-medium uppercase tracking-widest text-text-muted">Competitors</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-text-primary">{rows.length}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : "—"}
          </div>
        </div>
      </div>

      {/* Fire button + log */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <button
            type="button"
            onClick={fireHarvest}
            disabled={harvest === "running"}
            className={`
              group relative w-full rounded-xl border px-6 py-5 text-left transition-all
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
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-warning border-t-transparent" />
              ) : (
                <svg className="h-6 w-6 text-accent group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {harvest === "running" ? "Harvesting..." : harvest === "done" ? "Harvest Complete" : harvest === "error" ? "Retry Harvest" : "Fire Harvest"}
                </div>
                <div className="text-xs text-text-secondary">
                  {harvest === "running"
                    ? "Running price-harvester — scanning tickers & submitting portfolio"
                    : "Run price-harvester.ts to scan, optimize & submit to Cala"}
                </div>
              </div>
            </div>
          </button>

          {error && (
            <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-xs text-negative">
              {error}
            </div>
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
            <div ref={logRef} className="max-h-48 overflow-y-auto p-3 font-mono text-xs text-text-secondary leading-relaxed">
              {harvestLog.map((line, i) => (
                <div key={i} className={line.includes("ERROR") || line.includes("fail") ? "text-negative" : line.includes("submit") || line.includes("BEST") ? "text-positive" : ""}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Leaderboard</h2>
          <button
            type="button"
            onClick={fetchLeaderboard}
            className="text-xs text-accent hover:text-accent-muted transition"
          >
            Refresh
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-muted">
            No leaderboard data available.
          </div>
        ) : (
          <div className="p-4">
            <ReturnBar rows={rows} />
          </div>
        )}
      </div>

      {/* Full table */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3 text-right">Stocks</th>
                <th className="px-4 py-3 text-right">Portfolio Value</th>
                <th className="px-4 py-3 text-right">Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map((r, i) => {
                const us = isTeamNuke(r);
                return (
                  <tr key={r.team_id + i} className={`${us ? "bg-accent/5" : ""} hover:bg-bg-muted/40`}>
                    <td className="px-4 py-3">{rankBadge(i)}</td>
                    <td className="px-4 py-3">
                      <div className={`text-sm ${us ? "text-accent font-semibold" : "text-text-primary"}`}>
                        {r.team_name}
                      </div>
                      <div className="text-xs text-text-muted font-mono">{r.model_agent_version}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{r.num_transactions}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{fmtUsd(r.total_value)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${r.return_pct >= 0 ? "text-positive" : "text-negative"}`}>
                      {fmtPct(r.return_pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

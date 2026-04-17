"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnswerPanel } from "@/components/judge/answer-panel";
import { CompanyPicker } from "@/components/judge/company-picker";
import { PresetButtons } from "@/components/judge/preset-buttons";
import type { Holding, JudgeAnswer } from "@/lib/types";

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
  quantity?: number;
  purchaseDate?: string;
}

interface PortfolioData {
  ok: boolean;
  source?: "omnigraph" | "local" | "supabase";
  lastUpdated: string;
  totalTickers: number;
  winnersCount: number;
  losersCount: number;
  avgReturn: number;
  bestPerformer: Ticker | null;
  worstPerformer: Ticker | null;
  tickers: Ticker[];
  /** Rows excluded from stats (tickers in `bad_tickers`). */
  badTickersExcluded?: number;
  priceView?: "full" | "actionable";
  allQuarantined?: boolean;
  portfolioNote?: string;
}

type HarvestState = "idle" | "running" | "done" | "error";
type Tab = "overview" | "holdings" | "judge";

/* ── Formatters ─────────────────────────────────────────── */

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtPrice(v: number): string {
  if (v < 0.001 && v > 0) return v.toExponential(2);
  if (v < 1 && v > 0) return `$${v.toFixed(4)}`;
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

function returnColor(pct: number | null): string {
  if (pct == null) return "text-text-muted";
  return pct >= 0 ? "text-positive" : "text-negative";
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
      <div className="text-[10px] font-medium uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${accent ? "text-accent" : "text-text-primary"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-text-secondary truncate">{sub}</div>}
    </div>
  );
}

/* ── Return sparkline ──────────────────────────────────── */

function ReturnSparkline({ tickers }: { tickers: Ticker[] }) {
  const sorted = tickers
    .filter((h) => Math.abs(h.returnPct) < 100_000)
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, 50);

  if (sorted.length < 2) return null;

  const vals = sorted.map((h) => h.returnPct);
  const max = Math.max(...vals.map(Math.abs));
  const scale = max || 1;
  const barH = 160;

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Return Distribution (top {sorted.length})
        </span>
        <span className="text-[10px] text-text-muted">Hover for details</span>
      </div>
      <div className="flex items-end gap-px" style={{ height: barH }}>
        {sorted.map((h) => {
          const pct = (Math.abs(h.returnPct) / scale) * 100;
          const hw = Math.max(pct, 2);
          const color = h.returnPct >= 0 ? "bg-positive" : "bg-negative";
          return (
            <div key={h.ticker} className="group relative flex-1 min-w-[3px]" style={{ height: "100%" }}>
              <div className={`absolute bottom-0 w-full rounded-t ${color} opacity-70 group-hover:opacity-100 transition-opacity`} style={{ height: `${hw}%` }} />
              <div className="pointer-events-none absolute -top-16 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-bg-muted px-2.5 py-1.5 text-xs text-text-primary shadow-xl ring-1 ring-border-subtle group-hover:block">
                <span className="font-mono font-semibold">{h.ticker}</span>
                <br />
                <span className={returnColor(h.returnPct)}>{fmtPct(h.returnPct)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Holding bar ───────────────────────────────────────── */

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

/* ── Tab button ────────────────────────────────────────── */

function TabButton({ active, onClick, children, badge }: { active: boolean; onClick: () => void; children: React.ReactNode; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-bg-elevated text-text-primary shadow-sm ring-1 ring-border-subtle"
          : "text-text-muted hover:text-text-secondary hover:bg-bg-muted/40"
      }`}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] font-semibold tabular-nums text-accent">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Dashboard
   ══════════════════════════════════════════════════════════ */

export function TradingDashboard() {
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [totalTeams, setTotalTeams] = useState(0);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [harvest, setHarvest] = useState<HarvestState>("idle");
  const [harvestLog, setHarvestLog] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const logRef = useRef<HTMLDivElement>(null);

  // Holdings table state
  const [filter, setFilter] = useState<"all" | "winners" | "losers">("all");
  const [sortKey, setSortKey] = useState<"returnPct" | "ticker" | "evalPrice">("returnPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Judge mode state
  const [judgeHoldings, setJudgeHoldings] = useState<Holding[]>([]);
  const [judgeTicker, setJudgeTicker] = useState("");
  const [presetId, setPresetId] = useState<number | null>(1);
  const [judgeAnswer, setJudgeAnswer] = useState<JudgeAnswer | null>(null);
  const [judgeLoading, setJudgeLoading] = useState(false);
  const [judgeHoldingsLoading, setJudgeHoldingsLoading] = useState(false);
  const [judgeCompaniesMessage, setJudgeCompaniesMessage] = useState<string | null>(null);

  /* ── Data fetching ─────────────────────────────────────── */

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
      if (!json.ok) return;

      const holdings: Ticker[] = (json.holdings ?? []).map((h: Record<string, unknown>) => ({
        ticker: (h.ticker ?? "") as string,
        purchasePrice: Number(h.purchasePrice ?? h.purchase_price ?? 0),
        evalPrice: Number(h.evalPrice ?? h.eval_price ?? 0),
        returnPct: Number(h.returnPct ?? h.return_pct ?? 0),
      }));

      const sorted = [...holdings].sort((a, b) => b.returnPct - a.returnPct);
      const winners = sorted.filter((t) => t.returnPct > 0);

      const badEx =
        typeof json.badTickersExcluded === "number" && Number.isFinite(json.badTickersExcluded)
          ? json.badTickersExcluded
          : undefined;
      const priceView =
        json.priceView === "full" || json.priceView === "actionable" ? json.priceView : undefined;
      const allQuarantined = Boolean(json.allQuarantined);
      const portfolioNote = typeof json.portfolioNote === "string" ? json.portfolioNote : undefined;

      setPortfolio({
        ok: true,
        source: json.source,
        lastUpdated: (json.lastUpdated ?? json.run?.updated_at ?? "") as string,
        totalTickers: holdings.length,
        winnersCount: winners.length,
        losersCount: holdings.length - winners.length,
        avgReturn: holdings.length > 0
          ? holdings.reduce((s, t) => s + t.returnPct, 0) / holdings.length
          : 0,
        bestPerformer: sorted[0] ?? null,
        worstPerformer: sorted[sorted.length - 1] ?? null,
        tickers: sorted,
        badTickersExcluded: badEx,
        priceView,
        allQuarantined,
        portfolioNote,
      });
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchTeamNuke(), fetchPortfolio()]).then(() => setLoading(false));
    const id = setInterval(fetchTeamNuke, 60_000);
    return () => clearInterval(id);
  }, [fetchTeamNuke, fetchPortfolio]);

  /** Judge tab: load Omnigraph-backed company list (bounded time; Strict Mode–safe). */
  useEffect(() => {
    if (tab !== "judge") return;

    let active = true;
    const ac = new AbortController();
    const maxMs = 25_000;
    const deadline = setTimeout(() => ac.abort(), maxMs);

    setJudgeHoldingsLoading(true);
    fetch("/api/judge-mode/companies", { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) {
          if (active && !ac.signal.aborted) {
            setJudgeCompaniesMessage(`Companies request failed (${r.status}).`);
          }
          return;
        }
        let json: { holdings?: Holding[]; message?: string };
        try {
          json = (await r.json()) as { holdings?: Holding[]; message?: string };
        } catch {
          if (active && !ac.signal.aborted) {
            setJudgeCompaniesMessage("Invalid JSON from /api/judge-mode/companies.");
          }
          return;
        }
        if (!active || ac.signal.aborted) return;
        const msg = json.message;
        if (typeof msg === "string") {
          setJudgeCompaniesMessage(msg);
        }
        if (Array.isArray(json.holdings)) {
          setJudgeHoldings(json.holdings);
          if (json.holdings.length > 0) {
            setJudgeTicker((t) => t || json.holdings![0]?.ticker || "");
          }
        }
      })
      .catch(() => {
        if (active && !ac.signal.aborted) {
          setJudgeHoldings([]);
          setJudgeCompaniesMessage("Could not load companies (network error or timeout).");
        }
      })
      .finally(() => {
        clearTimeout(deadline);
        if (active) setJudgeHoldingsLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(deadline);
      ac.abort();
      setJudgeHoldingsLoading(false);
    };
  }, [tab]);

  // Fetch judge answer when ticker/preset changes
  useEffect(() => {
    if (!judgeTicker || !presetId) return;

    const ctrl = new AbortController();
    startTransition(() => setJudgeLoading(true));

    fetch(
      `/api/judge-mode?ticker=${encodeURIComponent(judgeTicker)}&presetId=${presetId}`,
      { signal: ctrl.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ answer: JudgeAnswer | null }>;
      })
      .then((body) => {
        if (!ctrl.signal.aborted) startTransition(() => setJudgeAnswer(body.answer));
      })
      .catch(() => {
        if (!ctrl.signal.aborted) startTransition(() => setJudgeAnswer(null));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) startTransition(() => setJudgeLoading(false));
      });

    return () => ctrl.abort();
  }, [judgeTicker, presetId]);

  /* ── Harvest ───────────────────────────────────────────── */

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

  /* ── Holdings filtering/sorting ────────────────────────── */

  const toggleSort = useCallback(
    (key: typeof sortKey) => {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortKey(key); setSortDir(key === "ticker" ? "asc" : "desc"); }
    },
    [sortKey],
  );

  const filteredHoldings = useMemo(() => {
    if (!portfolio) return [];
    let list = portfolio.tickers;
    if (filter === "winners") list = list.filter((h) => h.returnPct > 0);
    if (filter === "losers") list = list.filter((h) => h.returnPct <= 0);

    return [...list].sort((a, b) => {
      let cmp: number;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "evalPrice") cmp = a.evalPrice - b.evalPrice;
      else cmp = a.returnPct - b.returnPct;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [portfolio, filter, sortKey, sortDir]);

  const holdingsStatSub = useMemo(() => {
    if (!portfolio) return "";
    const base = `${portfolio.winnersCount} green · ${portfolio.losersCount} red`;
    const ex = portfolio.badTickersExcluded ?? 0;
    if (ex > 0 && !portfolio.allQuarantined) {
      return `${base} · ${ex} quarantined`;
    }
    return base;
  }, [portfolio]);

  const updatedStatSub = useMemo(() => {
    if (!portfolio?.source) return undefined;
    const parts: string[] = [portfolio.source];
    if (portfolio.priceView === "actionable") parts.push("actionable");
    return parts.join(" · ");
  }, [portfolio]);

  /* ── Loading state ─────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-sm text-text-muted">Loading Team Nuke data...</p>
      </div>
    );
  }

  const top30 = portfolio?.tickers.slice(0, 30) ?? [];
  const bottom10 = portfolio?.tickers.slice(-10).reverse() ?? [];
  const sortIcon = (key: typeof sortKey) => {
    if (sortKey !== key) return null;
    return <span className="ml-1 text-accent">{sortDir === "desc" ? "↓" : "↑"}</span>;
  };

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
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={fireHarvest}
              disabled={harvest === "running"}
              className={`
                group inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition
                ${harvest === "running"
                  ? "border-warning/40 bg-warning/5 cursor-wait text-warning"
                  : harvest === "done"
                    ? "border-positive/40 bg-positive/5 text-positive hover:bg-positive/10"
                    : harvest === "error"
                      ? "border-negative/40 bg-negative/5 text-negative hover:bg-negative/10"
                      : "border-accent/40 bg-accent/5 text-accent hover:bg-accent/10 hover:border-accent/60"
                }
              `}
            >
              {harvest === "running" ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-warning border-t-transparent" />
              ) : (
                <svg className="h-4 w-4 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              {harvest === "running" ? "Harvesting..." : harvest === "done" ? "Done" : harvest === "error" ? "Retry" : "Fire Harvest"}
            </button>
            <a
              href="https://cala-leaderboard.apps.rebolt.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-muted/60 px-3 py-2.5 text-xs text-text-secondary hover:text-text-primary hover:border-accent/40 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Leaderboard
            </a>
          </div>
        </div>
      </div>

      {/* ── Harvest Log (collapsible) ────────────────────── */}
      {harvestLog.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Harvest Log</span>
              {harvest === "running" && (
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
                  <span className="text-xs text-warning">Running</span>
                </div>
              )}
            </div>
            {harvest !== "running" && (
              <button
                type="button"
                onClick={() => { setHarvest("idle"); setHarvestLog([]); }}
                className="text-xs text-text-muted hover:text-text-secondary transition"
              >
                Clear
              </button>
            )}
          </div>
          <div ref={logRef} className="max-h-56 overflow-y-auto p-3 font-mono text-xs text-text-secondary leading-relaxed">
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

      {/* ── Portfolio Stats ──────────────────────────────── */}
      {portfolio && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Holdings" value={String(portfolio.totalTickers)} sub={holdingsStatSub} />
          <StatCard label="Avg Return" value={fmtPct(portfolio.avgReturn)} accent />
          <StatCard label="Best" value={portfolio.bestPerformer?.ticker ?? "—"} sub={portfolio.bestPerformer ? fmtPct(portfolio.bestPerformer.returnPct) : undefined} />
          <StatCard label="Worst" value={portfolio.worstPerformer?.ticker ?? "—"} sub={portfolio.worstPerformer ? fmtPct(portfolio.worstPerformer.returnPct) : undefined} />
          <StatCard label="Win Rate" value={portfolio.totalTickers > 0 ? `${((portfolio.winnersCount / portfolio.totalTickers) * 100).toFixed(0)}%` : "—"} />
          <StatCard label="Updated" value={portfolio.lastUpdated ? timeAgo(portfolio.lastUpdated) : "—"} sub={updatedStatSub} />
        </div>
      )}

      {portfolio?.portfolioNote && (
        <div
          className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-warning leading-relaxed"
          role="status"
        >
          {portfolio.portfolioNote}
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border border-border-subtle bg-bg-muted/30 p-1">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "holdings"} onClick={() => setTab("holdings")} badge={portfolio?.totalTickers}>
          Holdings
        </TabButton>
        <TabButton active={tab === "judge"} onClick={() => setTab("judge")}>
          Judge Mode
        </TabButton>
      </div>

      {/* ── Tab: Overview ────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Sparkline */}
          {portfolio && portfolio.tickers.length > 2 && (
            <ReturnSparkline tickers={portfolio.tickers} />
          )}

          {/* Top 30 bars */}
          {top30.length > 0 && (
            <div className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
              <div className="border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
                <h2 className="text-sm font-semibold text-text-primary">Top Performers</h2>
              </div>
              <div className="p-4 space-y-1.5">
                {top30.slice(0, 15).map((t) => (
                  <HoldingBar key={t.ticker} ticker={t.ticker} returnPct={t.returnPct} maxAbs={Math.max(...top30.map((x) => Math.abs(x.returnPct)), 1)} />
                ))}
              </div>
            </div>
          )}

          {/* Bottom 10 bars */}
          {bottom10.length > 0 && bottom10[0]?.returnPct < 0 && (
            <div className="rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden">
              <div className="border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
                <h2 className="text-sm font-semibold text-text-primary">Bottom Performers</h2>
              </div>
              <div className="p-4 space-y-1.5">
                {bottom10.map((t) => (
                  <HoldingBar key={t.ticker} ticker={t.ticker} returnPct={t.returnPct} maxAbs={Math.max(...bottom10.map((x) => Math.abs(x.returnPct)), 1)} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!portfolio && (
            <div className="rounded-xl border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary" role="status">
              <p className="font-medium text-text-primary">No portfolio data yet</p>
              <p className="mt-2">Click <strong>Fire Harvest</strong> to scan tickers and build the portfolio, or connect Omnigraph for the full knowledge graph.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Holdings ────────────────────────────────── */}
      {tab === "holdings" && (
        <div className="space-y-4">
          {portfolio && portfolio.tickers.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
              <div className="flex items-center justify-between border-b border-border-subtle bg-bg-muted/40 px-4 py-3">
                <h2 className="text-sm font-semibold text-text-primary">All Holdings ({filteredHoldings.length})</h2>
                <div className="flex gap-1">
                  {(["all", "winners", "losers"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`rounded-md px-2.5 py-1 text-xs transition ${
                        filter === f ? "bg-accent/15 text-accent font-medium" : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {f === "all" ? "All" : f === "winners" ? "Winners" : "Losers"}
                    </button>
                  ))}
                </div>
              </div>

              {filteredHoldings.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-text-muted">No holdings match this filter.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-bg-muted/60 text-[10px] uppercase tracking-wider text-text-muted">
                      <tr>
                        <th className="px-4 py-3 w-12">#</th>
                        <th className="px-4 py-3 cursor-pointer hover:text-text-secondary" onClick={() => toggleSort("ticker")}>
                          Ticker{sortIcon("ticker")}
                        </th>
                        <th className="px-4 py-3 text-right">Buy</th>
                        <th className="px-4 py-3 text-right cursor-pointer hover:text-text-secondary" onClick={() => toggleSort("evalPrice")}>
                          Current{sortIcon("evalPrice")}
                        </th>
                        <th className="px-4 py-3 text-right cursor-pointer hover:text-text-secondary" onClick={() => toggleSort("returnPct")}>
                          Return{sortIcon("returnPct")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle/50">
                      {filteredHoldings.slice(0, 100).map((t, i) => (
                        <tr key={t.ticker} className="hover:bg-bg-muted/30">
                          <td className="px-4 py-2.5 text-xs text-text-muted tabular-nums">{i + 1}</td>
                          <td className="px-4 py-2.5 font-mono font-medium text-text-primary">{t.ticker}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{fmtPrice(t.purchasePrice)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">{fmtPrice(t.evalPrice)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${t.returnPct >= 0 ? "text-positive" : "text-negative"}`}>
                            {fmtPct(t.returnPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredHoldings.length > 100 && (
                    <div className="border-t border-border-subtle px-4 py-3 text-center text-xs text-text-muted">
                      Showing 100 of {filteredHoldings.length} holdings
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary" role="status">
              <p className="font-medium text-text-primary">No holdings data</p>
              <p className="mt-2">Fire the harvester to populate tickers, or connect Omnigraph.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Judge Mode ──────────────────────────────── */}
      {tab === "judge" && (
        <div className="space-y-4">
          {judgeHoldingsLoading ? (
            <div className="rounded-xl border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary animate-pulse">
              Loading companies from Omnigraph (and fallbacks)…
            </div>
          ) : judgeHoldings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary" role="status">
              <p className="font-medium text-text-primary">No companies available for cross-examination</p>
              <p className="mt-2">
                {judgeCompaniesMessage ??
                  "Run the price harvester, set OMNIGRAPH_URL, configure Supabase, or add data/price-db.json."}
              </p>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <section className="lg:col-span-1">
                <CompanyPicker holdings={judgeHoldings} value={judgeTicker} onChange={setJudgeTicker} />
              </section>
              <section className="lg:col-span-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Preset questions</h2>
                <div className="mt-2">
                  <PresetButtons selectedId={presetId} onSelect={setPresetId} />
                </div>
              </section>
              <section className="lg:col-span-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Panel</h2>
                <div className="mt-2">
                  <AnswerPanel answer={judgeTicker && presetId ? judgeAnswer : null} loading={judgeLoading} />
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

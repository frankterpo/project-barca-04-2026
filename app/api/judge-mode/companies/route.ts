import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { NextResponse } from "next/server";

import {
  OmnigraphClient,
  type OmnigraphReadResult,
  probeOmnigraphHealth,
} from "@/lib/omnigraph/client";
import { getPricesForDashboard, isSupabaseConfigured } from "@/lib/supabase";
import type { Holding } from "@/lib/types";

export const dynamic = "force-dynamic";

const OMNIGRAPH_BUDGET_MS = 12_000;
const SUPABASE_BUDGET_MS = 8_000;
/** Hard cap so the handler always finishes (client AbortController is 25s). */
const ROUTE_HARD_CAP_MS = 22_000;

export async function GET() {
  try {
    const holdings = await withTimeout(loadJudgeHoldings(), ROUTE_HARD_CAP_MS);
    if (holdings.length > 0) {
      return NextResponse.json({ ok: true, holdings });
    }
    return NextResponse.json({
      ok: true,
      holdings: [],
      message: emptyHoldingsMessage(),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.message === "omnigraph_load_timeout";
    return NextResponse.json({
      ok: true,
      holdings: [],
      message: timedOut
        ? `${emptyHoldingsMessage()} (Request hit the ${ROUTE_HARD_CAP_MS / 1000}s server budget — check Omnigraph/Supabase latency.)`
        : emptyHoldingsMessage(),
    });
  }
}

async function loadJudgeHoldings(): Promise<Holding[]> {
  let holdings: Holding[] = [];
  try {
    holdings = await withTimeout(loadHoldingsFromOmnigraph(), OMNIGRAPH_BUDGET_MS);
  } catch {
    holdings = [];
  }

  if (holdings.length === 0) {
    try {
      holdings = await withTimeout(holdingsFromSupabase(), SUPABASE_BUDGET_MS);
    } catch {
      holdings = [];
    }
  }

  if (holdings.length === 0) {
    holdings = holdingsFromLocalPriceDb();
  }

  return holdings;
}

function emptyHoldingsMessage(): string {
  const base =
    "No portfolio data. Run the price harvester, set OMNIGRAPH_URL for Omnigraph, SUPABASE_CONNECTION for Postgres prices, or add data/price-db.json.";
  if (process.env.VERCEL && !process.env.OMNIGRAPH_URL?.trim()) {
    return `${base} On Vercel you currently have no OMNIGRAPH_URL — add it under Project → Settings → Environment Variables (and OMNIGRAPH_BEARER_TOKEN if your server requires it). See docs/OPERATOR.md.`;
  }
  return base;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("omnigraph_load_timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function loadHoldingsFromOmnigraph(): Promise<Holding[]> {
  const healthy = await probeOmnigraphHealth({
    timeoutMs: 2_000,
    retries: 0,
  }).catch(() => false);
  if (!healthy) return [];

  const og = new OmnigraphClient({ timeoutMs: 4_000, retries: 0 });

  try {
    const latestRun = await og.read<OmnigraphReadResult>("latest_run");
    if (latestRun.row_count > 0) {
      const runId = String(latestRun.rows[0].run_id);
      const result = await og.read<OmnigraphReadResult>("holdings_for_run", { run_id: runId });
      return result.rows.map((r) => ({
        ticker: String(r.ticker ?? ""),
        name: String(r.name ?? r.ticker ?? ""),
        weightPct: Number(r.weight_pct ?? 0),
        convictionBand: (String(r.conviction_band ?? "C")) as Holding["convictionBand"],
      }));
    }
  } catch { /* fall through to all_companies */ }

  try {
    const result = await og.read<OmnigraphReadResult>("all_companies");
    return result.rows.map((r) => ({
      ticker: String(r.ticker ?? ""),
      name: String(r.name ?? r.ticker ?? ""),
      weightPct: 0,
      convictionBand: "C" as const,
    }));
  } catch {
    return [];
  }
}

async function holdingsFromSupabase(): Promise<Holding[]> {
  if (!isSupabaseConfigured()) return [];
  const { rows } = await getPricesForDashboard();
  if (rows.length === 0) return [];
  return rows.map((r) => ({
    ticker: r.ticker,
    name: r.ticker,
    weightPct: 0,
    convictionBand: "C" as const,
  }));
}

interface LocalPriceEntry {
  ticker: string;
}

interface LocalPriceDB {
  prices: Record<string, LocalPriceEntry>;
}

function holdingsFromLocalPriceDb(): Holding[] {
  const paths = [
    join("/tmp", "data", "price-db.json"),
    join(process.cwd(), "data", "price-db.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const db = JSON.parse(readFileSync(p, "utf-8")) as LocalPriceDB;
      const entries = Object.values(db.prices ?? {});
      if (entries.length === 0) continue;
      return entries.map((e) => ({
        ticker: e.ticker,
        name: e.ticker,
        weightPct: 0,
        convictionBand: "C" as const,
      }));
    } catch {
      /* try next path */
    }
  }
  return [];
}

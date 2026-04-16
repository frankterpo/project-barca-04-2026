import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getOmnigraphClient, type OmnigraphReadResult } from "@/lib/omnigraph";
import { probeOmnigraphHealth } from "@/lib/omnigraph/client";
import { isSupabaseConfigured, getAllPrices } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface PriceEntry {
  ticker: string;
  purchasePrice: number;
  evalPrice: number;
  returnPct: number;
}

interface PriceDB {
  lastUpdated: string;
  prices: Record<string, PriceEntry>;
}

interface HoldingRow {
  ticker: string;
  name?: string;
  weight_pct: number;
  conviction_band: string;
}

async function tryOmnigraph(): Promise<Response | null> {
  const healthy = await probeOmnigraphHealth({ timeoutMs: 2_000, retries: 0 });
  if (!healthy) return null;

  const og = getOmnigraphClient();

  const runsResult = await og.read<OmnigraphReadResult>("all_runs");
  const runs = runsResult.rows ?? [];
  if (runs.length === 0) return null;

  const latestRun = runs[0] as Record<string, unknown>;
  const runId = latestRun.run_id as string;

  const holdingsResult = await og.read<OmnigraphReadResult>("holdings_for_run", { run_id: runId });
  const holdings = (holdingsResult.rows ?? []) as unknown as HoldingRow[];

  return NextResponse.json({
    ok: true,
    source: "omnigraph",
    run: {
      run_id: runId,
      branch_label: latestRun.branch_label,
      portfolio_value_usd: latestRun.portfolio_value_usd,
      return_pct: latestRun.return_pct,
      updated_at: latestRun.updated_at,
    },
    allRuns: runs.slice(0, 20),
    holdings: holdings.map((h) => ({
      ticker: h.ticker,
      name: h.name ?? h.ticker,
      weightPct: h.weight_pct,
      convictionBand: h.conviction_band,
    })),
    totalHoldings: holdings.length,
  });
}

function tryLocalPriceDb(): Response | null {
  const paths = [
    join("/tmp", "data", "price-db.json"),
    join(process.cwd(), "data", "price-db.json"),
  ];

  let db: PriceDB | null = null;
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        db = JSON.parse(readFileSync(p, "utf-8"));
        break;
      } catch { /* try next */ }
    }
  }
  if (!db) return null;

  const entries = Object.values(db.prices);
  const sorted = [...entries].sort((a, b) => b.returnPct - a.returnPct);
  const winners = entries.filter((e) => e.returnPct > 0);
  const avgReturn = entries.length > 0
    ? entries.reduce((s, e) => s + e.returnPct, 0) / entries.length
    : 0;

  return NextResponse.json({
    ok: true,
    source: "local",
    lastUpdated: db.lastUpdated,
    totalTickers: entries.length,
    winnersCount: winners.length,
    losersCount: entries.length - winners.length,
    avgReturn,
    bestPerformer: sorted[0] ?? null,
    worstPerformer: sorted[sorted.length - 1] ?? null,
    holdings: sorted.map((e) => ({
      ticker: e.ticker,
      purchasePrice: e.purchasePrice,
      evalPrice: e.evalPrice,
      returnPct: e.returnPct,
      quantity: 0,
      purchaseDate: db!.lastUpdated,
    })),
  });
}

async function trySupabase(): Promise<Response | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const rows = await getAllPrices();
    if (rows.length === 0) return null;

    const winners = rows.filter((r) => (r.return_pct ?? 0) > 0);
    const avg = rows.length > 0
      ? rows.reduce((s, r) => s + (r.return_pct ?? 0), 0) / rows.length
      : 0;

    return NextResponse.json({
      ok: true,
      source: "supabase",
      lastUpdated: rows[0]?.harvested_at ?? null,
      totalTickers: rows.length,
      winnersCount: winners.length,
      losersCount: rows.length - winners.length,
      avgReturn: avg,
      bestPerformer: rows[0] ? { ticker: rows[0].ticker, purchasePrice: rows[0].purchase_price, evalPrice: rows[0].eval_price, returnPct: rows[0].return_pct } : null,
      worstPerformer: rows[rows.length - 1] ? { ticker: rows[rows.length - 1].ticker, purchasePrice: rows[rows.length - 1].purchase_price, evalPrice: rows[rows.length - 1].eval_price, returnPct: rows[rows.length - 1].return_pct } : null,
      holdings: rows.map((r) => ({
        ticker: r.ticker,
        purchasePrice: r.purchase_price,
        evalPrice: r.eval_price,
        returnPct: r.return_pct,
        quantity: 0,
        purchaseDate: r.harvested_at,
      })),
    });
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const ogResponse = await tryOmnigraph().catch(() => null);
    if (ogResponse) return ogResponse;
  } catch { /* fall through */ }

  try {
    const sbResponse = await trySupabase();
    if (sbResponse) return sbResponse;
  } catch { /* fall through */ }

  const localResponse = tryLocalPriceDb();
  if (localResponse) return localResponse;

  return NextResponse.json(
    { ok: false, error: "No portfolio data available. Run the harvester first, or connect Omnigraph." },
    { status: 404 },
  );
}

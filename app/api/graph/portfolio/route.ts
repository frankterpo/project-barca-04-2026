import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { getOmnigraphClient, type OmnigraphReadResult } from "@/lib/omnigraph";
import { probeOmnigraphHealth } from "@/lib/omnigraph/client";

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

export async function GET() {
  try {
    const ogResponse = await tryOmnigraph().catch(() => null);
    if (ogResponse) return ogResponse;
  } catch { /* fall through */ }

  const localResponse = tryLocalPriceDb();
  if (localResponse) return localResponse;

  return NextResponse.json(
    { ok: false, error: "No portfolio data available. Run the harvester first, or connect Omnigraph." },
    { status: 404 },
  );
}

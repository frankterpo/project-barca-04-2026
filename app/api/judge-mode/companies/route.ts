import { NextResponse } from "next/server";

import { getOmnigraphClient, type OmnigraphReadResult } from "@/lib/omnigraph/client";
import { probeOmnigraphHealth } from "@/lib/omnigraph/client";
import type { Holding } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const holdings = await loadHoldingsFromOmnigraph();
  if (holdings.length > 0) {
    return NextResponse.json({ ok: true, holdings });
  }

  return NextResponse.json({
    ok: true,
    holdings: [],
    message: "No companies in Omnigraph. Run the harvester to populate data.",
  });
}

async function loadHoldingsFromOmnigraph(): Promise<Holding[]> {
  const healthy = await probeOmnigraphHealth({ timeoutMs: 2_000, retries: 0 }).catch(() => false);
  if (!healthy) return [];

  const og = getOmnigraphClient();

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

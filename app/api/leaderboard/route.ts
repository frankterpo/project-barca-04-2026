import { NextResponse } from "next/server";
import { tryFetchCalaLeaderboardRows, leaderboardRowReturnPct } from "@/lib/cala";
import { parseLenientJson } from "@/lib/cala/convex-http";

export const dynamic = "force-dynamic";

const DIRECT_CONVEX_URL = "https://different-cormorant-663.convex.site/api/leaderboard";

export async function GET() {
  let result = await tryFetchCalaLeaderboardRows(8_000);

  if (!result) {
    try {
      const res = await fetch(DIRECT_CONVEX_URL, {
        headers: { Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text();
      const data = parseLenientJson(text) as Record<string, unknown>[];
      if (Array.isArray(data) && data.length > 0) {
        result = { url: DIRECT_CONVEX_URL, rows: data };
      }
    } catch {
      // fallback failed
    }
  }

  if (!result) {
    return NextResponse.json({ ok: false, rows: [], error: "Leaderboard unreachable" }, { status: 502 });
  }

  const rows = result.rows.map((r) => ({
    team_id: r.team_id ?? r.model_agent_version ?? "unknown",
    model_agent_version: r.model_agent_version ?? "—",
    num_transactions: typeof r.num_transactions === "number" ? r.num_transactions : 0,
    total_value: typeof r.total_value === "number" ? r.total_value : 0,
    return_pct: leaderboardRowReturnPct(r),
  }));

  rows.sort((a, b) => (b.return_pct ?? -Infinity) - (a.return_pct ?? -Infinity));

  return NextResponse.json({ ok: true, rows });
}

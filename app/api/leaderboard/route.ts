import { NextResponse } from "next/server";
import { tryFetchCalaLeaderboardRows, leaderboardRowReturnPct } from "@/lib/cala";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await tryFetchCalaLeaderboardRows(8_000);
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

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CONVEX_CLOUD_URL = "https://different-cormorant-663.convex.cloud/api/query";
const INITIAL_INVESTMENT = 1_000_000;

interface ConvexRow {
  teamName?: string;
  teamSlug?: string;
  modelAgentName?: string;
  modelAgentVersion?: string;
  totalValue?: number;
  totalInvested?: number;
  transactionCount?: number;
  isBaseline?: boolean;
  submittedAt?: number;
  teamLogoUrl?: string | null;
}

export async function GET() {
  try {
    const res = await fetch(CONVEX_CLOUD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "submissions:leaderboard", args: {} }),
      signal: AbortSignal.timeout(10_000),
    });

    const json = await res.json();

    if (json.status !== "success" || !Array.isArray(json.value)) {
      return NextResponse.json(
        { ok: false, rows: [], error: json.errorMessage ?? "Convex query failed" },
        { status: 502 },
      );
    }

    const rows = (json.value as ConvexRow[]).map((r) => {
      const invested = r.totalInvested ?? INITIAL_INVESTMENT;
      const value = r.totalValue ?? invested;
      const returnPct = invested > 0 ? ((value - invested) / invested) * 100 : 0;

      return {
        team_id: r.teamSlug ?? r.teamName ?? "unknown",
        team_name: r.teamName ?? r.teamSlug ?? "unknown",
        model_agent_version: r.modelAgentVersion ?? "—",
        num_transactions: r.transactionCount ?? 0,
        total_value: value,
        return_pct: returnPct,
        is_baseline: r.isBaseline ?? false,
        submitted_at: r.submittedAt ?? null,
        logo_url: r.teamLogoUrl ?? null,
      };
    });

    rows.sort((a, b) => b.return_pct - a.return_pct);

    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, rows: [], error: msg }, { status: 502 });
  }
}

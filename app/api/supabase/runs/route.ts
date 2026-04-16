import { NextResponse } from "next/server";

import { isSupabaseConfigured, getLatestRuns, getRunHoldings } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_CONNECTION not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const runIdParam = searchParams.get("run_id");

  try {
    if (runIdParam) {
      const holdings = await getRunHoldings(Number(runIdParam));
      return NextResponse.json({ ok: true, run_id: Number(runIdParam), holdings });
    }

    const runs = await getLatestRuns(limit);
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { isSupabaseConfigured, getAllPrices, getPriceCount } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_CONNECTION not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const countOnly = searchParams.get("count") === "1";

  try {
    if (countOnly) {
      const count = await getPriceCount();
      return NextResponse.json({ ok: true, count });
    }

    const prices = await getAllPrices();
    return NextResponse.json({ ok: true, count: prices.length, prices });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

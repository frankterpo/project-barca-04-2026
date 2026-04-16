import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

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

export async function GET() {
  const priceDbPath = join(process.cwd(), "data/price-db.json");

  if (!existsSync(priceDbPath)) {
    return NextResponse.json({ ok: false, error: "No price-db.json found" }, { status: 404 });
  }

  try {
    const db: PriceDB = JSON.parse(readFileSync(priceDbPath, "utf-8"));
    const entries = Object.values(db.prices);
    const sorted = [...entries].sort((a, b) => b.returnPct - a.returnPct);

    const winners = entries.filter((e) => e.returnPct > 0);
    const losers = entries.filter((e) => e.returnPct <= 0);
    const avgReturn =
      entries.length > 0
        ? entries.reduce((s, e) => s + e.returnPct, 0) / entries.length
        : 0;

    return NextResponse.json({
      ok: true,
      lastUpdated: db.lastUpdated,
      totalTickers: entries.length,
      winnersCount: winners.length,
      losersCount: losers.length,
      avgReturn,
      bestPerformer: sorted[0] ?? null,
      worstPerformer: sorted[sorted.length - 1] ?? null,
      top30: sorted.slice(0, 30),
      bottom10: sorted.slice(-10).reverse(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to parse price-db" },
      { status: 500 },
    );
  }
}

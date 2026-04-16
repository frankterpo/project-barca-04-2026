import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

interface PriceEntry {
  purchasePrice: number;
  evalPrice: number;
  quantity: number;
  purchaseDate: string;
  evalDate: string;
}

interface PriceDB {
  lastUpdated: string;
  prices: Record<string, PriceEntry>;
}

interface SubmissionLog {
  timestamp: string;
  strategy: string;
  returnPct: number;
  portfolioValue: number;
  tickerCount: number;
  top5: Array<{ ticker: string; returnPct: number; weight: number }>;
}

export async function GET() {
  const priceDbPath = join(process.cwd(), "data/price-db.json");
  const submissionsPath = join(process.cwd(), "data/submissions.json");

  const result: {
    ok: boolean;
    priceDb: PriceDB | null;
    submissions: SubmissionLog[];
    holdings: Array<{
      ticker: string;
      purchasePrice: number;
      evalPrice: number;
      returnPct: number;
      quantity: number;
      purchaseDate: string;
    }>;
  } = {
    ok: true,
    priceDb: null,
    submissions: [],
    holdings: [],
  };

  if (existsSync(priceDbPath)) {
    try {
      const raw = readFileSync(priceDbPath, "utf-8");
      const db: PriceDB = JSON.parse(raw);
      result.priceDb = db;

      result.holdings = Object.entries(db.prices)
        .map(([ticker, entry]) => {
          const ret =
            entry.purchasePrice > 0
              ? ((entry.evalPrice - entry.purchasePrice) / entry.purchasePrice) * 100
              : 0;
          return {
            ticker,
            purchasePrice: entry.purchasePrice,
            evalPrice: entry.evalPrice,
            returnPct: ret,
            quantity: entry.quantity,
            purchaseDate: entry.purchaseDate,
          };
        })
        .sort((a, b) => b.returnPct - a.returnPct);
    } catch {}
  }

  if (existsSync(submissionsPath)) {
    try {
      result.submissions = JSON.parse(readFileSync(submissionsPath, "utf-8"));
    } catch {}
  }

  return NextResponse.json(result);
}

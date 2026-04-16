#!/usr/bin/env npx tsx
/**
 * One-time seed: push existing local JSON data into Supabase tables.
 * Run: npx tsx scripts/seed-supabase.ts
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  upsertPrices,
  addBadTicker,
  insertRun,
  insertRunHoldings,
  closePool,
  getPriceCount,
  getBadTickers,
  getLatestRuns,
} from "../lib/supabase";

const DATA_DIR = join(process.cwd(), "data");

async function seedPrices() {
  const path = join(DATA_DIR, "price-db.json");
  if (!existsSync(path)) {
    console.log("⏭  price-db.json not found, skipping prices");
    return;
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    prices: Record<string, { ticker: string; purchasePrice: number; evalPrice: number; returnPct: number }>;
  };
  const entries = Object.values(raw.prices);
  if (entries.length === 0) {
    console.log("⏭  price-db.json empty");
    return;
  }
  const n = await upsertPrices(
    entries.map((e) => ({
      ticker: e.ticker,
      purchasePrice: e.purchasePrice ?? null,
      evalPrice: e.evalPrice ?? null,
      returnPct: e.returnPct ?? null,
    })),
  );
  console.log(`✅ prices: upserted ${n} rows`);
}

async function seedBadTickers() {
  const path = join(DATA_DIR, "bad-tickers.json");
  if (!existsSync(path)) {
    console.log("⏭  bad-tickers.json not found, skipping bad_tickers");
    return;
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Array<string | { ticker: string }>;
  let n = 0;
  for (const entry of raw) {
    const ticker = typeof entry === "string" ? entry : entry.ticker;
    if (!ticker) continue;
    await addBadTicker(ticker);
    n++;
  }
  console.log(`✅ bad_tickers: inserted ${n} rows`);
}

async function seedRunLog() {
  const path = join(DATA_DIR, "cala-run-log.jsonl");
  if (!existsSync(path)) {
    console.log("⏭  cala-run-log.jsonl not found, skipping runs");
    return;
  }
  const lines = readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  let runCount = 0;
  let holdingCount = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const runId = await insertRun({
        phase: entry.phase,
        team_id: entry.team_id ?? null,
        strategy: entry.best_strategy ?? null,
        submit_return_pct: entry.submit_return_pct ?? null,
        projected_value: entry.projected_value_usd ?? null,
        projected_return: entry.projected_return_pct ?? null,
        actual_value: entry.actual_total_value_usd ?? null,
        actual_invested: entry.actual_invested_usd ?? null,
        rank: entry.rank ?? null,
        leaderboard_rows: entry.leaderboard_rows ?? null,
        gap_to_first_pp: entry.gap_to_first_pp ?? null,
        top_return_pct: entry.top_return_pct ?? null,
        our_return_pct: entry.our_return_pct ?? null,
        bad_ticker_count: entry.bad_ticker_count ?? null,
        price_db_count: entry.price_db_count ?? null,
        harvest_new_prices: entry.harvest_new_prices ?? null,
        harvest_elapsed_s: entry.harvest_elapsed_s ?? null,
        error_message: entry.error_message ?? null,
        note: entry.note ?? null,
      });
      runCount++;

      if (entry.phase === "optimize_submit" && Array.isArray(entry.holdings) && entry.holdings.length > 0) {
        await insertRunHoldings(runId, entry.holdings);
        holdingCount += entry.holdings.length;
      }
    } catch {
      // skip malformed lines
    }
  }
  console.log(`✅ runs: inserted ${runCount} rows (${holdingCount} run_holdings)`);
}

async function main() {
  console.log("🌱 Seeding Supabase from local JSON files...\n");

  await seedPrices();
  await seedBadTickers();
  await seedRunLog();

  console.log("\n📊 Final counts:");
  console.log(`   prices:      ${await getPriceCount()}`);
  console.log(`   bad_tickers: ${(await getBadTickers()).length}`);
  console.log(`   runs:        ${(await getLatestRuns(9999)).length}`);

  await closePool();
  console.log("\n✅ Seed complete");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});

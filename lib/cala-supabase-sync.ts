import type { CalaRunLogEntry } from "./cala-run-log";
import { addBadTicker, insertRun, insertRunHoldings, isSupabaseConfigured, upsertPrices } from "./supabase";

/** When unset or not `0`, persist Cala runs (and prices on harvest) if `SUPABASE_CONNECTION` is set. */
export function calaSupabaseSyncEnabled(): boolean {
  return isSupabaseConfigured() && process.env.CALA_SUPABASE_SYNC !== "0";
}

function buildNote(entry: CalaRunLogEntry): string | null {
  const parts = [entry.note, entry.leaderboard_url ? `leaderboard_url:${entry.leaderboard_url}` : null].filter(
    (x): x is string => Boolean(x),
  );
  return parts.length ? parts.join(" | ") : null;
}

/** Insert one `runs` row (+ optional `run_holdings` for successful optimize submits). */
export async function persistCalaRunToSupabase(
  entry: CalaRunLogEntry,
  holdings?: Array<{ ticker: string; amount: number }>,
): Promise<void> {
  if (!calaSupabaseSyncEnabled()) return;
  try {
    const id = await insertRun({
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
      note: buildNote(entry),
    });
    if (
      entry.phase === "optimize_submit" &&
      holdings &&
      holdings.length > 0
    ) {
      await insertRunHoldings(id, holdings);
    }
  } catch (e) {
    console.warn(
      `📦 Supabase: run persist failed — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Sync bad tickers to Supabase (call after `savePersistedBadTickers`). */
export async function syncBadTickersToSupabase(tickers: Set<string>): Promise<void> {
  if (!calaSupabaseSyncEnabled()) return;
  try {
    let n = 0;
    for (const t of tickers) {
      await addBadTicker(t);
      n++;
    }
    if (n > 0) console.log(`📦 Supabase: synced ${n} bad ticker(s)`);
  } catch (e) {
    console.warn(
      `📦 Supabase: bad ticker sync failed — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Upsert all entries from `price-db.json` into `prices` (call after `--harvest`). */
export async function syncPriceDbToSupabase(
  prices: Record<string, { ticker: string; purchasePrice: number; evalPrice: number; returnPct: number }>,
): Promise<void> {
  if (!calaSupabaseSyncEnabled()) return;
  const entries = Object.values(prices).map((e) => ({
    ticker: e.ticker,
    purchasePrice: e.purchasePrice,
    evalPrice: e.evalPrice,
    returnPct: e.returnPct,
  }));
  if (entries.length === 0) return;
  try {
    const n = await upsertPrices(entries);
    console.log(`📦 Supabase: upserted ${n} price row(s)`);
  } catch (e) {
    console.warn(
      `📦 Supabase: price sync failed — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

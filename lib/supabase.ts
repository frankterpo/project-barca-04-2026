import pg from "pg";

let _pool: pg.Pool | null = null;

/** Postgres connection string (pooler), e.g. from Supabase Dashboard → Connect → URI. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_CONNECTION?.trim());
}

function getPool(): pg.Pool {
  if (_pool) return _pool;
  const conn = process.env.SUPABASE_CONNECTION?.trim();
  if (!conn) throw new Error("SUPABASE_CONNECTION env var not set");
  _pool = new pg.Pool({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

export function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, values);
}

// --------------- Prices ---------------

export interface PriceRow {
  ticker: string;
  purchase_price: number | null;
  eval_price: number | null;
  return_pct: number | null;
  harvested_at: string;
}

export async function upsertPrice(
  ticker: string,
  purchasePrice: number | null,
  evalPrice: number | null,
  returnPct: number | null,
): Promise<void> {
  await query(
    `INSERT INTO prices (ticker, purchase_price, eval_price, return_pct, harvested_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (ticker) DO UPDATE SET
       purchase_price = EXCLUDED.purchase_price,
       eval_price     = EXCLUDED.eval_price,
       return_pct     = EXCLUDED.return_pct,
       harvested_at   = EXCLUDED.harvested_at`,
    [ticker, purchasePrice, evalPrice, returnPct],
  );
}

export async function upsertPrices(
  entries: Array<{
    ticker: string;
    purchasePrice: number | null;
    evalPrice: number | null;
    returnPct: number | null;
  }>,
): Promise<number> {
  if (entries.length === 0) return 0;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let count = 0;
    for (const e of entries) {
      await client.query(
        `INSERT INTO prices (ticker, purchase_price, eval_price, return_pct, harvested_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (ticker) DO UPDATE SET
           purchase_price = EXCLUDED.purchase_price,
           eval_price     = EXCLUDED.eval_price,
           return_pct     = EXCLUDED.return_pct,
           harvested_at   = EXCLUDED.harvested_at`,
        [e.ticker, e.purchasePrice, e.evalPrice, e.returnPct],
      );
      count++;
    }
    await client.query("COMMIT");
    return count;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getAllPrices(): Promise<PriceRow[]> {
  const res = await query<PriceRow>("SELECT * FROM prices ORDER BY return_pct DESC NULLS LAST");
  return res.rows;
}

/**
 * Prices for the trading dashboard: by default drops rows whose ticker is in `bad_tickers`
 * so win/loss stats reflect an “actionable” universe. Set `PORTFOLIO_INCLUDE_BAD_TICKERS=1`
 * to include every row (legacy / audit).
 */
export async function getPricesForDashboard(): Promise<{
  rows: PriceRow[];
  badTickersExcluded: number;
  priceView: "full" | "actionable";
  /**
   * Every row matched `bad_tickers` — we still return the full `prices` set so the UI is not empty;
   * `badTickersExcluded` equals total rows (intent to exclude all). See `portfolioNote` on the API.
   */
  allQuarantined: boolean;
}> {
  const all = await getAllPrices();
  if (process.env.PORTFOLIO_INCLUDE_BAD_TICKERS === "1") {
    return { rows: all, badTickersExcluded: 0, priceView: "full", allQuarantined: false };
  }
  const badList = await getBadTickers();
  const bad = new Set(badList.map((t) => t.trim().toUpperCase()).filter(Boolean));
  const rows = all.filter((r) => !bad.has(r.ticker.trim().toUpperCase()));
  const allQuarantined = all.length > 0 && rows.length === 0;
  if (allQuarantined) {
    return {
      rows: all,
      badTickersExcluded: all.length,
      priceView: "actionable",
      allQuarantined: true,
    };
  }
  return {
    rows,
    badTickersExcluded: all.length - rows.length,
    priceView: "actionable",
    allQuarantined: false,
  };
}

export async function getPriceCount(): Promise<number> {
  const res = await query<{ count: string }>("SELECT count(*) FROM prices");
  return parseInt(res.rows[0].count, 10);
}

// --------------- Bad Tickers ---------------

/** Returns true if a new row was inserted (false if ticker was already in `bad_tickers`). */
export async function addBadTicker(ticker: string): Promise<boolean> {
  const res = await query(
    "INSERT INTO bad_tickers (ticker) VALUES ($1) ON CONFLICT DO NOTHING",
    [ticker],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getBadTickers(): Promise<string[]> {
  const res = await query<{ ticker: string }>("SELECT ticker FROM bad_tickers ORDER BY ticker");
  return res.rows.map((r) => r.ticker);
}

export async function isBadTicker(ticker: string): Promise<boolean> {
  const res = await query<{ count: string }>(
    "SELECT count(*) FROM bad_tickers WHERE ticker = $1",
    [ticker],
  );
  return parseInt(res.rows[0].count, 10) > 0;
}

/** Remove price rows (e.g. after quarantining tickers). Returns rows deleted. */
export async function deletePricesByTickers(tickers: string[]): Promise<number> {
  if (tickers.length === 0) return 0;
  const norm = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (norm.length === 0) return 0;
  const res = await query("DELETE FROM prices WHERE ticker = ANY($1::text[])", [norm]);
  return res.rowCount ?? 0;
}

// --------------- Runs ---------------

export interface RunRow {
  id: number;
  phase: string;
  team_id: string | null;
  strategy: string | null;
  submit_return_pct: number | null;
  projected_value: number | null;
  projected_return: number | null;
  actual_value: number | null;
  actual_invested: number | null;
  rank: number | null;
  leaderboard_rows: number | null;
  gap_to_first_pp: number | null;
  top_return_pct: number | null;
  our_return_pct: number | null;
  bad_ticker_count: number | null;
  price_db_count: number | null;
  harvest_new_prices: number | null;
  harvest_elapsed_s: number | null;
  error_message: string | null;
  note: string | null;
  created_at: string;
}

export interface InsertRun {
  phase: string;
  team_id?: string | null;
  strategy?: string | null;
  submit_return_pct?: number | null;
  projected_value?: number | null;
  projected_return?: number | null;
  actual_value?: number | null;
  actual_invested?: number | null;
  rank?: number | null;
  leaderboard_rows?: number | null;
  gap_to_first_pp?: number | null;
  top_return_pct?: number | null;
  our_return_pct?: number | null;
  bad_ticker_count?: number | null;
  price_db_count?: number | null;
  harvest_new_prices?: number | null;
  harvest_elapsed_s?: number | null;
  error_message?: string | null;
  note?: string | null;
}

export async function insertRun(run: InsertRun): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO runs (phase, team_id, strategy, submit_return_pct, projected_value,
     projected_return, actual_value, actual_invested, rank, leaderboard_rows,
     gap_to_first_pp, top_return_pct, our_return_pct, bad_ticker_count,
     price_db_count, harvest_new_prices, harvest_elapsed_s, error_message, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      run.phase,
      run.team_id ?? null,
      run.strategy ?? null,
      run.submit_return_pct ?? null,
      run.projected_value ?? null,
      run.projected_return ?? null,
      run.actual_value ?? null,
      run.actual_invested ?? null,
      run.rank ?? null,
      run.leaderboard_rows ?? null,
      run.gap_to_first_pp ?? null,
      run.top_return_pct ?? null,
      run.our_return_pct ?? null,
      run.bad_ticker_count ?? null,
      run.price_db_count ?? null,
      run.harvest_new_prices ?? null,
      run.harvest_elapsed_s ?? null,
      run.error_message ?? null,
      run.note ?? null,
    ],
  );
  return res.rows[0].id;
}

export async function insertRunHoldings(
  runId: number,
  holdings: Array<{ ticker: string; amount: number }>,
): Promise<void> {
  if (holdings.length === 0) return;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const h of holdings) {
      await client.query(
        "INSERT INTO run_holdings (run_id, ticker, amount) VALUES ($1, $2, $3)",
        [runId, h.ticker, h.amount],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getLatestRuns(limit = 20): Promise<RunRow[]> {
  const res = await query<RunRow>(
    "SELECT * FROM runs ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return res.rows;
}

export async function getRunHoldings(
  runId: number,
): Promise<Array<{ ticker: string; amount: number }>> {
  const res = await query<{ ticker: string; amount: number }>(
    "SELECT ticker, amount FROM run_holdings WHERE run_id = $1 ORDER BY amount DESC",
    [runId],
  );
  return res.rows;
}

// --------------- Cleanup ---------------

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

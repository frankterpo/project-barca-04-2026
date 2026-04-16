-- Prices: one row per ticker, upserted by the harvester
CREATE TABLE IF NOT EXISTS prices (
  ticker        TEXT PRIMARY KEY,
  purchase_price DOUBLE PRECISION,
  eval_price     DOUBLE PRECISION,
  return_pct     DOUBLE PRECISION,
  harvested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bad tickers: tickers the Cala API rejects
CREATE TABLE IF NOT EXISTS bad_tickers (
  ticker    TEXT PRIMARY KEY,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Runs: one row per harvester/optimizer/leaderboard invocation
CREATE TABLE IF NOT EXISTS runs (
  id                  SERIAL PRIMARY KEY,
  phase               TEXT NOT NULL,
  team_id             TEXT,
  strategy            TEXT,
  submit_return_pct   DOUBLE PRECISION,
  projected_value     DOUBLE PRECISION,
  projected_return    DOUBLE PRECISION,
  actual_value        DOUBLE PRECISION,
  actual_invested     DOUBLE PRECISION,
  rank                INTEGER,
  leaderboard_rows    INTEGER,
  gap_to_first_pp     DOUBLE PRECISION,
  top_return_pct      DOUBLE PRECISION,
  our_return_pct      DOUBLE PRECISION,
  bad_ticker_count    INTEGER,
  price_db_count      INTEGER,
  harvest_new_prices  INTEGER,
  harvest_elapsed_s   DOUBLE PRECISION,
  error_message       TEXT,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Run holdings: per-ticker allocation for a given run
CREATE TABLE IF NOT EXISTS run_holdings (
  id      SERIAL PRIMARY KEY,
  run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ticker  TEXT NOT NULL,
  amount  DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_holdings_run_id ON run_holdings(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prices_return_pct ON prices(return_pct DESC NULLS LAST);

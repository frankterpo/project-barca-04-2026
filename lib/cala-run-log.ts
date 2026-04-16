import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

/** One JSON line per run for dashboards and iteration tracking.
 *
 * Phases: `harvest` | `optimize_*` | `leaderboard` | `research_*`.
 * Example: `jq 'select(.phase|startswith("research"))' data/cala-run-log.jsonl`
 */
export type CalaRunPhase =
  | "harvest"
  | "optimize_dry_run"
  | "optimize_submit"
  | "optimize_submit_blocked"
  | "optimize_submit_failed"
  | "optimize_submit_leaderboard_reconcile"
  | "leaderboard"
  | "research_submit"
  | "research_submit_failed";

export interface CalaRunLogEntry {
  phase: CalaRunPhase;
  team_id?: string | null;
  best_strategy?: string;
  /** Research agent `model_agent_version` when phase is research_* */
  model_agent_version?: string;
  dry_run?: boolean;
  /** Live submit or leaderboard row return % */
  submit_return_pct?: number | null;
  projected_value_usd?: number | null;
  projected_return_pct?: number | null;
  actual_total_value_usd?: number | null;
  actual_invested_usd?: number | null;
  rank?: number | null;
  leaderboard_rows?: number | null;
  gap_to_first_pp?: number | null;
  top_return_pct?: number | null;
  our_return_pct?: number | null;
  /** e.g. leaderboard team slug for the benchmark row */
  benchmark_team_id?: string | null;
  benchmark_return_pct?: number | null;
  gap_to_benchmark_pp?: number | null;
  bad_ticker_count?: number;
  price_db_count?: number;
  harvest_new_prices?: number;
  harvest_elapsed_s?: number;
  /** Convex / HTTP error text (optimize/research failures) */
  error_message?: string;
  /** After optimize_submit: row return % from fetched leaderboard vs submit_return_pct */
  leaderboard_return_pct?: number | null;
  drift_pp?: number | null;
  leaderboard_url?: string | null;
  note?: string;
  team_found_on_board?: boolean;
  leaderboard_row_snapshot?: {
    return_pct?: number | null;
    total_value?: number | null;
    total_invested?: number | null;
  } | null;
}

export function calaRunLoggingEnabled(): boolean {
  return process.env.CALA_RUN_LOG !== "0";
}

function isRunLogEntry(x: unknown): x is CalaRunLogEntry {
  return (
    x !== null &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    "phase" in x &&
    typeof (x as CalaRunLogEntry).phase === "string"
  );
}

export type AppendCalaRunLogOptions = {
  /** Stored in `run_holdings` when phase is `optimize_submit` and Supabase sync is enabled. */
  holdings?: Array<{ ticker: string; amount: number }>;
};

/** Append one line to `dataDir/cala-run-log.jsonl`. Never throws.
 * When `SUPABASE_CONNECTION` is set and `CALA_SUPABASE_SYNC` is not `0`, also inserts into `runs` (+ holdings for optimize submits).
 */
export function appendCalaRunLog(
  dataDir: string,
  entry: CalaRunLogEntry,
  options?: AppendCalaRunLogOptions,
): void {
  if (!calaRunLoggingEnabled()) {
    if (process.env.CALA_SUPABASE_SYNC !== "0" && isRunLogEntry(entry)) {
      void import("./cala-supabase-sync").then(({ persistCalaRunToSupabase }) =>
        persistCalaRunToSupabase(entry, options?.holdings),
      );
    }
    return;
  }
  if (typeof dataDir !== "string" || dataDir.length === 0 || !isRunLogEntry(entry)) {
    return;
  }
  try {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const logFile = join(dataDir, "cala-run-log.jsonl");
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    appendFileSync(logFile, line, "utf8");
  } catch {
    /* never break harvest / optimize */
  }
  if (process.env.CALA_SUPABASE_SYNC !== "0") {
    void import("./cala-supabase-sync").then(({ persistCalaRunToSupabase }) =>
      persistCalaRunToSupabase(entry, options?.holdings),
    );
  }
}

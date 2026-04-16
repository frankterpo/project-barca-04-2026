/**
 * Try multiple leaderboard URLs until one returns a JSON array scoreboard.
 * See CALA_LEADERBOARD_URL / CALA_LEADERBOARD_URLS in .env.example.
 */

import { calaConvexQueryUrl, calaLeaderboardUrlCandidates } from "./convex-endpoints";
import { DEFAULT_CONVEX_FETCH_MS, fetchConvexEndpointJson } from "./convex-http";

const INITIAL_INVESTMENT = 1_000_000;

/** Map Convex `submissions:leaderboard` rows to the normalized shape used by scripts and UI. */
function mapConvexLeaderboardValue(value: unknown[]): Record<string, unknown>[] {
  return value.map((raw) => {
    const r = raw as Record<string, unknown>;
    const invested = typeof r.totalInvested === "number" ? r.totalInvested : INITIAL_INVESTMENT;
    const tv = typeof r.totalValue === "number" ? r.totalValue : invested;
    const return_pct = invested > 0 ? ((tv - invested) / invested) * 100 : 0;
    return {
      team_id: r.teamSlug ?? r.teamName ?? "unknown",
      team_name: r.teamName ?? r.teamSlug ?? "unknown",
      model_agent_version: r.modelAgentVersion ?? "—",
      num_transactions: r.transactionCount ?? 0,
      total_value: tv,
      return_pct,
      is_baseline: r.isBaseline ?? false,
      submitted_at: r.submittedAt ?? null,
      logo_url: r.teamLogoUrl ?? null,
    };
  });
}

async function fetchLeaderboardViaConvexQuery(
  timeoutMs: number,
): Promise<{ url: string; rows: Record<string, unknown>[] }> {
  const url = calaConvexQueryUrl();
  const data = await fetchConvexEndpointJson<{
    status?: string;
    value?: unknown;
    errorMessage?: string;
  }>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ path: "submissions:leaderboard", args: {} }),
    },
    timeoutMs,
  );
  if (data.status === "success" && Array.isArray(data.value) && data.value.length > 0) {
    return { url, rows: mapConvexLeaderboardValue(data.value) };
  }
  const detail =
    data.status === "error" && typeof data.errorMessage === "string"
      ? data.errorMessage
      : "response was not success with non-empty array";
  throw new Error(detail);
}

/** Normalize return % from a leaderboard row (supports return_pct or total_value vs $1M baseline). */
function rowTotalInvested(row: Record<string, unknown>): number | null {
  const a = row.total_invested;
  const b = row.totalInvested;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  if (typeof b === "number" && Number.isFinite(b)) return b;
  return null;
}

export function leaderboardRowReturnPct(row: Record<string, unknown>): number | null {
  if (typeof row.return_pct === "number" && Number.isFinite(row.return_pct)) return row.return_pct;
  if (typeof row.total_value === "number" && Number.isFinite(row.total_value)) {
    const invested = rowTotalInvested(row) ?? INITIAL_INVESTMENT;
    if (invested === 0) return null;
    return (((row.total_value as number) - invested) / invested) * 100;
  }
  return null;
}

/** Stable team key for matching `CALA_TEAM_ID` to leaderboard rows (handles number vs string). */
export function leaderboardRowTeamId(row: Record<string, unknown>): string {
  return String(row.team_id ?? row.team ?? "");
}

/** Rows with a computable return %, sorted best → worst (for rank / gap metrics). */
export interface LeaderboardRowWithPct {
  row: Record<string, unknown>;
  pct: number;
}

export interface LeaderboardTeamSummary {
  enriched: LeaderboardRowWithPct[];
  ourRank: number | null;
  ourReturnPct: number | null;
  topReturnPct: number | null;
  gapToFirstPp: number | null;
  benchmarkTeamId: string | null;
  benchmarkReturnPct: number | null;
  gapToBenchmarkPp: number | null;
}

const DEFAULT_BENCHMARK_TEAM = "sourish";

/**
 * Scoreboard analytics: rank, gap vs #1, optional benchmark row (default team id "sourish").
 * Uses the same return rules as `leaderboardRowReturnPct`.
 */
export function summarizeLeaderboardForTeam(
  rows: Record<string, unknown>[],
  teamId: string | null | undefined,
  opts?: { benchmarkTeamId?: string },
): LeaderboardTeamSummary {
  const benchmarkSlug = (opts?.benchmarkTeamId ?? DEFAULT_BENCHMARK_TEAM).toLowerCase();
  const enriched = rows
    .map((row) => ({ row, pct: leaderboardRowReturnPct(row) }))
    .filter((x): x is LeaderboardRowWithPct => x.pct !== null)
    .sort((a, b) => b.pct - a.pct);

  const topReturnPct = enriched[0]?.pct ?? null;
  let ourRank: number | null = null;
  let ourReturnPct: number | null = null;
  const tid = teamId?.trim();
  if (tid) {
    const idx = enriched.findIndex((x) => leaderboardRowTeamId(x.row) === tid);
    if (idx >= 0) {
      ourRank = idx + 1;
      ourReturnPct = enriched[idx]!.pct;
    }
  }
  const gapToFirstPp =
    topReturnPct != null && ourReturnPct != null ? topReturnPct - ourReturnPct : null;

  const benchRow = enriched.find(
    (x) => leaderboardRowTeamId(x.row).toLowerCase() === benchmarkSlug,
  );
  const benchmarkReturnPct = benchRow?.pct ?? null;
  const benchmarkTeamId = benchRow ? leaderboardRowTeamId(benchRow.row) : null;
  const gapToBenchmarkPp =
    benchmarkReturnPct != null && ourReturnPct != null
      ? benchmarkReturnPct - ourReturnPct
      : null;

  return {
    enriched,
    ourRank,
    ourReturnPct,
    topReturnPct,
    gapToFirstPp,
    benchmarkTeamId,
    benchmarkReturnPct,
    gapToBenchmarkPp,
  };
}

function rowLooksLikeLeaderboard(o: Record<string, unknown>): boolean {
  return (
    "return_pct" in o ||
    "team_id" in o ||
    "total_value" in o ||
    "model_agent_version" in o ||
    "teamSlug" in o ||
    "teamName" in o
  );
}

function isLeaderboardArray(data: unknown): data is Record<string, unknown>[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const row = data[0];
  if (typeof row !== "object" || row === null) return false;
  return rowLooksLikeLeaderboard(row as Record<string, unknown>);
}

function extractRowsFromKeyedArray(
  o: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | null {
  const arr = o[key];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (typeof first !== "object" || first === null) return null;
  if (!rowLooksLikeLeaderboard(first as Record<string, unknown>)) return null;
  return arr as Record<string, unknown>[];
}

/**
 * Accept a raw array, or `{ rows }` / `{ ok?, rows }`, or Convex-style `{ value: [...] }`, or `{ page: [...] }`.
 */
export function extractLeaderboardRowsFromJson(data: unknown): Record<string, unknown>[] | null {
  if (isLeaderboardArray(data)) return data;
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  const fromRows = extractRowsFromKeyedArray(o, "rows");
  if (fromRows) return fromRows;
  const fromValue = extractRowsFromKeyedArray(o, "value");
  if (fromValue) return fromValue;
  const fromPage = extractRowsFromKeyedArray(o, "page");
  if (fromPage) return fromPage;
  return null;
}

/** Throws with a per-URL error trail if nothing works. */
export async function fetchCalaLeaderboardRows(
  timeoutMs = DEFAULT_CONVEX_FETCH_MS,
): Promise<{ url: string; rows: Record<string, unknown>[] }> {
  const errors: string[] = [];
  for (const url of calaLeaderboardUrlCandidates()) {
    try {
      const data = await fetchConvexEndpointJson<unknown>(
        url,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
      );
      const rows = extractLeaderboardRowsFromJson(data);
      if (rows) {
        return { url, rows };
      }
      errors.push(`${url}: response was not a recognizable leaderboard payload`);
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const queryUrl = calaConvexQueryUrl();
  try {
    return await fetchLeaderboardViaConvexQuery(timeoutMs);
  } catch (e) {
    errors.push(
      `${queryUrl} (POST submissions:leaderboard): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  throw new Error(
    `Cala leaderboard: no working JSON endpoint.\n${errors.map((l) => `  • ${l}`).join("\n")}`,
  );
}

/** Same as fetchCalaLeaderboardRows but returns null when all candidates fail. */
export async function tryFetchCalaLeaderboardRows(
  timeoutMs = DEFAULT_CONVEX_FETCH_MS,
): Promise<{ url: string; rows: Record<string, unknown>[] } | null> {
  try {
    return await fetchCalaLeaderboardRows(timeoutMs);
  } catch {
    return null;
  }
}

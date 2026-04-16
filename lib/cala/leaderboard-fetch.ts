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
export function leaderboardRowReturnPct(row: Record<string, unknown>): number | null {
  if (typeof row.return_pct === "number") return row.return_pct;
  if (typeof row.total_value === "number") {
    return ((row.total_value as number) - 1_000_000) / 1_000_000 * 100;
  }
  return null;
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

/**
 * Accept a raw array, or Next `/api/leaderboard` shape `{ ok?, rows }`, or any object with `rows` array.
 */
function extractLeaderboardRowsFromJson(data: unknown): Record<string, unknown>[] | null {
  if (isLeaderboardArray(data)) return data;
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  if (typeof first !== "object" || first === null) return null;
  if (!rowLooksLikeLeaderboard(first as Record<string, unknown>)) return null;
  return rows as Record<string, unknown>[];
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

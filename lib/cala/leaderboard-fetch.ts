/**
 * Try multiple leaderboard URLs until one returns a JSON array scoreboard.
 * See CALA_LEADERBOARD_URL / CALA_LEADERBOARD_URLS in .env.example.
 */

import { calaLeaderboardUrlCandidates } from "./convex-endpoints";
import { DEFAULT_CONVEX_FETCH_MS, fetchConvexEndpointJson } from "./convex-http";

/** Normalize return % from a leaderboard row (supports return_pct or total_value vs $1M baseline). */
export function leaderboardRowReturnPct(row: Record<string, unknown>): number | null {
  if (typeof row.return_pct === "number") return row.return_pct;
  if (typeof row.total_value === "number") {
    return ((row.total_value as number) - 1_000_000) / 1_000_000 * 100;
  }
  return null;
}

function isLeaderboardArray(data: unknown): data is Record<string, unknown>[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const row = data[0];
  if (typeof row !== "object" || row === null) return false;
  const o = row as Record<string, unknown>;
  return (
    "return_pct" in o ||
    "team_id" in o ||
    "total_value" in o ||
    "model_agent_version" in o
  );
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
      if (isLeaderboardArray(data)) {
        return { url, rows: data };
      }
      errors.push(`${url}: response was not a non-empty leaderboard array`);
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
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

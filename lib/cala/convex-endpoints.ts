/**
 * Cala competition scoreboard + submit endpoints (Convex-hosted in this project).
 * Override via env when routes move — keeps leaderboard and submit on the same deployment.
 */

const DEFAULT_ORIGIN = "https://different-cormorant-663.convex.site";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Ordered list of URLs to try for GET leaderboard JSON.
 * Order: explicit env → /api/leaderboard on same host as dashboard URL → same for submit URL →
 * CALA_LEADERBOARD_URLS extras → default Convex deployment.
 */
export function calaLeaderboardUrlCandidates(): string[] {
  const out: string[] = [];
  const add = (raw?: string | null) => {
    if (!raw?.trim()) return;
    const s = trimTrailingSlash(raw.trim());
    if (!out.includes(s)) out.push(s);
  };

  const lb = process.env.CALA_LEADERBOARD_URL?.trim();
  if (lb) {
    add(lb);
    try {
      const u = new URL(lb);
      const p = u.pathname.replace(/\/$/, "") || "/";
      // Dashboard or marketing root: also try Convex-style JSON route on that host.
      if (p === "/" || (!p.includes("/api/") && !p.toLowerCase().includes("leaderboard"))) {
        add(trimTrailingSlash(new URL("/api/leaderboard", u.origin).href));
      }
    } catch {
      /* ignore invalid CALA_LEADERBOARD_URL */
    }
  }

  const submit = process.env.CALA_SUBMIT_URL?.trim();
  if (submit) {
    try {
      const u = new URL(submit);
      add(trimTrailingSlash(new URL("/api/leaderboard", u.origin).href));
    } catch {
      /* ignore */
    }
  }

  const extras = process.env.CALA_LEADERBOARD_URLS?.split(/[\s,]+/).filter(Boolean) ?? [];
  for (const e of extras) add(e);

  add(trimTrailingSlash(`${DEFAULT_ORIGIN}/api/leaderboard`));

  return out;
}

/** Primary URL for display / backward compatibility (first candidate). */
export function calaLeaderboardUrl(): string {
  const c = calaLeaderboardUrlCandidates();
  return c[0] ?? trimTrailingSlash(`${DEFAULT_ORIGIN}/api/leaderboard`);
}

/** Portfolio submission endpoint — same deployment as leaderboard when only env base is set. */
export function calaSubmitUrl(): string {
  const explicit = process.env.CALA_SUBMIT_URL?.trim();
  if (explicit) return trimTrailingSlash(explicit);
  const lb = process.env.CALA_LEADERBOARD_URL?.trim();
  if (lb) {
    try {
      const u = new URL(lb);
      u.pathname = "/api/submit";
      u.search = "";
      u.hash = "";
      return trimTrailingSlash(u.toString());
    } catch {
      /* fall through */
    }
  }
  return trimTrailingSlash(`${DEFAULT_ORIGIN}/api/submit`);
}

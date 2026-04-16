/**
 * Resolve Cala Convex HTTP endpoints for submit + leaderboard.
 * See docs/OPERATOR.md: CALA_SUBMIT_URL, CALA_LEADERBOARD_URL, CALA_LEADERBOARD_URLS.
 */

const DEFAULT_CONVEX_ORIGIN = "https://different-cormorant-663.convex.site";
const DEFAULT_CONVEX_QUERY_URL = "https://different-cormorant-663.convex.cloud/api/query";

function trimEnv(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** Accept host-only values from env. */
function ensureAbsoluteUrl(raw: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function parseUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * From a leaderboard env value (full JSON URL, or site root), produce URL(s) to try.
 * Site root → `${origin}/api/leaderboard` only.
 */
function expandLeaderboardInput(raw: string): string[] {
  const u = ensureAbsoluteUrl(raw);
  try {
    const parsed = new URL(u);
    const path = (parsed.pathname || "/").replace(/\/$/, "") || "/";
    if (path.includes("/api/leaderboard") || path.endsWith("/leaderboard")) {
      return [parsed.toString()];
    }
    if (path === "" || path === "/") {
      return [`${parsed.origin}/api/leaderboard`];
    }
    return [parsed.toString(), `${parsed.origin}/api/leaderboard`];
  } catch {
    return [u];
  }
}

export function calaSubmitUrl(): string {
  const env = trimEnv(process.env.CALA_SUBMIT_URL);
  if (env) return ensureAbsoluteUrl(env);
  return `${DEFAULT_CONVEX_ORIGIN}/api/submit`;
}

/** First preferred leaderboard URL (for callers that need a single string). */
export function calaLeaderboardUrl(): string {
  const candidates = calaLeaderboardUrlCandidates();
  return candidates[0] ?? `${DEFAULT_CONVEX_ORIGIN}/api/leaderboard`;
}

/**
 * Order matches docs/OPERATOR.md:
 * 1) CALA_LEADERBOARD_URL (expanded)
 * 2) origin /api/leaderboard from CALA_SUBMIT_URL
 * 3) each entry in CALA_LEADERBOARD_URLS (expanded)
 * 4) default Convex deployment
 */
export function calaLeaderboardUrlCandidates(): string[] {
  const out: string[] = [];
  const push = (url: string) => {
    const n = url.trim();
    if (!n || out.includes(n)) return;
    out.push(n);
  };

  const lb = trimEnv(process.env.CALA_LEADERBOARD_URL);
  if (lb) {
    for (const u of expandLeaderboardInput(lb)) push(u);
  }

  try {
    push(`${new URL(calaSubmitUrl()).origin}/api/leaderboard`);
  } catch {
    /* ignore malformed CALA_SUBMIT_URL */
  }

  for (const raw of parseUrlList(process.env.CALA_LEADERBOARD_URLS)) {
    for (const u of expandLeaderboardInput(raw)) push(u);
  }

  push(`${DEFAULT_CONVEX_ORIGIN}/api/leaderboard`);

  return out;
}

function convexSiteOriginToQueryUrl(siteOrigin: string): string | null {
  try {
    const parsed = new URL(ensureAbsoluteUrl(siteOrigin));
    if (!/\.convex\.site$/i.test(parsed.hostname)) return null;
    const cloudHost = parsed.hostname.replace(/\.convex\.site$/i, ".convex.cloud");
    return `https://${cloudHost}/api/query`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Convex `POST …/api/query` URL (e.g. internal `submissions:leaderboard` used by Next `/api/leaderboard`).
 * Override with `CALA_CONVEX_QUERY_URL` when the deployment changes; otherwise derived from
 * `CALA_SUBMIT_URL` / `CALA_LEADERBOARD_URL` by mapping `.convex.site` → `.convex.cloud`.
 */
export function calaConvexQueryUrl(): string {
  const explicit = trimEnv(process.env.CALA_CONVEX_QUERY_URL);
  if (explicit) return ensureAbsoluteUrl(explicit).replace(/\/$/, "");
  const submit = trimEnv(process.env.CALA_SUBMIT_URL);
  if (submit) {
    try {
      const u = new URL(ensureAbsoluteUrl(submit));
      if (/\.convex\.cloud$/i.test(u.hostname)) {
        return new URL("/api/query", `${u.protocol}//${u.hostname}`).href.replace(/\/$/, "");
      }
      const mapped = convexSiteOriginToQueryUrl(u.origin);
      if (mapped) return mapped;
    } catch {
      /* fall through */
    }
  }
  const lb = trimEnv(process.env.CALA_LEADERBOARD_URL);
  if (lb) {
    try {
      const mapped = convexSiteOriginToQueryUrl(new URL(ensureAbsoluteUrl(lb)).origin);
      if (mapped) return mapped;
    } catch {
      /* fall through */
    }
  }
  return convexSiteOriginToQueryUrl(DEFAULT_CONVEX_ORIGIN) ?? DEFAULT_CONVEX_QUERY_URL;
}

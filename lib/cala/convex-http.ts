/**
 * Convex HTTP helpers for Cala leaderboard + submit endpoints.
 * Some gateways/proxies return extra bytes before/after JSON or duplicate values; res.json() then throws
 * "Unexpected non-whitespace character after JSON at position N".
 */

export const DEFAULT_CONVEX_FETCH_MS = 120_000;

/** Strip BOM, trim; parse full body or first top-level `{...}` / `[...]` slice. */
export function parseLenientJson(text: string): unknown {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (t.length === 0) throw new Error("Empty response body");
  const head = t.slice(0, 64).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) {
    throw new Error(`Response is HTML, not JSON (prefix): ${t.slice(0, 120).replace(/\s+/g, " ")}`);
  }
  try {
    return JSON.parse(t);
  } catch {
    let from = 0;
    let lastParseErr: unknown = null;
    while (from < t.length) {
      const found = extractFirstJsonValue(t, from);
      if (found === null) break;
      const { slice, start } = found;
      try {
        return JSON.parse(slice);
      } catch (e) {
        lastParseErr = e;
        // Same opening `{`/`[` can yield a syntactic "balanced" slice that isn't valid JSON
        // (e.g. braces inside unquoted tokens). Skip it and try the next top-level value.
        from = start + 1;
      }
    }
    const hint =
      lastParseErr instanceof Error ? lastParseErr.message : lastParseErr != null ? String(lastParseErr) : "";
    throw new Error(
      `Invalid JSON (prefix): ${t.slice(0, 160).replace(/\s+/g, " ")}${hint ? ` | ${hint}` : ""}`,
    );
  }
}

function extractFirstJsonValue(s: string, fromIndex: number): { slice: string; start: number } | null {
  const startObj = s.indexOf("{", fromIndex);
  const startArr = s.indexOf("[", fromIndex);
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start === -1) return null;

  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return { slice: s.slice(start, i + 1), start };
    }
  }
  return null;
}

export async function fetchConvexEndpointJson<T>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data: unknown;
    try {
      data = parseLenientJson(text);
    } catch (parseErr) {
      const ct = res.headers.get("content-type") ?? "?";
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(
        `${msg} | HTTP ${res.status} content-type=${ct} url=${url} body=${JSON.stringify(text.slice(0, 240))}`,
      );
    }
    if (!res.ok) {
      const detail =
        typeof data === "object" && data !== null ? JSON.stringify(data) : String(data);
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

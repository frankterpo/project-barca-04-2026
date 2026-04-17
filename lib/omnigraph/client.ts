import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_URL = "http://127.0.0.1:8080";
const DEFAULT_BRANCH = "main";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 2;

const QUERY_FILE = join(process.cwd(), "graph", "queries.gq");

export interface OmnigraphClientOptions {
  url?: string;
  bearerToken?: string;
  branch?: string;
  timeoutMs?: number;
  retries?: number;
}

export class OmnigraphClient {
  private readonly url: string;
  private readonly bearerToken: string | undefined;
  private readonly branch: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private querySourceCache: string | null = null;

  constructor(opts?: OmnigraphClientOptions) {
    this.url = (
      opts?.url ??
      process.env.OMNIGRAPH_URL ??
      DEFAULT_URL
    ).replace(/\/$/, "");
    this.bearerToken =
      opts?.bearerToken ?? process.env.OMNIGRAPH_BEARER_TOKEN ?? undefined;
    this.branch = opts?.branch ?? DEFAULT_BRANCH;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = opts?.retries ?? DEFAULT_RETRIES;
  }

  private getQuerySource(): string {
    if (!this.querySourceCache) {
      this.querySourceCache = readFileSync(QUERY_FILE, "utf-8");
    }
    return this.querySourceCache;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.bearerToken) {
      h["Authorization"] = `Bearer ${this.bearerToken}`;
    }
    return h;
  }

  private async fetchWithRetry(
    endpoint: string,
    body: Record<string, unknown>,
    label: string,
  ): Promise<Response> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(`${this.url}${endpoint}`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new OmnigraphError(`${label} failed: ${res.status}`, res.status, text);
        }
        return res;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retries) {
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        }
      }
    }
    throw lastErr!;
  }

  /**
   * Execute a named read query defined in graph/queries.gq.
   * Returns the parsed JSON response from omnigraph-server.
   */
  async read<T = OmnigraphReadResult>(
    queryName: string,
    params?: Record<string, unknown>,
    opts?: { branch?: string },
  ): Promise<T> {
    const body: Record<string, unknown> = {
      query_source: this.getQuerySource(),
      query_name: queryName,
      branch: opts?.branch ?? this.branch,
    };
    if (params && Object.keys(params).length > 0) {
      body.params = params;
    }
    const res = await this.fetchWithRetry("/read", body, `read ${queryName}`);
    return (await res.json()) as T;
  }

  /**
   * Execute a named mutation query (insert/update/delete).
   */
  async change(
    queryName: string,
    params?: Record<string, unknown>,
    opts?: { branch?: string },
  ): Promise<OmnigraphChangeResult> {
    const body: Record<string, unknown> = {
      query_source: this.getQuerySource(),
      query_name: queryName,
      branch: opts?.branch ?? this.branch,
    };
    if (params && Object.keys(params).length > 0) {
      body.params = params;
    }
    const res = await this.fetchWithRetry("/change", body, `change ${queryName}`);
    return (await res.json()) as OmnigraphChangeResult;
  }

  /** Health check — omnigraph-server exposes GET /healthz. */
  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/healthz`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── result types ───────────────────────────────────────────────

export interface OmnigraphReadResult {
  query_name: string;
  target: { branch: string; snapshot: number | null };
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface OmnigraphChangeResult {
  query_name: string;
  branch: string;
  [key: string]: unknown;
}

// ── errors ─────────────────────────────────────────────────────

export class OmnigraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "OmnigraphError";
  }
}

// ── singleton ──────────────────────────────────────────────────

let _instance: OmnigraphClient | null = null;

/**
 * Returns the shared OmnigraphClient singleton.
 * The first call that provides `opts` sets the singleton config.
 * Subsequent calls ignore `opts` and return the existing instance.
 */
export function getOmnigraphClient(
  opts?: OmnigraphClientOptions,
): OmnigraphClient {
  if (!_instance) {
    _instance = new OmnigraphClient(opts);
  }
  return _instance;
}

/**
 * One-off health probe — creates an ephemeral client so the singleton
 * isn't poisoned with restrictive timeout / 0-retry settings.
 */
export async function probeOmnigraphHealth(
  opts?: OmnigraphClientOptions,
): Promise<boolean> {
  try {
    return await new OmnigraphClient(opts).healthy();
  } catch {
    return false;
  }
}

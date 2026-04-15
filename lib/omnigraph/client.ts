import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_URL = "http://127.0.0.1:8080";
const DEFAULT_BRANCH = "main";

const QUERY_FILE = join(process.cwd(), "graph", "queries.gq");

export interface OmnigraphClientOptions {
  url?: string;
  bearerToken?: string;
  branch?: string;
}

export class OmnigraphClient {
  private readonly url: string;
  private readonly bearerToken: string | undefined;
  private readonly branch: string;
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
    const res = await fetch(`${this.url}/read`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OmnigraphError(
        `read ${queryName} failed: ${res.status}`,
        res.status,
        text,
      );
    }
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
    const res = await fetch(`${this.url}/change`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OmnigraphError(
        `change ${queryName} failed: ${res.status}`,
        res.status,
        text,
      );
    }
    return (await res.json()) as OmnigraphChangeResult;
  }

  /** Health check — omnigraph-server exposes GET /healthz. */
  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/healthz`, {
        method: "GET",
        headers: this.headers(),
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

export function getOmnigraphClient(
  opts?: OmnigraphClientOptions,
): OmnigraphClient {
  if (!_instance) {
    _instance = new OmnigraphClient(opts);
  }
  return _instance;
}

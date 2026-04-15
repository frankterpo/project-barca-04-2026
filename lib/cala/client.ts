import {
  entitySearchResponseSchema,
  queryResponseSchema,
  searchResponseSchema,
  type CalaEntityProfile,
  type CalaEntitySearchResponse,
  type CalaEntityType,
  type CalaIntrospection,
  type CalaQueryResponse,
  type CalaSearchResponse,
} from "./schemas";
import { requireCalaTeamId } from "./team-id";

const DEFAULT_BASE_URL = "https://api.cala.ai";

function env(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export interface CalaClientOptions {
  baseUrl?: string;
  apiKey?: string;
  teamId?: string;
}

export interface EntityProjection {
  numerical_observations?: Record<string, string[]>;
  properties?: string[];
  relationships?: {
    incoming?: Record<string, { limit?: number }>;
    outgoing?: Record<string, { limit?: number }>;
  };
}

export class CalaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly teamId: string;

  constructor(opts?: CalaClientOptions) {
    this.baseUrl = (opts?.baseUrl ?? process.env.CALA_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.apiKey = opts?.apiKey ?? env("CALA_API_KEY");
    this.teamId = opts?.teamId ?? requireCalaTeamId();
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts?: { body?: Record<string, unknown>; params?: Record<string, string> },
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (opts?.params) {
      const qs = new URLSearchParams(opts.params);
      url += `?${qs.toString()}`;
    }

    const headers: Record<string, string> = {
      "X-API-KEY": this.apiKey,
      "Content-Type": "application/json",
    };

    const body =
      method === "POST" && opts?.body
        ? JSON.stringify({ ...opts.body, team_id: this.teamId })
        : undefined;

    const res = await fetch(url, { method, headers, body });

    if (res.status === 429) {
      throw new CalaRateLimitError();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CalaApiError(res.status, text);
    }

    return (await res.json()) as T;
  }

  // ── Knowledge Search (natural language) ──────────────────────────────
  async search(input: string): Promise<CalaSearchResponse> {
    const raw = await this.request<unknown>("POST", "/v1/knowledge/search", {
      body: { input },
    });
    return searchResponseSchema.parse(raw);
  }

  // ── Knowledge Query (structured dot-notation) ────────────────────────
  async query(input: string): Promise<CalaQueryResponse> {
    const raw = await this.request<unknown>("POST", "/v1/knowledge/query", {
      body: { input },
    });
    return queryResponseSchema.parse(raw);
  }

  // ── Entity Search (fuzzy by name) ────────────────────────────────────
  async searchEntities(
    name: string,
    opts?: { entityTypes?: CalaEntityType[]; limit?: number },
  ): Promise<CalaEntitySearchResponse> {
    const params: Record<string, string> = { name };
    if (opts?.limit) params.limit = String(opts.limit);

    let url = `${this.baseUrl}/v1/entities?${new URLSearchParams(params).toString()}`;
    if (opts?.entityTypes?.length) {
      url += opts.entityTypes.map((t) => `&entity_types=${encodeURIComponent(t)}`).join("");
    }

    const res = await fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": this.apiKey },
    });
    if (res.status === 429) throw new CalaRateLimitError();
    if (!res.ok) throw new CalaApiError(res.status, await res.text().catch(() => ""));

    return entitySearchResponseSchema.parse(await res.json());
  }

  // ── Retrieve Entity (full profile by UUID) ───────────────────────────
  async getEntity(entityId: string, projection?: EntityProjection): Promise<CalaEntityProfile> {
    return this.request<CalaEntityProfile>("POST", `/v1/entities/${entityId}`, {
      body: (projection ?? {}) as Record<string, unknown>,
    });
  }

  // ── Entity Introspection (schema discovery) ──────────────────────────
  async introspect(entityId: string): Promise<CalaIntrospection> {
    const url = `${this.baseUrl}/v1/entities/${entityId}/introspection`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": this.apiKey },
    });
    if (res.status === 429) throw new CalaRateLimitError();
    if (!res.ok) throw new CalaApiError(res.status, await res.text().catch(() => ""));
    return (await res.json()) as CalaIntrospection;
  }
}

// ── Error classes ────────────────────────────────────────────────────────

export class CalaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Cala API ${status}: ${body.slice(0, 200)}`);
    this.name = "CalaApiError";
  }
}

export class CalaRateLimitError extends CalaApiError {
  constructor() {
    super(429, "Rate limit exceeded");
    this.name = "CalaRateLimitError";
  }
}

// ── Singleton factory ────────────────────────────────────────────────────

let _instance: CalaClient | null = null;

export function getCalaClient(opts?: CalaClientOptions): CalaClient {
  if (!_instance) {
    _instance = new CalaClient(opts);
  }
  return _instance;
}

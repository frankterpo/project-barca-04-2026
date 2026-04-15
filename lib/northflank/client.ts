import type {
  GetRunOptions,
  JobRunDetail,
  JobRunRef,
  JobRunsPage,
  ListRunsOptions,
  NorthflankClientOptions,
  RunJobOptions,
} from "./types";

const DEFAULT_BASE_URL = "https://api.northflank.com";

export class NorthflankClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts?: NorthflankClientOptions) {
    const key = opts?.apiKey ?? process.env.NORTHFLANK_API_KEY;
    if (!key) {
      throw new NorthflankConfigError(
        "NORTHFLANK_API_KEY is required — set it in .env or pass apiKey",
      );
    }
    this.apiKey = key;
    this.baseUrl = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  /** Start a new run for a pre-configured job. */
  async runJob(opts: RunJobOptions): Promise<JobRunRef> {
    const body: Record<string, unknown> = {};
    if (opts.runtimeEnvironment) body.runtimeEnvironment = opts.runtimeEnvironment;
    if (opts.runtimeFiles) body.runtimeFiles = opts.runtimeFiles;

    const data = await this.post<{ data: JobRunRef }>(
      `/v1/projects/${e(opts.projectId)}/jobs/${e(opts.jobId)}/runs`,
      body,
    );
    return data.data;
  }

  /** Get details about a specific run. */
  async getRunDetail(opts: GetRunOptions): Promise<JobRunDetail> {
    const data = await this.get<{ data: JobRunDetail }>(
      `/v1/projects/${e(opts.projectId)}/jobs/${e(opts.jobId)}/runs/${e(opts.runId)}`,
    );
    return data.data;
  }

  /** List runs for a job (paginated). */
  async listRuns(opts: ListRunsOptions): Promise<JobRunsPage> {
    const qs = new URLSearchParams();
    if (opts.page != null) qs.set("page", String(opts.page));
    if (opts.perPage != null) qs.set("per_page", String(opts.perPage));
    if (opts.cursor) qs.set("cursor", opts.cursor);

    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await this.get<{ data: { runs: JobRunsPage["runs"] }; pagination: JobRunsPage["pagination"] }>(
      `/v1/projects/${e(opts.projectId)}/jobs/${e(opts.jobId)}/runs${suffix}`,
    );
    return { runs: res.data.runs, pagination: res.pagination };
  }

  /** Abort a running job. */
  async abortRun(opts: GetRunOptions): Promise<void> {
    await this.del(
      `/v1/projects/${e(opts.projectId)}/jobs/${e(opts.jobId)}/runs/${e(opts.runId)}`,
    );
  }

  // ── internals ─────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.handleResponse<T>(res, `GET ${path}`);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res, `POST ${path}`);
  }

  private async del(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new NorthflankApiError(`DELETE ${path} failed: ${res.status}`, res.status, text);
    }
  }

  private async handleResponse<T>(res: Response, label: string): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new NorthflankApiError(`${label} failed: ${res.status}`, res.status, text);
    }
    return (await res.json()) as T;
  }
}

function e(segment: string): string {
  return encodeURIComponent(segment);
}

// ── errors ──────────────────────────────────────────────────────

export class NorthflankApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "NorthflankApiError";
  }
}

export class NorthflankConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NorthflankConfigError";
  }
}

// ── singleton ───────────────────────────────────────────────────

let _instance: NorthflankClient | null = null;

export function getNorthflankClient(opts?: NorthflankClientOptions): NorthflankClient {
  if (!_instance) {
    _instance = new NorthflankClient(opts);
  }
  return _instance;
}

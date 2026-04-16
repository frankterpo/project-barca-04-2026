/** Northflank API v1 types for the job-run lifecycle. */

export type JobRunStatus = "SUCCESS" | "RUNNING" | "FAILED";

export interface JobRunRef {
  id: string;
  runName: string;
}

export interface JobRunDetail {
  id: string;
  active: 0 | 1;
  backoffLimit: number;
  completions: number;
  concluded: boolean;
  failed: 0 | 1;
  runName: string;
  status: JobRunStatus;
  succeeded: 0 | 1;
  startedAt: string;
  concludedAt: string;
}

export interface JobRunsPage {
  runs: JobRunDetail[];
  pagination: {
    hasNextPage: boolean;
    cursor?: string;
    count: number;
  };
}

export interface RunJobOptions {
  projectId: string;
  jobId: string;
  runtimeEnvironment?: Record<string, string>;
  runtimeFiles?: Record<string, { data: string; encoding: string }>;
}

export interface GetRunOptions {
  projectId: string;
  jobId: string;
  runId: string;
}

export interface ListRunsOptions {
  projectId: string;
  jobId: string;
  page?: number;
  perPage?: number;
  cursor?: string;
}

export interface NorthflankClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

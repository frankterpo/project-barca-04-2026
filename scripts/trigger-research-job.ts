#!/usr/bin/env npx tsx
/**
 * Trigger the research agent on Northflank and poll until the run finishes.
 *
 * Prerequisites:
 * - NORTHFLANK_API_KEY
 * - NORTHFLANK_PROJECT_ID + NORTHFLANK_RESEARCH_JOB_ID (or legacy NORTHFLANK_JOB_ID)
 *
 * Runtime env vars are passed through to the job (Cala + Omnigraph).
 *
 * Usage:
 *   pnpm agent:run-remote
 *   npx tsx scripts/trigger-research-job.ts --no-wait
 */
import "dotenv/config";

import {
  getNorthflankClient,
  NorthflankApiError,
  NorthflankConfigError,
} from "../lib/northflank";

const POLL_MS = Number(process.env.NORTHFLANK_POLL_MS ?? 8_000);
const MAX_WAIT_MS = Number(process.env.NORTHFLANK_MAX_WAIT_MS ?? 3_600_000);

function runtimeEnvironment(): Record<string, string> | undefined {
  const keys = [
    "CALA_API_KEY",
    "CALA_TEAM_ID",
    "CALA_BASE_URL",
    "CALA_ALLOW_SUBMIT",
    "OMNIGRAPH_URL",
    "OMNIGRAPH_BEARER_TOKEN",
    "CALA_SUPABASE_SYNC",
    "SUPABASE_CONNECTION",
  ] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v != null && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const noWait = process.argv.includes("--no-wait");

  const projectId =
    process.env.NORTHFLANK_PROJECT_ID ?? process.env.NORTHFLANK_PROJECT;
  const jobId =
    process.env.NORTHFLANK_RESEARCH_JOB_ID ??
    process.env.NORTHFLANK_JOB_ID ??
    process.env.NORTHFLANK_RESEARCH_AGENT_JOB_ID;

  if (!projectId || !jobId) {
    console.error(
      "Set NORTHFLANK_PROJECT_ID and NORTHFLANK_RESEARCH_JOB_ID (or NORTHFLANK_JOB_ID).",
    );
    process.exit(1);
  }

  let client;
  try {
    client = getNorthflankClient();
  } catch (e) {
    if (e instanceof NorthflankConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const env = runtimeEnvironment();
  console.log("Starting Northflank run…", { projectId, jobId, keys: env ? Object.keys(env) : [] });
  const ref = await client.runJob({
    projectId,
    jobId,
    runtimeEnvironment: env,
  });
  console.log("Run started:", ref);

  if (noWait) return;

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    const detail = await client.getRunDetail({
      projectId,
      jobId,
      runId: ref.id,
    });
    console.log(
      `[${new Date().toISOString()}] status=${detail.status} concluded=${detail.concluded} active=${detail.active}`,
    );
    if (detail.concluded) {
      if (detail.status === "SUCCESS") {
        console.log("✅ Run succeeded.");
        return;
      }
      console.error("❌ Run failed or ended non-success:", detail);
      process.exit(1);
    }
  }
  console.error("Timed out waiting for run to conclude.");
  process.exit(1);
}

main().catch((err) => {
  if (err instanceof NorthflankApiError) {
    console.error("Northflank API error:", err.status, err.message, err.body);
  } else {
    console.error(err);
  }
  process.exit(1);
});

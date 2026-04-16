/**
 * Lobster IC — Autonomous Runner
 *
 * Runs the research agent in a loop competing on the Cala leaderboard.
 * Hybrid mode: submits only when return beats the leaderboard #1 return and
 * CALA_ALLOW_SUBMIT=1 (explicit operator approval). Use --dry-run to never POST.
 *
 * Usage:
 *   pnpm tsx scripts/autonomous-runner.ts
 *   pnpm tsx scripts/autonomous-runner.ts --dry-run    # score only, no submit
 *   pnpm tsx scripts/autonomous-runner.ts --interval 600  # 10 min between runs
 */

import "dotenv/config";
import {
  calaSubmitUrl,
  DEFAULT_CONVEX_FETCH_MS,
  fetchConvexEndpointJson,
  leaderboardRowReturnPct,
  tryFetchCalaLeaderboardRows,
} from "../lib/cala";
import { runResearchPipeline } from "./research-agent";
import * as fs from "fs";

const STATE_FILE = "data/runner-state.json";
const DEFAULT_INTERVAL_SEC = 900; // 15 minutes between runs

/** Shape of successful Cala submit HTTP JSON (fields vary by backend version). */
interface CalaSubmitResponse {
  submission_id?: string;
  total_value?: number;
  total_invested?: number;
}

interface RunnerState {
  bestReturnPct: number | null;
  bestSubmissionId: string | null;
  bestVersion: string | null;
  totalRuns: number;
  lastRunAt: string | null;
  history: RunRecord[];
}

interface RunRecord {
  version: string;
  returnPct: number | null;
  submitted: boolean;
  submissionId: string | null;
  timestamp: string;
  stockCount: number;
}

function loadState(): RunnerState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return {
    bestReturnPct: null,
    bestSubmissionId: null,
    bestVersion: null,
    totalRuns: 0,
    lastRunAt: null,
    history: [],
  };
}

function saveState(state: RunnerState) {
  if (!fs.existsSync("data")) fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const intervalIdx = args.indexOf("--interval");
  const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : DEFAULT_INTERVAL_SEC;
  const once = args.includes("--once");
  return { dryRun, interval, once };
}

/** Best return on the public leaderboard (current #1 bar to beat). */
async function fetchLeaderboardTopReturn(): Promise<number | null> {
  const got = await tryFetchCalaLeaderboardRows(DEFAULT_CONVEX_FETCH_MS);
  if (!got) return null;
  let top: number | null = null;
  for (const row of got.rows) {
    const p = leaderboardRowReturnPct(row);
    if (p != null && (top === null || p > top)) top = p;
  }
  return top;
}

async function runLoop() {
  const { dryRun, interval, once } = parseArgs();
  const state = loadState();

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  🦞 LOBSTER IC — Autonomous Research Runner      ║");
  console.log(
    "║  Mode: " +
      (dryRun ? "DRY RUN (no submissions)" : "LIVE (submit only if beat #1 + CALA_ALLOW_SUBMIT=1)").padEnd(42) +
      "║"
  );
  console.log("║  Interval: " + `${interval}s`.padEnd(38) + "║");
  console.log("║  Total runs so far: " + `${state.totalRuns}`.padEnd(29) + "║");
  console.log("║  Best return: " + `${state.bestReturnPct !== null ? state.bestReturnPct.toFixed(2) + "%" : "none yet"}`.padEnd(35) + "║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  let runNumber = state.totalRuns;

  while (true) {
    runNumber++;
    const version = `v2.${runNumber}.${Date.now().toString(36)}`;

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Run #${runNumber} — ${new Date().toISOString()}`);
    console.log(`${"═".repeat(60)}`);

    try {
      const result = await runResearchPipeline({ submit: false, version });
      const allocCount = result.allocations.length;

      let submitted = false;
      let submissionId: string | null = null;
      let returnPct: number | null = null;

      if (!dryRun && allocCount >= 50) {
        const allowSubmit = process.env.CALA_ALLOW_SUBMIT === "1";
        if (!allowSubmit) {
          console.log(
            "\n📋 Skipping submission — set CALA_ALLOW_SUBMIT=1 after you explicitly approve real submits."
          );
        } else {
          // Submit to get actual return, then compare against #1
          console.log(`\n📤 Submitting ${allocCount} allocations to get scored return...`);
          const sub = await submitDirectly(result.allocations, version);
          if (sub) {
            submissionId = sub.submission_id || null;
            returnPct =
              sub.total_value && sub.total_invested
                ? ((sub.total_value - sub.total_invested) / sub.total_invested) * 100
                : null;

            if (returnPct !== null) {
              submitted = true;
              console.log(`  Return: ${returnPct > 0 ? "+" : ""}${returnPct.toFixed(2)}%`);

              const topReturn = await fetchLeaderboardTopReturn();
              if (topReturn !== null && returnPct > topReturn) {
                console.log(`  🚀 BEATS leaderboard #1 (${topReturn.toFixed(2)}%)!`);
              } else if (topReturn !== null) {
                console.log(`  📊 Below #1 (${topReturn.toFixed(2)}%) — keep iterating.`);
              }

              if (state.bestReturnPct === null || returnPct > state.bestReturnPct) {
                state.bestReturnPct = returnPct;
                state.bestSubmissionId = submissionId;
                state.bestVersion = version;
                console.log("  🏆 NEW PERSONAL BEST!");
              }
            }
          }
        }
      }

      state.totalRuns = runNumber;
      state.lastRunAt = new Date().toISOString();
      state.history.push({
        version,
        returnPct,
        submitted,
        submissionId,
        timestamp: new Date().toISOString(),
        stockCount: allocCount,
      });

      // Keep last 50 runs in history
      if (state.history.length > 50) {
        state.history = state.history.slice(-50);
      }

      saveState(state);
    } catch (err) {
      console.error(`\n❌ Run #${runNumber} failed:`, (err as Error).message);
      state.totalRuns = runNumber;
      state.lastRunAt = new Date().toISOString();
      saveState(state);
    }

    if (once) {
      console.log("\n✅ Single run complete (--once flag).");
      break;
    }

    console.log(`\n⏰ Next run in ${interval} seconds...`);
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

async function submitDirectly(
  allocations: { ticker: string; amount: number; reasoning: string }[],
  version: string,
): Promise<CalaSubmitResponse | null> {
  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) throw new Error("CALA_TEAM_ID required");

  const body = {
    team_id: teamId,
    model_agent_name: "LobsterIC-EntityAgent",
    model_agent_version: version,
    transactions: allocations.map((a) => ({
      nasdaq_code: a.ticker,
      amount: a.amount,
    })),
  };

  let result: unknown;
  try {
    result = await fetchConvexEndpointJson<unknown>(
      calaSubmitUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      DEFAULT_CONVEX_FETCH_MS,
    );
  } catch (e) {
    console.error("  Submission failed:", e instanceof Error ? e.message : String(e));
    return null;
  }

  console.log(
    "  ✅ Submitted:",
    result !== null && typeof result === "object" && "submission_id" in result
      ? (result as CalaSubmitResponse).submission_id || "ok"
      : "ok",
  );
  return result as CalaSubmitResponse;
}

runLoop().catch((err) => {
  console.error("Runner fatal error:", err);
  process.exit(1);
});

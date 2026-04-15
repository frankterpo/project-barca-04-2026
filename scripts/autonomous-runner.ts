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
import { runResearchPipeline } from "./research-agent";
import * as fs from "fs";

const STATE_FILE = "data/runner-state.json";
const DEFAULT_INTERVAL_SEC = 900; // 15 minutes between runs

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

/** Best return_pct on the public leaderboard (current #1 bar to beat). */
async function fetchLeaderboardTopReturn(): Promise<number | null> {
  try {
    const res = await fetch("https://different-cormorant-663.convex.site/api/leaderboard", {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    let top: number | null = null;
    for (const e of data as { return_pct?: unknown }[]) {
      if (typeof e.return_pct === "number") {
        if (top === null || e.return_pct > top) top = e.return_pct;
      }
    }
    return top;
  } catch {
    return null;
  }
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
      const shouldSubmit = !dryRun;
      const result = await runResearchPipeline({ submit: false, version });

      const returnPct = result.returnPct;
      const allocCount = result.allocations.length;

      let submitted = false;
      let submissionId: string | null = null;

      if (shouldSubmit && allocCount >= 50) {
        const allowSubmit = process.env.CALA_ALLOW_SUBMIT === "1";
        if (!allowSubmit) {
          console.log(
            "\n📋 Skipping submission — set CALA_ALLOW_SUBMIT=1 after you explicitly approve real submits."
          );
        } else {
          const topReturn = await fetchLeaderboardTopReturn();
          if (topReturn === null) {
            console.log("\n📋 Skipping submission — could not read leaderboard #1 return.");
          } else if (returnPct === null) {
            console.log("\n📋 Skipping submission — no in-run return to compare against #1.");
          } else if (returnPct > topReturn) {
            console.log(
              `\n🚀 Submitting: ${returnPct.toFixed(2)}% beats leaderboard top ${topReturn.toFixed(2)}% (${allocCount} stocks)`
            );
            const sub = await submitDirectly(result.allocations, version);
            if (sub) {
              submitted = true;
              submissionId = sub.submission_id || null;
              const subReturn =
                sub.total_value && sub.total_invested
                  ? ((sub.total_value - sub.total_invested) / sub.total_invested) * 100
                  : null;

              if (subReturn !== null) {
                console.log(`  Return: ${subReturn > 0 ? "+" : ""}${subReturn.toFixed(2)}%`);
                if (state.bestReturnPct === null || subReturn > state.bestReturnPct) {
                  state.bestReturnPct = subReturn;
                  state.bestSubmissionId = submissionId;
                  state.bestVersion = version;
                  console.log("  🏆 NEW PERSONAL BEST!");
                }
              }
            }
          } else {
            console.log(
              `\n📋 Skipping submission — ${returnPct.toFixed(2)}% does not beat #1 (${topReturn.toFixed(2)}%).`
            );
          }
        }
      }

      state.totalRuns = runNumber;
      state.lastRunAt = new Date().toISOString();
      state.history.push({
        version,
        returnPct: result.returnPct,
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
  version: string
) {
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

  const res = await fetch("https://different-cormorant-663.convex.site/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (!res.ok) {
    console.error("  Submission failed:", JSON.stringify(result));
    return null;
  }

  console.log("  ✅ Submitted:", result.submission_id || "ok");
  return result;
}

runLoop().catch((err) => {
  console.error("Runner fatal error:", err);
  process.exit(1);
});

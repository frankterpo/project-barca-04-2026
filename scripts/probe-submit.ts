/**
 * Probe-submit: quickly test stock picks and see scored returns.
 * Usage:
 *   pnpm tsx scripts/probe-submit.ts                    # submit current picks
 *   pnpm tsx scripts/probe-submit.ts --batch <name>     # label the submission
 */

import "dotenv/config";
import {
  calaLeaderboardUrlCandidates,
  calaSubmitUrl,
  DEFAULT_CONVEX_FETCH_MS,
  fetchConvexEndpointJson,
  tryFetchCalaLeaderboardRows,
} from "../lib/cala";

const TOTAL_BUDGET = 1_000_000;
const MIN_PER_STOCK = 5_000;

// ── Stock universe to test ──────────────────────────────────────────
// We need to find the stocks with the highest actual returns in Cala's
// scoring model. The #1 has +12040% from 50 stocks → some stocks must
// have gone up 100x+.
//
// Strategy: test batches of tickers and see which ones have the highest
// returns. Concentrate on those.

// High-growth / high-beta / possible 100x candidates
// Think: IPOs, meme stocks, crypto-adjacent, AI plays, biotech, SPACs
const SPECULATIVE_GROWTH = [
  "SMCI", "PLTR", "COIN", "ARM", "MSTR", "APP", "IONQ", "RGTI", "QUBT",
  "RKLB", "LUNR", "HOOD", "SOFI", "AFRM", "UPST", "AI", "BBAI", "SOUN",
  "SYM", "GRAB", "SE", "NU", "DUOL", "CAVA", "BIRK", "CART",
  "CELH", "HIMS", "TOST", "DJT", "GME", "AMC", "RIVN",
  "LCID", "JOBY", "ACHR", "LILM", "EVTL",
];

// Crypto/blockchain plays  
const CRYPTO_ADJACENT = [
  "MSTR", "COIN", "MARA", "RIOT", "CLSK", "HUT", "BITF", "CORZ",
  "CIFR", "BTBT", "BTDR", "WULF",
];

// AI pure-plays and infrastructure
const AI_PLAYS = [
  "NVDA", "SMCI", "ARM", "PLTR", "AI", "SOUN", "BBAI", "IONQ", "RGTI",
  "QUBT", "SNOW", "DDOG", "MDB", "PATH", "CRWD", "PANW",
];

// Quantum computing
const QUANTUM = ["IONQ", "RGTI", "QUBT", "QBTS"];

// Nuclear/energy renaissance
const ENERGY = ["CEG", "VST", "NRG", "OKLO", "SMR", "LEU", "NNE", "CCJ"];

// Space
const SPACE = ["RKLB", "LUNR", "ASTS", "BKSY", "SPIR", "RDW"];

// Build test batches
function uniqueTickers(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

// Batch 1: Extreme concentration on AI + crypto + quantum + speculative
const BATCH_CONFIGS: Record<string, string[]> = {
  "ai_crypto_quantum": uniqueTickers(AI_PLAYS, CRYPTO_ADJACENT, QUANTUM),
  "full_speculative": uniqueTickers(SPECULATIVE_GROWTH, CRYPTO_ADJACENT, QUANTUM, ENERGY, SPACE),
  "top_performers": [
    // likely highest-return stocks in the pre-April-2025 period
    "NVDA", "SMCI", "PLTR", "ARM", "MSTR", "APP", "COIN", "HOOD",
    "IONQ", "RGTI", "QUBT", "RKLB", "SOUN", "CAVA", "HIMS", "AFRM",
    "VST", "CEG", "OKLO", "SMR", "NNE", "MARA", "RIOT", "CLSK",
    "LUNR", "ASTS", "BBAI", "AI", "SOFI", "DUOL", "TOST", "BIRK",
    "GRAB", "SE", "NU", "CELH", "CART", "DJT", "UPST", "GME",
    "AVGO", "META", "NFLX", "AMZN", "GOOGL", "AXON", "FICO", "COST",
    "BKNG", "GE",
  ],
  "ultra_concentrated": [
    // absolute moonshots — 50 stocks, heaviest on the ones most likely to 100x
    "MSTR", "NVDA", "SMCI", "PLTR", "ARM", "COIN", "IONQ", "RGTI",
    "QUBT", "MARA", "RIOT", "CLSK", "APP", "SOUN", "RKLB", "LUNR",
    "HIMS", "HOOD", "CAVA", "AFRM", "UPST", "AI", "BBAI", "SOFI",
    "VST", "CEG", "OKLO", "SMR", "NNE", "ASTS", "DJT", "GME",
    "AVGO", "META", "NFLX", "TSLA", "AXON", "DUOL", "SE", "NU",
    "TOST", "BIRK", "GRAB", "CELH", "CART", "GE", "BKNG", "FICO",
    "HUT", "CORZ",
  ],
};

function buildAllocations(tickers: string[], strategy: "equal" | "top_heavy" = "top_heavy") {
  const n = tickers.length;
  if (n < 50) {
    console.error(`Need at least 50 tickers, got ${n}`);
    process.exit(1);
  }

  const allocations: { nasdaq_code: string; amount: number }[] = [];

  if (strategy === "equal") {
    const perStock = Math.floor(TOTAL_BUDGET / n);
    let remainder = TOTAL_BUDGET - perStock * n;
    for (const ticker of tickers) {
      const extra = remainder > 0 ? 1 : 0;
      allocations.push({ nasdaq_code: ticker, amount: perStock + extra });
      if (remainder > 0) remainder--;
    }
  } else {
    // Top-heavy: first 10 stocks get 60% of budget, rest split evenly
    const topCount = Math.min(10, Math.floor(n * 0.2));
    const topBudget = Math.floor(TOTAL_BUDGET * 0.6);
    const bottomBudget = TOTAL_BUDGET - topBudget;
    const bottomCount = n - topCount;

    const perTop = Math.floor(topBudget / topCount);
    const perBottom = Math.max(MIN_PER_STOCK, Math.floor(bottomBudget / bottomCount));

    let total = 0;
    for (let i = 0; i < n; i++) {
      const amt = i < topCount ? perTop : perBottom;
      allocations.push({ nasdaq_code: tickers[i], amount: amt });
      total += amt;
    }

    // Fix rounding
    const diff = TOTAL_BUDGET - total;
    if (diff !== 0) {
      allocations[0].amount += diff;
    }
  }

  return allocations;
}

async function submit(
  allocations: { nasdaq_code: string; amount: number }[],
  batchName: string,
) {
  const teamId = process.env.CALA_TEAM_ID?.trim();
  if (!teamId) throw new Error("CALA_TEAM_ID required");

  const body = {
    team_id: teamId,
    model_agent_name: "probe",
    model_agent_version: batchName,
    transactions: allocations,
  };

  const total = allocations.reduce((s, a) => s + a.amount, 0);
  console.log(`\n📤 Submitting "${batchName}": ${allocations.length} stocks, $${total.toLocaleString()}`);
  console.log(`   Top 5: ${allocations.slice(0, 5).map(a => `${a.nasdaq_code}=$${a.amount.toLocaleString()}`).join(", ")}`);

  let result: Record<string, unknown>;
  try {
    result = await fetchConvexEndpointJson<Record<string, unknown>>(
      calaSubmitUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      DEFAULT_CONVEX_FETCH_MS,
    );
  } catch (e) {
    console.error(`   ❌ Failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  const invested = result.total_invested as number | undefined;
  const value = result.total_value as number | undefined;
  const returnPct =
    invested && value !== undefined ? ((value - invested) / invested) * 100 : 0;

  console.log(
    `   ✅ Value: $${value?.toLocaleString() ?? "?"} | Return: ${returnPct > 0 ? "+" : ""}${returnPct.toFixed(2)}%`,
  );
  return { batchName, invested, value, returnPct, stockCount: allocations.length };
}

interface LeaderboardRow {
  model_agent_version?: string;
  num_transactions?: number;
  total_value?: number;
  return_pct?: number;
}

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const got = await tryFetchCalaLeaderboardRows(DEFAULT_CONVEX_FETCH_MS);
  return (got?.rows ?? []) as LeaderboardRow[];
}

async function main() {
  const args = process.argv.slice(2);
  const batchIdx = args.indexOf("--batch");
  const batchName = batchIdx >= 0 ? args[batchIdx + 1] : null;
  const listBatches = args.includes("--list");
  const allBatches = args.includes("--all");
  const strategyArg = args.includes("--equal") ? "equal" as const : "top_heavy" as const;

  if (listBatches) {
    console.log("Available batches:");
    for (const [name, tickers] of Object.entries(BATCH_CONFIGS)) {
      console.log(`  ${name}: ${tickers.length} stocks`);
    }
    return;
  }

  // Show current leaderboard top
  console.log("📊 Current leaderboard top 3:");
  const lb = await fetchLeaderboard();
  if (lb.length > 0) {
    for (const entry of lb.slice(0, 3)) {
      const rp = entry.return_pct ?? 0;
      console.log(
        `   ${entry.model_agent_version}: ${entry.num_transactions} stocks, $${entry.total_value?.toLocaleString()} (${rp > 0 ? "+" : ""}${rp.toFixed(2)}%)`,
      );
    }
  } else {
    console.log(`   (no JSON leaderboard — tried: ${calaLeaderboardUrlCandidates().join(", ")})`);
  }

  if (allBatches) {
    const results: {
      batchName: string;
      invested?: number;
      value?: number;
      returnPct: number;
      stockCount: number;
    }[] = [];
    for (const [name, tickers] of Object.entries(BATCH_CONFIGS)) {
      if (tickers.length < 50) {
        console.log(`\n⚠️ Skipping "${name}": only ${tickers.length} tickers (need 50)`);
        continue;
      }
      const allocs = buildAllocations(tickers, strategyArg);
      const r = await submit(allocs, name);
      if (r) results.push(r);
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log("\n═══ RESULTS SUMMARY ═══");
    results.sort((a, b) => b.returnPct - a.returnPct);
    for (const r of results) {
      console.log(`  ${r.batchName.padEnd(25)} ${r.stockCount} stocks  ${r.returnPct > 0 ? "+" : ""}${r.returnPct.toFixed(2)}%  $${r.value?.toLocaleString()}`);
    }
  } else if (batchName) {
    const tickers = BATCH_CONFIGS[batchName];
    if (!tickers) {
      console.error(`Unknown batch: ${batchName}. Use --list to see options.`);
      return;
    }
    const allocs = buildAllocations(tickers, strategyArg);
    await submit(allocs, batchName);
  } else {
    // Default: submit ultra_concentrated
    const tickers = BATCH_CONFIGS["ultra_concentrated"];
    const allocs = buildAllocations(tickers, strategyArg);
    await submit(allocs, "ultra_v1");
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

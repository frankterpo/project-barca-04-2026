import { JUDGE_PRESETS } from "@/lib/judge-presets";
import { toBand } from "@/lib/conviction";
import type { CompanyDecision, PortfolioRunSummary } from "@/lib/types";

const RUN_ID = "demo-v1";

function judgeMap(
  ticker: string,
  fn: (presetId: number) => {
    answer: string;
    evidenceIds: string[];
    dissent?: string;
  },
) {
  return Object.fromEntries(
    JUDGE_PRESETS.map((p) => {
      const body = fn(p.id);
      return [
        String(p.id),
        {
          presetId: p.id,
          answer: body.answer,
          evidenceIds: body.evidenceIds,
          dissent: body.dissent,
        },
      ];
    }),
  );
}

function decisionFor(params: {
  ticker: string;
  name: string;
  weightPct: number;
  quality: number;
  growth: number;
  risk: number;
  chairConfidence: number;
}): CompanyDecision {
  const { ticker, name, weightPct, quality, growth, risk, chairConfidence } =
    params;
  const e1 = `${ticker}-E1`;
  const e2 = `${ticker}-E2`;
  const e3 = `${ticker}-E3`;

  return {
    ticker,
    name,
    evidence: [
      {
        id: e1,
        title: `${name} revenue durability note`,
        source: "Mock 10-K excerpt",
        excerpt: "Recurring revenue mix improved YoY in the mock dataset.",
      },
      {
        id: e2,
        title: `${name} margin bridge`,
        source: "Mock investor deck",
        excerpt: "Operating leverage visible if growth holds at guided range.",
      },
      {
        id: e3,
        title: `${name} risk register`,
        source: "Mock risk factors",
        excerpt: "Key risk: demand cyclicality vs execution on new products.",
      },
    ],
    thesis: {
      bull: {
        narrative: `${name} compounds via durable cash flows and disciplined reinvestment; mock conviction aligns with quality and growth scores.`,
        evidenceIds: [e1, e2],
      },
      skeptic: {
        narrative: `The skeptical view centers on valuation and cycle timing — any demand air-pocket would pressure multiples faster than fundamentals.`,
        evidenceIds: [e3],
      },
      risk: {
        narrative: `Primary risks: macro slowdown, competitive share shifts, and regulatory headlines that are uncorrelated to operating performance.`,
        evidenceIds: [e3, e1],
      },
    },
    quality: {
      score: quality,
      summary: `Quality panel: ${name} shows solid unit economics in the mock evidence set with manageable balance sheet risk.`,
      keyStrengths: ["Recurring mix", "Cash conversion", "Brand or ecosystem depth"],
      keyConcerns: ["Cyclical exposure", "Supplier concentration"],
      evidenceIds: [e1],
    },
    growth: {
      score: growth,
      summary: `Growth panel: forward drivers are credible but slope-of-growth debates remain.`,
      growthDrivers: ["New product cycle", "Geographic expansion", "Pricing power"],
      headwinds: ["Tough comps", "FX", "Enterprise budget scrutiny"],
      evidenceIds: [e2],
    },
    risk: {
      score: risk,
      summary: `Risk panel: tail risks are visible but partially mitigated by balance sheet optionality.`,
      risks: ["Demand volatility", "Regulatory headlines", "Execution on roadmap"],
      mitigations: ["Diversified revenue", "Cost controls", "Liquidity buffer"],
      evidenceIds: [e3],
    },
    chair: {
      confidence: chairConfidence,
      allocationRationale: `Chair: sizing ~${weightPct.toFixed(1)}% reflects blended committee scores with emphasis on risk-adjusted growth.`,
      dissent: "Minority view: would prefer smaller sizing until next quarter's prints.",
      verdict:
        chairConfidence >= 65
          ? "overweight"
          : chairConfidence >= 45
            ? "neutral"
            : "underweight",
    },
    judgeAnswers: judgeMap(ticker, (presetId) => ({
      answer: `[${ticker}] Mock answer for preset ${presetId}: cross-exam response grounded on ${e1} and ${e2}.`,
      evidenceIds: [e1, e2],
      dissent:
        presetId === 7
          ? "Bear case not dismissed: cycle risk could dominate if orders decelerate."
          : undefined,
    })),
  };
}

export const demoDecisionsList: CompanyDecision[] = [
  decisionFor({
    ticker: "AAPL",
    name: "Apple Inc.",
    weightPct: 22,
    quality: 78,
    growth: 62,
    risk: 58,
    chairConfidence: 72,
  }),
  decisionFor({
    ticker: "NVDA",
    name: "NVIDIA Corp.",
    weightPct: 22,
    quality: 74,
    growth: 82,
    risk: 48,
    chairConfidence: 76,
  }),
  decisionFor({
    ticker: "MSFT",
    name: "Microsoft Corp.",
    weightPct: 20,
    quality: 80,
    growth: 68,
    risk: 55,
    chairConfidence: 74,
  }),
  decisionFor({
    ticker: "AMZN",
    name: "Amazon.com Inc.",
    weightPct: 18,
    quality: 70,
    growth: 72,
    risk: 52,
    chairConfidence: 68,
  }),
  decisionFor({
    ticker: "GOOGL",
    name: "Alphabet Inc.",
    weightPct: 18,
    quality: 76,
    growth: 66,
    risk: 50,
    chairConfidence: 70,
  }),
];

export const demoDecisionsByTicker: Record<string, CompanyDecision> =
  Object.fromEntries(demoDecisionsList.map((d) => [d.ticker, d]));

const DEMO_WEIGHTS: Record<string, number> = {
  AAPL: 22,
  NVDA: 22,
  MSFT: 20,
  AMZN: 18,
  GOOGL: 18,
};

export const demoSummary: PortfolioRunSummary = {
  id: RUN_ID,
  branchLabel: "feature/demo-mock-committee",
  benchmarkNote: "Benchmark (text v0): Nasdaq-100 +1.2% YTD (illustrative)",
  portfolioValueUsd: 1_000_000,
  updatedAt: new Date().toISOString(),
  holdings: demoDecisionsList.map((d) => ({
    ticker: d.ticker,
    name: d.name,
    weightPct: DEMO_WEIGHTS[d.ticker] ?? 0,
    convictionBand: toBand(d.chair.confidence),
    chairConfidence: d.chair.confidence,
  })),
};

export const DEMO_RUN_ID = RUN_ID;

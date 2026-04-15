import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  companyDecisionSchema,
  portfolioRunSummarySchema,
} from "@/lib/contracts/schemas";
import type { DecisionStore } from "@/lib/store/decision-store";
import type { CompanyDecision, JudgeAnswer, PortfolioRunSummary } from "@/lib/types";

function runsRoot(cwd: string, runId: string) {
  return path.join(cwd, "data", "runs", runId);
}

export class JsonDecisionStore implements DecisionStore {
  constructor(private readonly cwd: string) {}

  async getRunSummary(runId: string): Promise<PortfolioRunSummary> {
    const raw = await readFile(
      path.join(runsRoot(this.cwd, runId), "summary.json"),
      "utf8",
    );
    const parsed = portfolioRunSummarySchema.parse(JSON.parse(raw));
    return parsed;
  }

  async getHoldings(runId: string): Promise<PortfolioRunSummary["holdings"]> {
    const summary = await this.getRunSummary(runId);
    return summary.holdings;
  }

  async getDecision(runId: string, ticker: string): Promise<CompanyDecision | null> {
    const file = path.join(
      runsRoot(this.cwd, runId),
      "decisions",
      `${ticker.toUpperCase()}.json`,
    );
    try {
      const raw = await readFile(file, "utf8");
      return companyDecisionSchema.parse(JSON.parse(raw)) as CompanyDecision;
    } catch {
      return null;
    }
  }

  async getJudgeAnswer(
    runId: string,
    ticker: string,
    presetId: number,
  ): Promise<JudgeAnswer | null> {
    const decision = await this.getDecision(runId, ticker);
    if (!decision) return null;
    const key = String(presetId);
    return decision.judgeAnswers[key] ?? null;
  }
}

export function createJsonStore(cwd: string = process.cwd()) {
  return new JsonDecisionStore(cwd);
}

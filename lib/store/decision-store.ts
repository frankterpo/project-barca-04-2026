import type { CompanyDecision, JudgeAnswer, PortfolioRunSummary } from "@/lib/types";

export interface DecisionStore {
  getRunSummary(runId: string): Promise<PortfolioRunSummary>;
  getHoldings(runId: string): Promise<PortfolioRunSummary["holdings"]>;
  getDecision(runId: string, ticker: string): Promise<CompanyDecision | null>;
  getJudgeAnswer(
    runId: string,
    ticker: string,
    presetId: number,
  ): Promise<JudgeAnswer | null>;
}

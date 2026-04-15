import type {
  CommitteeChairOutput,
  GrowthAnalystOutput,
  QualityAnalystOutput,
  RiskAnalystOutput,
} from "@/lib/contracts/schemas";

export type ConvictionBand = "A" | "B" | "C";

export interface EvidenceRef {
  id: string;
  title: string;
  source?: string;
  excerpt?: string;
}

export interface ThesisSide {
  narrative: string;
  evidenceIds: string[];
}

export interface Thesis {
  bull: ThesisSide;
  skeptic: ThesisSide;
  risk: ThesisSide;
}

export interface Holding {
  ticker: string;
  name: string;
  weightPct: number;
  convictionBand: ConvictionBand;
  chairConfidence?: number;
}

export interface PortfolioRunSummary {
  id: string;
  branchLabel: string;
  benchmarkNote: string;
  portfolioValueUsd: number;
  updatedAt: string;
  holdings: Holding[];
}

export interface CompanyDecision {
  ticker: string;
  name: string;
  evidence: EvidenceRef[];
  thesis: Thesis;
  quality: QualityAnalystOutput;
  growth: GrowthAnalystOutput;
  risk: RiskAnalystOutput;
  chair: CommitteeChairOutput;
  /** keyed by preset id string "1".."8" */
  judgeAnswers: Record<string, JudgeAnswer>;
}

export interface JudgeAnswer {
  presetId: number;
  answer: string;
  evidenceIds: string[];
  dissent?: string;
}

export type {
  CommitteeChairOutput,
  GrowthAnalystOutput,
  QualityAnalystOutput,
  RiskAnalystOutput,
};

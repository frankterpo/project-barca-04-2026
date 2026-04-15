import { z } from "zod";

export const evidenceRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().optional(),
  excerpt: z.string().optional(),
});

export const thesisSideSchema = z.object({
  narrative: z.string(),
  evidenceIds: z.array(z.string()),
});

export const thesisSchema = z.object({
  bull: thesisSideSchema,
  skeptic: thesisSideSchema,
  risk: thesisSideSchema,
});

export const qualityAnalystSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  keyStrengths: z.array(z.string()),
  keyConcerns: z.array(z.string()),
  evidenceIds: z.array(z.string()),
});

export const growthAnalystSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  growthDrivers: z.array(z.string()),
  headwinds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
});

export const riskAnalystSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  risks: z.array(z.string()),
  mitigations: z.array(z.string()),
  evidenceIds: z.array(z.string()),
});

export const committeeChairSchema = z.object({
  confidence: z.number().min(0).max(100),
  allocationRationale: z.string(),
  dissent: z.string().optional(),
  verdict: z.enum(["overweight", "neutral", "underweight"]),
});

export const judgeAnswerSchema = z.object({
  presetId: z.number().int().min(1).max(32),
  answer: z.string(),
  evidenceIds: z.array(z.string()),
  dissent: z.string().optional(),
});

export const companyDecisionSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  evidence: z.array(evidenceRefSchema),
  thesis: thesisSchema,
  quality: qualityAnalystSchema,
  growth: growthAnalystSchema,
  risk: riskAnalystSchema,
  chair: committeeChairSchema,
  judgeAnswers: z.record(z.string(), judgeAnswerSchema),
});

export const holdingSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  weightPct: z.number(),
  convictionBand: z.enum(["A", "B", "C"]),
  chairConfidence: z.number().optional(),
});

export const portfolioRunSummarySchema = z.object({
  id: z.string(),
  branchLabel: z.string(),
  benchmarkNote: z.string(),
  portfolioValueUsd: z.number(),
  updatedAt: z.string(),
  holdings: z.array(holdingSchema),
});

export type QualityAnalystOutput = z.infer<typeof qualityAnalystSchema>;
export type GrowthAnalystOutput = z.infer<typeof growthAnalystSchema>;
export type RiskAnalystOutput = z.infer<typeof riskAnalystSchema>;
export type CommitteeChairOutput = z.infer<typeof committeeChairSchema>;
export type JudgeAnswerParsed = z.infer<typeof judgeAnswerSchema>;
export type CompanyDecisionParsed = z.infer<typeof companyDecisionSchema>;
export type PortfolioRunSummaryParsed = z.infer<typeof portfolioRunSummarySchema>;

import type { ConvictionBand } from "@/lib/types";

export function toBand(score: number): ConvictionBand {
  if (score >= 70) return "A";
  if (score >= 45) return "B";
  return "C";
}

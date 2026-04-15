import type { PortfolioRunSummary } from "@/lib/types";
import { getDefaultRunId } from "@/lib/run-id";
import { createJsonStore } from "@/lib/store/json-store";

export async function loadRunSummarySafe(): Promise<PortfolioRunSummary | null> {
  const store = createJsonStore();
  const runId = getDefaultRunId();
  try {
    return await store.getRunSummary(runId);
  } catch {
    return null;
  }
}

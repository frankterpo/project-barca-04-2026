import { loadPortfolioRunSummaryFromOmnigraph } from "@/lib/graph/omnigraph-run-data";
import type { PortfolioRunSummary } from "@/lib/types";
import { getDefaultRunId } from "@/lib/run-id";
import { createJsonStore } from "@/lib/store/json-store";

export async function loadRunSummarySafe(): Promise<PortfolioRunSummary | null> {
  const runId = getDefaultRunId();
  const fromGraph = await loadPortfolioRunSummaryFromOmnigraph(runId);
  if (fromGraph) return fromGraph;

  const store = createJsonStore();
  try {
    return await store.getRunSummary(runId);
  } catch {
    return null;
  }
}

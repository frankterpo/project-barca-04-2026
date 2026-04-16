import { NextResponse } from "next/server";

import { loadCompanyDecisionFromOmnigraph } from "@/lib/graph/omnigraph-run-data";
import { getDefaultRunId } from "@/lib/run-id";
import { createJsonStore } from "@/lib/store/json-store";

interface Props {
  params: Promise<{ ticker: string }>;
}

export async function GET(_req: Request, { params }: Props) {
  const { ticker } = await params;
  const runId = getDefaultRunId();
  const fromGraph = await loadCompanyDecisionFromOmnigraph(runId, ticker);
  if (fromGraph) {
    return NextResponse.json({ ok: true, data: fromGraph, source: "omnigraph" });
  }
  const store = createJsonStore();
  const decision = await store.getDecision(runId, ticker);
  if (!decision) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "NOT_FOUND", message: `No decision for ${ticker}` },
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, data: decision, source: "json" });
}

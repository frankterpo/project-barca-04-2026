import { NextResponse } from "next/server";

import { getDefaultRunId } from "@/lib/run-id";
import { createJsonStore } from "@/lib/store/json-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId") ?? getDefaultRunId();
  const ticker = url.searchParams.get("ticker");
  const presetRaw = url.searchParams.get("presetId");
  if (!ticker || !presetRaw) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_QUERY",
          message: "ticker and presetId are required",
        },
      },
      { status: 400 },
    );
  }
  const presetId = Number(presetRaw);
  if (!Number.isFinite(presetId)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_QUERY", message: "presetId must be a number" } },
      { status: 400 },
    );
  }
  const store = createJsonStore();
  const answer = await store.getJudgeAnswer(runId, ticker, presetId);
  return NextResponse.json({ ok: true, answer });
}

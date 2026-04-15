import { NextResponse } from "next/server";

import { getDefaultRunId } from "@/lib/run-id";
import { createJsonStore } from "@/lib/store/json-store";

export async function GET() {
  try {
    const store = createJsonStore();
    const data = await store.getRunSummary(getDefaultRunId());
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RUN_LOAD_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Run creation is not implemented in v0.",
      },
    },
    { status: 501 },
  );
}

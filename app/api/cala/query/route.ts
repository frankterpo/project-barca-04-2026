import { NextResponse } from "next/server";

import { CalaApiError, getCalaClient } from "@/lib/cala";

/**
 * POST /api/cala/query — structured dot-notation knowledge query
 * Body: { "input": "companies.industry=fintech.founded_year>=2020" }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = typeof body?.input === "string" ? body.input.trim() : "";
    if (!input) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_BODY", message: "input is required" } },
        { status: 400 },
      );
    }

    const cala = getCalaClient();
    const data = await cala.query(input);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof CalaApiError) {
      const status = err.status === 429 ? 429 : 502;
      return NextResponse.json(
        { ok: false, error: { code: "CALA_ERROR", message: err.message } },
        { status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Unknown error" },
      },
      { status: 500 },
    );
  }
}

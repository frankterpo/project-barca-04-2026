import { NextResponse } from "next/server";

import { getOmnigraphClient, OmnigraphError } from "@/lib/omnigraph";

/**
 * POST /api/graph/change
 * Body: { "query": "upsert_company", "params": { "ticker": "AAPL", "name": "Apple", "sector": "Technology" }, "branch": "main" }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queryName = typeof body?.query === "string" ? body.query.trim() : "";
    if (!queryName) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_BODY", message: '"query" (named mutation) is required' } },
        { status: 400 },
      );
    }

    const params = body.params as Record<string, unknown> | undefined;
    const branch = typeof body.branch === "string" ? body.branch : undefined;

    const client = getOmnigraphClient();
    const data = await client.change(queryName, params, { branch });

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return graphErrorResponse(err);
  }
}

function graphErrorResponse(err: unknown) {
  if (err instanceof OmnigraphError) {
    return NextResponse.json(
      { ok: false, error: { code: "OMNIGRAPH_ERROR", message: err.message, detail: err.body } },
      { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Unknown error" } },
    { status: 500 },
  );
}

import { NextResponse } from "next/server";

import { CalaApiError, getCalaClient } from "@/lib/cala";

/**
 * POST /api/cala/search  — natural language knowledge search
 * Body: { "input": "What is Apple's revenue?" }
 *
 * GET  /api/cala/search?q=Apple+revenue — convenience alias
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
    const data = await cala.search(input);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return calaErrorResponse(err);
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { ok: false, error: { code: "MISSING_QUERY", message: "?q= is required" } },
      { status: 400 },
    );
  }

  try {
    const cala = getCalaClient();
    const data = await cala.search(q);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return calaErrorResponse(err);
  }
}

function calaErrorResponse(err: unknown) {
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
      error: {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Unknown error",
      },
    },
    { status: 500 },
  );
}

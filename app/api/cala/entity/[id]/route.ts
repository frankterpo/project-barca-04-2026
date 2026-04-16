import { NextResponse } from "next/server";

import { CalaApiError, getCalaClient } from "@/lib/cala";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * GET  /api/cala/entity/:id — full entity profile
 * POST /api/cala/entity/:id — same (mirrors Cala's POST convention)
 */
async function handler(_req: Request, { params }: Props) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "entity id must be a UUID" } },
      { status: 400 },
    );
  }

  try {
    const cala = getCalaClient();
    const data = await cala.getEntity(id);
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

export { handler as GET, handler as POST };

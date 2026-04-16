import { NextResponse } from "next/server";
import { getNorthflankClient, NorthflankApiError } from "@/lib/northflank";

/**
 * POST /api/compute/run
 * Body: { projectId, jobId, runtimeEnvironment?, runtimeFiles? }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, jobId } = body as { projectId?: string; jobId?: string };

    if (!projectId || !jobId) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_BODY", message: '"projectId" and "jobId" are required' } },
        { status: 400 },
      );
    }

    const ref = await getNorthflankClient().runJob({
      projectId,
      jobId,
      runtimeEnvironment: body.runtimeEnvironment,
      runtimeFiles: body.runtimeFiles,
    });

    return NextResponse.json({ ok: true, data: ref }, { status: 201 });
  } catch (err) {
    return computeErrorResponse(err);
  }
}

function computeErrorResponse(err: unknown) {
  if (err instanceof NorthflankApiError) {
    return NextResponse.json(
      { ok: false, error: { code: "NORTHFLANK_ERROR", message: err.message, status: err.status } },
      { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
  const msg = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: msg } },
    { status: 500 },
  );
}

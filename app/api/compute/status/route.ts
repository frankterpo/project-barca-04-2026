import { NextResponse } from "next/server";
import { getNorthflankClient, NorthflankApiError } from "@/lib/northflank";

/**
 * GET /api/compute/status?projectId=X&jobId=Y&runId=Z
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const jobId = url.searchParams.get("jobId");
    const runId = url.searchParams.get("runId");

    if (!projectId || !jobId || !runId) {
      return NextResponse.json(
        { ok: false, error: { code: "MISSING_PARAMS", message: "projectId, jobId, and runId are required" } },
        { status: 400 },
      );
    }

    const detail = await getNorthflankClient().getRunDetail({ projectId, jobId, runId });
    return NextResponse.json({ ok: true, data: detail });
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

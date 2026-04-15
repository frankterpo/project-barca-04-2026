import { NextResponse } from "next/server";
import { getNorthflankClient, NorthflankApiError } from "@/lib/northflank";

/**
 * GET /api/compute/runs?projectId=X&jobId=Y&page=1&perPage=20&cursor=...
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const jobId = url.searchParams.get("jobId");

    if (!projectId || !jobId) {
      return NextResponse.json(
        { ok: false, error: { code: "MISSING_PARAMS", message: "projectId and jobId are required" } },
        { status: 400 },
      );
    }

    const page = url.searchParams.get("page");
    const perPage = url.searchParams.get("perPage");
    const cursor = url.searchParams.get("cursor");

    const result = await getNorthflankClient().listRuns({
      projectId,
      jobId,
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
      cursor: cursor ?? undefined,
    });

    return NextResponse.json({ ok: true, data: result });
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

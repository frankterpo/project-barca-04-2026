import { NextResponse } from "next/server";

import { getOmnigraphClient } from "@/lib/omnigraph";

export async function GET() {
  const ok = await getOmnigraphClient().healthy();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
}

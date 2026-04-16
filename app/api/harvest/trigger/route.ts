import { NextResponse } from "next/server";
import { exec, type ChildProcess } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "auto" ? "--auto" : "--harvest";
  const startMs = Date.now();

  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };

      send(`[${new Date().toISOString()}] Starting price-harvester ${mode}...`);

      child = exec(
        `npx tsx scripts/price-harvester.ts ${mode} 2>&1`,
        { timeout: 280_000, maxBuffer: 10 * 1024 * 1024, cwd: process.cwd() },
      );

      child.stdout?.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (line.trim()) send(line);
        }
      });

      child.stderr?.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (line.trim()) send(`[stderr] ${line}`);
        }
      });

      child.on("close", (code) => {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
        send(`[done] Process exited with code ${code} in ${elapsed}s`);
        try { controller.close(); } catch {}
      });

      child.on("error", (err) => {
        send(`[error] ${err.message}`);
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      child?.kill();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

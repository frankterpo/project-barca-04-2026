import { NextResponse } from "next/server";
import { exec, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const body = lines
    .map((l) => `data: ${JSON.stringify(l)}\n\n`)
    .join("");
  return new NextResponse(encoder.encode(body), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "auto" ? "--auto" : "--harvest";

  if (process.env.VERCEL) {
    return sseResponse([
      "[error] Harvest requires a local environment (tsx + child_process).",
      "[error] Vercel serverless functions cannot run the price-harvester script.",
      "[error] Run locally: pnpm tsx scripts/price-harvester.ts --auto",
      "[done] Process exited with code 1 in 0.0s",
    ]);
  }

  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  const useTsx = existsSync(tsxBin) ? tsxBin : "npx tsx";

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
        `${useTsx} scripts/price-harvester.ts ${mode} 2>&1`,
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

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "auto" ? "auto" : "harvest";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {}
      };

      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args: unknown[]) => send(args.map(String).join(" "));
      console.error = (...args: unknown[]) => send(`[error] ${args.map(String).join(" ")}`);

      const t0 = Date.now();
      try {
        send(`[${new Date().toISOString()}] Starting price-harvester (in-process, mode=${mode})...`);

        const { autoLoop, harvest, optimize, loadPriceDB } =
          await import("@/scripts/price-harvester");

        if (mode === "auto") {
          await autoLoop();
        } else {
          await harvest();
          const db = loadPriceDB();
          if (Object.keys(db.prices).length >= 50) {
            await optimize(false);
          }
        }

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        send(`[done] Process exited with code 0 in ${elapsed}s`);
      } catch (e) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        send(`[error] ${e instanceof Error ? e.message : String(e)}`);
        send(`[done] Process exited with code 1 in ${elapsed}s`);
      } finally {
        console.log = origLog;
        console.error = origErr;
        try {
          controller.close();
        } catch {}
      }
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

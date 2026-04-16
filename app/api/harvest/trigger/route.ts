import { NextResponse } from "next/server";
import { exec } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const startMs = Date.now();

  return new Promise<NextResponse>((resolve) => {
    const child = exec(
      "npx tsx scripts/price-harvester.ts 2>&1",
      { timeout: 280_000, maxBuffer: 5 * 1024 * 1024, cwd: process.cwd() },
      (error, stdout, stderr) => {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
        const output = (stdout || "") + (stderr || "");
        const lines = output.split("\n").filter(Boolean);
        const lastLines = lines.slice(-30);

        if (error) {
          resolve(
            NextResponse.json({
              ok: false,
              elapsed_s: elapsed,
              error: error.message,
              output: lastLines,
            }, { status: 500 }),
          );
          return;
        }

        resolve(
          NextResponse.json({
            ok: true,
            elapsed_s: elapsed,
            output: lastLines,
          }),
        );
      },
    );

    child.unref?.();
  });
}

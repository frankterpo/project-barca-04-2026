import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEMO_RUN_ID,
  demoDecisionsList,
  demoSummary,
} from "@/lib/mock/seed-data";

async function main() {
  const root = process.cwd();
  const runDir = path.join(root, "data", "runs", DEMO_RUN_ID);
  const decisionsDir = path.join(runDir, "decisions");
  await mkdir(decisionsDir, { recursive: true });

  await writeFile(
    path.join(runDir, "summary.json"),
    `${JSON.stringify(demoSummary, null, 2)}\n`,
    "utf8",
  );

  for (const decision of demoDecisionsList) {
    await writeFile(
      path.join(decisionsDir, `${decision.ticker}.json`),
      `${JSON.stringify(decision, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(`Wrote demo fixtures to data/runs/${DEMO_RUN_ID}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

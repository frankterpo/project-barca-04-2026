import Link from "next/link";
import { notFound } from "next/navigation";

import { CommitteeStrip } from "@/components/company/committee-strip";
import { ThesisTabs } from "@/components/company/thesis-tabs";
import { getDefaultRunId } from "@/lib/run-id";
import { createJsonStore } from "@/lib/store/json-store";

interface Props {
  params: Promise<{ ticker: string }>;
}

export default async function CompanyPage({ params }: Props) {
  const { ticker } = await params;
  const store = createJsonStore();
  const runId = getDefaultRunId();
  const decision = await store.getDecision(runId, ticker);
  if (!decision) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Holding
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="font-mono">{decision.ticker}</span>{" "}
            <span className="text-text-secondary">{decision.name}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/portfolio"
            className="rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-secondary hover:bg-bg-muted hover:text-text-primary"
          >
            ← Portfolio
          </Link>
          <Link
            href={`/judge-mode?ticker=${encodeURIComponent(decision.ticker)}`}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/15"
          >
            Judge Mode
          </Link>
        </div>
      </div>
      <CommitteeStrip decision={decision} />
      <ThesisTabs decision={decision} />
    </div>
  );
}

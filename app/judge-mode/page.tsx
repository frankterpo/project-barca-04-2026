import { JudgeModeClient } from "@/components/judge/judge-mode-client";
import { loadRunSummarySafe } from "@/lib/load-run";

interface Props {
  searchParams?: Promise<{ ticker?: string }>;
}

export default async function JudgeModePage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const summary = await loadRunSummarySafe();
  const holdings = summary?.holdings ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Judge Mode</h1>
        <p className="text-sm text-text-secondary">
          Cross-examine the mock committee with preset questions (cached answers).
        </p>
      </div>
      {holdings.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary"
          role="status"
        >
          <p className="font-medium text-text-primary">No holdings available.</p>
          <p className="mt-2">
            Run{" "}
            <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-text-primary">
              pnpm run demo:seed
            </code>{" "}
            first.
          </p>
        </div>
      ) : (
        <JudgeModeClient holdings={holdings} initialTicker={sp.ticker} />
      )}
    </div>
  );
}

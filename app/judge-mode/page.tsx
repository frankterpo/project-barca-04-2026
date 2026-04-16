import { JudgeModeClient } from "@/components/judge/judge-mode-client";

interface Props {
  searchParams?: Promise<{ ticker?: string }>;
}

export default async function JudgeModePage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Judge Mode</h1>
        <p className="text-sm text-text-secondary">
          Cross-examine the investment committee with preset questions — powered by Omnigraph.
        </p>
      </div>
      <JudgeModeClient holdings={[]} initialTicker={sp.ticker} />
    </div>
  );
}

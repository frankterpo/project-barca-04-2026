import type { CompanyDecision } from "@/lib/types";

function ScorePill({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-muted/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg tabular-nums text-text-primary">{score}</div>
    </div>
  );
}

export function CommitteeStrip({ decision }: { decision: CompanyDecision }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <ScorePill label="Quality" score={decision.quality.score} />
          <ScorePill label="Growth" score={decision.growth.score} />
          <ScorePill label="Risk (lower better)" score={decision.risk.score} />
        </div>
        <div className="flex-1 rounded-lg bg-bg-muted/40 p-3 lg:ml-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Chair
            </span>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold capitalize text-accent ring-1 ring-accent/30">
              {decision.chair.verdict}
            </span>
            <span className="font-mono text-sm text-text-secondary">
              confidence {decision.chair.confidence}
            </span>
          </div>
          <p className="mt-2 text-sm text-text-primary">{decision.chair.allocationRationale}</p>
          {decision.chair.dissent ? (
            <p className="mt-2 text-xs text-text-secondary">Dissent: {decision.chair.dissent}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

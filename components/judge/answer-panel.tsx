import type { JudgeAnswer } from "@/lib/types";

export function AnswerPanel({
  answer,
  loading,
}: {
  answer: JudgeAnswer | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div
        className="min-h-[120px] rounded-lg border border-dashed border-border-subtle bg-bg-elevated/50 p-4 text-sm text-text-secondary"
        aria-live="polite"
      >
        Loading…
      </div>
    );
  }

  if (!answer) {
    return (
      <div
        className="min-h-[120px] rounded-lg border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary"
        aria-live="polite"
      >
        Pick a company and question to view the mock committee answer.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated p-4"
      aria-live="polite"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        Answer
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-primary">{answer.answer}</p>
      <div className="mt-3 text-xs text-text-muted">
        Evidence:{" "}
        <span className="font-mono text-text-secondary">{answer.evidenceIds.join(", ")}</span>
      </div>
      {answer.dissent ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <div className="text-xs font-semibold uppercase">Dissent</div>
          <p className="mt-1">{answer.dissent}</p>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { startTransition, useEffect, useState } from "react";

import { AnswerPanel } from "@/components/judge/answer-panel";
import { CompanyPicker } from "@/components/judge/company-picker";
import { PresetButtons } from "@/components/judge/preset-buttons";
import { getDefaultRunId } from "@/lib/run-id";
import type { Holding, JudgeAnswer } from "@/lib/types";

export function JudgeModeClient({
  holdings,
  initialTicker,
}: {
  holdings: Holding[];
  initialTicker?: string;
}) {
  const runId = getDefaultRunId();
  const defaultTicker =
    (initialTicker &&
      holdings.some((h) => h.ticker === initialTicker.toUpperCase()) &&
      initialTicker.toUpperCase()) ||
    holdings[0]?.ticker ||
    "";
  const [ticker, setTicker] = useState(defaultTicker);
  const [presetId, setPresetId] = useState<number | null>(1);
  const [answer, setAnswer] = useState<JudgeAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const displayAnswer = ticker && presetId ? answer : null;

  useEffect(() => {
    if (!ticker || !presetId) return;

    const ctrl = new AbortController();
    startTransition(() => setLoading(true));
    fetch(
      `/api/judge-mode?runId=${encodeURIComponent(runId)}&ticker=${encodeURIComponent(ticker)}&presetId=${presetId}`,
      { signal: ctrl.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ answer: JudgeAnswer | null }>;
      })
      .then((body) => {
        if (ctrl.signal.aborted) return;
        startTransition(() => setAnswer(body.answer));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        startTransition(() => setAnswer(null));
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        startTransition(() => setLoading(false));
      });

    return () => ctrl.abort();
  }, [ticker, presetId, runId]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="lg:col-span-1">
        <CompanyPicker holdings={holdings} value={ticker} onChange={setTicker} />
      </section>
      <section className="lg:col-span-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Preset questions
        </h2>
        <div className="mt-2">
          <PresetButtons selectedId={presetId} onSelect={setPresetId} />
        </div>
      </section>
      <section className="lg:col-span-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Panel</h2>
        <div className="mt-2">
          <AnswerPanel answer={displayAnswer} loading={loading} />
        </div>
      </section>
    </div>
  );
}

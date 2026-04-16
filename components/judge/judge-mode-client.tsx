"use client";

import { startTransition, useCallback, useEffect, useState } from "react";

import { AnswerPanel } from "@/components/judge/answer-panel";
import { CompanyPicker } from "@/components/judge/company-picker";
import { PresetButtons } from "@/components/judge/preset-buttons";
import type { Holding, JudgeAnswer } from "@/lib/types";

export function JudgeModeClient({
  holdings: initialHoldings,
  initialTicker,
}: {
  holdings: Holding[];
  initialTicker?: string;
}) {
  const [holdings, setHoldings] = useState<Holding[]>(initialHoldings);
  const [loadingHoldings, setLoadingHoldings] = useState(initialHoldings.length === 0);

  const defaultTicker =
    (initialTicker &&
      holdings.some((h) => h.ticker === initialTicker.toUpperCase()) &&
      initialTicker.toUpperCase()) ||
    holdings[0]?.ticker ||
    "";

  const [ticker, setTicker] = useState(defaultTicker);

  useEffect(() => {
    if (initialHoldings.length > 0) return;

    const ctrl = new AbortController();
    fetch("/api/judge-mode/companies", { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ holdings?: Holding[] }>)
      .then((body) => {
        if (!ctrl.signal.aborted && body.holdings) {
          const next = body.holdings!;
          startTransition(() => {
            setHoldings(next);
            setTicker((t) => t || next[0]?.ticker || "");
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) startTransition(() => setLoadingHoldings(false));
      });

    return () => ctrl.abort();
  }, [initialHoldings]);
  const [presetId, setPresetId] = useState<number | null>(1);
  const [answer, setAnswer] = useState<JudgeAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnswer = useCallback(() => {
    if (!ticker || !presetId) return;

    const ctrl = new AbortController();
    startTransition(() => setLoading(true));
    fetch(
      `/api/judge-mode?ticker=${encodeURIComponent(ticker)}&presetId=${presetId}`,
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
  }, [ticker, presetId]);

  useEffect(() => {
    return fetchAnswer();
  }, [fetchAnswer]);

  const displayAnswer = ticker && presetId ? answer : null;

  if (loadingHoldings) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary animate-pulse">
        Loading companies from Omnigraph...
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-sm text-text-secondary"
        role="status"
      >
        <p className="font-medium text-text-primary">No holdings available.</p>
        <p className="mt-2">
          Run the price harvester to populate Omnigraph, or connect to a running Omnigraph instance.
        </p>
      </div>
    );
  }

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

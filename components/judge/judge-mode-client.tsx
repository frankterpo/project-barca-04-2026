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
  const [companiesMessage, setCompaniesMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialHoldings.length > 0) {
      startTransition(() => setLoadingHoldings(false));
      return;
    }

    startTransition(() => setLoadingHoldings(true));
    let active = true;
    const ctrl = new AbortController();
    const deadline = window.setTimeout(() => ctrl.abort(), 25_000);
    fetch("/api/judge-mode/companies", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          startTransition(() =>
            setCompaniesMessage(`Companies request failed (${r.status}). Try again or check server logs.`),
          );
          return;
        }
        let body: { holdings?: Holding[]; message?: string };
        try {
          body = (await r.json()) as { holdings?: Holding[]; message?: string };
        } catch {
          startTransition(() =>
            setCompaniesMessage("Invalid response from /api/judge-mode/companies (not JSON)."),
          );
          return;
        }
        if (!active || ctrl.signal.aborted) return;
        const msg = body.message;
        if (typeof msg === "string") {
          startTransition(() => setCompaniesMessage(msg));
        }
        if (Array.isArray(body.holdings)) {
          const next = body.holdings;
          startTransition(() => {
            setHoldings(next);
            setTicker((t) => t || next[0]?.ticker || "");
          });
        }
      })
      .catch(() => {
        if (active && !ctrl.signal.aborted) {
          startTransition(() =>
            setCompaniesMessage("Could not load companies (network error or timeout)."),
          );
        }
      })
      .finally(() => {
        window.clearTimeout(deadline);
        if (active) startTransition(() => setLoadingHoldings(false));
      });

    return () => {
      active = false;
      window.clearTimeout(deadline);
      ctrl.abort();
      startTransition(() => setLoadingHoldings(false));
    };
  }, [initialHoldings.length]);
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
        Loading companies from Omnigraph (and fallbacks)…
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
          {companiesMessage ??
            "Run the price harvester, configure Omnigraph (OMNIGRAPH_URL), Supabase, or add data/price-db.json."}
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

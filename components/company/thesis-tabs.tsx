"use client";

import { useState } from "react";

import type { CompanyDecision, EvidenceRef } from "@/lib/types";

const TABS = [
  { id: "bull", label: "Bull" },
  { id: "skeptic", label: "Skeptic" },
  { id: "risk", label: "Risk" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function EvidenceList({
  evidence,
  ids,
}: {
  evidence: EvidenceRef[];
  ids: string[];
}) {
  const map = new Map(evidence.map((e) => [e.id, e]));
  return (
    <ul className="mt-3 space-y-2">
      {ids.map((id) => {
        const e = map.get(id);
        if (!e) {
          return (
            <li key={id} className="text-xs text-text-muted">
              {id} (missing ref)
            </li>
          );
        }
        return (
          <li
            key={id}
            className="rounded-md border border-border-subtle bg-bg-muted/40 p-3 text-sm"
          >
            <div className="font-mono text-xs text-accent">{e.id}</div>
            <div className="font-medium text-text-primary">{e.title}</div>
            {e.source ? (
              <div className="text-xs text-text-muted">{e.source}</div>
            ) : null}
            {e.excerpt ? (
              <p className="mt-1 text-text-secondary">{e.excerpt}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ThesisTabs({ decision }: { decision: CompanyDecision }) {
  const [tab, setTab] = useState<TabId>("bull");

  const active =
    tab === "bull"
      ? decision.thesis.bull
      : tab === "skeptic"
        ? decision.thesis.skeptic
        : decision.thesis.risk;

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated">
      <div
        role="tablist"
        aria-label="Thesis views"
        className="flex flex-wrap gap-1 border-b border-border-subtle p-2"
      >
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`min-h-[44px] rounded-md px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "bg-bg-muted text-text-primary ring-1 ring-border-subtle"
                  : "text-text-secondary hover:bg-bg-muted/60 hover:text-text-primary"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="p-4">
        <p className="text-sm leading-relaxed text-text-primary">{active.narrative}</p>
        <EvidenceList evidence={decision.evidence} ids={active.evidenceIds} />
      </div>
    </div>
  );
}

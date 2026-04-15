"use client";

import { useMemo, useState } from "react";

import type { Holding } from "@/lib/types";

export function CompanyPicker({
  holdings,
  value,
  onChange,
}: {
  holdings: Holding[];
  value: string;
  onChange: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return holdings;
    return holdings.filter(
      (h) => h.ticker.includes(q) || h.name.toUpperCase().includes(q),
    );
  }, [holdings, query]);

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        Company
      </label>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ticker or name…"
        className="w-full rounded-lg border border-border-subtle bg-bg-muted/40 px-3 py-2 text-sm text-text-primary outline-none ring-0 placeholder:text-text-muted focus:border-accent"
        aria-autocomplete="list"
        aria-controls="company-suggestions"
      />
      <ul
        id="company-suggestions"
        className="max-h-48 overflow-auto rounded-lg border border-border-subtle bg-bg-elevated"
        role="listbox"
      >
        {filtered.map((h) => {
          const selected = h.ticker === value;
          return (
            <li key={h.ticker} role="option" aria-selected={selected}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  selected ? "bg-accent/10 text-text-primary" : "hover:bg-bg-muted/50"
                }`}
                onClick={() => {
                  onChange(h.ticker);
                  setQuery("");
                }}
              >
                <span className="font-mono font-medium">{h.ticker}</span>
                <span className="text-text-secondary">{h.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="text-xs text-text-muted">
        Selected: <span className="font-mono text-text-primary">{value || "—"}</span>
      </div>
    </div>
  );
}

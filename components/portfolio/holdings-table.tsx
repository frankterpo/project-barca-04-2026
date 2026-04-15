"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { Holding } from "@/lib/types";

type SortKey = "ticker" | "weightPct" | "convictionBand";

function bandStyles(band: Holding["convictionBand"]) {
  switch (band) {
    case "A":
      return "bg-positive/15 text-positive ring-1 ring-positive/30";
    case "B":
      return "bg-warning/15 text-warning ring-1 ring-warning/30";
    default:
      return "bg-negative/10 text-negative ring-1 ring-negative/25";
  }
}

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "weightPct",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const copy = [...holdings];
    copy.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "ticker") return a.ticker.localeCompare(b.ticker) * dir;
      if (sort.key === "weightPct") return (a.weightPct - b.weightPct) * dir;
      return a.convictionBand.localeCompare(b.convictionBand) * dir;
    });
    return copy;
  }, [holdings, sort]);

  if (holdings.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-border-subtle bg-bg-elevated/40 p-8 text-center text-sm text-text-secondary"
        role="status"
      >
        No holdings yet. Run{" "}
        <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-text-primary">
          pnpm run demo:seed
        </code>{" "}
        to generate mock JSON fixtures.
      </div>
    );
  }

  function toggle(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-muted/60 text-xs uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              <button
                type="button"
                className="font-semibold hover:text-text-primary"
                onClick={() => toggle("ticker")}
              >
                Ticker {sort.key === "ticker" ? (sort.dir === "asc" ? "↑" : "↓") : ""}
              </button>
            </th>
            <th scope="col" className="px-4 py-3">
              Name
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <button
                type="button"
                className="font-semibold hover:text-text-primary"
                onClick={() => toggle("weightPct")}
              >
                Weight {sort.key === "weightPct" ? (sort.dir === "asc" ? "↑" : "↓") : ""}
              </button>
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <button
                type="button"
                className="font-semibold hover:text-text-primary"
                onClick={() => toggle("convictionBand")}
              >
                Band {sort.key === "convictionBand" ? (sort.dir === "asc" ? "↑" : "↓") : ""}
              </button>
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Detail
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {sorted.map((h) => (
            <tr key={h.ticker} className="hover:bg-bg-muted/40">
              <td className="px-4 py-3 font-mono font-medium text-text-primary">{h.ticker}</td>
              <td className="px-4 py-3 text-text-secondary">{h.name}</td>
              <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                {h.weightPct.toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right">
                <span
                  className={`inline-flex min-w-[2rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${bandStyles(h.convictionBand)}`}
                >
                  {h.convictionBand}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/company/${h.ticker}`}
                  className="text-accent hover:text-accent-muted"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

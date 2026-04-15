"use client";

import { JUDGE_PRESETS } from "@/lib/judge-presets";

export function PresetButtons({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="grid gap-2">
      {JUDGE_PRESETS.map((p) => {
        const pressed = selectedId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={pressed}
            className={`min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm transition ${
              pressed
                ? "border-accent bg-accent/10 text-text-primary ring-1 ring-accent/40"
                : "border-border-subtle bg-bg-elevated text-text-secondary hover:border-border-subtle hover:bg-bg-muted/50 hover:text-text-primary"
            }`}
            onClick={() => onSelect(p.id)}
          >
            <span className="font-mono text-xs text-text-muted">Q{p.id}</span>{" "}
            <span className="block sm:inline">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

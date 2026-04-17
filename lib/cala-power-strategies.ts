/**
 * Optional power-weighted allocation grid for Cala harvest optimization.
 *
 * CALA_POWER_GRID — comma/semicolon-separated pairs: topN:power (e.g. `8:2,10:2,12:2.5`).
 * If unset, falls back to CALA_POWER_TOPN_LIST × CALA_POWER_EXPONENT_LIST (cartesian),
 * then to defaults 8:2 and 12:2.
 */

import { buildPowerTopWeighted, type CalaAllocationRow, type CalaPriceEntry } from "./cala-portfolio-math";

export const DEFAULT_CALA_POWER_PAIRS: ReadonlyArray<{ topN: number; power: number }> = [
  { topN: 8, power: 2 },
  { topN: 12, power: 2 },
];

const MAX_POWER_STRATEGIES = 32;

function dedupePairs(pairs: { topN: number; power: number }[]): { topN: number; power: number }[] {
  const seen = new Set<string>();
  const out: { topN: number; power: number }[] = [];
  for (const p of pairs) {
    const topN = Math.min(50, Math.max(2, Math.floor(p.topN)));
    const power = Math.min(10, Math.max(0.5, p.power));
    const key = `${topN}:${power}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ topN, power });
    if (out.length >= MAX_POWER_STRATEGIES) break;
  }
  return out;
}

/** Parse `8:2, 12:2.5` or `8x2` into { topN, power }[]. */
export function parseCalaPowerGridString(raw: string): { topN: number; power: number }[] {
  const out: { topN: number; power: number }[] = [];
  for (const part of raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[:xX]\s*(\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const topN = parseInt(m[1], 10);
    const power = parseFloat(m[2]);
    if (!Number.isFinite(topN) || !Number.isFinite(power)) continue;
    out.push({ topN, power });
  }
  return dedupePairs(out);
}

function parseNumberList(raw: string | undefined, intMode: boolean): number[] {
  if (!raw?.trim()) return [];
  const nums: number[] = [];
  for (const part of raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const n = intMode ? parseInt(part, 10) : parseFloat(part);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

/** Resolve grid from env: CALA_POWER_GRID wins; else cartesian of TOPN × EXPONENT lists; else defaults. */
export function resolveCalaPowerPairsFromEnv(env: NodeJS.ProcessEnv = process.env): { topN: number; power: number }[] {
  const gridRaw = env.CALA_POWER_GRID?.trim();
  if (gridRaw) {
    const parsed = parseCalaPowerGridString(gridRaw);
    if (parsed.length > 0) return parsed;
  }

  const topNs = parseNumberList(env.CALA_POWER_TOPN_LIST, true).filter((n) => n >= 2 && n <= 50);
  const powers = parseNumberList(env.CALA_POWER_EXPONENT_LIST, false).filter((p) => p > 0 && p <= 10);
  if (topNs.length > 0 && powers.length > 0) {
    const cart: { topN: number; power: number }[] = [];
    for (const topN of topNs) {
      for (const power of powers) {
        cart.push({ topN, power });
      }
    }
    const d = dedupePairs(cart);
    if (d.length > 0) return d;
  }

  return [...DEFAULT_CALA_POWER_PAIRS];
}

/** Stable strategy id for logs / retry (use `d` as decimal separator when needed). */
export function calaPowerStrategyId(topN: number, power: number): string {
  const p = Number.isInteger(power) ? String(power) : String(power).replace(".", "d");
  return `power_n${topN}_p${p}`;
}

export function parsePowerStrategyId(name: string): { topN: number; power: number } | null {
  const m = name.match(/^power_n(\d+)_p(.+)$/);
  if (!m) return null;
  const topN = parseInt(m[1], 10);
  const power = parseFloat(m[2].replace(/d/g, "."));
  if (!Number.isFinite(topN) || !Number.isFinite(power)) return null;
  return { topN, power };
}

export function buildPowerStrategiesForEntries(
  entries: CalaPriceEntry[],
  pairs?: { topN: number; power: number }[],
): { name: string; allocs: CalaAllocationRow[] }[] {
  const use = pairs ?? resolveCalaPowerPairsFromEnv();
  return use.map(({ topN, power }) => ({
    name: calaPowerStrategyId(topN, power),
    allocs: buildPowerTopWeighted(entries, { topN, power }),
  }));
}

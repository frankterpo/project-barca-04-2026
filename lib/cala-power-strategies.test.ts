import { describe, expect, it } from "vitest";
import {
  buildPowerStrategiesForEntries,
  calaPowerStrategyId,
  parseCalaPowerGridString,
  parsePowerStrategyId,
  resolveCalaPowerPairsFromEnv,
} from "./cala-power-strategies";
import type { CalaPriceEntry } from "./cala-portfolio-math";

const sampleEntries: CalaPriceEntry[] = Array.from({ length: 12 }, (_, i) => ({
  ticker: `S${i}`,
  purchasePrice: 10,
  evalPrice: 10 + i,
  returnPct: i,
}));

describe("parseCalaPowerGridString", () => {
  it("parses colon and x separators", () => {
    expect(parseCalaPowerGridString("8:2; 10x2.5")).toEqual([
      { topN: 8, power: 2 },
      { topN: 10, power: 2.5 },
    ]);
  });

  it("dedupes identical topN:power pairs", () => {
    const r = parseCalaPowerGridString("8:2,8:2,10:2");
    expect(r).toEqual([
      { topN: 8, power: 2 },
      { topN: 10, power: 2 },
    ]);
  });
});

describe("resolveCalaPowerPairsFromEnv", () => {
  it("prefers CALA_POWER_GRID", () => {
    const pairs = resolveCalaPowerPairsFromEnv({
      CALA_POWER_GRID: "6:1.5, 12:2",
      CALA_POWER_TOPN_LIST: "99",
      CALA_POWER_EXPONENT_LIST: "9",
    } as unknown as NodeJS.ProcessEnv);
    expect(pairs).toEqual([
      { topN: 6, power: 1.5 },
      { topN: 12, power: 2 },
    ]);
  });

  it("uses cartesian lists when grid empty", () => {
    const pairs = resolveCalaPowerPairsFromEnv({
      CALA_POWER_TOPN_LIST: "8,10",
      CALA_POWER_EXPONENT_LIST: "2,3",
    } as unknown as NodeJS.ProcessEnv);
    expect(pairs).toContainEqual({ topN: 8, power: 2 });
    expect(pairs).toContainEqual({ topN: 10, power: 3 });
  });
});

describe("calaPowerStrategyId / parsePowerStrategyId", () => {
  it("round-trips integer power", () => {
    const id = calaPowerStrategyId(10, 2);
    expect(id).toBe("power_n10_p2");
    expect(parsePowerStrategyId(id)).toEqual({ topN: 10, power: 2 });
  });

  it("round-trips fractional power via d", () => {
    const id = calaPowerStrategyId(8, 2.5);
    expect(id).toBe("power_n8_p2d5");
    expect(parsePowerStrategyId(id)).toEqual({ topN: 8, power: 2.5 });
  });

  it("returns null for legacy names", () => {
    expect(parsePowerStrategyId("power_top8")).toBeNull();
  });
});

describe("buildPowerStrategiesForEntries", () => {
  it("builds one strategy per resolved pair", () => {
    const strategies = buildPowerStrategiesForEntries(sampleEntries, [
      { topN: 8, power: 2 },
      { topN: 4, power: 1 },
    ]);
    expect(strategies.map((s) => s.name)).toEqual(["power_n8_p2", "power_n4_p1"]);
    // Fewer than 50 entries → buildPowerTopWeighted falls back to max-concentration slice
    expect(strategies[0].allocs.length).toBe(sampleEntries.length);
  });
});
